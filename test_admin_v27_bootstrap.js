const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const page = fs.readFileSync('./public/admin-v27.html', 'utf8');
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const bootstrapStart = server.indexOf('function buildV27BootstrapPayload()');
const bootstrapEnd = server.indexOf('app.get("/api/admin/bot/status", requireAdmin', bootstrapStart);
assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'bootstrap builder must be isolated before the heavy bot status route');
const bootstrapCode = server.slice(bootstrapStart, bootstrapEnd);

assert.match(server, /app\.get\("\/api\/admin\/v27\/bootstrap", requireAdmin/);
assert.match(bootstrapCode, /mutation: 'none'/);
assert.match(bootstrapCode, /V27_BOOTSTRAP_CACHE_TTL_MS/);
assert.match(bootstrapCode, /whatsappSessionPersistenceHealth\(\)/);
assert.match(bootstrapCode, /companyUser\(\)/);
assert.match(bootstrapCode, /SELECT COUNT\(\*\) AS count FROM orders/);
assert.doesNotMatch(bootstrapCode, /readGroupSnapshot\(/, 'bootstrap must not block on WhatsApp Web group metadata');
assert.doesNotMatch(bootstrapCode, /storageInventory\(/, 'bootstrap must not walk the persistent storage tree');
assert.doesNotMatch(bootstrapCode, /companyWalletSummary\(/, 'bootstrap must not load the full ledger payload');

const groupStart = server.indexOf('app.get("/api/admin/group/summary", requireAdmin');
const groupEnd = server.indexOf('app.get("/api/admin/group/permissions", requireAdmin', groupStart);
assert.ok(groupStart >= 0 && groupEnd > groupStart, 'group summary route must remain isolated');
const groupCode = server.slice(groupStart, groupEnd);
assert.match(groupCode, /adminGroupSummaryCache/);
assert.match(groupCode, /X-Group-Summary-Cache/);
assert.match(groupCode, /ADMIN_GROUP_SUMMARY_CACHE_TTL_MS/);
assert.match(groupCode, /readGroupSnapshot\(groupId\)/);

assert.match(page, /\/api\/admin\/v27\/bootstrap/);
assert.match(page, /async function loadBootstrap\(prefetched=null\)/);
assert.match(page, /async function ensureFullData\(\)/);
assert.match(page, /state\.fullDataLoaded/);
assert.match(page, /await ensureFullData\(\);/);
assert.match(page, /state\.fullDataLoaded=true/);
assert.match(page, /fetch\('\/api\/admin\/v27\/bootstrap'/);
assert.doesNotMatch(page, /bootstrap\(\).*\/api\/admin\/bot\/status/);
assert.match(page, /v27DiagnosticsRefresh.*loadBootstrap/);
assert.doesNotMatch(page, /groupPanelsStarted.*loadGroupLink/);

console.log('V27 unified bootstrap, lazy detail loading, and group summary cache: PASS');
