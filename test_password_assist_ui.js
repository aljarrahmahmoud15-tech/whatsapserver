const assert = require('node:assert/strict');
const fs = require('node:fs');
for (const file of ['public/admin-v26.html', 'public/admin-v27.html']) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /id="togglePassword"/);
  assert.match(html, /id="capsLockWarning"/);
  assert.match(html, /getModifierState\('CapsLock'\)/);
  assert.match(html, /password\.type==='text'/);
  assert.match(html, /type="password" autocomplete="current-password"/);
}
console.log('V26/V27 password visibility and Caps Lock warning UI: PASS');
