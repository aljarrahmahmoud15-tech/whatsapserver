const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const start = server.indexOf('app.get("/api/admin/group/membership-comparison"');
const end = server.indexOf('app.get("/api/admin/group/permissions"', start);
assert.ok(start >= 0 && end > start, 'membership comparison route must exist');
const route = server.slice(start, end);
assert.match(route, /requireAdmin/);
assert.match(route, /mutation: "none"/);
assert.match(route, /unregisteredInGroup/);
assert.match(route, /registeredOutsideGroup/);
assert.match(route, /readGroupSnapshot/);
assert.doesNotMatch(route, /sendMessage|addParticipants|removeParticipants|UPDATE users|INSERT INTO|DELETE FROM|settlePendingOrder/);
assert.match(server, /allowUnconfirmedRemoval: false/);
assert.match(server, /error: progress\.error \|\| null/);

console.log('read-only group membership comparison and wallet-policy guard: PASS');
