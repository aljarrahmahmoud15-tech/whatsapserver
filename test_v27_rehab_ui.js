const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'public', 'admin-v27.html'), 'utf8');

test('V27 mobile rehabilitation keeps group operations delegated and reads fresh data', () => {
  assert.match(html, /id="groupSyncPanel" class="panel v27-delegated hidden/);
  assert.match(html, /id="groupService" class="service-item hidden/);
  assert.match(html, /id="v27ReadinessPanel" class="panel v27-readiness-panel hidden/);
  assert.match(html, /إدارة القروب ضمن مركز التشغيل V26/);
  assert.match(html, /function freshApi\(url,options=\{\}\)/);
  assert.match(html, /prefetched\|\|await freshApi\('\/api\/admin\/v27\/bootstrap'\)/);
  assert.match(html, /document\.querySelectorAll\('\[data-screen\]'\)/);
  assert.match(html, /if\(screen!==\'admin\'\)void ensureFullData\(\)/);
  assert.match(html, /state\.groupSummary=r\[12\]/);
  assert.match(html, /state\.staff=Array\.isArray\(r\[13\]\?\.accounts\)/);
  assert.match(html, /state\.supportTickets=Array\.isArray\(r\[14\]\?\.tickets\)/);
  assert.match(html, /state\.v27Health=r\[15\]/);
  assert.match(html, /state\.v27OwnerControl=r\[16\]/);
  assert.match(html, /state\.v27Diagnostics=r\[17\]/);
});
