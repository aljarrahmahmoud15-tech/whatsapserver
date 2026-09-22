const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
assert.match(source, /async function fetchInternalReactionRows\(messageId\)/);
assert.match(source, /WAWebCollections/);
assert.match(source, /collections\.Reactions\.find\(candidateId\)/);
assert.match(source, /const rawId = String\(targetId \|\| ""\)\.split\("_"\)\.slice\(2\)\.join\("_"\)/);
assert.match(source, /if \(Array\.isArray\(value\)\) return value/);
assert.match(source, /if \(Array\.isArray\(value\.models\)\) return value\.models/);
assert.match(source, /collections\.Msg\?\.getMessagesById/);
assert.match(source, /const internalReactions =/);
assert.match(source, /internalReactions\.length && !archivedHasSenders/);
console.log('internal reaction rows guard: ok');
