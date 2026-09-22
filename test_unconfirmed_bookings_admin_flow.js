const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');

assert.match(server, /app\.get\("\/api\/admin\/unconfirmed-bookings", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/unconfirmed-bookings\/candidate\/:id\/confirm", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/unconfirmed-bookings\/:kind\/:id\/reject", requireAdmin/);
assert.match(server, /if \(!configuredGroupId \|\| !isConfiguredGroup\(configuredGroupId\)\)/);
assert.match(server, /WHERE c\.group_id=\?/);
assert.match(server, /c\.status IN \('candidate','pending'\)/);
assert.match(server, /const canConfirm = row\.status === "pending" && Boolean\(row\.acceptance_message_id\)/);
assert.match(server, /settlePendingOrder\(candidate\.id, acceptance\.acceptance_message_id, connectedBotPhone\(\), \{ adminApproval: true \}\)/);
assert.match(server, /function settlePendingOrder\(candidateId, expectedMessageId, confirmerPhone, \{ adminApproval = false \} = \{\}\)/);
assert.match(server, /mutation: "applied_once"/);
assert.match(server, /UPDATE order_candidate_acceptances SET status='rejected'/);
assert.match(server, /UPDATE order_candidates SET status='cancelled'/);
assert.match(server, /UPDATE orders SET status='cancelled',settlement_state='cancelled'/);
assert.match(server, /financialMutation: false/);
assert.match(server, /app\.locals\.unconfirmedBookingActions/);

assert.match(admin, /id="unconfirmedBookingsCard"/);
assert.match(admin, /id="unconfirmedBookings"/);
assert.match(admin, /تأكيد وتثبيت التسوية/);
assert.match(admin, /عدم تأكيد الحجز/);
assert.match(admin, /\/api\/admin\/unconfirmed-bookings\?limit=200/);
assert.match(admin, /function renderUnconfirmedBookings\(\)/);
assert.match(admin, /function openUnconfirmedDecision\(index,action\)/);
assert.match(admin, /function submitUnconfirmedDecision\(\)/);
assert.match(admin, /window\.unconfirmedDecisionInFlight/);
assert.match(admin, /id="unconfirmedDecisionModal"/);
assert.match(admin, /action==='confirm'\?`\/api\/admin\/unconfirmed-bookings\/candidate/);
assert.match(admin, /action==='confirm'\?`تم تأكيد الحجز وتثبيت التسوية/);
assert.doesNotMatch(admin, /function openUnconfirmedDecision\(index,action\)\{[\s\S]{0,700}confirm\(/, 'قرار الحجز يستخدم نافذة داخلية بدل confirm() الحاجب');

console.log('unconfirmed booking list, confirm/settle, reject, group scope, and duplicate-action guardrails verified');
