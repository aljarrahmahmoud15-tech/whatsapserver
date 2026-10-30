const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /function composeCanonicalMessageId\(message\)/);
assert.match(server, /value\.user && value\.server/);
assert.match(server, /composeCanonicalMessageId\(message\)/);
assert.match(server, /const messageId = serializedMessageId\(msg\) \|\|/);
assert.match(server, /async function notifyOfficialGroupOrderReopened\(/);
assert.match(server, /isOfficialGroupTarget\(targetGroupId\)/);
assert.match(server, /orderReopenNotificationInFlight/);
assert.match(server, /ORDER-REOPEN-INSUFFICIENT-BALANCE-\$\{candidateId\}/);
assert.match(server, /⚠️ لم يثبت الحجز لعدم كفاية الرصيد/);
assert.match(server, /بعد حذف «تم» يصبح الحجز متاحًا من جديد؛ أرسل «تم» ثم 👍 للتثبيت/);
assert.match(server, /async function reopenOrderAfterInsufficientBalance\(/);
assert.match(server, /!\["deleted", "paused"\]\.includes\(deletionStatus\)/);
assert.match(server, /messageDeletionPaused: deletionStatus === "paused"/);
assert.match(server, /correction = null/);
assert.match(server, /singleMessage: true/);
assert.match(server, /financialMutation: false/);
assert.match(server, /⏸️ رد «تم» مرفوض لعدم كفاية الرصيد وسيبقى ظاهرًا مؤقتًا/);
assert.match(server, /function findReopenedCandidateByMessage\(/);
assert.match(server, /event LIKE 'order\.acceptance\.reopened\.%'/);
assert.match(server, /candidate_reopened/);
assert.match(server, /acceptance_reopened_notice_match/);
assert.match(server, /reopenStatus: reopened\.status/);

const rejectionStart = server.indexOf('if (acceptanceResult.state === "insufficient_balance")');
const rejectionEnd = server.indexOf('if (["captain_ineligible"', rejectionStart);
assert.ok(rejectionStart >= 0 && rejectionEnd > rejectionStart);
const rejectionBlock = server.slice(rejectionStart, rejectionEnd);
assert.match(rejectionBlock, /await reopenOrderAfterInsufficientBalance\(/);
assert.match(rejectionBlock, /deletionStatus/);
assert.ok(rejectionBlock.indexOf('await notifyCaptainInsufficientAcceptanceBalance(') < rejectionBlock.indexOf('await reopenOrderAfterInsufficientBalance('));

const recoveryStart = server.indexOf('if (unquotedResult?.state === "insufficient_balance")');
const recoveryEnd = server.indexOf('if (!unquotedResult ||', recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
assert.match(server.slice(recoveryStart, recoveryEnd), /await reopenOrderAfterInsufficientBalance\(/);

console.log('insufficient-balance rejection reopens the order with idempotent group notice and no settlement');
