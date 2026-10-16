const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');
const v26 = fs.readFileSync('./public/admin-v26.html', 'utf8');

assert.match(server, /app\.get\("\/api\/admin\/captains\/archived", requireAdmin/);
assert.match(server, /u\.archived_at IS NOT NULL/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/restore", requireAdmin/);
const restoreStart = server.indexOf('app.post("/api/admin/captains/:id/restore"');
const restoreEnd = server.indexOf('app.get("/api/admin/captains/:id/merge-preview"', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'restore route boundaries must exist');
const restoreRoute = server.slice(restoreStart, restoreEnd);
assert.match(restoreRoute, /RESTORE_ARCHIVED_CAPTAIN/);
assert.match(restoreRoute, /archived_at=NULL/);
assert.match(restoreRoute, /account_status='active'/);
assert.match(restoreRoute, /financialMutation: false/);
assert.match(restoreRoute, /settlementMutation: false/);
assert.match(restoreRoute, /groupMembershipChanged: false/);
assert.match(restoreRoute, /whatsappMessageSent: false/);
assert.doesNotMatch(restoreRoute, /wallet_cents\s*=|INSERT INTO wallet_ledger|UPDATE wallet_ledger|sendMessage|sendCaptainStatusText|addCaptainToConfiguredGroup/);

for (const page of [admin, v26]) {
  assert.match(page, /captains\/archived/);
  assert.match(page, /captains\/['"]?\+encodeURIComponent\(id\)\+['"]\/restore/);
  assert.match(page, /RESTORE_ARCHIVED_CAPTAIN/);
  assert.match(page, /لا تغيّر الرصيد|لا يتغير الرصيد/);
}
assert.match(admin, /id="archivedCaptainsCard"/);
assert.match(admin, /onclick="loadArchivedCaptains\(\)"/);
assert.match(admin, /function restoreArchivedCaptain\(id,name\)/);
assert.match(v26, /id="archivedCaptainsButton"/);
assert.match(v26, /id="archivedCaptainsPanel"/);
assert.match(v26, /function restoreArchivedCaptain\(id,name\)/);

for (const [name, page] of [['admin', admin], ['v26', v26]]) {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length, `${name} script exists`);
  assert.doesNotThrow(() => new vm.Script(scripts.at(-1)), `${name} JavaScript parses`);
}

console.log('captain archive extraction and restore guardrails verified');
