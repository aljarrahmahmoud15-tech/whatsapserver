const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('server.js', 'utf8');

const routeBlock = (route) => {
  const start = source.indexOf(`app.get("${route}"`);
  assert.ok(start >= 0, `route must exist: ${route}`);
  const end = source.indexOf('\napp.', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
};

test('distributed admin read cache has bounded memory, Redis fallback, and generation invalidation', () => {
  assert.match(source, /const V27_ADMIN_READ_CACHE_MAX_ENTRIES = 256/);
  assert.match(source, /function v27AdminReadCache\(kind, ttlMs = 1000\)/);
  assert.match(source, /readRedisJson\(redisKey\)/);
  assert.match(source, /writeRedisJson\(redisKey, envelope, ttlMs\)/);
  assert.match(source, /function invalidateV27AdminReadCache\(\)/);
  assert.match(source, /redisCacheClient\.incr\(redisCacheKey\('admin-read-generation'\)\)/);
  assert.match(source, /res\.once\("finish", \(\) =>/);
});

test('core V27 read routes use explicit short TTLs', () => {
  const routes = [
    ['/api/admin/bot/status', 'bot-status'],
    ['/api/admin/system/health', 'system-health'],
    ['/api/admin/captains', 'captains'],
    ['/api/admin/orders', 'orders'],
    ['/api/admin/orders/open', 'orders-open'],
    ['/api/admin/unconfirmed-bookings', 'unconfirmed-bookings'],
    ['/api/admin/company-wallet', 'company-wallet'],
    ['/api/admin/subscriptions', 'subscriptions'],
    ['/api/admin/settlements', 'settlements'],
    ['/api/admin/group/members', 'group-members'],
    ['/api/admin/support-tickets', 'support-tickets'],
  ];
  for (const [route, kind] of routes) {
    assert.match(routeBlock(route), new RegExp(`v27AdminReadCache\\("${kind}"`), `${route} must use ${kind} cache`);
  }
});

test('mutation and live-operation reads remain outside the distributed read cache', () => {
  for (const route of ['/api/admin/owner-control', '/api/admin/send-status/:operationId', '/api/admin/group/diagnostic']) {
    const block = routeBlock(route);
    assert.doesNotMatch(block, /v27AdminReadCache\(/, `${route} must remain live or audited`);
  }
  for (const route of ['/api/admin/captain-invites', '/api/admin/group/link-state', '/api/admin/cards', '/api/admin/wallet/:phone']) {
    assert.doesNotMatch(routeBlock(route), /v27AdminReadCache\(/, `${route} contains sensitive or secret-bearing data`);
  }
  assert.match(routeBlock('/api/admin/settings'), /v27AdminReadCache\("owner-settings"/);
  assert.match(routeBlock('/api/admin/system/settings'), /v27AdminReadCache\("system-settings"/);
});

test('public status is written to Redis without putting Redis on the liveness path', () => {
  assert.match(source, /redisCacheKey\('public-status'\)/);
  const healthStart = source.indexOf('app.get("/health"');
  const healthEnd = source.indexOf('app.get("/captain/register"', healthStart);
  const healthRoute = source.slice(healthStart, healthEnd);
  assert.doesNotMatch(healthRoute, /readRedisJson|writeRedisJson|redisCacheClient/);
});

console.log('V27 Redis admin read-cache guardrails: PASS');
