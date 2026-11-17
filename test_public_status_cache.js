const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
const statusStart = source.indexOf('app.get("/status", requireAdmin, (req, res) => {');
const statusEnd = source.indexOf('app.get("/api/group-invite"', statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, 'detailed status route exists and is administrator-protected');
const statusRoute = source.slice(statusStart, statusEnd);

assert.match(source, /const PUBLIC_STATUS_CACHE_TTL_MS = Math\.max\(250, Math\.min\(5000,/);
assert.match(source, /let publicStatusCache = \{ payload: null, expiresAt: 0 \};/);
assert.match(statusRoute, /publicStatusCache\.payload && publicStatusCache\.expiresAt > currentTime/);
assert.match(statusRoute, /X-Status-Cache/);
assert.match(statusRoute, /private, max-age=2, stale-while-revalidate=5/);
assert.match(statusRoute, /publicStatusCache = \{ payload, expiresAt: Date\.now\(\) \+ PUBLIC_STATUS_CACHE_TTL_MS \};/);
assert.ok(!statusRoute.includes('settlePendingOrder('), 'status cache route remains read-only');

const healthStart = source.indexOf('app.get("/health", (req, res) => {');
const healthEnd = source.indexOf('app.get("/api/meta/build"', healthStart);
assert.ok(healthStart >= 0 && healthEnd > healthStart, 'public health route exists');
const healthRoute = source.slice(healthStart, healthEnd);
assert.ok(!healthRoute.includes('requireAdmin'), 'public liveness must not require dashboard authentication');
assert.match(healthRoute, /Liveness must remain independent of SQLite, Redis, filesystem scans, and WhatsApp calls/);

const index = fs.readFileSync('./public/index.html', 'utf8');
assert.match(index, /const authenticated=document\.getElementById\('login'\)\.dataset\.authenticated==='true';/);
assert.match(index, /api\(authenticated\?'\/status\?fresh=1':'\/health'\)/, 'unauthenticated polling uses public health, authenticated polling uses detailed status');
assert.match(index, /if\(await refreshOverview\(true\)\)void refreshStatus\(\)\.catch\(\(\)=>\{\}\)/, 'detailed status refresh starts after successful login');

const admin = fs.readFileSync('./admin.html', 'utf8');
const archiveStart = admin.indexOf('async function archiveAllUnconfirmedBookings(){');
const archiveEnd = admin.indexOf('async function archiveUnconfirmedOlderThan24h(){', archiveStart);
assert.ok(archiveStart >= 0 && archiveEnd > archiveStart, 'full archive action exists');
const archiveHandler = admin.slice(archiveStart, archiveEnd);
assert.match(archiveHandler, /window\.confirm\(/, 'bulk archive requires visible interactive confirmation');
assert.ok(archiveHandler.indexOf('window.confirm(') < archiveHandler.indexOf("api('/api/admin/unconfirmed-bookings/archive-all'"), 'confirmation happens before the bulk archive request');

console.log('public health/status authentication, cache and bulk-archive confirmation guardrails verified');
