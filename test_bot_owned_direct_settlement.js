const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
const dashboard = fs.readFileSync('./admin.html', 'utf8');

assert.match(source, /async function approveBotOwnedAcceptance\(\{ groupId, message, candidateId, acceptanceMessageId \}\)/);
assert.match(source, /const result = settlePendingOrder\(candidateId, acceptanceMessageId, connectedBotPhone\(\)\)/);
assert.match(source, /audit\("order\.bot_owned\.accepted_directly"/);
assert.match(source, /void sendFinalBookingConfirmation\(groupId, confirmationDetails\)/);
assert.match(source, /if \(producer\.is_bot === 1 \|\| producer\.role === "company"\)/);
assert.match(source, /void approveBotOwnedAcceptance\(\{ groupId, message: msg, candidateId: candidate\.id, acceptanceMessageId \}\)/);
assert.match(source, /Human-owned bookings still use the producer's/);
assert.match(dashboard, /يعتمد البوت الحجز بنفسه فور تسجيل/);
assert.match(dashboard, /دون انتظار التطبيق أو رقم صاحب التفاعل/);

console.log('bot-owned direct approval and settlement guardrails verified');
