const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('./public/admin-v26.html', 'utf8');
assert.match(page, /<title>وصلني الآن · عمليات V26<\/title>/);
assert.match(page, /id="metricCaptains"/);
assert.match(page, /id="metricOrders"/);
assert.match(page, /id="metricNegative"/);
assert.match(page, /id="captainList"/);
assert.match(page, /id="ordersList"/);
assert.match(page, /id="adminDetailPanel"/);

for (const endpoint of [
  '/status',
  '/api/admin/bot/status',
  '/api/admin/captains',
  '/api/admin/orders',
  '/api/admin/orders/open?summary=1',
  '/api/admin/settlements?limit=300',
  '/api/admin/company-wallet',
  '/api/admin/subscriptions?compact=1',
  '/api/admin/captain-invites',
  '/api/admin/cards?limit=100',
  '/api/admin/leads',
]) assert.match(page, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

// The display page must not wire any finance, settlement, group, or account mutation.
for (const forbidden of [
  '/api/admin/captain-wallet-pool/execute',
  '/api/admin/captain-wallet-pool/distribute',
  '/api/admin/captain-wallet-pool/withdraw',
  '/api/admin/users/:id/direct-credit',
  '/api/admin/captains/:id/direct-credit',
  '/api/admin/captains/:id/wallet-adjustment',
  '/api/admin/group/sync-captains',
  '/api/admin/captain-invites/:id/decision',
]) assert.doesNotMatch(page, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

assert.match(page, /لا توجد حركة مالية أو إرسال WhatsApp تلقائي/);
assert.match(page, /إضافة الرصيد/);
assert.match(page, /data-safe-action="edit"/);
assert.match(page, /data-safe-action="credit"/);
assert.match(page, /data-safe-action="suspend"/);
assert.doesNotMatch(page, /161/);
assert.doesNotMatch(page, /243/);

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, 'V26 page must contain a script');
new vm.Script(scripts.at(-1));

console.log('admin V26 live read-only UI guard: PASS');
