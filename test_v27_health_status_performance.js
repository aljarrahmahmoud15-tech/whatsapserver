const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('server.js', 'utf8');
const healthStart = source.indexOf('app.get("/health"');
const captainRegisterStart = source.indexOf('app.get("/captain/register"');
const statusStart = source.indexOf('app.get("/status"');
const systemHealthStart = source.indexOf('app.get("/api/admin/system/health"');
assert.ok(healthStart >= 0, 'health route must exist');
assert.ok(captainRegisterStart > healthStart, 'health route boundary must exist');
assert.ok(statusStart > healthStart, 'status route must exist after health route');
assert.ok(systemHealthStart > statusStart, 'status route boundary must exist');

const healthRoute = source.slice(healthStart, captainRegisterStart);
const statusRoute = source.slice(statusStart, systemHealthStart);

test('health remains a lightweight liveness route with server timing', () => {
  assert.match(healthRoute, /Cache-Control\", \"no-store\"/);
  assert.match(healthRoute, /Server-Timing/);
  assert.doesNotMatch(healthRoute, /db\.prepare\(|readRedisJson\(|storageInventory\(|fs\.(readdir|stat|access)Sync/);
});

test('status serves a snapshot and does not run SQLite work in the request handler', () => {
  assert.match(source, /function buildPublicStatusPayload\(\)/);
  assert.match(source, /function refreshPublicStatusCache\(\)/);
  assert.match(source, /startPublicStatusCacheRefresh\(\);/);
  assert.match(statusRoute, /X-Status-Cache/);
  assert.match(statusRoute, /Server-Timing/);
  assert.doesNotMatch(statusRoute, /db\.prepare\(/);
  assert.doesNotMatch(statusRoute, /whatsappSessionPersistenceHealth\(/);
});

test('status snapshot refresh is single-flight and unrefed', () => {
  assert.match(source, /if \(publicStatusRefreshPromise\) return publicStatusRefreshPromise;/);
  assert.match(source, /publicStatusRefreshTimer\.unref\(\)/);
  assert.match(source, /setInterval\(\(\) => \{ void refreshPublicStatusCache\(\); \}, PUBLIC_STATUS_CACHE_TTL_MS\)/);
});
