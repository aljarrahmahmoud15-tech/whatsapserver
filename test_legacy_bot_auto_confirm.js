const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /const LEGACY_BOT_PHONE = "0779110123"/);
assert.match(server, /const LEGACY_BOT_PHONE_INTL = "962779110123"/);
assert.match(server, /function isBotPhone\(phone\)/);
assert.match(server, /function isLegacyBotCaptainPhone\(phone\)/);
assert.match(server, /normalized === phoneWithCountry\(BOT_PHONE\) \|\| normalized === phoneWithCountry\(BOT_PHONE_INTL\)/);
assert.match(server, /if \(producer\.is_bot === 1 \|\| producer\.role === "company"\)/);
assert.doesNotMatch(server, /producer\.is_bot === 1 \|\| producer\.role === "company" \|\| isLegacyBotCaptainPhone\(producer\.phone\)/);
assert.match(server, /Human-owned bookings still use the producer's 👍 on this exact/);
assert.match(server, /approveBotOwnedAcceptance\(\{ groupId, message: msg, candidateId: candidate\.id, acceptanceMessageId \}\)/);
assert.match(server, /settlePendingOrder\(candidateId, acceptanceMessageId, connectedBotPhone\(\)\)/);

const botIdentityBody = server.slice(server.indexOf('function isBotPhone(phone)'), server.indexOf('function isLegacyBotCaptainPhone(phone)'));
assert.doesNotMatch(botIdentityBody, /LEGACY_BOT_PHONE/);
assert.match(server, /The former bot number is now an ordinary captain/);
assert.match(server, /SET role='captain', is_bot=0/);
assert.match(server, /const currentBotPhones = new Set\(\[BOT_PHONE, BOT_PHONE_INTL\]/);
assert.match(server, /const legacyCaptainPhone = phoneWithCountry\(LEGACY_BOT_PHONE_INTL \|\| LEGACY_BOT_PHONE\)/);

console.log('legacy number remains a captain and requires its own 👍 for settlement');
