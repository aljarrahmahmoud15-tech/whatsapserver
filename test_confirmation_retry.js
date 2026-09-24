const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
const start = source.indexOf('async function retryFailedBookingConfirmations');
const end = source.indexOf('function observeFinalBookingConfirmationMessage', start);
assert.ok(start >= 0, 'confirmation retry helper must exist');
assert.ok(end > start, 'confirmation retry helper must end before the observer');
const retry = source.slice(start, end);

assert.match(retry, /FROM order_confirmation_deliveries d\s+JOIN orders o/);
assert.match(retry, /d\.status='failed'/);
assert.match(retry, /d\.attempts < \?/);
assert.match(retry, /MAX_CONFIRMATION_DELIVERY_ATTEMPTS/);
assert.match(retry, /sendFinalBookingConfirmation\(row\.group_id/);
assert.match(retry, /orderId: row\.order_id/);
assert.doesNotMatch(retry, /settlePendingOrder/);
assert.doesNotMatch(retry, /applySettlement|wallet_ledger|INSERT INTO settlements/);
assert.match(source, /void retryFailedBookingConfirmations\(\)/, 'retry must run when WhatsApp becomes ready');
assert.match(source, /MAX_CONFIRMATION_DELIVERY_ATTEMPTS = 3/);

console.log('Confirmation retry guard tests passed');
