const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('./public/admin-merged-readonly.html', 'utf8');
assert.match(page, /<title>وصلني الآن · لوحة الإدارة الموحدة<\/title>/);
assert.match(page, /مصدرها V26/);
assert.match(page, /لا توجد حركة تلقائية/);
assert.match(page, /id="metricCaptains"/);
assert.match(page, /id="ordersList"/);
assert.match(page, /id="captainList"/);
assert.match(page, /id="settlementsList"/);
assert.match(page, /id="companyBalance"/);
assert.match(page, /id="adminRows"/);

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
  '/api/admin/group/summary',
]) assert.match(page, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

// Login is authentication, not an operational mutation. It is the only POST in this page.
const postMethods = page.match(/method\s*:\s*['"]POST['"]/g) || [];
assert.equal(postMethods.length, 1, 'only the authentication request may use POST');
assert.match(page, /fetch\('\/api\/auth\/login'/);
for (const method of ['PATCH', 'PUT', 'DELETE']) {
  assert.doesNotMatch(page, new RegExp(`method\\s*:\\s*['"]${method}['"]`));
}
for (const forbidden of [
  '/api/admin/owner-control/command',
  '/api/admin/owner-vault/decision',
  '/api/admin/group/confirm-one',
  '/api/admin/group/confirmed-preview',
  '/api/admin/captain-wallet-pool',
  '/api/admin/captains/:id/direct-credit',
  '/api/admin/captains/:id/suspend-and-remove',
  '/api/admin/captain-invites/:id/decision',
  '/api/admin/qr-temporary-link',
  '/api/admin/whatsapp/restart',
]) assert.doesNotMatch(page, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, 'merged read-only page must contain a script');
new vm.Script(scripts.at(-1));
console.log('merged V26 read-only admin UI guard: PASS');
