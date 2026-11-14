"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const server = fs.readFileSync("server.js", "utf8");
const GROUP = "approved-group@g.us";
const OTHER_GROUP = "other-group@g.us";
const EVENT = "group.acceptance.insufficient_balance_deleted";
const helperStart = server.indexOf("const insufficientBalanceGroupNotificationInFlight = new Set();");
const helperEnd = server.indexOf("\nconst cancellationPartyNotificationInFlight", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "group helper exists");
const helperSource = server.slice(helperStart, helperEnd);
const identityStart = server.indexOf("function messageIdCore(");
const identityEnd = server.indexOf("function buildStoredQuotedMessageById(", identityStart);
assert.ok(identityStart >= 0 && identityEnd > identityStart, "existing message identity helpers exist");
const identitySource = server.slice(identityStart, identityEnd);
const tableMatch = server.match(/CREATE TABLE IF NOT EXISTS notifications \([\s\S]*?\n\);/);
assert.ok(tableMatch, "notifications schema exists in server source");
const notificationIndex = "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''";
assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency ON notifications\(idempotency_key\)/);

assert.match(helperSource, /isOfficialGroupTarget\(targetGroupId\)/);
assert.match(helperSource, /isServer2OutboundTargetAllowed\(targetGroupId\)/);
assert.match(helperSource, /sourceMessageIdsEqual\(entry\?\.messageId, sourceKey\)/);
assert.match(helperSource, /INSERT OR IGNORE INTO notifications/);
assert.match(helperSource, /inserted\?\.changes !== 1/);
assert.match(helperSource, /insufficientBalanceGroupNotificationInFlight\.add\(idempotencyKey\)/);
assert.match(helperSource, /finally \{[\s\S]*insufficientBalanceGroupNotificationInFlight\.delete\(idempotencyKey\)/);
assert.match(helperSource, /deliveryStatus === "uncertain"/);
assert.match(helperSource, /group\.acceptance\.insufficient_balance_deleted/);
assert.match(helperSource, /,'group',/);
assert.match(helperSource, /تم حذف رسالة «تم» للكابتن/);
assert.doesNotMatch(helperSource, /إلغاء الرحلة|wallet|balanceCents|recipient_phone.*captain/);

const recoveryStart = server.indexOf('if (unquotedResult?.state === "insufficient_balance")');
const recoveryEnd = server.indexOf('if (!unquotedResult ||', recoveryStart);
const incomingStart = server.indexOf('if (acceptanceResult.state === "insufficient_balance")');
const incomingEnd = server.indexOf("// لا يصل هذا السطر إلى حالة نقص الرصيد", incomingStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "recovery branch exists");
assert.ok(incomingStart >= 0 && incomingEnd > incomingStart, "incoming branch exists");
for (const [label, branch] of [["recovery", server.slice(recoveryStart, recoveryEnd)], ["incoming", server.slice(incomingStart, incomingEnd)]]) {
  assert.match(branch, /await deleteAcceptanceMessagesForInsufficientBalance\(/, `${label} keeps bounded deletion`);
  assert.match(branch, /await notifyOfficialGroupInsufficientAcceptanceBalance\(/, `${label} uses group helper`);
  assert.match(branch, /await reopenOrderAfterInsufficientBalance\(/, `${label} keeps reopen`);
  assert.doesNotMatch(branch, /notifyCaptainInsufficientAcceptanceBalance|notificationStatus|captain notification/, `${label} has no private notice call or log`);
}
assert.equal((server.match(/notifyCaptainInsufficientAcceptanceBalance/g) || []).length, 1, "private helper definition remains but has no callsites");
const retryStart = server.indexOf("async function retryCaptainStatusNotifications");
const retryEnd = server.indexOf("function startCaptainStatusNotificationRetryScheduler", retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart, "existing generic retry helper exists");
assert.doesNotMatch(server.slice(retryStart, retryEnd), new RegExp(EVENT.replaceAll(".", "\\.")), "generic captain retry cannot retry the group event");

function openDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insufficient-balance-group-"));
  const file = path.join(dir, "notifications.sqlite");
  const db = new Database(file);
  db.exec(`${tableMatch[0]}\n${notificationIndex}`);
  return { db, dir };
}

function closeDb({ db, dir }) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function loadHelper(db, { ready = true, official = true, outbound = true, sendResult = "sent", sendGate = null } = {}) {
  const sends = [];
  const audits = [];
  const context = {
    db,
    client: ready ? { sendMessage() {} } : null,
    isReady: ready,
    now: () => "2026-11-15T00:00:00.000Z",
    isOfficialGroupTarget: (target) => official && target === GROUP,
    isServer2OutboundTargetAllowed: (target) => outbound && target === GROUP,
    sendWhatsAppAtMostOnce: async (target, content) => {
      sends.push({ target, content });
      if (sendGate) await sendGate;
      const status = typeof sendResult === "function" ? sendResult() : sendResult;
      if (status === "uncertain") return { status, message: null, error: "send_timeout_no_retry" };
      if (status === "failed") return { status, message: null, error: "fixture_send_failed" };
      return { status: "sent", message: { id: { _serialized: `fixture-sent-${sends.length}` } }, error: null };
    },
    audit: (...entry) => audits.push(entry),
    console: { warn() {}, log() {} },
  };
  vm.runInNewContext(`${identitySource}\n${helperSource}\nthis.notify = notifyOfficialGroupInsufficientAcceptanceBalance; this.core = messageIdCore; this.equal = sourceMessageIdsEqual;`, context);
  return { ...context, sends, audits };
}

function acceptedMessage(core, participant = "symbolic-pn@c.us") {
  return `true_${GROUP}_${core}_${participant}`;
}

function validArgs({ sourceMessageId = "accept-core", evidenceMessageId = sourceMessageId, groupId = GROUP, deletionStatus = "deleted", deletionResult = null } = {}) {
  return {
    groupId,
    sourceMessageId,
    messageId: sourceMessageId,
    deletionStatus,
    deletionResult: deletionResult || {
      ok: true,
      revoked: true,
      paused: false,
      deletedCount: 1,
      results: [{ messageId: evidenceMessageId, ok: true, result: { ok: true } }],
    },
    publicTripNo: "TRIP-1",
    captainName: "كابتن تجريبي",
  };
}

function rowFor(db, key) {
  return db.prepare("SELECT * FROM notifications WHERE idempotency_key=?").get(key);
}

function keyFor(core) {
  return `GROUP-ACCEPTANCE-INSUFFICIENT-BALANCE-${GROUP}-${core}`;
}

test("valid group notice sends once, records the actual schema contract, and stays idempotent", async () => {
  const fixture = openDb();
  try {
    const context = loadHelper(fixture.db);
    const first = await context.notify(validArgs());
    assert.equal(first.status, "sent");
    assert.equal(context.sends.length, 1);
    assert.equal(context.sends[0].target, GROUP);
    assert.equal(context.sends[0].content, "تم حذف رسالة «تم» للكابتن كابتن تجريبي لعدم كفاية الرصيد. رقم الرحلة: TRIP-1.");
    const row = fixture.db.prepare("SELECT recipient_phone,recipient_role,event,title,message,delivery_status,source_message_id,idempotency_key FROM notifications").get();
    assert.deepEqual(row, {
      recipient_phone: GROUP,
      recipient_role: "group",
      event: EVENT,
      title: "حذف قبول «تم» لعدم كفاية الرصيد",
      message: context.sends[0].content,
      delivery_status: "sent",
      source_message_id: "accept-core",
      idempotency_key: keyFor("accept-core"),
    });
    const repeated = await context.notify(validArgs());
    assert.equal(repeated.status, "already_sent");
    assert.equal(context.sends.length, 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM notifications").get().count, 1);
  } finally {
    closeDb(fixture);
  }
});

test("simultaneous calls claim one pending receipt before the first await", async () => {
  const fixture = openDb();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    const context = loadHelper(fixture.db, { sendGate: gate });
    const firstPromise = context.notify(validArgs({ sourceMessageId: "concurrent-core" }));
    await Promise.resolve();
    const duplicate = await context.notify(validArgs({ sourceMessageId: "concurrent-core" }));
    assert.equal(duplicate.status, "already_in_flight");
    assert.equal(context.sends.length, 1);
    release();
    assert.equal((await firstPromise).status, "sent");
    assert.equal(fixture.db.prepare("SELECT delivery_status FROM notifications WHERE idempotency_key=?").get(keyFor("concurrent-core")).delivery_status, "sent");
  } finally {
    release?.();
    closeDb(fixture);
  }
});

test("PN/LID and canonical wrapper variants collapse, while different message cores remain separate across a restarted context", async () => {
  const fixture = openDb();
  try {
    const pn = acceptedMessage("wrapped-core", "symbolic-pn@c.us");
    const lid = acceptedMessage("wrapped-core", "symbolic-lid@lid");
    const firstContext = loadHelper(fixture.db);
    assert.equal(firstContext.core(pn), "wrapped-core");
    assert.equal(firstContext.equal(pn, lid), true);
    assert.equal((await firstContext.notify(validArgs({ sourceMessageId: pn, evidenceMessageId: lid }))).status, "sent");
    const restartedContext = loadHelper(fixture.db);
    assert.equal((await restartedContext.notify(validArgs({ sourceMessageId: lid, evidenceMessageId: pn }))).status, "already_sent");
    assert.equal(restartedContext.sends.length, 0);
    assert.equal((await restartedContext.notify(validArgs({ sourceMessageId: "different-core" }))).status, "sent");
    assert.equal(restartedContext.sends.length, 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM notifications").get().count, 2);
  } finally {
    closeDb(fixture);
  }
});

test("disabled, failed, partial, mismatched-evidence, and wrong/private targets produce no notice", async () => {
  const cases = [
    ["disabled", validArgs({ sourceMessageId: "disabled-core", deletionStatus: "paused", deletionResult: { ok: false, revoked: false, paused: true, deletedCount: 0, results: [] } })],
    ["failed", validArgs({ sourceMessageId: "failed-core", deletionStatus: "failed", deletionResult: { ok: false, revoked: false, paused: false, deletedCount: 0, results: [] } })],
    ["partial", validArgs({ sourceMessageId: "partial-core", deletionStatus: "partial", deletionResult: { ok: false, revoked: true, paused: false, deletedCount: 1, results: [{ messageId: "partial-core", ok: true, result: { ok: true } }] } })],
    ["mismatched evidence", validArgs({ sourceMessageId: "expected-core", evidenceMessageId: "different-core" })],
    ["malformed count", validArgs({ sourceMessageId: "malformed-count-core", deletionResult: { ok: true, revoked: true, paused: false, deletedCount: "not-a-count", results: [{ messageId: "malformed-count-core", ok: true, result: { ok: true } }] } })],
    ["group mismatch", validArgs({ sourceMessageId: "other-group-core", groupId: OTHER_GROUP })],
    ["private target", validArgs({ sourceMessageId: "private-target-core", groupId: "symbolic-recipient@c.us" })],
  ];
  for (const [label, args] of cases) {
    const fixture = openDb();
    try {
      const context = loadHelper(fixture.db);
      const result = await context.notify(args);
      assert.equal(result.status, label === "group mismatch" || label === "private target" ? "blocked" : "not_confirmed", label);
      assert.equal(context.sends.length, 0, `${label}: no outbound call`);
      assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM notifications").get().count, 0, `${label}: no receipt`);
    } finally {
      closeDb(fixture);
    }
  }
});

test("not-ready is recorded as failed without false success or retry", async () => {
  const fixture = openDb();
  try {
    const context = loadHelper(fixture.db, { ready: false });
    const first = await context.notify(validArgs({ sourceMessageId: "unavailable-core" }));
    assert.equal(first.status, "unavailable");
    assert.equal(context.sends.length, 0);
    assert.equal(rowFor(fixture.db, keyFor("unavailable-core")).delivery_status, "failed");
    const second = await context.notify(validArgs({ sourceMessageId: "unavailable-core" }));
    assert.equal(second.status, "failed");
    assert.equal(context.sends.length, 0);
  } finally {
    closeDb(fixture);
  }
});

test("uncertain timeout remains uncertain and persisted attempted rows never retry", async () => {
  const fixture = openDb();
  try {
    const context = loadHelper(fixture.db, { sendResult: "uncertain" });
    assert.equal((await context.notify(validArgs({ sourceMessageId: "uncertain-core" }))).status, "uncertain");
    assert.equal((await context.notify(validArgs({ sourceMessageId: "uncertain-core" }))).status, "uncertain");
    assert.equal(context.sends.length, 1);
    const restartedContext = loadHelper(fixture.db, { sendResult: "sent" });
    assert.equal((await restartedContext.notify(validArgs({ sourceMessageId: "uncertain-core" }))).status, "uncertain");
    assert.equal(restartedContext.sends.length, 0);
  } finally {
    closeDb(fixture);
  }

  for (const [status, expected] of [["pending", "pending"], ["sent", "already_sent"], ["uncertain", "uncertain"], ["failed", "failed"]]) {
    const fixture = openDb();
    try {
      const core = `persisted-${status}`;
      fixture.db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,source_message_id,idempotency_key,created_at) VALUES(?,'group',?,?,?,?,?,?,?)")
        .run(GROUP, EVENT, "fixture", "fixture", status, core, keyFor(core), "2026-11-15T00:00:00.000Z");
      const context = loadHelper(fixture.db);
      assert.equal((await context.notify(validArgs({ sourceMessageId: core }))).status, expected, status);
      assert.equal(context.sends.length, 0, `${status}: persisted receipt blocks resend`);
    } finally {
      closeDb(fixture);
    }
  }
});

console.log("insufficient-balance group notice: strict evidence, group-only target, atomic receipt, and no private callsites verified");
