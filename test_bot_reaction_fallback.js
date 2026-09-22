const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
assert.match(server, /CREATE TABLE IF NOT EXISTS order_candidate_acceptances/);
assert.match(server, /INSERT OR IGNORE INTO order_candidate_acceptances/);
assert.match(server, /لا تسوية عند «تم» فقط/);
assert.doesNotMatch(server, /const result = settlePendingOrder\(candidate\.id, messageId, BOT_PHONE_INTL \|\| BOT_PHONE\)/);
assert.match(server, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(server, /const settlementConfirmerPhone = phoneWithCountry\(acceptanceCaptain\.phone\)/);
assert.match(server, /const result = settlePendingOrder\(pending\.candidate_id, pending\.acceptance_message_id, settlementConfirmerPhone\)/);
assert.doesNotMatch(server, /const producerApproved =/);
console.log('any captain thumbs-up on the exact quoted تم reply settles once');
