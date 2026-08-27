const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('./server.js', 'utf8');
assert(source.includes('let lastGroupEventGroupId = null;'));
assert(source.includes('lastGroupEventGroupId = groupId;'));
assert(source.includes('app.get("/api/admin/diagnostics/last-group-event", requireAdmin'));
assert(!source.includes('groupId: lastGroupEventGroupId, telemetry: lastGroupMessageTelemetry }));\napp.get("/status"'));
console.log('group event identity guard: ok');
