"use strict";
// Owner instruction 2026-11-24 12:38 +03: «نفّذ» on erasing the financial and audit history of the outside-group
// tombstones. Destruction is only acceptable if it is provably aimed at exactly that population, so this test runs
// the real write sequence against a real database and asserts what survived: every orders row, the company's own
// commission ledger rows, and every row whose subject is still an active captain.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const source = fs.readFileSync("server.js", "utf8");
const reasonMatch = source.match(/const OUTSIDE_GROUP_CAPTAIN_ARCHIVE_REASON = "([^"]+)";/);
assert.ok(reasonMatch, "the tombstone reason constant must exist for the purge to be scoped by it");
const REASON = reasonMatch[1];
assert.equal(REASON, "خارج القروب الرسمي — قرار المالك");

const blockStart = source.indexOf('const REMOVED_CAPTAIN_HISTORY_PURGE_CONFIRMATION = "PURGE_REMOVED_CAPTAIN_FINANCIAL_HISTORY";');
const blockEnd = source.indexOf('app.get("/api/admin/group/live-messages"');
assert.ok(blockStart >= 0 && blockEnd > blockStart, "the purge block must exist and sit before the group live-messages route");
assert.ok(blockStart > source.indexOf('const OUTSIDE_GROUP_CAPTAIN_REMOVAL_CONFIRMATION = "REMOVE_CAPTAINS_OUTSIDE_OFFICIAL_GROUP";'),
  "the purge block must come after the removal block");
const block = source.slice(blockStart, blockEnd);

const schemaAnchor = source.indexOf("db.exec(`\nCREATE TABLE IF NOT EXISTS users (");
assert.ok(schemaAnchor >= 0, "the schema literal must be found to build a real fixture database");
const schemaStart = source.indexOf("CREATE TABLE IF NOT EXISTS users (", schemaAnchor);
const schemaEnd = source.indexOf("`);", schemaStart);
const schema = source.slice(schemaStart, schemaEnd);
assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS order_settlements") && schema.includes("CREATE TABLE IF NOT EXISTS captain_merge_history"),
  "the fixture schema must carry the tables this purge writes");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "removed-history-purge-"));
const db = new Database(path.join(dir, "purge.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(schema);
for (const sql of [
  "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'",
  "ALTER TABLE users ADD COLUMN archived_at TEXT",
  "ALTER TABLE users ADD COLUMN archive_reason TEXT",
  "ALTER TABLE orders ADD COLUMN pending_captain_user_id INTEGER",
  "ALTER TABLE orders ADD COLUMN pending_message_id TEXT",
  "ALTER TABLE orders ADD COLUMN pending_at TEXT",
  "ALTER TABLE orders ADD COLUMN producer_phone_snapshot TEXT",
  "ALTER TABLE orders ADD COLUMN producer_name_snapshot TEXT",
  "ALTER TABLE orders ADD COLUMN captain_phone_snapshot TEXT",
  "ALTER TABLE orders ADD COLUMN captain_name_snapshot TEXT",
  "ALTER TABLE orders ADD COLUMN confirmed_by_phone TEXT",
  "ALTER TABLE orders ADD COLUMN settlement_state TEXT NOT NULL DEFAULT 'pending'",
]) db.exec(sql);
// charged_user_id / approval_reaction_user_id and their foreign keys are already declared in the schema literal,
// so only the legacy-database ALTERs have to be replayed here.
assert.ok(schema.includes("FOREIGN KEY(charged_user_id) REFERENCES users(id)"), "the fixture must carry the settlement foreign keys the purge writes");
assert.ok(schema.includes("FOREIGN KEY(ledger_id) REFERENCES wallet_ledger(id)"), "the fixture must carry the charge-to-ledger foreign key that fixes delete order");

// Synthetic numbers assembled from short pieces so no literal long digit run enters the repository.
const P = (head, tail) => "962" + head + tail;
const T1 = P("790", "000555");
const T2 = P("790", "000666");
const T3 = P("790", "000557");
const T4 = P("790", "000558");
const A1 = P("790", "000333");
const A2 = P("790", "000444");
const BOT = P("799", "999000");
const STAMP = "2026-11-24T09:00:00.000Z";
const ins = (table, row) => {
  const keys = Object.keys(row).filter((key) => row[key] !== undefined);
  db.prepare("INSERT INTO " + table + " (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((key) => row[key]));
};

// --- fixture ------------------------------------------------------------------
ins("users", { id: 1, phone: P("770", "000001"), name: "company", role: "company", wallet_cents: 68781, active: 1, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "active" });
ins("users", { id: 2, phone: BOT, name: "bot", role: "captain", wallet_cents: 0, active: 1, is_bot: 1, created_at: STAMP, updated_at: STAMP, account_status: "active" });
ins("users", { id: 3, phone: A1, name: "active-A", role: "captain", wallet_cents: 5000, active: 1, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "active" });
ins("users", { id: 4, phone: A2, name: "active-B", role: "captain", wallet_cents: 3000, active: 1, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "active" });
ins("users", { id: 5, phone: T1, name: "removed-T1", role: "captain", wallet_cents: 1200, active: 0, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "deleted", archived_at: STAMP, archive_reason: REASON });
ins("users", { id: 6, phone: T2, name: "removed-T2", role: "captain", wallet_cents: 0, active: 0, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "deleted", archived_at: STAMP, archive_reason: REASON });
// Neither of these may ever enter the target set: a merged account and a tombstone from a different decision.
ins("users", { id: 7, phone: P("790", "000777"), name: "merged", role: "captain", wallet_cents: 0, active: 0, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "merged", archive_reason: REASON });
ins("users", { id: 8, phone: P("790", "000888"), name: "other-reason", role: "captain", wallet_cents: 700, active: 0, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "deleted", archived_at: STAMP, archive_reason: "سبب آخر" });
// This is the live shape the owner's 1007 removals actually have today: the debt policy re-labelled the
// tombstone 'suspended' (active=0, archived_at and the reason left alone). It is still the same decision.
ins("users", { id: 9, phone: T3, name: "removed-T3-suspended", role: "captain", wallet_cents: 900, active: 0, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "suspended", archived_at: STAMP, archive_reason: REASON });
// The opposite case, and it exists in production: tombstoned, then registered again. A live account keeps
// its whole record, even though the old reason is still written on it.
ins("users", { id: 10, phone: T4, name: "re-registered", role: "captain", wallet_cents: 0, active: 1, is_bot: 0, created_at: STAMP, updated_at: STAMP, account_status: "active", archived_at: STAMP, archive_reason: REASON });

const phoneOf = (id) => ({ 1: P("770", "000001"), 2: BOT, 3: A1, 4: A2, 5: T1, 6: T2, 7: P("790", "000777"), 8: P("790", "000888"), 9: T3, 10: T4 })[id] || null;
const order = (id, producer, captain, status, confirmedPhone) => ins("orders", {
  id, order_no: 100 + id, source_message_id: "ORDER-" + id, group_id: "group", raw_text: "السعر 15", price_cents: 1500,
  order_kind: id === 103 ? "order" : "normal", producer_user_id: producer, captain_user_id: captain, status,
  settlement_state: status === "open" ? "pending" : "settled", company_cents: 255, producer_cents: 255, captain_cents: 300,
  confirmed_by_phone: confirmedPhone, producer_phone_snapshot: producer ? phoneOf(producer) : null,
  captain_phone_snapshot: captain ? phoneOf(captain) : null, captain_name_snapshot: captain ? "snap-" + captain : null,
  created_at: STAMP, updated_at: STAMP,
});
order(101, 5, 3, "accepted", A1);    // removed downloader, active executor
order(102, 3, 5, "completed", A1);   // active downloader, removed executor -> settlement leaves
order(103, 5, 6, "accepted", T1);    // both sides removed
order(104, 3, 4, "accepted", A1);    // fully active, the control row
order(105, 5, null, "open", T1);     // removed downloader only, never accepted
order(106, 3, 9, "accepted", A1);    // executed by the re-labelled tombstone

const settlement = (id, orderId, captain, producer, charged, approval) => ins("order_settlements", {
  id, order_id: orderId, status: "applied", idempotency_key: "SET-" + id, captain_user_id: captain, producer_user_id: producer,
  charged_user_id: charged, approval_reaction_user_id: approval, price_cents: 1500, company_cents: 255, producer_cents: 255,
  captain_fee_cents: 300, created_at: STAMP, applied_at: STAMP,
});
settlement(1, 101, 3, 5, 3, 5);
settlement(2, 102, 5, 3, 5, 3);
settlement(3, 103, 5, 6, 5, 6);
settlement(4, 104, 3, 4, 3, 4);
settlement(5, 106, 9, 3, 9, 3);   // the suspended tombstone as executor

const ledger = (id, user, orderId, type, amount) => ins("wallet_ledger", {
  id, user_id: user, order_id: orderId, type, amount_cents: amount, balance_after_cents: amount, reference: "REF-" + id, created_at: STAMP,
});
ledger(1, 1, 101, "commission_company", 255);
ledger(2, 1, 102, "commission_company", 255);
ledger(3, 1, 104, "commission_company", 300);
ledger(4, 3, 101, "commission_credit", 1000);
ledger(5, 5, 102, "commission_debit", -300);
ledger(6, 5, null, "topup", 1200);
ledger(7, 6, null, "topup", 500);
ledger(8, 4, 104, "commission_credit", 400);
ledger(9, 8, null, "topup", 700);
ledger(10, 9, null, "topup", 900);
ledger(11, 10, null, "topup", 400);  // the re-registered account's own money history

ins("order_candidates", { id: 201, source_message_id: "CAND-1", group_id: "group", raw_text: "السعر 15", price_cents: 1500, producer_user_id: 5, status: "finalized", final_order_id: 101, created_at: STAMP, updated_at: STAMP });
ins("order_candidates", { id: 202, source_message_id: "CAND-2", group_id: "group", raw_text: "السعر 20", price_cents: 2000, producer_user_id: 3, pending_captain_user_id: 5, status: "pending", created_at: STAMP, updated_at: STAMP });
ins("order_candidates", { id: 203, source_message_id: "CAND-3", group_id: "group", raw_text: "السعر 10", price_cents: 1000, producer_user_id: 6, status: "finalized", final_order_id: 103, created_at: STAMP, updated_at: STAMP });
const acceptance = (id, candidate, captain) => ins("order_candidate_acceptances", { id, candidate_id: candidate, captain_user_id: captain, acceptance_message_id: "ACC-" + id, created_at: STAMP, updated_at: STAMP });
acceptance(301, 202, 5);   // removed captain answered an active captain's request
acceptance(302, 201, 3);   // active captain answered a removed captain's request -> child of the leaving candidate
acceptance(303, 202, 4);   // active to active, must survive
ins("unresolved_order_messages", { id: 401, message_id: "MSG-1", group_id: "group", body: "السعر 15", first_seen_at: STAMP, last_seen_at: STAMP, candidate_id: 201 });
ins("special_booking_requests", { id: 501, request_code: "SP-1", customer_name: "c", phone: P("790", "001234"), origin: "a", destination: "b", trip_time: "09:00", created_at: STAMP, updated_at: STAMP, order_candidate_id: 201 });
ins("customer_booking_requests", { id: 601, request_code: "CB-1", customer_name: "c", phone: P("790", "005678"), origin: "a", destination: "b", trip_time: "09:00", request_type: "passenger", created_at: STAMP, updated_at: STAMP, order_candidate_id: 203 });
ins("captain_login_links", { id: 701, token_hash: "h1", token_last8: "lnk1a", captain_user_id: 5, expires_at: STAMP, created_at: STAMP, updated_at: STAMP });
ins("captain_login_links", { id: 702, token_hash: "h2", token_last8: "lnk2b", captain_user_id: 3, expires_at: STAMP, created_at: STAMP, updated_at: STAMP });
ins("captain_invites", { id: 801, token_hash: "i1", token_last8: "inv1a", created_at: STAMP, updated_at: STAMP, expires_at: STAMP, approved_user_id: 5 });
ins("topup_cards", { id: 901, code_hash: "c1", code_last4: "1234", value_cents: 1000, status: "redeemed", redeemed_by: 5, assigned_captain_id: 5, created_at: STAMP });
ins("topup_cards", { id: 902, code_hash: "c2", code_last4: "5678", value_cents: 2000, status: "redeemed", redeemed_by: 3, assigned_captain_id: 3, created_at: STAMP });
ins("topup_card_archive", { id: 1001, card_id: 901, captain_id: 5, captain_name_snapshot: "removed-T1", captain_phone_snapshot: T1, value_cents: 1000, prior_status: "issued", final_status: "void", sent_at: STAMP, archived_at: STAMP, destroyed_at: STAMP, reason: "x" });
ins("ride_ratings", { id: 1101, ride_id: 101, customer_phone: P("790", "009999"), captain_user_id: 5, rating: 5, token_hash: "r1", status: "submitted", expires_at: STAMP, created_at: STAMP, updated_at: STAMP });
ins("captain_merge_history", { id: 1201, source_captain_id: 5, target_captain_id: 3, source_phone: T1, target_phone: A1, created_at: STAMP });
ins("captain_merge_history", { id: 1202, source_captain_id: 8, target_captain_id: 7, source_phone: P("790", "008888"), target_phone: P("790", "007777"), created_at: STAMP });
ins("audit_logs", { id: 1301, actor_user_id: 5, action: "captain.login", entity_type: "user", entity_id: "5", created_at: STAMP });
ins("audit_logs", { id: 1302, actor_user_id: 3, action: "captain.login", entity_type: "user", entity_id: "3", created_at: STAMP });
ins("audit_logs", { id: 1303, actor_user_id: null, action: "captain.outside_group.unlinked", entity_type: "user", entity_id: "5", created_at: STAMP });
ins("audit_logs", { id: 1304, actor_user_id: 9, action: "captain.login", entity_type: "user", entity_id: "9", created_at: STAMP });
ins("notifications", { id: 1401, recipient_phone: T1, recipient_role: "captain", event: "x", title: "t", message: "m", created_at: STAMP });
ins("notifications", { id: 1402, recipient_phone: A1, recipient_role: "captain", event: "x", title: "t", message: "m", created_at: STAMP });
ins("notifications", { id: 1403, recipient_phone: T3, recipient_role: "captain", event: "x", title: "t", message: "m", created_at: STAMP });
ins("notifications", { id: 1404, recipient_phone: T4, recipient_role: "captain", event: "x", title: "t", message: "m", created_at: STAMP });
ins("whatsapp_identities", { id: 1501, user_id: 5, phone: T1, whatsapp_lid: "555@lid", source: "webjs", verified_at: STAMP, last_seen_at: STAMP });
ins("captain_phone_aliases", { phone: P("790", "002222"), captain_user_id: 5, created_at: STAMP });
ins("captain_auth_challenges", { id: 1601, captain_user_id: 5, phone: T1, purpose: "login", code_hash: "z", expires_at: STAMP, created_at: STAMP });
// An unlisted nullable foreign key: the sweep must detach it instead of letting it block the account deletion.
db.exec("CREATE TABLE probe_refs (id INTEGER PRIMARY KEY, captain_ref INTEGER REFERENCES users(id), locked_ref INTEGER NOT NULL REFERENCES users(id))");
ins("probe_refs", { id: 1701, captain_ref: 5, locked_ref: 3 });
ins("probe_refs", { id: 1702, captain_ref: null, locked_ref: 4 });

// --- run the block against that database ---------------------------------------
const sandbox = {
  db, fs, path, console, JSON, Math, Number, Object, String, Array, Date, Set, Map, Error, Promise, Buffer, setTimeout, crypto,
  DATA_DIR: dir,
  OUTSIDE_GROUP_CAPTAIN_ARCHIVE_REASON: REASON,
  now: () => STAMP,
  money: (cents) => Math.round(Number(cents || 0)) / 100,
  displayPhone: (phone) => "…" + String(phone || "").slice(-4),
  phoneWithCountry: (phone) => { const value = String(phone || "").replace(/\D/g, ""); return value.startsWith("962") ? value : "962" + value.replace(/^0/, ""); },
  connectedBotPhone: () => "0" + "799" + "999000",
  isProtectedOwnerIdentity: () => false,
  boundedDiagnosticText: (value, limit) => String(value && value.message ? value.message : value || "").slice(0, limit || 140),
  companyUser: () => db.prepare("SELECT * FROM users WHERE role='company' LIMIT 1").get(),
  audit: (action, entityType, entityId, details) => db.prepare("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details,created_at) VALUES(NULL,?,?,?,?,?)")
    .run(action, entityType, String(entityId), JSON.stringify(details || {}), STAMP),
  ensureOutsideGroupRemovalIndexes: () => ["stub"],
  requireOwnerAdmin: (req, res, next) => next(), adminReadLimiter: (req, res, next) => next(), adminMutationLimiter: (req, res, next) => next(),
  notifyOperations: () => Promise.resolve(true),
  app: { get: () => {}, post: () => {} },
};
vm.runInNewContext(block
  + "\nthis.purgeSteps = removedCaptainHistoryPurgeSteps;"
  + "\nthis.sweepSteps = removedCaptainHistorySweepSteps;"
  + "\nthis.purgeTargets = removedCaptainPurgeTargets;"
  + "\nthis.report = removedCaptainHistoryPurgeReport;"
  + "\nthis.runPurge = runRemovedCaptainHistoryPurge;"
  + "\nthis.staticColumns = REMOVED_HISTORY_STATIC_COLUMNS;"
  + "\nthis.backups = removedPurgeBackups;"
  + "\nthis.startBackup = startRemovedPurgeBackup;"
  + "\nthis.backupPromise = () => removedPurgeBackupPromise;"
  + "\nthis.exportSets = removedPurgeExports;"
  + "\nthis.buildExport = buildRemovedPurgeExport;"
  + "\nthis.publicExports = publicRemovedPurgeExportSets;"
  + "\nthis.stepCounts = removedPurgeStepCounts;"
  + "\nthis.partFor = removedPurgeExportPartFor;"
  + "\nthis.startExport = startRemovedPurgeExportBuild;"
  + "\nthis.exportPromise = () => removedPurgeExportPromise;"
  + "\nthis.exportSlice = REMOVED_PURGE_EXPORT_SLICE;"
  + "\nthis.confirmation = REMOVED_CAPTAIN_HISTORY_PURGE_CONFIRMATION;", sandbox);

const count = (sql, ...args) => Number(db.prepare(sql).get(...args).count || 0);
const stepCount = (report, key) => Number((report.steps.find((row) => row.key === key) || {}).count || 0);

// --- preview scope --------------------------------------------------------------
const preview = sandbox.report(0);
assert.equal(sandbox.confirmation, "PURGE_REMOVED_CAPTAIN_FINANCIAL_HISTORY");
// Values built inside the vm context belong to another realm, so identity is compared through this realm.
assert.deepEqual(Array.from(preview.targets.map((row) => Number(row.id)).sort((a, b) => a - b)), [5, 6, 9], "the recorded reason, not the status, decides the target set");
assert.equal(preview.targetCount, 3);
assert.deepEqual(Array.from(new Set(preview.targets.map((row) => String(row.accountStatus)))).sort(), ["deleted", "suspended"],
  "both a fresh tombstone and one the debt policy re-labelled are targets");
assert.equal(preview.targets.some((row) => Number(row.id) === 10), false, "an account that is live again is never a target");
assert.equal(preview.skippedProtected.length, 0);
assert.equal(count("SELECT COUNT(*) AS count FROM users WHERE id IN (7,8,10) AND role='captain'"), 3, "merged, other-reason and re-registered accounts exist but are out of scope");
assert.equal(stepCount(preview, "wallet_ledger"), 4, "the removed accounts own four ledger rows");
assert.equal(stepCount(preview, "order_settlements_executed"), 3, "three settlements name a removed executor, including the re-labelled tombstone");
assert.equal(stepCount(preview, "order_candidates"), 2, "two candidate requests were posted by removed accounts");
assert.equal(stepCount(preview, "order_candidate_acceptances_captain"), 1);
assert.equal(stepCount(preview, "order_candidate_acceptances_child"), 1);
assert.equal(stepCount(preview, "orders_producer"), 3, "orders keep existing: only the identity column is detached");
assert.equal(stepCount(preview, "orders_captain"), 3);
assert.equal(stepCount(preview, "notifications"), 2);
assert.equal(stepCount(preview, "audit_logs_actor"), 2, "only actions performed by them leave; records about them stay");
assert.equal(stepCount(preview, "whatsapp_identities"), 1);
assert.equal(stepCount(preview, "sweep_probe_refs_captain_ref"), 1, "the dynamic sweep must pick up an unlisted nullable foreign key");
assert.equal(preview.steps.filter((row) => String(row.key).includes("locked_ref")).length, 0,
  "a NOT NULL foreign key is never silently nulled - that account would surface as held instead");
assert.equal(preview.money.companyLedgerRowsInsideTargets, 0, "the company wallet must be provably outside the target set");
assert.equal(preview.money.orderRows.before, preview.money.orderRows.after, "orders rows are never deleted");
assert.equal(preview.money.overviewOrders.before, 5);
assert.equal(preview.money.overviewOrders.after, 2, "the dashboard booking figure is the settlement join, so it must be reported honestly");
assert.equal(preview.money.ledgerMoves.before, 11);
assert.equal(preview.money.ledgerMoves.after, 7);
assert.equal(preview.money.companyEarnings.total, 8.1);
assert.equal(preview.money.activeCaptainWallets.sum, 80, "active captain balances are untouched");
assert.equal(preview.walletCentsDestroyed, 2100, "the removed accounts' balances are the only wallet money leaving");
assert.equal(preview.money.inactiveTombstonesWithOtherReasons, 1, "a tombstone from another decision is counted as untouched, not as a target");
assert.equal(preview.money.liveAgainWithSameReasonProtected, 1, "the re-registered account is reported as protected");
assert.equal(preview.countErrors.length, 0, "no count may fail silently - a swallowed error would let the owner confirm a wrong number");
assert.equal(stepCount(preview, "captain_merge_history"), 1, "a step with two placeholders must bind both, or the preview undercounts");

// Structural invariant behind that bug: every statement needs exactly one bound value per placeholder.
for (const item of sandbox.purgeSteps().concat(sandbox.sweepSteps())) {
  const params = (item.bind || ["ids"]).length;
  for (const sql of [item.select, item.write].filter(Boolean)) {
    assert.equal(String(sql).split("?").length - 1, params, item.key + " binds " + params + " value(s) per statement");
  }
}

// --- the writes ---------------------------------------------------------------
// --- the row export: the second safety anchor ----------------------------------
// Server 2's persistent disk cannot hold a second full copy of a multi-gigabyte database, and the owner refused to
// delete an older copy for room. So the purge also accepts a verified export of exactly the rows it destroys. This
// drives that contract while the rows still exist: the exported bytes have to be the pre-destruction image.
const xIds = sandbox.purgeTargets(0).targets.map((row) => Number(row.id));
const xPhones = sandbox.purgeTargets(0).targets.map((row) => String(row.phone));
assert.ok(xIds.length >= 2, "the fixture must have targets to export");
assert.equal(sandbox.exportSets().verified.length, 0, "nothing is exported yet, so nothing may be destroyed");
assert.equal(sandbox.exportSlice, 200, "the export slice is the same size a batch may take");

const xName = "purge-export-1000";
const xDir = path.join(dir, "backups", xName);
fs.mkdirSync(xDir, { recursive: true });
const xJob = { status: "running", name: xName, startedAt: STAMP, completedAt: null, parts: 0, rowsTotal: 0, bytesTotal: 0, error: null };
const xManifest = sandbox.buildExport(xName, xDir, xJob);
assert.equal(xManifest.targetCount, xIds.length, "the manifest covers every current target");
assert.equal(xManifest.parts.length, 1, "one slice holds the whole fixture");
assert.ok(fs.existsSync(path.join(xDir, "manifest.json")) && fs.existsSync(path.join(xDir, "manifest.sha256")), "the manifest and its hash are files too");

const xList = sandbox.exportSets();
assert.equal(xList.verified.length, 1, "a freshly written export verifies");
assert.deepEqual(Array.from(xList.unverified), [], "and nothing is refused");
const xRecord = xList.verified[0];

const xText = fs.readFileSync(path.join(xDir, xRecord.parts[0].name), "utf8");
const xLines = xText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
assert.equal(xLines.length, Number(xRecord.parts[0].lines), "the manifest line count is the file's line count");
assert.equal(crypto.createHash("sha256").update(Buffer.from(xText)).digest("hex"), xRecord.parts[0].sha256, "the part hashes to what the manifest recorded");
const xByStep = {};
for (const item of xLines) xByStep[item.step] = (xByStep[item.step] || 0) + 1;

const xUserIds = xLines.filter((item) => item.step === "users").map((item) => Number(item.row.id)).sort((a, b) => a - b);
assert.deepEqual(Array.from(xUserIds), Array.from(xIds).sort((a, b) => a - b), "every target account row is exported before it is destroyed");
assert.equal(xByStep.users, xIds.length);

const xLiveLedger = count("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id IN (" + xIds.join(",") + ")");
assert.equal(xByStep.wallet_ledger, xLiveLedger, "the exported money rows are exactly the rows the purge deletes");
assert.equal(xRecord.perStepTotal.wallet_ledger, xLiveLedger, "and the manifest totals agree");
assert.ok(xLiveLedger > 0, "at least one target must carry wallet history in the fixture");
for (const item of xLines.filter((row) => row.step === "wallet_ledger")) {
  assert.equal(xIds.indexOf(Number(item.row.user_id)) >= 0, true, "no ledger row outside the target set may enter the export");
}
const xExportedCents = xLines.filter((item) => item.step === "wallet_ledger").reduce((total, item) => total + Number(item.row.amount_cents || 0), 0);
const xLiveCents = Number(count("SELECT COALESCE(SUM(amount_cents),0) AS count FROM wallet_ledger WHERE user_id IN (" + xIds.join(",") + ")"));
assert.equal(xExportedCents, xLiveCents, "the export keeps the amounts, not just the row count");

const xLiveNotes = count("SELECT COUNT(*) AS count FROM notifications WHERE recipient_phone IN ('" + xPhones.join("','") + "')");
assert.equal(xByStep.notifications, xLiveNotes, "notification rows are exported under the same predicate");

const xCounts = sandbox.stepCounts(xIds, xPhones);
assert.deepEqual(Array.from(xCounts.errors), [], "every step is countable");
for (const key of Object.keys(xCounts.counts)) {
  assert.equal(Number(xRecord.parts[0].perStep[key]), Number(xCounts.counts[key]), key + ": the export matches the live count");
}

assert.ok(sandbox.partFor(xRecord, xIds), "the whole fixture is one exported slice");
assert.equal(sandbox.partFor(xRecord, xIds.concat([999999])), null, "an account that was never exported is not covered");
assert.equal(sandbox.partFor(xRecord, xIds.slice(1)), null, "a shorter slice is not the same slice");

fs.appendFileSync(path.join(xDir, xRecord.parts[0].name), "{\"step\":\"x\",\"kind\":\"delete\",\"row\":{}}\n");
const xTampered = sandbox.exportSets();
assert.equal(xTampered.verified.length, 0, "a drifted part is not a verified export");
assert.equal(xTampered.unverified.length, 1);
assert.ok(xTampered.unverified[0].reasons.some((text) => /part drifted/.test(text)), "and the refusal says why");

const xName2 = "purge-export-2000";
const xDir2 = path.join(dir, "backups", xName2);
fs.mkdirSync(xDir2, { recursive: true });
const xJob2 = { status: "running", name: xName2, startedAt: STAMP, completedAt: null, parts: 0, rowsTotal: 0, bytesTotal: 0, error: null };
sandbox.buildExport(xName2, xDir2, xJob2);
const xRebuilt = sandbox.exportSets();
assert.equal(xRebuilt.verified.length, 1, "the rebuilt export verifies");
assert.equal(xRebuilt.verified[0].name, xName2, "and the newest one is what a batch cites");
assert.equal(xRebuilt.unverified.length, 1, "the damaged set is still reported, never hidden");
const xGoodText = fs.readFileSync(path.join(xDir2, xRebuilt.verified[0].parts[0].name), "utf8");
const xGoodLines = xGoodText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
assert.equal(crypto.createHash("sha256").update(Buffer.from(xGoodText)).digest("hex"), xRebuilt.verified[0].parts[0].sha256);

const xPublic = sandbox.publicExports(xRebuilt);
assert.equal(xPublic.verifiedCount, 1);
assert.equal(typeof xPublic.newest.targetIdsSha256, "string");
assert.equal(xPublic.newest.targetIds, undefined, "previews stay small");
console.log("removed captain history purge: the row-export anchor contract passed");

const targets = sandbox.purgeTargets(0).targets;
const ids = targets.map((row) => Number(row.id));
const phones = targets.map((row) => String(row.phone));
const purge = db.transaction(() => sandbox.runPurge(ids, phones, STAMP))();
assert.equal(JSON.stringify(purge.failures), "[]", "the declared order must satisfy every foreign key without a single failure");
assert.equal(JSON.stringify(purge.held), "[]", "after the purge no removed account may still be referenced");
assert.equal(purge.usersRemoved, 3);
assert.equal(purge.deleteRows, stepCount(preview, "captain_subscription_charges") + stepCount(preview, "captain_daily_charges") + stepCount(preview, "captain_withdrawal_requests")
  + stepCount(preview, "order_settlements_executed") + stepCount(preview, "order_candidate_acceptances_captain") + stepCount(preview, "order_candidate_acceptances_child")
  + stepCount(preview, "order_candidates") + stepCount(preview, "wallet_ledger") + stepCount(preview, "captain_login_links") + stepCount(preview, "captain_merge_history")
  + stepCount(preview, "audit_logs_actor") + stepCount(preview, "notifications"));

// gone
assert.deepEqual(db.prepare("SELECT id FROM users ORDER BY id").all().map((row) => row.id), [1, 2, 3, 4, 7, 8, 10]);
assert.equal(count("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id IN (5,6,9)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM order_settlements WHERE captain_user_id IN (5,6,9) OR producer_user_id IN (5,6,9) OR charged_user_id IN (5,6,9) OR approval_reaction_user_id IN (5,6,9)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM order_candidates WHERE producer_user_id IN (5,6,9)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM captain_login_links WHERE captain_user_id IN (5,6,9)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM captain_merge_history WHERE source_captain_id IN (5,6,9) OR target_captain_id IN (5,6)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM audit_logs WHERE actor_user_id IN (5,6,9)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM notifications WHERE recipient_phone IN (?,?,?)", T1, T2, T3), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM whatsapp_identities WHERE user_id IN (5,6,9)"), 0, "phone identity leaves with the account");
assert.equal(count("SELECT COUNT(*) AS count FROM captain_phone_aliases WHERE captain_user_id IN (5,6,9)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM captain_auth_challenges WHERE captain_user_id IN (5,6,9)"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM orders WHERE producer_user_id IN (5,6,9) OR captain_user_id IN (5,6,9) OR pending_captain_user_id IN (5,6,9) OR confirmed_by_phone IN (?,?,?)", T1, T2, T3), 0,
  "no order may still point at a removed account");
assert.equal(count("SELECT COUNT(*) AS count FROM orders WHERE captain_phone_snapshot IS NOT NULL AND captain_user_id IS NULL"), 0, "snapshot columns leave with the id they belonged to");

// preserved
assert.equal(count("SELECT COUNT(*) AS count FROM orders"), 6, "every booking row survives");
assert.equal(db.prepare("SELECT captain_user_id AS c, status AS s FROM orders WHERE id=106").get().c, null, "the booking stays, the removed executor name is detached");
assert.equal(db.prepare("SELECT status AS s FROM orders WHERE id=106").get().s, "accepted");
assert.equal(count("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=10"), 1, "the re-registered account keeps its money history");
assert.equal(count("SELECT COUNT(*) AS count FROM notifications WHERE recipient_phone=?", T4), 1, "and its notifications");
assert.equal(count("SELECT COUNT(*) AS count FROM audit_logs WHERE actor_user_id=10"), 0);
assert.equal(count("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=1"), 3, "the company's own commission rows survive");
assert.equal(count("SELECT COALESCE(SUM(amount_cents),0) AS count FROM wallet_ledger WHERE user_id=1 AND type='commission_company'"), 810);
assert.equal(count("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id IN (3,4)"), 2, "active captains keep their wallet history");
assert.equal(count("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=8"), 1, "a tombstone from a different decision keeps its money history");
assert.deepEqual(db.prepare("SELECT id FROM order_settlements ORDER BY id").all().map((row) => row.id), [1, 4]);
assert.equal(db.prepare("SELECT producer_user_id AS p, approval_reaction_user_id AS a FROM order_settlements WHERE id=1").get().p, null);
assert.equal(db.prepare("SELECT charged_user_id AS c FROM order_settlements WHERE id=1").get().c, 3, "the active side of a shared settlement stays attributed");
assert.deepEqual(db.prepare("SELECT id FROM order_candidates ORDER BY id").all().map((row) => row.id), [202]);
assert.equal(db.prepare("SELECT pending_captain_user_id AS p FROM order_candidates WHERE id=202").get().p, null);
assert.deepEqual(db.prepare("SELECT id FROM order_candidate_acceptances ORDER BY id").all().map((row) => row.id), [303]);
assert.equal(count("SELECT COUNT(*) AS count FROM unresolved_order_messages"), 1, "the message survives, the link is detached");
assert.equal(db.prepare("SELECT candidate_id AS c FROM unresolved_order_messages WHERE id=401").get().c, null);
assert.equal(db.prepare("SELECT order_candidate_id AS c FROM special_booking_requests WHERE id=501").get().c, null);
assert.equal(db.prepare("SELECT order_candidate_id AS c FROM customer_booking_requests WHERE id=601").get().c, null);
assert.equal(count("SELECT COUNT(*) AS count FROM topup_cards"), 2, "card value records are never destroyed");
assert.equal(db.prepare("SELECT redeemed_by AS r, assigned_captain_id AS a FROM topup_cards WHERE id=901").get().r, null);
assert.equal(db.prepare("SELECT redeemed_by AS r FROM topup_cards WHERE id=902").get().r, 3);
assert.equal(db.prepare("SELECT captain_id AS c, captain_phone_snapshot AS p FROM topup_card_archive WHERE id=1001").get().c, null);
assert.equal(db.prepare("SELECT captain_user_id AS c FROM ride_ratings WHERE id=1101").get().c, null);
assert.equal(db.prepare("SELECT approved_user_id AS u FROM captain_invites WHERE id=801").get().u, null);
assert.equal(count("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id='5' AND actor_user_id IS NULL"), 1,
  "the tombstone record written for the outside-group decision is not destroyed by erasing their own actions");
assert.equal(count("SELECT COUNT(*) AS count FROM audit_logs WHERE action='captains.removed_history.purge.applied'"), 1,
  "the destruction itself must be recorded");
assert.equal(count("SELECT COUNT(*) AS count FROM notifications WHERE recipient_phone=?", A1), 1);
assert.equal(db.prepare("SELECT captain_ref AS r, locked_ref AS l FROM probe_refs WHERE id=1701").get().r, null, "the sweep detached the unlisted nullable key");
assert.equal(db.prepare("SELECT locked_ref AS l FROM probe_refs WHERE id=1702").get().l, 4);
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "no dangling reference anywhere in the database");
assert.equal(db.pragma("integrity_check", { simple: true }), "ok");

// --- after state -------------------------------------------------------------
const after = sandbox.report(0);
assert.equal(after.targetCount, 0, "the purge is finished, not partial");
assert.equal(after.totals.deleteRows, 0);
assert.equal(after.totals.nullRows, 0);
assert.equal(after.money.overviewOrders.after, 2);
assert.equal(after.money.ledgerMoves.after, 7);
assert.equal(after.money.companyEarnings.total, 8.1);
assert.equal(sandbox.purgeSteps().filter((row) => !row.write).every((row) => row.kind === "cascade"), true, "count-only steps are exactly the cascade tables");
assert.equal(sandbox.sweepSteps().every((row) => row.kind === "null" && row.write.includes("=NULL")), true, "the sweep may only detach, never destroy");
assert.equal(sandbox.sweepSteps().some((row) => row.write.includes("DELETE")), false);
for (const column of ["orders.producer_user_id", "orders.captain_user_id", "wallet_ledger.user_id", "order_settlements.captain_user_id", "audit_logs.actor_user_id", "notifications.recipient_phone"]) {
  assert.ok(sandbox.staticColumns.has(column), column + " must stay in the reviewed list so the sweep cannot duplicate it");
}
// --- the mandatory backup, which is what authorises the destruction ------------
// The first live attempt awaited the copy inside the batch request, the edge cut it, and nothing was destroyed. So
// the copy is its own request now, and what makes it trustworthy is the marker written after it finished.
// It is driven by the event loop, so this part has to await rather than poll synchronously.
(async () => {
  const backupsDir = path.join(dir, "backups");
  assert.equal(sandbox.backups().complete, null, "no copy exists yet, so nothing may be destroyed");
  assert.equal(sandbox.backups().files.length, 0);

  const started = sandbox.startBackup();
  assert.equal(started.started, true, "the owner-only request starts the copy");
  assert.equal(sandbox.startBackup().reason, "already_running", "a second copy cannot stack on the first");
  await sandbox.backupPromise();
  const job = sandbox.backups().job;
  assert.equal(job.status, "complete", "the copy finished: " + JSON.stringify(job));

  const firstCopy = sandbox.backups();
  assert.equal(firstCopy.files.length, 1);
  assert.equal(firstCopy.complete.name, job.name, "the completed copy is the one a batch may cite");
  assert.ok(Number(firstCopy.complete.bytes) > 0, "the marker carries a real size");
  assert.deepEqual(Array.from(firstCopy.incomplete), []);
  assert.ok(fs.existsSync(path.join(backupsDir, job.name)), "the database copy itself is on disk");
  assert.ok(fs.existsSync(path.join(backupsDir, job.name + ".done")), "and its completion marker");

  // Torn copy: the file is there but the marker is gone. It must not authorise anything.
  fs.rmSync(path.join(backupsDir, job.name + ".done"));
  const torn = sandbox.backups();
  assert.equal(torn.complete, null, "a copy without its marker is not a backup");
  assert.deepEqual(Array.from(torn.incomplete), [job.name]);

  // A marker that disagrees with the file is still not a backup.
  fs.writeFileSync(path.join(backupsDir, job.name + ".done"), JSON.stringify({ name: job.name, bytes: 7, completedAt: STAMP }));
  assert.equal(sandbox.backups().complete, null, "a marker whose size disagrees is not a backup");
  fs.rmSync(path.join(backupsDir, job.name + ".done"));

  // A proper second copy restores the guarantee, as its own file.
  assert.equal(sandbox.startBackup().started, true);
  await sandbox.backupPromise();
  const second = sandbox.backups();
  assert.equal(second.job.status, "complete");
  assert.notEqual(second.job.name, job.name, "each copy is its own file, never overwritten");
  assert.equal(second.files.length, 2);
  assert.ok(second.complete.bytes > 0 && second.complete.name === second.job.name, "the newest completed copy is the one reported");
  console.log("removed captain history purge: the backup contract passed");
  // --- the export really is a restore point --------------------------------------
  // One destroyed money row is put back out of the exported bytes. If the image were not usable, this is where it shows.
  const xSavedText = fs.readFileSync(path.join(xDir2, sandbox.exportSets().verified[0].parts[0].name), "utf8");
  const xSaved = xSavedText.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((item) => item.step === "wallet_ledger");
  assert.equal(count("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id IN (" + xIds.join(",") + ")"), 0, "the purge really destroyed those money rows");
  assert.ok(xSaved.length > 0, "and the export still holds them");
  const xSavedUsers = fs.readFileSync(path.join(xDir2, sandbox.exportSets().verified[0].parts[0].name), "utf8")
    .split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((item) => item.step === "users");
  const xOwner = xSavedUsers.find((item) => Number(item.row.id) === Number(xSaved[0].row.user_id));
  assert.ok(xOwner, "the account the money row belongs to is in the same export");
  const xUserCols = Object.keys(xOwner.row);
  db.prepare("INSERT INTO users (" + xUserCols.join(",") + ") VALUES (@" + xUserCols.join(",@") + ")").run(xOwner.row);
  const xRow = Object.assign({}, xSaved[0].row);
  const xCols = Object.keys(xRow);
  db.prepare("INSERT INTO wallet_ledger (" + xCols.join(",") + ") VALUES (@" + xCols.join(",@") + ")").run(xRow);
  const xBack = db.prepare("SELECT * FROM wallet_ledger WHERE id=?").get(Number(xRow.id));
  assert.ok(xBack, "the exported row is insertable, so the image is a real restore point");
  assert.equal(Number(xBack.amount_cents), Number(xRow.amount_cents), "with the amount it was written with");
  db.prepare("DELETE FROM wallet_ledger WHERE id=?").run(Number(xRow.id));
  db.prepare("DELETE FROM users WHERE id=?").run(Number(xOwner.row.id));
  console.log("removed captain history purge: the export restores destroyed rows");


  fs.rmSync(dir, { recursive: true, force: true });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log("removed captain history purge: scope, writes, preservation and invariants passed");

// --- the deployed shape of the owner routes -----------------------------------
assert.ok(block.includes('app.get("/api/admin/captains/removed-history-preview", requireOwnerAdmin'), "the preview must be owner-only");
assert.ok(block.includes('app.post("/api/admin/captains/purge-removed-history", requireOwnerAdmin'), "the purge must be owner-only");
assert.ok(block.includes("adminMutationLimiter"), "the purge route must keep the admin mutation limiter");
assert.ok(block.includes('if (req.body?.execute !== true)'), "execution needs an explicit execute switch");
assert.ok(block.includes('String(req.body?.confirmation || "") !== REMOVED_CAPTAIN_HISTORY_PURGE_CONFIRMATION'), "a literal owner confirmation token is required");
assert.ok(block.includes('app.post("/api/admin/captains/purge-backup", requireOwnerAdmin'), "the mandatory full copy is its own owner-only request");
assert.ok(block.includes('app.get("/api/admin/captains/purge-backup", requireOwnerAdmin'), "and it can be polled read-only");
assert.equal(block.includes("await db.backup("), false, "no batch request may wait on the copy: the edge cut the first attempt and the write never ran");
assert.equal(block.includes("skipBackup"), false, "a batch cannot opt out of the backup requirement any more");
assert.ok(block.includes("if (!backups.complete && !exportSets.verified.length)"), "a batch refuses while neither a completed copy nor a verified export exists");
assert.ok(block.includes("Number(marker.bytes) === bytes"), "a marker whose size disagrees with the file is not a backup");
assert.ok(block.includes("reason: \"already_running\""), "concurrent copies are refused instead of piling up");
assert.ok(block.includes("backup: removedPurgeBackups(),"), "the preview states whether a completed copy exists");
assert.ok(block.includes('/^pre-money-purge-\\d+\\.sqlite$/.test(name)'), "every batch cites the one completed copy instead of making its own");
assert.ok(block.includes("incompleteBackups: backups.incomplete"), "the refusal names the copies it did not trust");
assert.ok(block.includes("JSON.stringify(liveKey) !== JSON.stringify(expectedKey)"), "live counts must still match the preview counts");
assert.ok(block.includes("JSON.stringify(expected.steps) !== JSON.stringify(previewKey)"), "per-step counts are verified too");
assert.ok(block.includes("if (preview.money.companyLedgerRowsInsideTargets !== 0)"), "the company wallet is checked before any write");
assert.ok(block.includes("active=0 AND account_status<>'merged' AND archive_reason=?"), "targets are pinned to the owner's recorded reason with the account switched off, whatever the status field says");
assert.equal(block.includes("account_status='deleted' AND archive_reason=?"), false, "a status-based target predicate would have matched nobody once the debt policy rewrote the statuses");
assert.ok(block.includes("if (Number(result.changes || 0) === 1) usersRemoved += 1;"), "accounts are deleted one id at a time so a reference holds only that account");
assert.ok(block.includes('if (!Number.isInteger(batchSize) || batchSize < 0 || batchSize > 300)'), "the batch size needs a hard upper bound");
assert.ok(block.includes("nextExpected:"), "the response must report the counts the next batch has to confirm");
assert.ok(block.includes("completed: recount.targetCount === 0"), "the run must state when nothing is left");
assert.ok(block.includes("ownersOnly: true"), "the confirmation notice goes to the owner only");
assert.ok(block.includes('mutation: "none"'), "every refusal path must state that nothing changed");

assert.ok(block.includes('app.post("/api/admin/captains/purge-export", requireOwnerAdmin'), "the row export is its own owner-only request");
assert.ok(block.includes('app.get("/api/admin/captains/purge-export", requireOwnerAdmin'), "and it can be polled read-only");
assert.ok(block.includes('app.get("/api/admin/captains/purge-export/part", requireOwnerAdmin'), "the parts are served only from a verified manifest");
assert.ok(block.includes("if (!backups.complete && !exportSets.verified.length)"), "a batch needs a completed copy or a verified export, never neither");
assert.ok(block.includes('kind: "row-export"'), "and it says which anchor it ran under");
assert.ok(block.includes("const part = removedPurgeExportPartFor(record, wanted);"), "every batch account has to sit in an exported slice");
assert.ok(block.includes("تغيّرت صفوف هذه الدفعة منذ التصدير"), "rows that changed since the export refuse the batch");
assert.ok(block.includes("crypto.createHash(\"sha256\").update(buffer).digest(\"hex\") !== part.sha256"), "a part is served only while it still hashes right");
assert.ok(block.includes("if (!sql) continue;"), "only steps with a countable predicate are exported");
assert.ok(block.includes("counts[item.key] = rows.length;"), "the export counts what it writes, step by step");
assert.ok(block.includes("export: publicRemovedPurgeExportSets(removedPurgeExports()),"), "the preview states whether a verified export exists");
assert.equal(block.includes("fs.rmSync(exportSetDir"), false, "the export never deletes the safety record it wrote");

// Destruction boundaries.
for (const forbidden of ["DELETE FROM orders", "DELETE FROM order_confirmation_deliveries", "DELETE FROM topup_cards",
  "DELETE FROM customer_accounts", "DELETE FROM customer_leads", "DELETE FROM support_tickets", "DELETE FROM messages",
  "DELETE FROM whatsapp_message_receipts", "DELETE FROM voice_booking_intakes", "DELETE FROM reaction_evidence",
  "DELETE FROM settings", "DELETE FROM users WHERE role='company'", "UPDATE users SET wallet_cents",
  "UPDATE wallet_ledger SET", "purgeExperimentalCaptains", "rejectCaptainRemovalWhilePaused", "PRAGMA foreign_keys",
  "DROP TABLE", "DROP INDEX"]) {
  assert.equal(block.includes(forbidden), false, `the purge block must never contain ${forbidden}`);
}
assert.equal(block.includes("DELETE FROM audit_logs WHERE actor_user_id"), true, "their own actions leave, which is the point of the order");
assert.match(block, /^(?![\s\S]*\d{11,}@g\.us)[\s\S]*$/, "no WhatsApp group identifier may ever appear in this block");
assert.ok(block.includes("audit(\"captains.removed_history.purge.applied\"") && block.includes("audit(\"captains.removed_history.purge.summary\""),
  "the destruction itself must be written to the audit trail");
assert.equal(block.split("DELETE FROM users").length - 1, 1, "exactly one user-row deletion statement");
console.log("removed captain history purge route shape: passed");
