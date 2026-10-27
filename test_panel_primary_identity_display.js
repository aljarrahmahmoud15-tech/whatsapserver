const assert = require('node:assert/strict');
const fs = require('node:fs');
// Zero-copy guardrails: panels must NOT hardcode any bot identity number.
// Identity is read dynamically from the /status endpoint.
const retired = new RegExp([
  ['962775', '969880'].join(''),
  ['077596', '9880'].join(''),
].join('|'));
const panels = ['admin.html', 'public/index.html', 'public/staff.html'];
for (const file of panels) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /962779110123/, `${file} must not hardcode the bot number`);
  assert.doesNotMatch(source, /0779110123/, `${file} must not hardcode the local bot number`);
  assert.doesNotMatch(source, retired, `${file} must not contain the retired bot identity`);
}
const v27 = fs.readFileSync('public/admin-v27.html', 'utf8');
assert.doesNotMatch(v27, /APPROVED_BOT_PHONE_INTL='962779110123'/, 'v27 must not hardcode the bot number');
assert.match(v27, /البوت متصل · \$\{readOnlyBotNumber\(\)\}/);
assert.match(v27, /publicJson\('\/status\?fresh=1'\)/);
assert.doesNotMatch(v27, retired);
const index = fs.readFileSync('public/index.html', 'utf8');
assert.match(index, /function internationalPhone\(value\)/);
assert.match(index, /const phone=internationalPhone\(data\?\.phone\)/);
assert.match(index, /api\('\/status\?fresh=1'\)/);
assert.match(index, /id="ops-bot-phone"/, 'لوحة الإدارة تعرض رقم البوت ديناميكيًا من /status');
assert.doesNotMatch(index, /function localPhone\(/);
const server = fs.readFileSync('server.js', 'utf8');
assert.match(server, /\$\{BOT_PHONE_INTL \|\| BOT_PHONE\}/);
assert.doesNotMatch(server, retired);
console.log('panel primary bot identity is dynamic and zero-hardcoded verified');
