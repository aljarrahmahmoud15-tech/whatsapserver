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
assert.doesNotMatch(server, /a2\.acceptance_message_id=c\.pending_message_id/);
assert.match(server, /a2\.acceptance_message_id=\(SELECT c2\.pending_message_id FROM order_candidates c2 WHERE c2\.id=a2\.candidate_id\)/);
assert.match(server, /const canConfirm = row\.status === "pending" && Boolean\(row\.acceptance_message_id\)/);
assert.match(server, /settlePendingOrder\(candidate\.id, acceptance\.acceptance_message_id, connectedBotPhone\(\), \{ adminApproval: true \}\)/);
assert.match(server, /function settlePendingOrder\(candidateId, expectedMessageId, confirmerPhone, \{ adminApproval = false \} = \{\}\)/);
assert.match(server, /const equivalentOrder = findEquivalentOrder\(current\.group_id, current\.source_message_id\)/);
assert.match(server, /importSource: "admin_archived_candidate_recovery"/);
assert.match(server, /allowArchivedRestore: true/);
assert.match(server, /current\.archive_state === "archived" && !allowArchivedRestore/);
assert.match(server, /archive_state='active',archived_at=NULL,archive_reason=NULL/);
assert.match(server, /state: "already_registered"/);
assert.match(server, /const equivalentOrder = findEquivalentOrder\(row\.group_id, row\.source_message_id\)/);
assert.match(server, /SELECT status FROM order_settlements WHERE order_id=\? ORDER BY id DESC LIMIT 1/);
assert.match(server, /mutation: "applied_once"/);
assert.match(server, /UPDATE order_candidate_acceptances SET status='rejected'/);
assert.match(server, /UPDATE order_candidates SET status='cancelled'/);
assert.match(server, /UPDATE orders SET status='cancelled',settlement_state='cancelled'/);
assert.match(server, /financialMutation: false/);
assert.match(server, /app\.locals\.unconfirmedBookingActions/);

assert.match(admin, /id="unconfirmedBookingsCard"/);
assert.match(admin, /id="unconfirmedBookings"/);
assert.match(admin, /اعتماد الحجز وتثبيت التسوية/);
assert.match(admin, /class=\"settle-button\"/);
assert.match(admin, /aria-label=\"اعتماد الحجز وتثبيت التسوية\"/);
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
