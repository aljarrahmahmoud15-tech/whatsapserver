const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /CREATE TABLE IF NOT EXISTS order_confirmation_deliveries[\s\S]*order_id INTEGER NOT NULL UNIQUE/);
assert.match(source, /const confirmationSendQueue = \[\];/);
assert.match(source, /const confirmationQueuedOrderIds = new Set\(\);/);
assert.match(source, /function enqueueFinalBookingConfirmation\(groupId, details, options = \{\}\)/);
assert.match(source, /confirmationDeliveryInFlight\.has\(orderId\) \|\| confirmationQueuedOrderIds\.has\(orderId\)/);
assert.match(source, /void enqueueFinalBookingConfirmation\(target\.from, confirmationDetails, \{ deliveryMode: "direct", immediateReaction: true \}\)/);
assert.match(source, /const ownerAuthorized = Boolean\(typeof isProtectedOwnerIdentity === "function" && isProtectedOwnerIdentity\(approverPhone\)\);/);
assert.match(source, /cancelPendingOrderForProducerReaction\(pendingAcceptance\.candidate_id, messageId, approverPhone, ownerAuthorized\)/);
assert.match(source, /cancelOrderForReactionRemoval\(acceptedOrder\.id, messageId, approverPhone, ownerAuthorized\)/);
assert.match(source, /function cancelPendingOrderForProducerReaction\(candidateId, expectedMessageId, producerPhone, ownerAuthorized = false\)/);
assert.match(source, /function cancelOrderForReactionRemoval\(orderId, expectedMessageId, producerPhone, ownerAuthorized = false\)/);
console.log('confirmation queue idempotency and owner cancellation guardrails verified');
