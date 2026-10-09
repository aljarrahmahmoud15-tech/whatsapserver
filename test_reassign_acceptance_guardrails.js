const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const start = server.indexOf('app.post("/api/admin/unconfirmed-bookings/candidate/:id/reassign-acceptance"');
const end = server.indexOf('app.post("/api/admin/unconfirmed-bookings/candidate/:id/confirm"', start);
assert.ok(start >= 0 && end > start, 'owner-only acceptance reassignment route exists');
const route = server.slice(start, end);
assert.match(route, /requireBotWalletOwner/);
assert.match(route, /fetchExactGroupEvidenceMessages/);
assert.match(route, /inspectConfirmedRecoveryMessage/);
assert.match(route, /findCaptainByPhone\(executorPhone, \{ activeOnly: true \}\)/);
assert.match(route, /pending_captain_user_id=\?,pending_message_id=\?/);
assert.match(route, /acceptance_reassigned/);
assert.match(route, /financialMutation: false/);
assert.match(route, /settlement: "not_applied"/);
assert.doesNotMatch(route, /settlePendingOrder\(/, 'reassignment cannot settle or mutate wallets');
assert.doesNotMatch(route, /sendFinalBookingConfirmation\(/, 'reassignment cannot send a settlement confirmation');
console.log('owner-only acceptance reassignment guardrails verified');
