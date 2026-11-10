const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /async function reopenOrderAfterInsufficientBalance\(\{ candidate, requiredCents, deletionStatus, groupNotificationStatus = "not_sent" \}\)/);
const reopenStart = server.indexOf('async function reopenOrderAfterInsufficientBalance(');
const reopenEnd = server.indexOf('\nasync function mediaFromRemoteVideoUrl', reopenStart);
assert.ok(reopenStart >= 0 && reopenEnd > reopenStart);
const reopen = server.slice(reopenStart, reopenEnd);
assert.match(reopen, /candidate_reopened/);
assert.match(reopen, /reopened_after_insufficient_balance/);
assert.match(reopen, /groupNotificationStatus/);
assert.match(reopen, /groupNotification: groupNotificationSent/);
assert.match(reopen, /return \{ status: "reopened"/);
assert.match(reopen, /financialMutation: false/);
assert.match(server, /تم حذف رسالة «تم» من الكابتن لعدم كفاية الرصيد/);
assert.match(server, /تم إلغاء الرحلة رقم \$\{String\(publicTripNo \|\| "غير محدد"\)\} فقط/);
assert.doesNotMatch(reopen, /sendServer2DirectAtMostOnce/);
console.log('insufficient-balance rejection reopens the order and records group-notification status');
