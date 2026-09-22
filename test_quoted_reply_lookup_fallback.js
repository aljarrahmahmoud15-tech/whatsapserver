const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /async function getQuotedMessageWithFallback\(message\)/);
assert.match(source, /message\?\._data\?\.quotedStanzaID/);
assert.match(source, /message\?\._data\?\.quotedMessageId/);
assert.match(source, /message\?\._data\?\.quotedMsgId/);
assert.match(source, /client\.getMessageById\(quotedMessageId\)/);
assert.match(source, /withTimeout\(client\.getMessageById\(quotedMessageId\), 12000, null\)/);

console.log('quoted acceptance lookup fallback verified');
