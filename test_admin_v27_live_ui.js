const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('./public/admin-v27.html', 'utf8');
const server = fs.readFileSync('./server.js', 'utf8');

assert.match(page, /<title>وصلني الآن · عمليات V27<\/title>/);
assert.match(server, /app\.get\("\/admin-v27\.html", \(req, res\) =>/);
assert.match(server, /sendFile\(path\.join\(__dirname, "public", "admin-v27\.html"\)\)/);

for (const marker of [
  'id="v27ReadinessPanel"',
  'id="v27ReadinessBadge"',
  'id="v27SyncAge"',
  'id="v27DiagnosticAge"',
  'id="v27AlertCount"',
  'id="v27OperationalFeed"',
  'function renderV27Readiness()',
  'id="v27DiagnosticsRefresh"',
]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\[\]\\]/g, '\\$&')));

for (const endpoint of [
  '/status',
  '/api/admin/bot/status',
  '/api/admin/system/health',
  '/api/admin/owner-control',
  '/api/admin/whatsapp/send-diagnostics',
  '/api/admin/captains',
  '/api/admin/orders',
  '/api/admin/orders/open?summary=1',
  '/api/admin/settlements?limit=300',
  '/api/admin/company-wallet',
  '/api/admin/owner-vault',
  '/api/admin/group/summary',
]) assert.match(page, new RegExp(endpoint.replace(/[.*+?^${}()|[\[\]\\]/g, '\\$&')));

// V27 keeps the same protected owner actions and the backend's existing cancellation contract.
assert.match(page, /confirmation:'V26_CANCEL_ORDER'/);
assert.match(page, /`V26-CANCEL-ORDER-\$\{id\}-\$\{Date\.now\(\)\}`/);
assert.match(page, /لا يوجد تنفيذ كود حر/);
assert.doesNotMatch(page, /OWNER_VAULT_SECRET/);
assert.doesNotMatch(page, /owner-vault\.key/);

// The refreshed readiness layer must remain observational and must not add broad mutations.
for (const forbidden of [
  '/api/admin/captain-wallet-pool/execute',
  '/api/admin/captain-wallet-pool/distribute',
  '/api/admin/captain-wallet-pool/withdraw',
  '/api/admin/group/sync-captains',
]) assert.doesNotMatch(page, new RegExp(forbidden.replace(/[.*+?^${}()|[\[\]\\]/g, '\\$&')));

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, 'V27 page must contain a script');
new vm.Script(scripts.at(-1), { filename: 'public/admin-v27.html#script' });

console.log('admin V27 readiness UI, route, diagnostics, and mutation guard: PASS');
