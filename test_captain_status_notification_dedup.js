const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const start = server.indexOf('app.patch("/api/admin/captains/:id"');
const end = server.indexOf('app.delete("/api/admin/captains/:id"', start);
assert.ok(start >= 0 && end > start, 'captain status patch route must exist');
const route = server.slice(start, end);

assert.match(route, /active<>\?/);
assert.match(route, /statusChange\.changes/);
assert.match(route, /statusChanged: false/);
assert.match(route, /notificationSent: false/);
assert.match(route, /statusChanged: true/);
assert.match(route, /CAPTAIN-STATUS-\$\{id\}-\$\{active \? "ACTIVE" : "SUSPENDED"\}-\$\{stamp\}/);
assert.doesNotMatch(route, /CAPTAIN-STATUS-[^\n]*Date\.now\(\)/);

const updateIndex = route.indexOf('const statusChange =');
const notifyIndex = route.indexOf('void sendCaptainStatusText');
assert.ok(updateIndex >= 0 && notifyIndex > updateIndex, 'status notification must follow the guarded state update');

console.log('captain status notification deduplication guard: ok');
