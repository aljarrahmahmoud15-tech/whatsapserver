const assert = require('node:assert/strict');
const fs = require('node:fs');

const intl = '962779110123';
const local = '0779110123';
const retired = new RegExp([
  ['962775', '969880'].join(''),
  ['077596', '9880'].join(''),
].join('|'));
const panels = ['admin.html', 'public/index.html', 'public/staff.html'];

for (const file of panels) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, new RegExp(intl), `${file} must display the approved international bot number`);
  assert.doesNotMatch(source, new RegExp(local), `${file} must not display the local bot number`);
  assert.doesNotMatch(source, retired, `${file} must not contain the retired bot identity`);
}

const v27 = fs.readFileSync('public/admin-v27.html', 'utf8');
assert.match(v27, /APPROVED_BOT_PHONE_INTL='962779110123'/);
assert.match(v27, /البوت متصل · \$\{readOnlyBotNumber\(\)\}/);
assert.match(v27, /publicJson\('\/status\?fresh=1'\)/);
assert.doesNotMatch(v27, retired);

const server = fs.readFileSync('server.js', 'utf8');
assert.match(server, /\$\{BOT_PHONE_INTL \|\| BOT_PHONE\}/);
assert.doesNotMatch(server, retired);

console.log('panel primary international bot identity display verified');
