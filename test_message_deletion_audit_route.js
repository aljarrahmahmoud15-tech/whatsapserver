const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /app\.get\("\/api\/admin\/audit\/message-deletion", requireAdmin/);
assert.match(server, /action='whatsapp\.message_deletion'/);
assert.match(server, /details LIKE \?/);
assert.match(server, /readOnly: true/);
assert.match(server, /revoked: details\?\.deletionResult\?\.revoked === true/);
assert.match(server, /ok: details\?\.deletionResult\?\.ok === true/);
assert.match(server, /Cache-Control/, 'audit endpoint must disable caching');
console.log('message deletion audit endpoint guardrails verified');
