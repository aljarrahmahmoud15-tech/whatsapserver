const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');
assert.doesNotMatch(server, /LEGACY_BOT_PHONE|isLegacyBotCaptainPhone|The former bot number/);
assert.match(server, /function isBotPhone\(phone\)/);
assert.match(server, /normalized === phoneWithCountry\(BOT_PHONE\) \|\| normalized === phoneWithCountry\(BOT_PHONE_INTL\)/);
assert.match(server, /const BOT_PHONE = process\.env\.BOT_PHONE/);
console.log('legacy bot identity is not embedded in the Aljarah service');
