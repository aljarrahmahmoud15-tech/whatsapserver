const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(source, /const settlementConfirmerPhone = phoneWithCountry\(acceptanceCaptain\.phone\);/);
assert.match(source, /settlePendingOrder\(pending\.candidate_id, pending\.acceptance_message_id, settlementConfirmerPhone\)/);
assert.match(source, /const producerApproved = Boolean\(/);
assert.match(source, /const producerPhone = phoneWithCountry\(producer\.phone\);/);
assert.match(source, /approverNormalizedPhone === producerPhone/);
assert.match(source, /approvingCaptain\.role === "captain"/);
assert.match(source, /approvingCaptain\.active === 1/);
assert.match(source, /reaction_approver_not_original_producer/);
assert.match(source, /isBlockedPhone\(approverPhone\)/);

console.log('original producer thumbs-up on selected quoted تم policy verified');
