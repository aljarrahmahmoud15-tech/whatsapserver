const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /app\.post\("\/api\/admin\/group\/delete-duplicate-text", requireBotWalletOwner/);
assert.match(source, /async function deleteWhatsAppMessageForEveryone\(messageId\)/);
assert.match(source, /Array\.isArray\(req\.body\?\.messageIds\)/);
assert.match(source, /message\?\.fromMe === true/);
assert.match(source, /resolveGroupChatId\(message\) === groupId/);
assert.match(source, /String\(message\?\.body \|\| ""\)\.trim\(\) === expectedBody/);
assert.match(source, /messageIds\.includes\(keepMessageId\)/);
assert.match(source, /canSenderRevokeMsg/);
assert.match(source, /canAdminRevokeMsg/);
assert.match(source, /Cmd\.sendRevokeMsgs/);
assert.match(source, /current\.isRevoked \|\| current\.revoked \|\| current\.type === "revoked"/);
assert.match(source, /mutation: "none"/);
assert.match(source, /group\.duplicate_text_messages_deleted/);

console.log('duplicate text deletion guard: ok');
