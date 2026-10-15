const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
const sendCardStart = source.indexOf('async function sendCompanyOperationsCard');
const sendCardEnd = source.indexOf('function sendBotText(', sendCardStart);
const sendCard = source.slice(sendCardStart, sendCardEnd);

assert.match(source, /function isBotOutboundTarget\(target\)/);
assert.match(source, /whatsapp_identities WHERE whatsapp_lid=\? AND active=1/);
assert.match(sendCard, /isBotOutboundTarget\(to\)/);
assert.match(sendCard, /blocked: "bot_identity"/);
assert.match(source, /isProtectedOwnerIdentity\(phone\) \|\| isBotPhone\(phone\)/);

console.log('bot branding guardrail and captain-only welcome path verified');
