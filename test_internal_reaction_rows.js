const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
assert.match(source, /async function fetchInternalReactionRows\(messageId\)/);
assert.match(source, /WAWebCollections/);
assert.match(source, /collections\.Reactions\.find\(targetId\)/);
assert.match(source, /reactionRows && typeof reactionRows\.serialize === \"function\"/);
assert.doesNotMatch(source, /const directReactions = Array\.isArray\(reactionCollection\?\.reactions\)/);
assert.match(source, /const internalReactions =/);
assert.match(source, /internalReactions\.length && !archivedHasSenders/);
console.log('internal reaction rows guard: ok');
