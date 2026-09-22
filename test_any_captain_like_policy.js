const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const authorizedThumb = Boolean\(reactionPresentOnAcceptance\);/);
assert.match(source, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(source, /const settlementConfirmerPhone = phoneWithCountry\(acceptanceCaptain\.phone\);/);
assert.match(source, /settlePendingOrder\(pending\.candidate_id, pending\.acceptance_message_id, settlementConfirmerPhone\)/);
assert.match(source, /const reactionPresentOnAcceptance = Boolean\(thumbs\.length \|\| visibleThumbReaction \|\| persistedThumbEvidence\.length\);/);
assert.doesNotMatch(source, /const producerApproved =/);
assert.doesNotMatch(source, /approver_ineligible.*return/);
assert.doesNotMatch(source, /reaction_owner_unresolved/);

console.log('any-captain thumbs-up on quoted تم policy verified');
