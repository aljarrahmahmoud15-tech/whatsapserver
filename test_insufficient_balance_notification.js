const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /async function notifyCaptainInsufficientAcceptanceBalance/);
assert.match(server, /تم حذف رسالة «تم» من الكابتن لعدم كفاية الرصيد/);
assert.match(server, /تم إلغاء الرحلة رقم \$\{String\(publicTripNo \|\| "غير محدد"\)\} فقط/);
assert.match(server, /async function deleteAcceptanceMessagesForInsufficientBalance/);
assert.match(server, /SELECT a\.acceptance_message_id FROM order_candidate_acceptances a JOIN order_candidates c/);
assert.match(server, /a\.captain_user_id=\? AND c\.group_id=\?/);
assert.match(server, /const ids = new Set\(\[messageId, \.\.\.rows\.map/);
assert.match(server, /for \(const acceptanceId of messageIds\)/);
assert.match(server, /deleteWhatsAppMessageForEveryone\(acceptanceId/);

const groupNoticeStart = server.indexOf('const insufficientBalanceGroupNotificationInFlight = new Set();');
const groupNoticeEnd = server.indexOf('\nconst cancellationPartyNotificationInFlight', groupNoticeStart);
assert.ok(groupNoticeStart >= 0 && groupNoticeEnd > groupNoticeStart);
const groupNotice = server.slice(groupNoticeStart, groupNoticeEnd);
assert.match(groupNotice, /async function notifyOfficialGroupInsufficientAcceptanceBalance\(\{ groupId, sourceMessageId, messageId, deletionStatus, deletionResult, publicTripNo, captainName, captainBalanceAmount, tripRequiredAmount \}\)/);
assert.match(groupNotice, /deletionStatus !== "deleted"/);
assert.match(groupNotice, /deletionResult\?\.ok !== true/);
assert.match(groupNotice, /deletionResult\?\.revoked !== true/);
assert.match(groupNotice, /!Number\.isFinite\(deletedCount\)/);
assert.match(groupNotice, /deletedCount <= 0/);
assert.match(groupNotice, /deletionResult\?\.paused === true/);
assert.match(groupNotice, /sourceMessageIdsEqual\(entry\?\.messageId, sourceKey\)/);
assert.match(groupNotice, /isOfficialGroupTarget\(targetGroupId\)/);
assert.match(groupNotice, /isServer2OutboundTargetAllowed\(targetGroupId\)/);
assert.match(groupNotice, /,'group',/);
assert.match(groupNotice, /group\.acceptance\.insufficient_balance_deleted/);
assert.match(groupNotice, /تم حذف رسالة «تم» للكابتن/);
assert.doesNotMatch(groupNotice, /captain_private_only|insufficient_balance_suppressed|إلغاء الرحلة|wallet|balanceCents/);
assert.match(groupNotice, /INSERT OR IGNORE INTO notifications/);
assert.match(groupNotice, /inserted\?\.changes !== 1/);
assert.match(groupNotice, /delivery_status='pending'/);
assert.match(groupNotice, /deliveryStatus === "uncertain"/);

assert.equal((server.match(/notifyCaptainInsufficientAcceptanceBalance/g) || []).length, 1, 'captain helper definition is retained with no callsites');
for (const [startMarker, endMarker] of [
  ['if (unquotedResult?.state === "insufficient_balance")', 'if (!unquotedResult ||'],
  ['if (acceptanceResult.state === "insufficient_balance")', '// لا يصل هذا السطر إلى حالة نقص الرصيد'],
]) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  const branch = server.slice(start, end);
  assert.doesNotMatch(branch, /notifyCaptainInsufficientAcceptanceBalance|notificationStatus/);
  assert.match(branch, /notifyOfficialGroupInsufficientAcceptanceBalance/);
  assert.match(branch, /deleteAcceptanceMessagesForInsufficientBalance/);
  assert.match(branch, /reopenOrderAfterInsufficientBalance/);
}

const retryStart = server.indexOf('async function retryCaptainStatusNotifications');
const retryEnd = server.indexOf('function startCaptainStatusNotificationRetryScheduler', retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart);
assert.doesNotMatch(server.slice(retryStart, retryEnd), /group\.acceptance\.insufficient_balance_deleted/);
console.log('insufficient-balance rejection now permits only fully confirmed group notice; private notice callsites are absent');
