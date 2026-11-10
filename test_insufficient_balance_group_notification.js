"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const server = fs.readFileSync("server.js", "utf8");

const helperStart = server.indexOf("const officialGroupInsufficientBalanceNotificationInFlight = new Set();");
const helperEnd = server.indexOf("\nconst cancellationPartyNotificationInFlight", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "official-group insufficient-balance notification helper exists");
const helperSource = server.slice(helperStart, helperEnd);

function assertCallOrder(startMarker, endMarker, label) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${label} insufficient-balance branch exists`);
  const branch = server.slice(start, end);
  const deleteIndex = branch.indexOf("await deleteAcceptanceMessagesForInsufficientBalance(");
  const groupNoticeIndex = branch.indexOf("await notifyOfficialGroupInsufficientAcceptanceBalance(");
  const captainNoticeIndex = branch.indexOf("await notifyCaptainInsufficientAcceptanceBalance(");
  assert.ok(deleteIndex >= 0 && deleteIndex < groupNoticeIndex && groupNoticeIndex < captainNoticeIndex,
    `${label}: delete the captain's «تم» message, then notify the official group, then notify the captain`);
}

assertCallOrder(
  'if (unquotedResult?.state === "insufficient_balance")',
  "if (!unquotedResult ||",
  "recovery"
);
assertCallOrder(
  'if (acceptanceResult.state === "insufficient_balance")',
  "// لا يصل هذا السطر إلى حالة نقص الرصيد",
  "live message"
);
assert.match(helperSource, /isOfficialGroupTarget\(targetGroupId\)/, "destination is locked to the configured official group");
assert.match(helperSource, /deletionResult\?\.results/, "the specific acceptance message must have a confirmed delete result");
assert.match(helperSource, /sourceMessageIdsEqual\(entry\.messageId, acceptanceMessageId\)/, "deletion is matched to this captain's exact message");
assert.match(helperSource, /GROUP-ACCEPTANCE-BALANCE-\$\{sourceKey\}/, "group notice is idempotency-keyed to the acceptance message");
assert.match(helperSource, /sendWhatsAppAtMostOnce\(targetGroupId, message/, "group send uses the allow-listed at-most-once sender");
assert.match(helperSource, /financialMutation: false/, "notification does not mutate financial state");

const notificationsById = new Map();
const notificationsByKey = new Map();
let nextNotificationId = 1;
const db = {
  prepare(sql) {
    return {
      get(...args) {
        assert.match(sql, /SELECT id,delivery_status,message_id FROM notifications WHERE idempotency_key/);
        return notificationsByKey.get(args[0]) || null;
      },
      run(...args) {
        if (sql.startsWith("INSERT OR IGNORE INTO notifications")) {
          const [recipient, title, message, sourceMessageId, idempotencyKey, createdAt] = args;
          if (notificationsByKey.has(idempotencyKey)) return { changes: 0, lastInsertRowid: 0 };
          const row = {
            id: nextNotificationId++, recipient, title, message, sourceMessageId,
            idempotencyKey, createdAt, delivery_status: "pending", message_id: null,
          };
          notificationsById.set(row.id, row);
          notificationsByKey.set(idempotencyKey, row);
          return { changes: 1, lastInsertRowid: row.id };
        }
        if (sql.startsWith("UPDATE notifications SET delivery_status=?,message_id=? WHERE id=?")) {
          const [deliveryStatus, messageId, id] = args;
          const row = notificationsById.get(id);
          assert.ok(row, "notification row exists before delivery update");
          row.delivery_status = deliveryStatus;
          row.message_id = messageId;
          return { changes: 1 };
        }
        if (sql.startsWith("UPDATE notifications SET delivery_status='failed' WHERE id=?")) {
          const row = notificationsById.get(args[0]);
          if (row) row.delivery_status = "failed";
          return { changes: 1 };
        }
        throw new Error(`Unexpected test SQL: ${sql}`);
      },
    };
  },
};

const sentMessages = [];
const audits = [];
const context = {
  db,
  isOfficialGroupTarget: (groupId) => groupId === "official-test@g.us",
  sourceMessageIdsEqual: (left, right) => String(left || "").trim() === String(right || "").trim(),
  sendWhatsAppAtMostOnce: async (groupId, message) => {
    sentMessages.push({ groupId, message });
    return { status: "sent", message: { id: { _serialized: "official-message-1" } } };
  },
  serializedMessageId: (message) => message?.id?._serialized || null,
  now: () => "2026-11-10T00:00:00.000Z",
  audit: (...entry) => audits.push(entry),
  console,
};
vm.runInNewContext(`${helperSource}\nthis.notifyOfficialGroupInsufficientAcceptanceBalance = notifyOfficialGroupInsufficientAcceptanceBalance;`, context);

(async () => {
  const failed = await context.notifyOfficialGroupInsufficientAcceptanceBalance({
    groupId: "official-test@g.us",
    sourceMessageId: "acceptance-failed",
    messageId: "acceptance-failed",
    deletionResult: { results: [{ messageId: "acceptance-failed", ok: false }] },
    publicTripNo: 71,
    captainName: "كابتن اختبار",
    deletionStatus: "failed",
  });
  assert.equal(failed.status, "not_sent");
  assert.equal(sentMessages.length, 0, "do not announce a deletion that failed");

  const partialButTargetRemains = await context.notifyOfficialGroupInsufficientAcceptanceBalance({
    groupId: "official-test@g.us",
    sourceMessageId: "acceptance-partial-failed",
    messageId: "acceptance-partial-failed",
    deletionResult: { results: [
      { messageId: "acceptance-partial-failed", ok: false },
      { messageId: "older-linked-acceptance", ok: true },
    ] },
    publicTripNo: 72,
    captainName: "كابتن اختبار",
    deletionStatus: "partial",
  });
  assert.equal(partialButTargetRemains.status, "not_sent");
  assert.equal(sentMessages.length, 0, "do not notify when another linked message was deleted but this «تم» remains");

  const paused = await context.notifyOfficialGroupInsufficientAcceptanceBalance({
    groupId: "official-test@g.us",
    sourceMessageId: "acceptance-paused",
    messageId: "acceptance-paused",
    deletionResult: { paused: true, results: [] },
    publicTripNo: 73,
    captainName: "كابتن اختبار",
    deletionStatus: "paused",
  });
  assert.equal(paused.status, "not_sent");
  assert.equal(sentMessages.length, 0, "a paused deletion must not produce a false group notice");

  const wrongGroup = await context.notifyOfficialGroupInsufficientAcceptanceBalance({
    groupId: "another-group@g.us",
    sourceMessageId: "acceptance-wrong-group",
    messageId: "acceptance-wrong-group",
    deletionResult: { results: [{ messageId: "acceptance-wrong-group", ok: true }] },
    publicTripNo: 74,
    captainName: "كابتن اختبار",
    deletionStatus: "deleted",
  });
  assert.equal(wrongGroup.status, "invalid");
  assert.equal(sentMessages.length, 0, "never send to an unconfigured group");

  const sent = await context.notifyOfficialGroupInsufficientAcceptanceBalance({
    groupId: "official-test@g.us",
    sourceMessageId: "acceptance-1",
    messageId: "acceptance-1",
    deletionResult: { results: [
      { messageId: "acceptance-1", ok: true },
      { messageId: "older-linked-acceptance", ok: false },
    ] },
    publicTripNo: 75,
    captainName: "كابتن اختبار",
    deletionStatus: "partial",
  });
  assert.equal(sent.status, "sent", "notify once the captain's specific message is confirmed deleted");
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].groupId, "official-test@g.us");
  assert.match(sentMessages[0].message, /كابتن اختبار/);
  assert.match(sentMessages[0].message, /العمولة المخفّضة/);
  assert.match(sentMessages[0].message, /تم حذف رسالة «تم»/);
  assert.match(sentMessages[0].message, /لم تُنفّذ تسوية مالية/);

  const duplicate = await context.notifyOfficialGroupInsufficientAcceptanceBalance({
    groupId: "official-test@g.us",
    sourceMessageId: "acceptance-1",
    messageId: "acceptance-1",
    deletionResult: { results: [{ messageId: "acceptance-1", ok: true }] },
    publicTripNo: 75,
    captainName: "كابتن اختبار",
    deletionStatus: "deleted",
  });
  assert.equal(duplicate.status, "already_sent");
  assert.equal(sentMessages.length, 1, "retries do not duplicate the group message");
  assert.equal(audits.length, 1);
  console.log("insufficient-balance group notice: ordered, exact-message-delete-gated, official-group-only, and idempotent");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
