const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  buildCaptainPendingArchiveSnapshot,
  fingerprintCaptainPendingArchiveSnapshot,
  paginateById,
  matchesCaptainPendingArchiveApproval,
  archiveCaptainPendingCandidates,
} = require("./captain-pending-archive-policy");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL,
    account_status TEXT NOT NULL,
    wallet_cents INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE order_candidates (
    id INTEGER PRIMARY KEY,
    source_message_id TEXT NOT NULL UNIQUE,
    group_id TEXT NOT NULL,
    public_trip_no INTEGER,
    raw_text TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    origin TEXT,
    destination TEXT,
    trip_time TEXT,
    order_kind TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL,
    archive_state TEXT NOT NULL DEFAULT 'active',
    pending_captain_user_id INTEGER,
    pending_message_id TEXT,
    pending_at TEXT,
    final_order_id INTEGER,
    lifecycle_stage TEXT NOT NULL DEFAULT 'candidate_created',
    lifecycle_blocker TEXT,
    lifecycle_updated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    archive_reason TEXT
  );
  CREATE TABLE order_candidate_acceptances (
    id INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL,
    captain_user_id INTEGER NOT NULL,
    acceptance_message_id TEXT NOT NULL,
    acceptance_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    source_message_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    order_no INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    origin TEXT,
    destination TEXT,
    trip_time TEXT,
    status TEXT NOT NULL,
    settlement_state TEXT NOT NULL,
    archive_state TEXT NOT NULL DEFAULT 'active',
    pending_captain_user_id INTEGER,
    pending_message_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE order_settlements (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    applied_at TEXT
  );
  CREATE TABLE wallet_ledger (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    reference TEXT NOT NULL
  );
  CREATE TABLE direct_rides (
    id INTEGER PRIMARY KEY,
    request_code TEXT NOT NULL,
    status TEXT NOT NULL
  );
`);

db.prepare("INSERT INTO users(id,name,role,active,account_status,wallet_cents) VALUES(1,'Captain One','captain',1,'active',12000)").run();
db.prepare("INSERT INTO users(id,name,role,active,account_status,wallet_cents) VALUES(2,'Captain Inactive','captain',0,'active',5000)").run();
db.prepare("INSERT INTO users(id,name,role,active,account_status,wallet_cents) VALUES(3,'Captain Pending','captain',1,'pending',3000)").run();

const groupId = "approved-group@g.us";
const otherGroupId = "secondary-group@g.us";
const snapshotAt = "2026-11-28T10:00:00.000Z";
const beforeAt = "2026-11-20T10:00:00.000Z";
const afterAt = "2026-11-29T10:00:00.000Z";
const insertCandidate = db.prepare(`INSERT INTO order_candidates
  (id,source_message_id,group_id,public_trip_no,raw_text,price_cents,origin,destination,trip_time,order_kind,
   status,archive_state,pending_captain_user_id,pending_message_id,pending_at,final_order_id,
   lifecycle_stage,lifecycle_blocker,created_at,updated_at)
  VALUES(@id,@source,@group,@publicNo,@raw,@price,@origin,@destination,@tripTime,'normal',
   @status,@archive,@captain,@pendingMessage,@pendingAt,@finalOrder,'acceptance_pending',NULL,@created,@updated)`);
function candidate({ id, source, group = groupId, status = "pending", archive = "active", captain = 1, pendingAt = beforeAt, created = beforeAt, finalOrder = null }) {
  insertCandidate.run({
    id, source, group, publicNo: id + 100, raw: `fixture request ${id}`, price: 500,
    origin: "North", destination: "Central", tripTime: "10:00", status, archive,
    captain, pendingMessage: `pending-${id}`, pendingAt, finalOrder, created, updated: beforeAt,
  });
}

candidate({ id: 1, source: "source-eligible" });
candidate({ id: 2, source: "source-assigned-after", pendingAt: afterAt });
candidate({ id: 3, source: "source-missing-time", pendingAt: null });
candidate({ id: 4, source: "source-final-link", finalOrder: 44 });
candidate({ id: 5, source: "source-open-link" });
candidate({ id: 6, source: "source-history-link" });
candidate({ id: 7, source: "source-inactive-captain", captain: 2 });
candidate({ id: 8, source: "source-pending-account", captain: 3 });
candidate({ id: 9, source: "source-other-group", group: otherGroupId });
candidate({ id: 10, source: "source-not-pending", status: "candidate" });
candidate({ id: 11, source: "source-already-archived", archive: "archived" });

db.prepare(`INSERT INTO orders
  (id,source_message_id,group_id,order_no,raw_text,price_cents,origin,destination,trip_time,status,settlement_state,archive_state,pending_captain_user_id,pending_message_id,created_at,updated_at)
  VALUES(1,'source-open-link',? ,701,'fixture open',500,'North','Central','10:00','open','pending','active',1,'open-pending',?,?)`).run(groupId, beforeAt, beforeAt);
db.prepare(`INSERT INTO orders
  (id,source_message_id,group_id,order_no,raw_text,price_cents,origin,destination,trip_time,status,settlement_state,archive_state,pending_captain_user_id,pending_message_id,created_at,updated_at)
  VALUES(2,'source-history-link',? ,702,'fixture settled',500,'North','Central','10:00','completed','settled','active',NULL,NULL,?,?)`).run(groupId, beforeAt, beforeAt);
db.prepare("INSERT INTO order_settlements(id,order_id,status,applied_at) VALUES(1,2,'applied',?)").run(beforeAt);
db.prepare("INSERT INTO order_candidate_acceptances(id,candidate_id,captain_user_id,acceptance_message_id,acceptance_mode,status,created_at,updated_at) VALUES(1,1,1,'acceptance-one','quoted','pending',?,?)").run(beforeAt, beforeAt);
db.prepare("INSERT INTO order_candidate_acceptances(id,candidate_id,captain_user_id,acceptance_message_id,acceptance_mode,status,created_at,updated_at) VALUES(2,1,1,'acceptance-two','unquoted','selected',?,?)").run(beforeAt, beforeAt);
db.prepare("INSERT INTO order_candidate_acceptances(id,candidate_id,captain_user_id,acceptance_message_id,acceptance_mode,status,created_at,updated_at) VALUES(3,1,1,'acceptance-rejected','quoted','rejected',?,?)").run(beforeAt, beforeAt);
db.prepare("INSERT INTO order_candidate_acceptances(id,candidate_id,captain_user_id,acceptance_message_id,acceptance_mode,status,created_at,updated_at) VALUES(4,2,1,'acceptance-new','quoted','pending',?,?)").run(afterAt, afterAt);
db.prepare("INSERT INTO wallet_ledger(id,user_id,amount_cents,reference) VALUES(1,1,-100,'fixture-ledger')").run();
db.prepare("INSERT INTO direct_rides(id,request_code,status) VALUES(1,'DIRECT-FIXTURE','in_progress')").run();

function findEquivalentOrder(group, source) {
  return db.prepare("SELECT * FROM orders WHERE group_id=? AND source_message_id=? ORDER BY id DESC LIMIT 1").get(group, source) || null;
}
function build(at = snapshotAt) {
  return buildCaptainPendingArchiveSnapshot(db, { groupId, evaluationAt: at, findEquivalentOrder });
}
function rows(table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
}
function protectedSnapshot() {
  return {
    users: rows("users"),
    orders: rows("orders"),
    settlements: rows("order_settlements"),
    ledger: rows("wallet_ledger"),
    directRides: rows("direct_rides"),
  };
}

const beforePreview = protectedSnapshot();
const preview = build();
const previewHash = fingerprintCaptainPendingArchiveSnapshot(groupId, preview);
assert.equal(preview.archiveableCandidates.length, 1, "only the old, valid, unlinked pending candidate is archivable");
assert.deepEqual(preview.archiveableCandidates.map((row) => row.candidate_id), [1]);
assert.deepEqual(new Set(preview.protectedCandidates.map((row) => row.protectionReason)), new Set([
  "assigned_after_snapshot",
  "unclassifiable_timestamp",
  "final_order_linked",
  "linked_open_order",
  "linked_order_history",
]));
assert.equal(preview.ongoingOrders.length, 1, "open Captain-visible orders are preserved separately");
assert.equal(preview.candidates.some((row) => [7, 8, 9, 10, 11].includes(row.candidate_id)), false,
  "inactive, other-group, non-pending and already archived rows are not in the live Captain candidate queue");
assert.deepEqual(protectedSnapshot(), beforePreview, "preview reads the database without writing order, finance, or ride data");
assert.match(previewHash, /^[0-9a-f]{64}$/);
assert.equal(matchesCaptainPendingArchiveApproval(groupId, preview, previewHash, [1]), true);
assert.equal(matchesCaptainPendingArchiveApproval(groupId, preview, previewHash, [1, 2]), false, "an extra protected ID is not approved");
assert.equal(matchesCaptainPendingArchiveApproval(groupId, preview, "0".repeat(64), [1]), false, "a mismatched fingerprint is rejected");
assert.equal(matchesCaptainPendingArchiveApproval(groupId, preview, previewHash, [1, 1]), false, "duplicate IDs are rejected");

const pageSource = preview.candidates.slice().reverse();
const pageOne = paginateById(pageSource, 0, 2);
assert.equal(pageOne.rows.length, 2);
assert.deepEqual(pageOne.rows.map((row) => row.candidate_id), [1, 2], "page order is stable even when the source array is reversed");
assert.equal(pageOne.nextCursor, 2);
const pageTwo = paginateById(pageSource, pageOne.nextCursor, 20);
assert.deepEqual(pageTwo.rows.map((row) => row.candidate_id), [3, 4, 5, 6], "cursor pagination does not skip rows");
assert.equal(pageTwo.nextCursor, null);

const originalUpdatedAt = db.prepare("SELECT updated_at FROM order_candidates WHERE id=1").get().updated_at;
const originalRawText = db.prepare("SELECT raw_text FROM order_candidates WHERE id=1").get().raw_text;
const originalAcceptanceUpdatedAt = db.prepare("SELECT updated_at FROM order_candidate_acceptances WHERE id=1").get().updated_at;
db.prepare("UPDATE order_candidates SET updated_at=? WHERE id=1").run("2026-11-28T09:59:59.999Z");
const timestampRefreshedPreview = build();
assert.equal(fingerprintCaptainPendingArchiveSnapshot(groupId, timestampRefreshedPreview), previewHash,
  "a timestamp-only background refresh does not change the material preview fingerprint");
db.prepare("UPDATE order_candidate_acceptances SET updated_at=? WHERE id=1").run("2026-11-28T09:59:59.999Z");
const acceptanceTimestampRefreshedPreview = build();
assert.equal(fingerprintCaptainPendingArchiveSnapshot(groupId, acceptanceTimestampRefreshedPreview), previewHash,
  "an acceptance timestamp-only refresh does not change the material preview fingerprint");
assert.equal(matchesCaptainPendingArchiveApproval(groupId, acceptanceTimestampRefreshedPreview, previewHash, [1]), true);
db.prepare("UPDATE order_candidate_acceptances SET updated_at=? WHERE id=1").run(originalAcceptanceUpdatedAt);
db.prepare("UPDATE order_candidates SET raw_text=?,updated_at=? WHERE id=1").run("fixture request materially changed", "2026-11-28T09:59:59.999Z");
const changedPreview = build();
assert.notEqual(fingerprintCaptainPendingArchiveSnapshot(groupId, changedPreview), previewHash,
  "a material request change after preview still invalidates the fingerprint");
db.prepare("UPDATE order_candidates SET raw_text=?,updated_at=? WHERE id=1").run(originalRawText, originalUpdatedAt);

const acceptanceBeforeStaleWrite = rows("order_candidate_acceptances");
db.prepare("UPDATE order_candidates SET updated_at=? WHERE id=1").run("2026-11-28T09:59:59.998Z");
assert.throws(() => db.transaction(() => archiveCaptainPendingCandidates(db, {
  groupId,
  candidates: preview.archiveableCandidates,
  stamp: "2026-11-28T10:04:00.000Z",
  reason: "stale-preview-must-not-write",
})).immediate(), /CAPTAIN_QUEUE_ARCHIVE_STALE_CANDIDATE/);
assert.equal(db.prepare("SELECT status FROM order_candidates WHERE id=1").get().status, "pending", "stale candidate remains pending after atomic rollback");
assert.deepEqual(rows("order_candidate_acceptances"), acceptanceBeforeStaleWrite, "stale candidate rollback restores every acceptance status");
db.prepare("UPDATE order_candidates SET updated_at=? WHERE id=1").run(originalUpdatedAt);

let auditedCandidateIds = [];
const archived = db.transaction(() => archiveCaptainPendingCandidates(db, {
  groupId,
  candidates: preview.archiveableCandidates,
  stamp: "2026-11-28T10:05:00.000Z",
  reason: "owner-confirmed-captain-queue-preview",
  onCandidateArchived: (row) => auditedCandidateIds.push(row.candidate_id),
})).immediate();
assert.deepEqual(archived, { archivedCount: 1, candidateIds: [1] });
assert.deepEqual(auditedCandidateIds, [1]);
const archivedCandidate = db.prepare("SELECT status,archive_state,archived_at,pending_captain_user_id,pending_message_id,pending_at FROM order_candidates WHERE id=1").get();
assert.equal(archivedCandidate.status, "cancelled");
assert.equal(archivedCandidate.archive_state, "archived");
assert.equal(archivedCandidate.pending_captain_user_id, null);
assert.equal(archivedCandidate.pending_message_id, null);
assert.equal(archivedCandidate.pending_at, null);
assert.equal(db.prepare("SELECT status FROM order_candidate_acceptances WHERE id=1").get().status, "cancelled");
assert.equal(db.prepare("SELECT status FROM order_candidate_acceptances WHERE id=2").get().status, "cancelled");
assert.equal(db.prepare("SELECT status FROM order_candidate_acceptances WHERE id=3").get().status, "rejected", "rejected acceptance history is preserved");
assert.equal(db.prepare("SELECT status FROM order_candidate_acceptances WHERE id=4").get().status, "pending", "non-selected candidate acceptance is untouched");
assert.deepEqual(protectedSnapshot(), beforePreview, "archiving candidates leaves users/wallets, orders, settlements, ledger, and direct rides byte-for-byte unchanged");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_candidates").get().count, 11, "candidate/history rows are retained, not deleted");

console.log("captain pending archive policy checks passed");
db.close();
