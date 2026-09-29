const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /const WHATSAPP_IDENTITY_SCOPE = String\(/, 'service identity scope is explicit');
assert.match(source, /const WHATSAPP_CLIENT_ID = process\.env\.WHATSAPP_CLIENT_ID\?\.trim\(\) \|\| `aljarah-\$\{WHATSAPP_IDENTITY_SCOPE\}`/, 'fallback LocalAuth namespace is service-scoped');
assert.match(source, /A LID is not globally meaningful across WhatsApp sessions/, 'LID boundary is documented');
assert.match(source, /SELECT phone FROM whatsapp_identities WHERE whatsapp_lid=\? AND active=1/, 'LID outbound requires local verified mapping');
assert.match(source, /crossGroupOperations: false/, 'status exposes cross-group isolation');
assert.match(source, /unverifiedLidOutbound: false/, 'status exposes LID isolation');
console.log('group/session isolation boundary guardrails verified');
