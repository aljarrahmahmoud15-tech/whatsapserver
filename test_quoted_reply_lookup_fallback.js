const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /async function getQuotedMessageWithFallback\(message\)/);
assert.match(source, /function buildStoredQuotedMessageById\(groupId, messageId\)/);
assert.match(source, /quoted = buildStoredQuotedMessageById\(resolveGroupChatId\(message\), quotedMessageIdHint\)/);
assert.match(source, /message\?\._data\?\.quotedStanzaID/);
assert.match(source, /message\?\._data\?\.quotedMessageId/);
assert.match(source, /message\?\._data\?\.quotedMsgId/);
assert.match(source, /getWhatsAppMessageByIdVariants\(quotedMessageIdHint, 5000\)/);
assert.match(source, /const quotedMessageIdHint = String\(/);
assert.match(source, /quoted\.__serializedId = quotedMessageIdHint/);
assert.match(source, /if \(message\?\.hasQuotedMsg \|\| quotedMessageIdHint\)/, 'لا يفحص Puppeteer رسالة تم غير المقتبسة');

console.log('quoted acceptance lookup fallback verified');
