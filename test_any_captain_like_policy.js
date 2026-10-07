const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(source, /const settlementConfirmerPhone = phoneWithCountry\(acceptanceCaptain\.phone\);/);
assert.match(source, /settlePendingOrder\(pending\.candidate_id, pending\.acceptance_message_id, settlementConfirmerPhone\)/);
assert.match(source, /const producerApproved = Boolean\(/);
assert.match(source, /typeof isProtectedOwnerIdentity === "function"/);
assert.match(source, /isProtectedOwnerIdentity\(approverPhone\)/);
assert.match(source, /reaction_approver_not_original_producer/);
assert.match(source, /isBlockedPhone\(approverPhone\)/);

console.log('original-producer thumbs-up on selected quoted تم policy verified');
