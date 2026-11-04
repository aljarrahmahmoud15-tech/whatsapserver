const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
assert.match(source, /cancellationCards:\s*\{\s*key:\s*"notification_cancellation_cards"/);
assert.match(source, /async function sendFinalBookingCancellation[\s\S]*?notificationEnabled\("cancellationCards"\)/);
assert.match(source, /async function sendFinalBookingConfirmation[\s\S]*?notificationEnabled\("bookingCards"\)/);
assert.match(source, /notifyOrderCancellationParties/);
console.log('cancellation group notification guardrail: ok');
