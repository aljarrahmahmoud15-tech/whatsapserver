const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('./server.js', 'utf8');
const page = fs.readFileSync('./public/admin-v26.html', 'utf8');

assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/suspend-and-remove", requireAdmin, async/);
const routeStart = server.indexOf('app.post("/api/admin/captains/:id/suspend-and-remove"');
const routeEnd = server.indexOf('app.delete("/api/admin/captains/:id"', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'suspend/remove route boundaries must exist');
const route = server.slice(routeStart, routeEnd);
assert.match(route, /SUSPEND_AND_REMOVE_CAPTAIN/);
assert.match(route, /isConfiguredGroup\(groupId\)/);
assert.match(route, /readGroupRemovalContext\(groupId\)/);
assert.match(route, /removeParticipants/);
assert.match(route, /accountChanged: false/);
assert.match(route, /financialMutation: false/);
assert.doesNotMatch(route, /wallet_cents|sendCaptainStatusText|sendServer2DirectAtMostOnce|sendMessage/);

for (const marker of [
  'data-safe-action="edit"',
  'data-safe-action="credit"',
  'data-safe-action="suspend"',
  'function openCaptainAction',
  'function saveCaptainEdit',
  'function applyCaptainCredit',
  'function suspendCaptainAndRemove',
  '/api/admin/users/',
  '/api/admin/captains/',
  'direct-credit',
  'suspend-and-remove',
  'SUSPEND_AND_REMOVE_CAPTAIN',
  'window.confirm',
  'idempotencyKey',
]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));

assert.match(page, /لا توجد حركة تلقائية؛ الأزرار الحساسة تتطلب تأكيد المالك/);
assert.match(page, /\/api\/admin\/group\/confirm-one/);
assert.doesNotMatch(page, /\/api\/admin\/group\/confirm-verified-bot-booking/);
assert.doesNotMatch(page, /\/api\/admin\/group\/sync-captains/);
assert.doesNotMatch(page, /\/api\/admin\/captain-wallet-pool\/(?:execute|distribute|withdraw)/);
assert.doesNotMatch(page, /161/);
assert.doesNotMatch(page, /243/);

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, 'V26 page must contain a script');
new vm.Script(scripts.at(-1));
console.log('V26 captain action guardrails: PASS');
