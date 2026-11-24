"use strict";
// Owner-approved 2026-11-24 («عندما يتم حذف رسالة تم لعدم كفاية الرصيد، يتم إظهار رصيد الكابتن»).
// Proves, without booting the server, that the official-group card for a «تم» deleted because of an
// insufficient balance now carries the captain's balance and the amount the trip needs, while:
//  * the confirmation gate, the group allowlist and the idempotency key are unchanged (no second card,
//    no card when the deletion is not confirmed),
//  * the figure never turns the card into something the order parser would accept as a price message,
//    because a bot message matching parseOrder is used by the recovery scan as the price message,
//  * the acceptance-parsing outcome of the card is exactly what it was before this change.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const source = fs.readFileSync("server.js", "utf8");
const slice = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

const GROUP = "official-test@g.us";
const SENDER = "sender-a";
const money = (value) => (Number(value || 0) / 100).toFixed(2);

// ---------- static guardrails ----------
assert.match(source, /async function notifyOfficialGroupInsufficientAcceptanceBalance\(\{ groupId, sourceMessageId, messageId, deletionStatus, deletionResult, publicTripNo, captainName, captainBalanceAmount, tripRequiredAmount \}\)/,
  "the notice must receive the balances from the acceptance path");
assert.match(source, /const balanceClause = balanceText === null/);
assert.match(source, /تم حذف رسالة «تم» للكابتن \$\{String\(captainName \|\| "غير محدد"\)}/);
// The price keywords of parseOrder must not sit next to the amounts in the new clause.
const clauseLine = (source.match(/: ` الرصيد الحالي للكابتن[^\n]*/) || [""])[0];
assert.ok(clauseLine.length > 20, "the balance clause exists");
for (const keyword of ["الأجرة", "أجرة", "السعر", "سعر", "القيمة", "قيمة", "المبلغ", "مبلغ", "price"]) {
  assert.equal(clauseLine.includes(keyword), false, `the balance clause must not use the price keyword ${keyword}`);
}
assert.equal(/(?:د\.?\s*أ|دينار|JOD)/i.test(clauseLine), false, "no currency token inside the clause");
// The confirmation gate is untouched.
assert.match(source, /deletionResult\?\.revoked !== true/, "the card still needs a confirmed revoke-for-everyone");
assert.match(source, /const idempotencyKey = `GROUP-ACCEPTANCE-INSUFFICIENT-BALANCE-\$\{targetGroupId\}-\$\{sourceCore\}`;/,
  "one card per deleted acceptance, unchanged");
// Both callers pass the balances.
assert.equal((source.match(/balanceCents: acceptanceResult\.balanceCents,\n      requiredCents: acceptanceResult\.requiredCents,/).length || 0), 1);
assert.equal((source.match(/balanceCents: unquotedResult\.balanceCents,\n        requiredCents: unquotedResult\.requiredCents,/).length || 0), 1);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "insufficient-balance-notice-"));
const db = new Database(path.join(tempDir, "notice.sqlite"));
db.exec(`CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_phone TEXT NOT NULL, recipient_role TEXT NOT NULL, event TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'pending', message_id TEXT, source_message_id TEXT, idempotency_key TEXT, created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(idempotency_key);`);

function makeSandbox() {
  const sent = [];
  const audits = [];
  const sandbox = {
    db,
    console: { log() {}, warn() {} },
    Date,
    Math,
    JSON,
    money,
    messageIdCore: (value) => String(value || "").split("_").slice(-2, -1)[0] || "",
    sourceMessageIdsEqual: (a, b) => String(a) === String(b),
    isOfficialGroupTarget: (target) => target === GROUP,
    isServer2OutboundTargetAllowed: (target) => target === GROUP,
    notificationEnabled: () => true,
    client: { sendMessage() {} },
    isReady: true,
    now: () => "2026-11-24T19:30:00.000Z",
    audit(action, _type, _id, details) { audits.push({ action, details }); },
    async sendWhatsAppAtMostOnce(to, content) { sent.push({ to, content }); return { status: "sent", message: { id: { _serialized: "sent-1" } } }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${slice("const insufficientBalanceGroupNotificationInFlight = new Set();", "async function notifyOrderCancellationParty(")}
this.notify = notifyOfficialGroupInsufficientAcceptanceBalance;`, sandbox);
  return { sandbox, sent, audits };
}

const deletedResult = (sourceMessageId) => ({
  ok: true,
  requested: true,
  revoked: true,
  paused: false,
  deletedCount: 1,
  results: [{ messageId: sourceMessageId, ok: true, result: { ok: true, revoked: true, method: "revoke_stub_evidence" } }],
});

const parserSandbox = {};
vm.createContext(parserSandbox);
vm.runInContext(`${slice("function parseOrder(text)", "\nfunction ")}
${slice("function isCaptainAcceptance(text)", "\nfunction ")}
this.parseOrder = parseOrder; this.isCaptainAcceptance = isCaptainAcceptance;`, parserSandbox);

const srcId = (key) => `false_${GROUP}_aaaa111@lid_${key}_t`;
(async () => {
  // messageIdCore() keeps the second-to-last segment, so the unique part goes before the trailing token.
  const SOURCE_ID = srcId("key9001");
  const callFor = (key, extra = {}) => {
    const id = srcId(key);
    return { ...base, sourceMessageId: id, messageId: id, deletionResult: deletedResult(id), ...extra };
  };
  const base = {
    groupId: GROUP,
    sourceMessageId: SOURCE_ID,
    messageId: SOURCE_ID,
    deletionStatus: "deleted",
    deletionResult: deletedResult(SOURCE_ID),
    publicTripNo: "890",
    captainName: "صاحب-اسم-رمزي",
    captainBalanceAmount: 250,
    tripRequiredAmount: 500,
  };

  // ---------- 1. the balance is shown ----------
  {
    const { sandbox, sent, audits } = makeSandbox();
    const result = await sandbox.notify(base);
    assert.equal(result.status, "sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, GROUP);
    assert.match(sent[0].content, /^تم حذف رسالة «تم» للكابتن صاحب-اسم-رمزي لعدم كفاية الرصيد\. رقم الرحلة: 890\./);
    assert.match(sent[0].content, /الرصيد الحالي للكابتن 2\.50، ويحتاج تثبيت الرحلة 5\.00\.$/);
    assert.equal(sent[0].content.includes("دينار"), false);
    assert.equal(/د\.?\s*أ/.test(sent[0].content), false, "no currency token that parseOrder reads as a price");
    assert.equal(parserSandbox.parseOrder(sent[0].content).isOrder, false, "the card must never parse as an order price message");
    assert.equal(parserSandbox.isCaptainAcceptance(sent[0].content), parserSandbox.isCaptainAcceptance(
      `تم حذف رسالة «تم» للكابتن س لعدم كفاية الرصيد. رقم الرحلة: 890.`), "acceptance parsing of the card is unchanged");
    const rows = db.prepare("SELECT event,recipient_role,delivery_status,title FROM notifications ORDER BY id").all();
    assert.deepEqual(Array.from(rows).map((r) => [r.event, r.recipient_role, r.delivery_status, r.title]),
      [["group.acceptance.insufficient_balance_deleted", "group", "sent", "حذف قبول «تم» لعدم كفاية الرصيد"]]);
    assert.ok(audits.every((entry) => entry.details.financialMutation === false), "the card never mutates money");
  }

  // ---------- 2. only the balance, when the required amount is unknown ----------
  {
    db.prepare("DELETE FROM notifications").run();
    const { sandbox, sent } = makeSandbox();
    await sandbox.notify(callFor("key9002", { tripRequiredAmount: null }));
    assert.match(sent[0].content, /الرصيد الحالي للكابتن 2\.50\.$/);
    assert.equal(sent[0].content.includes("يحتاج تثبيت"), false);
    assert.equal(parserSandbox.parseOrder(sent[0].content).isOrder, false);
  }
  // ---------- 3. unknown balance keeps the previous wording ----------
  {
    db.prepare("DELETE FROM notifications").run();
    const { sandbox, sent } = makeSandbox();
    await sandbox.notify(callFor("key9003", { captainBalanceAmount: undefined }));
    assert.equal(sent[0].content, `تم حذف رسالة «تم» للكابتن صاحب-اسم-رمزي لعدم كفاية الرصيد. رقم الرحلة: 890.`);
  }
  // ---------- 4. the old gates still hold ----------
  {
    db.prepare("DELETE FROM notifications").run();
    const { sandbox, sent } = makeSandbox();
    const notConfirmed = await sandbox.notify(callFor("key9004", { deletionResult: { ...deletedResult(srcId("key9004")), revoked: false } }));
    assert.equal(notConfirmed.status, "not_confirmed");
    const wrongGroup = await sandbox.notify(callFor("key9005", { groupId: "other@g.us" }));
    assert.equal(wrongGroup.status, "blocked");
    assert.equal(sent.length, 0, "no card without a confirmed revoke and the official group");
    // one card per deleted acceptance: the second call for the same message id is a duplicate
    const first = await sandbox.notify(callFor("key9006"));
    assert.equal(first.status, "sent", first.status || "");
    assert.equal(sent.length, 1);
    const again = await sandbox.notify(callFor("key9006"));
    assert.equal(again.duplicate, true);
    assert.equal(again.status, "already_sent");
    assert.equal(sent.length, 1, "the same acceptance never gets a second card");
  }
  console.log("test_insufficient_balance_notice_balance_line: ok");
})().catch((error) => { console.error(error); process.exit(1); });
