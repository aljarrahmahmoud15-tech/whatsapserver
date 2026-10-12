const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /async function notifyCaptainInsufficientAcceptanceBalance/);
assert.match(server, /تم حذف\/رفض رسالة «تم» لأن رصيد محفظتك لا يغطي عمولة هذا الطلب/);
assert.match(server, /الرصيد الحالي: \$\{money\(balanceCents\)\} JOD/);
assert.match(server, /العمولة المطلوبة: \$\{money\(requiredCents\)\} JOD/);
assert.match(server, /CAPTAIN-ACCEPTANCE-BALANCE-\$\{sourceKey\}/);
assert.match(server, /SELECT id,delivery_status,message_id FROM notifications WHERE idempotency_key=\? LIMIT 1/);
assert.match(server, /existing\?\.delivery_status === "sent" \|\| existing\?\.delivery_status === "uncertain"/);
assert.match(server, /captain\.acceptance\.insufficient_balance/);
assert.match(server, /await notifyCaptainInsufficientAcceptanceBalance\(/);
assert.match(server, /notificationStatus: notification\.status/);
assert.match(server, /async function notifyOfficialGroupInsufficientAcceptanceDeletionFailure/);
assert.match(server, /GROUP-ACCEPTANCE-ALERT-TEXT-\$\{sourceKey\}/);
assert.match(server, /order\.acceptance\.insufficient_balance_deletion_failed/);
assert.match(server, /تم إلغاء الرحلة لعدم استكفاء الرصيد/);
assert.match(server, /await notifyOfficialGroupInsufficientAcceptanceDeletionFailure\(/);

const guardIndex = server.indexOf('if (acceptanceResult.state === "insufficient_balance")');
const deleteIndex = server.indexOf('deleteAcceptanceOnlyAfterGroupAlert({', guardIndex);
const notifyIndex = server.indexOf('await notifyCaptainInsufficientAcceptanceBalance(', guardIndex);
assert.ok(guardIndex >= 0 && deleteIndex > guardIndex && notifyIndex > deleteIndex, 'private notification runs after the deletion attempt');
const helperStart = server.indexOf('async function deleteAcceptanceOnlyAfterGroupAlert(');
const correctionIndex = server.indexOf('await notifyOfficialGroupInsufficientAcceptanceDeletionFailure(', helperStart);
const helperDeleteIndex = server.indexOf('await deleteWhatsAppMessageForEveryone(messageId, {', helperStart);
assert.ok(correctionIndex >= 0 && helperDeleteIndex > correctionIndex, 'group alert runs before the guarded deletion');
assert.match(server, /const alertConfirmed = Boolean\(correction && \["sent", "already_sent"\]\.includes\(correction\.status\) && correction\.messageId\)/);
assert.match(server, /sendWhatsAppAtMostOnce\(targetGroupId, message, undefined, 20000\)/);
assert.match(server, /result\?\.message\?\.id\?\._serialized/);
assert.match(server, /serializedMessageId\(result\?\.message\)/);

const insertIndex = server.indexOf('INSERT INTO order_candidate_acceptances');
const notifyFunctionIndex = server.indexOf('async function notifyCaptainInsufficientAcceptanceBalance');
assert.ok(notifyFunctionIndex >= 0 && insertIndex >= 0, 'notification helper and acceptance persistence are present');

console.log('insufficient balance rejection sends an Arabic private notice with idempotency protection');
