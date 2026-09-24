const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
const start = source.indexOf('async function retryFailedBookingConfirmations');
const end = source.indexOf('function observeFinalBookingConfirmationMessage', start);
assert.ok(start >= 0, 'confirmation retry helper must exist');
assert.ok(end > start, 'confirmation retry helper must end before the observer');
assert.equal([...source.matchAll(/async function retryFailedBookingConfirmations/g)].length, 1, 'confirmation retry helper must have one runtime definition');
const retry = source.slice(start, end);

assert.match(retry, /FROM order_confirmation_deliveries d\s+JOIN orders o/);
assert.match(retry, /d\.status IN \('failed','pending'\)/);
assert.match(retry, /d\.attempts < \?/);
assert.match(retry, /d\.final_recovery_attempts < \?/);
assert.match(retry, /julianday\(d\.updated_at\) <= julianday\('now', '-120 seconds'\)/);
assert.match(retry, /MAX_CONFIRMATION_DELIVERY_ATTEMPTS/);
assert.match(retry, /sendFinalBookingConfirmation\(row\.group_id/);
assert.match(retry, /forceFinalRecovery:/);
assert.match(retry, /row\.status === 'pending'/);
assert.match(retry, /findFinalBookingConfirmationInGroup\(row\.group_id, row\.order_no\)/);
assert.match(retry, /orderId: row\.order_id/);
assert.doesNotMatch(retry, /settlePendingOrder/);
assert.doesNotMatch(retry, /applySettlement|wallet_ledger|INSERT INTO settlements/);
assert.match(source, /void retryFailedBookingConfirmations\(\)/, 'retry must run when WhatsApp becomes ready');
assert.match(source, /MAX_CONFIRMATION_DELIVERY_ATTEMPTS = 3/);
assert.match(source, /final_recovery_attempted_at TEXT/);
assert.match(source, /ADD COLUMN final_recovery_attempted_at TEXT/);
assert.match(source, /final_recovery_attempts INTEGER NOT NULL DEFAULT 0/);
assert.match(source, /MAX_FINAL_CONFIRMATION_RECOVERY_ATTEMPTS = 2/);
assert.match(source, /finalRecoveryAvailable = forceFinalRecovery/);
assert.match(source, /findFinalBookingConfirmationInGroup/);
assert.doesNotMatch(source, /manual_resend_only/);

console.log('Confirmation retry guard tests passed');
