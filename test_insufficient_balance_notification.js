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

const guardIndex = server.indexOf('if (acceptanceResult.state === "insufficient_balance")');
const deleteIndex = server.indexOf('deleteWhatsAppMessageForEveryone(messageId)', guardIndex);
const notifyIndex = server.indexOf('await notifyCaptainInsufficientAcceptanceBalance(', guardIndex);
assert.ok(guardIndex >= 0 && deleteIndex > guardIndex && notifyIndex > deleteIndex, 'private notification runs after the deletion attempt');

const insertIndex = server.indexOf('INSERT INTO order_candidate_acceptances');
const notifyFunctionIndex = server.indexOf('async function notifyCaptainInsufficientAcceptanceBalance');
assert.ok(notifyFunctionIndex >= 0 && insertIndex >= 0, 'notification helper and acceptance persistence are present');

console.log('insufficient balance rejection sends an Arabic private notice with idempotency protection');
