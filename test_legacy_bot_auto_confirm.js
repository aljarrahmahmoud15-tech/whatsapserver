const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /const LEGACY_BOT_PHONE = "0779110123"/);
assert.match(server, /const LEGACY_BOT_PHONE_INTL = "962779110123"/);
assert.match(server, /\[BOT_PHONE, BOT_PHONE_INTL, LEGACY_BOT_PHONE, LEGACY_BOT_PHONE_INTL\]/);
assert.match(server, /isBotGeneratedMessage\(msg\) \|\| isBotPhone\(senderPhone\)/);
assert.match(server, /if \(producer\.is_bot === 1 \|\| producer\.role === "company"\)/);
assert.match(server, /approveBotOwnedAcceptance\(\{ groupId, message: msg, candidateId: candidate\.id, acceptanceMessageId \}\)/);
assert.match(server, /settlePendingOrder\(candidateId, acceptanceMessageId, connectedBotPhone\(\)\)/);

console.log('legacy bot identity follows automatic bot-owned confirmation path');
