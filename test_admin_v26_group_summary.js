const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const page = fs.readFileSync('./public/admin-v26.html', 'utf8');

assert.match(server, /app\.get\("\/api\/admin\/group\/summary", requireAdmin, async/);
const start = server.indexOf('app.get("/api/admin/group/summary"');
const end = server.indexOf('app.get("/api/admin/diagnostics/last-guide-video-send"', start);
assert.ok(start >= 0 && end > start, 'group summary route must be isolated');
const route = server.slice(start, end);
assert.match(route, /configuredRuntimeGroupId\(\)/);
assert.match(route, /isConfiguredGroup\(groupId\)/);
assert.match(route, /readGroupSnapshot\(groupId\)/);
assert.match(route, /mutation: "none"/);
assert.doesNotMatch(route, /sendMessage|addParticipants|removeParticipants|settlePendingOrder/);
assert.match(page, /\/api\/admin\/group\/summary/);
assert.match(page, /groupMemberCount/);

console.log('V26 official group summary read-only guard: PASS');
