const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const start = server.indexOf('  if (producer.is_bot === 1 || producer.role === "company") {');
const end = server.indexOf('\n  }\n}', start);
assert(start >= 0 && end > start, 'company approval branch exists');
const branch = server.slice(start, end);
assert.match(branch, /const reacted = await reactToCaptainAcceptance\(msg, messageId\)/);
assert.match(branch, /if \(!reacted\) console\.warn\(.*continuing financial approval/);
assert.match(branch, /const result = settlePendingOrder\(candidate\.id, messageId, BOT_PHONE_INTL \|\| BOT_PHONE\)/);
assert.doesNotMatch(branch, /if \(!reacted\)[^\n]*\n[\s\S]{0,120}else \{/);
assert.match(branch, /if \(result\.state === "accepted"\)/);
console.log('bot reaction failure fallback keeps valid company settlement path active');
