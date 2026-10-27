const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /const BOT_PHONE = process\.env\.BOT_PHONE\?\.trim\(\) \|\| ""/);
assert.match(source, /const BOT_PHONE_INTL = process\.env\.BOT_PHONE_INTL\?\.trim\(\) \|\| ""/);
assert.match(source, /Demote every stale bot identity/);
assert.doesNotMatch(source, /function sanitizeLegacyPhone/);
assert.doesNotMatch(source, /function isLegacyBotCaptainPhone/);
assert.doesNotMatch(source, /const LEGACY_BOT_PHONE/);
assert.doesNotMatch(source, /downloaderPhone: "[0-9]+"/);

console.log('single active bot identity and stale-bot cleanup guardrails passed');
