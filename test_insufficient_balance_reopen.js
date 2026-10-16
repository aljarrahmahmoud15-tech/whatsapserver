const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /async function notifyOfficialGroupOrderReopened\(/);
assert.match(server, /isOfficialGroupTarget\(targetGroupId\)/);
assert.match(server, /orderReopenNotificationInFlight/);
assert.match(server, /ORDER-REOPEN-INSUFFICIENT-BALANCE-\$\{candidateId\}/);
assert.match(server, /🔁 إعادة فتح الحجز/);
assert.match(server, /تم حذف رد الكابتن «تم» السابق من القروب/);
assert.match(server, /لن يُعتمد هذا الرد/);
assert.match(server, /الحجز متاح من جديد/);
assert.match(server, /يرجى الرد على هذه الرسالة بكلمة «تم»/);
assert.match(server, /لم تُنفذ أي تسوية مالية لهذا الحجز حتى الآن/);
assert.match(server, /async function reopenOrderAfterInsufficientBalance\(/);
assert.match(server, /deletionStatus !== "deleted"/);
assert.match(server, /financialMutation: false/);
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
