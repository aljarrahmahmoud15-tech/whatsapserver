const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
const routeStart = source.indexOf('app.get("/status", (req, res) => {');
const routeEnd = source.indexOf('app.get("/api/admin/system/health"', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'public status route exists');
const route = source.slice(routeStart, routeEnd);

assert.match(source, /const PUBLIC_STATUS_CACHE_TTL_MS = Math\.max\(250, Math\.min\(5000,/);
assert.match(source, /let publicStatusCache = \{ payload: null, expiresAt: 0 \};/);
assert.match(route, /publicStatusCache\.payload && publicStatusCache\.expiresAt > currentTime/);
assert.match(route, /X-Status-Cache/);
assert.match(route, /private, max-age=2, stale-while-revalidate=5/);
assert.match(route, /publicStatusCache = \{ payload, expiresAt: Date\.now\(\) \+ PUBLIC_STATUS_CACHE_TTL_MS \};/);
assert.ok(!route.includes('settlePendingOrder('), 'status cache route remains read-only');

console.log('public status cache guardrails verified');
