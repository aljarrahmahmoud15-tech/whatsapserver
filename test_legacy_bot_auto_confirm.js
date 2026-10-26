const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /const BOT_PHONE = process\.env\.BOT_PHONE\?\.trim\(\) \|\| "0775969880"/);
assert.match(server, /const BOT_PHONE_INTL = process\.env\.BOT_PHONE_INTL\?\.trim\(\) \|\| "962775969880"/);
assert.match(server, /function isBotPhone\(phone\)/);
assert.match(server, /normalized === phoneWithCountry\(BOT_PHONE\) \|\| normalized === phoneWithCountry\(BOT_PHONE_INTL\)/);
assert.match(server, /SET role='captain', is_bot=0/);
assert.match(server, /WHERE id NOT IN \(\$\{ownerIds\.map\(\(\) => "\?"\)\.join\(\",\"\)\}\) AND is_bot=1/);
assert.match(server, /Keep wallets, ledgers, and historical orders intact/);
assert.match(server, /if \(!ownerRows\.length && primary\)/);
assert.doesNotMatch(server, /const LEGACY_BOT_PHONE/);
assert.doesNotMatch(server, /function isLegacyBotCaptainPhone/);
assert.match(server, /if \(producer\.is_bot === 1 \|\| producer\.role === "company"\)/);
assert.doesNotMatch(server, /producer\.is_bot === 1 \|\| producer\.role === "company" \|\| isLegacyBotCaptainPhone\(producer\.phone\)/);
assert.match(server, /Human-owned bookings still use the producer's 👍 on this exact/);
assert.match(server, /approveBotOwnedAcceptance\(\{ groupId, message: msg, candidateId: candidate\.id, acceptanceMessageId \}\)/);
assert.match(server, /settlePendingOrder\(candidateId, acceptanceMessageId, connectedBotPhone\(\)\)/);

console.log('single active bot identity and stale-bot demotion guardrails passed');
