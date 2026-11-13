"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const server = fs.readFileSync("server.js", "utf8");

const helperStart = server.indexOf("async function notifyOfficialGroupInsufficientAcceptanceBalance");
const helperEnd = server.indexOf("\nconst cancellationPartyNotificationInFlight", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "suppressed official-group notice helper exists");
const helperSource = server.slice(helperStart, helperEnd);
assert.match(helperSource, /groupNotification: false/);
assert.match(helperSource, /policy: "captain_private_only"/);
assert.match(helperSource, /return \{ status: "not_sent_by_policy" \}/);
assert.doesNotMatch(helperSource, /sendWhatsAppAtMostOnce|INSERT OR IGNORE|UPDATE notifications/,
  "low-balance rejection must not send or persist a public group notice");

function assertPrivateOnlyBranch(startMarker, endMarker, label) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${label} branch exists`);
  const branch = server.slice(start, end);
  const deletionIndex = branch.indexOf("await deleteAcceptanceMessagesForInsufficientBalance(");
  const suppressedGroupIndex = branch.indexOf("await notifyOfficialGroupInsufficientAcceptanceBalance(");
  const captainNoticeIndex = branch.indexOf("await notifyCaptainInsufficientAcceptanceBalance(");
  assert.ok(deletionIndex >= 0 && suppressedGroupIndex > deletionIndex && captainNoticeIndex > suppressedGroupIndex,
    `${label}: delete linked «تم», suppress public notice, then notify the captain privately`);
}

assertPrivateOnlyBranch(
  'if (unquotedResult?.state === "insufficient_balance")',
  "if (!unquotedResult ||",
  "recovery"
);
assertPrivateOnlyBranch(
  'if (acceptanceResult.state === "insufficient_balance")',
  "// لا يصل هذا السطر إلى حالة نقص الرصيد",
  "live message"
);

const audits = [];
const sandbox = { audit: (...entry) => audits.push(entry) };
vm.runInNewContext(`${helperSource}\nthis.notify = notifyOfficialGroupInsufficientAcceptanceBalance;`, sandbox);
(async () => {
  const result = await sandbox.notify({
    groupId: "official-test@g.us",
    sourceMessageId: "acceptance-1",
    deletionStatus: "deleted",
  });
  assert.equal(result.status, "not_sent_by_policy");
  assert.equal(audits.length, 1);
  assert.equal(audits[0][0], "official_group.acceptance.insufficient_balance_suppressed");
  assert.equal(audits[0][3].groupNotification, false);
  assert.equal(audits[0][3].financialMutation, false);
  console.log("insufficient-balance group notice suppressed; private captain notice remains enabled");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
