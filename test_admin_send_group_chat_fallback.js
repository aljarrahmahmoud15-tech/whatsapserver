const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /const sendPromise = Promise\.resolve\(\)\.then\(async \(\) =>/);
assert.match(source, /client\.getChatById\(chatId\)/);
assert.match(source, /client\.getChats\(\)/);
assert.match(source, /chat\.sendMessage\(message, \{ waitUntilMsgSent: false \}\)/);
assert.match(source, /admin send chat\.sendMessage failed; retrying client\.sendMessage/);
assert.match(source, /message\.send_chat_failed/);
assert.match(source, /client\.sendMessage\(chatId, message, \{ waitUntilMsgSent: false \}\)/);
assert.match(source, /observeAdminSentMessage\(msg\)/);

console.log('admin group send fallback and message_create observation verified');
