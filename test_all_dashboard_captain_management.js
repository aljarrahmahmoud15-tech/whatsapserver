const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('./server.js', 'utf8');
const legacy = fs.readFileSync('./admin.html', 'utf8');
const v26 = fs.readFileSync('./public/admin-v26.html', 'utf8');
const v27 = fs.readFileSync('./public/admin-v27.html', 'utf8');
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const route of [
  'app.patch("/api/admin/users/:id", requireAdmin',
  'app.post("/api/admin/captains/:id/suspend-and-remove", requireOwnerAdmin',
  'app.delete("/api/admin/captains/:id", requireOwnerAdmin',
  'app.post("/api/admin/captains/:id/restore", requireOwnerAdmin',
]) assert.match(server, new RegExp(escaped(route)));
assert.match(server, /financialMutation: false/);
assert.match(server, /settlementMutation: false/);

assert.match(legacy, /function editUser\(id\)/);
assert.match(legacy, /function saveCaptain\(id\)/);
assert.match(legacy, /function removeCaptainFromOfficialGroup\(id,name\)/);
assert.match(legacy, /function secureDeleteCaptain\(id,name\)/);
assert.match(legacy, /suspend-and-remove/);
assert.match(legacy, /حذف \/ أرشفة آمنة/);
assert.match(legacy, /إزالة من القروب/);

for (const [name, page] of [['V26', v26], ['V27', v27]]) {
  assert.match(page, /data-safe-action="edit"/);
  assert.match(page, /data-safe-action="archive"/);
  assert.match(page, /data-safe-action="suspend"/);
  assert.match(page, /function openCaptainAction/);
  assert.match(page, /function saveCaptainEdit/);
  assert.match(page, /function archiveCaptainAccount/);
  assert.match(page, /function suspendCaptainAndRemove/);
  assert.match(page, /api\('\/api\/admin\/captains\/'\+encodeURIComponent\(id\),\{method:'DELETE'/);
  assert.match(page, /لا حذف للسجل المالي أو الحجوزات/);
  assert.match(page, /window\.confirm/);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0, `${name} page must contain scripts`);
  for (const script of scripts) new vm.Script(script, { filename: `${name}#script` });
}

assert.match(v27, /data-captain-decision="archive"/);
assert.match(v27, /data-captain-decision="suspend"/);
console.log('all owner dashboards captain edit, group removal, archive, restore, and owner-only guardrails: PASS');
