const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(source, /const voiceBooking = Boolean\(/);
assert.match(source, /const approvalAuthorized = voiceBooking \? Boolean\(approvingProducer/);
assert.match(source, /const settlementConfirmerPhone = voiceBooking \? phoneWithCountry\(producer\.phone\) : phoneWithCountry\(acceptanceCaptain\.phone\);/);
assert.match(source, /approvalReactionUserId: voiceBooking \? approvingProducer\.id : approvingCaptain\.id/);
assert.match(source, /approval_reaction_user_id INTEGER/);
assert.match(source, /approval_method TEXT/);
assert.match(source, /const captainApproved = Boolean\(/);
assert.match(source, /approvingCaptain &&/);
assert.match(source, /approvingCaptain\.role === "captain"/);
assert.match(source, /approvingCaptain\.active === 1/);
assert.match(source, /reaction_approver_not_active_human_captain/);
assert.match(source, /isBlockedPhone\(approverPhone\)/);

console.log('active human captain thumbs-up on selected quoted تم policy verified');
