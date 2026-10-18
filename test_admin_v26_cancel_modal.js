const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('public/admin-v26.html', 'utf8');
const start = page.indexOf('function openCancelOrderModal(');
const end = page.indexOf('async function approveBooking(', start);
assert.ok(start >= 0 && end > start, 'V26 cancel modal handlers must exist');
const flow = page.slice(start, end);

assert.match(page, /data-order-cancel=/, 'settled order cards expose the owner cancellation action');
assert.match(page, /openCancelOrderModal\(Number\(button\.dataset\.orderCancel\),button\)/, 'the card action opens the review modal');
assert.match(flow, /id="cancelOrderForm"/, 'the modal contains a dedicated form');
assert.match(flow, /id="cancelOrderReason"/, 'the modal requires an auditable cancellation reason');
assert.match(flow, /id="cancelOrderAcknowledge"/, 'the modal requires explicit financial acknowledgement');
assert.match(flow, /V26_CANCEL_ORDER/, 'the server confirmation marker is preserved');
assert.match(flow, /X-Idempotency-Key/, 'the action remains idempotent');
assert.match(flow, /body:JSON\.stringify\(\{confirmation:'V26_CANCEL_ORDER',idempotencyKey,reason\}\)/, 'the entered reason is sent to the protected API');
assert.match(flow, /closeModal\(\);await loadData\(\)/, 'successful reversal closes and refreshes the dashboard');
assert.doesNotMatch(flow, /window\.confirm/, 'the cancellation flow uses the dedicated modal instead of an unstructured browser prompt');

console.log('V26 cancellation modal guardrails verified');
