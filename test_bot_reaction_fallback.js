const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
assert.match(server, /CREATE TABLE IF NOT EXISTS order_candidate_acceptances/);
assert.match(server, /INSERT OR IGNORE INTO order_candidate_acceptances/);
assert.match(server, /Final settlement is authorized when any active human captain reacts/);
assert.match(server, /async function approveBotOwnedAcceptance/);
assert.doesNotMatch(server, /const result = settlePendingOrder\(candidate\.id, messageId, BOT_PHONE_INTL \|\| BOT_PHONE\)/);
assert.match(server, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(server, /const settlementConfirmerPhone = phoneWithCountry\(acceptanceCaptain\.phone\)/);
assert.match(server, /const result = settlePendingOrder\(pending\.candidate_id, pending\.acceptance_message_id, settlementConfirmerPhone, \{ approvalReactionUserId: approvingCaptain\.id \}\)/);
assert.match(server, /const captainApproved = Boolean\(/);
assert.match(server, /reaction_approver_not_active_human_captain/);
console.log('active human captain thumbs-up on the exact quoted تم reply settles once');
