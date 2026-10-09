const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('./server.js', 'utf8');
assert.match(source, /async function resolveVisibleReactionSenderPhones\(/);
assert.match(source, /reactions-details-cell/);
assert.match(source, /openChatWindowAt\(messageId\)/);
assert.match(source, /reaction\?\.__senderPhone/);
assert.match(source, /reactionPhones\.push\(\.\.\.await resolveVisibleReactionSenderPhones/);

const start = source.indexOf('function normalizeReactionOwnerName');
const end = source.indexOf('async function resolveVisibleReactionSenderPhones', start);
assert.ok(start >= 0 && end > start, 'reaction owner normalizer exists');
const context = {};
vm.runInNewContext(`${source.slice(start, end)}\nthis.normalizeReactionOwnerName = normalizeReactionOwnerName;\nthis.reactionOwnerNameMatches = reactionOwnerNameMatches;`, context);

assert.equal(context.normalizeReactionOwnerName('حازم الشطناوي أبو الزيد'), 'حازم الشطناوي ابو الزيد');
assert.equal(context.normalizeReactionOwnerName('\u200fحازم   الشطناوي أبو الزيد'), 'حازم الشطناوي ابو الزيد');
assert.equal(context.normalizeReactionOwnerName('ID6 اليوم'), 'id6 اليوم');
assert.equal(context.reactionOwnerNameMatches('👍 1 من إجمالي 1 حازم الشطناوي أبو الزيد', 'حازم الشطناوي ابو الزيد'), true);
assert.equal(context.reactionOwnerNameMatches('حازم الشطناوي أبو الزيد', 'حازم الشطناوي'), true);
assert.equal(context.reactionOwnerNameMatches('حازم الشطناوي أبو الزيد', 'محمد الحوري'), false);
console.log('reaction owner UI fallback guardrails verified');
