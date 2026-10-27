const assert = require('node:assert/strict');
const fs = require('node:fs');
// Zero-copy guardrails: panels must NOT hardcode any bot identity number.
// The real retired value is encoded here in parts so it never appears literally.
const realIntl = new RegExp(['962779', '110123'].join(''));
const realLocal = new RegExp(['077911', '0123'].join(''));
const retired = new RegExp([
  ['962775', '969880'].join(''),
  ['077596', '9880'].join(''),
].join('|'));
const panels = ['admin.html', 'public/index.html', 'public/staff.html'];
for (const file of panels) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, realIntl, `${file} must not hardcode the bot number`);
  assert.doesNotMatch(source, realLocal, `${file} must not hardcode the local bot number`);
  assert.doesNotMatch(source, retired, `${file} must not contain the retired bot identity`);
}
const v27 = fs.readFileSync('public/admin-v27.html', 'utf8');
assert.doesNotMatch(v27, new RegExp("APPROVED_BOT_PHONE_INTL='" + ['962779', '110123'].join('') + "'"), 'v27 must not hardcode the bot number');
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
assert.match(server, /const BOT_PHONE = process\.env\.BOT_PHONE\?\.trim\(\) \|\| ""/);
assert.match(server, /const BOT_PHONE_INTL = process\.env\.BOT_PHONE_INTL\?\.trim\(\) \|\| ""/);
assert.doesNotMatch(server, retired);
console.log('panel primary bot identity is dynamic and zero-hardcoded verified');
