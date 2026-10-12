const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');
const start = server.indexOf('function messageIdCandidates');
const end = server.indexOf('function messageIdCore', start);
const block = server.slice(start, end);

assert.match(server, /function messageIdValueString\(value, depth = 0\)/);
assert.match(server, /const direct = value\._serialized \|\| value\.serialized \|\| value\.messageId/);
assert.match(block, /\]\s*\.map\(\(value\) => messageIdValueString\(value\)\)/);
assert.doesNotMatch(block, /\]\s*\.map\(\(value\) => String\(value \|\| ""\)\.trim\(\)\)/, 'message ID candidates must not stringify arbitrary objects');
console.log('message ID candidates reject object stringification');
