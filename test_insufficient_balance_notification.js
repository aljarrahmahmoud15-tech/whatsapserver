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

// Legacy failure-only wording is still available for the deletion-failure audit path.
assert.match(server, /async function notifyOfficialGroupInsufficientAcceptanceDeletionFailure/);
assert.match(server, /GROUP-ACCEPTANCE-DELETE-FAILED-\$\{sourceKey\}/);
assert.match(server, /order\.acceptance\.insufficient_balance_deletion_failed/);
assert.match(server, /تعذّر حذف رسالة «تم» تلقائيًا/);

// The group now always receives a visible, branded confirmation of the discarded «تم» reply,
// carrying the captain name, the reason, and the verified deletion state.
assert.match(server, /async function notifyOfficialGroupAcceptanceDiscarded\(/);
assert.match(server, /await notifyOfficialGroupAcceptanceDiscarded\(/);
assert.match(server, /GROUP-ACCEPTANCE-DISCARDED-\$\{sourceKey\}/);
assert.match(server, /order\.acceptance\.discarded_group_notice/);
assert.match(server, /الكابتن: \$\{captainName\}/);
assert.match(server, /تم حذف رسالة «تم» من القروب وتم التحقق منها/);
assert.match(server, /async function verifyWhatsAppMessageDeleted\(messageId, timeoutMs = 4000\)/);
assert.match(server, /const deletionVerified = deletionStatus === "deleted" \? await verifyWhatsAppMessageDeleted\(messageId\) : false;/);
assert.match(server, /deletionVerified,/);

const guardIndex = server.indexOf('if (acceptanceResult.state === "insufficient_balance")');
const deleteIndex = server.indexOf('deleteWhatsAppMessageForEveryone(messageId, {', guardIndex);
const notifyIndex = server.indexOf('await notifyCaptainInsufficientAcceptanceBalance(', guardIndex);
assert.ok(guardIndex >= 0 && deleteIndex > guardIndex && notifyIndex > deleteIndex, 'private notification runs after the deletion attempt');
const correctionIndex = server.indexOf('await notifyOfficialGroupAcceptanceDiscarded(', guardIndex);
assert.ok(correctionIndex > deleteIndex && correctionIndex < notifyIndex, 'group deletion confirmation runs between deletion and private captain notice');

const insertIndex = server.indexOf('INSERT INTO order_candidate_acceptances');
const notifyFunctionIndex = server.indexOf('async function notifyCaptainInsufficientAcceptanceBalance');
assert.ok(notifyFunctionIndex >= 0 && insertIndex >= 0, 'notification helper and acceptance persistence are present');

console.log('insufficient balance rejection deletes the reply, confirms it in the group, and notifies the captain privately');
