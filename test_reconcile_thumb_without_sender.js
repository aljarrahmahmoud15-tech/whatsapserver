const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const normalizedMessageId = reactionId\(messageId\) \|\| String\(messageId \|\| ""\)\.trim\(\);/);
assert.match(source, /if \(await hasVisibleThumbReaction\(normalizedMessageId\)\)/);
assert.match(source, /await handleMessageReaction\(\{ reaction: "👍", msgId: normalizedMessageId \}\);/);
assert.match(source, /if \(!senders\.length\) \{/);
assert.match(source, /hasReactionByMe: reactionIsByCurrentAccount/);
console.log('thumb reconciliation without reaction-owner phone: ok');
