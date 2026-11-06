const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const v26 = fs.readFileSync('./public/admin-v26.html', 'utf8');
const v27 = fs.readFileSync('./public/admin-v27.html', 'utf8');

assert.doesNotMatch(server, /source:\s*["']admin_token["']/,
  'dashboard middleware must not accept ADMIN_TOKEN as a web session');
for (const [name, page] of [['V26', v26], ['V27', v27]]) {
  assert.doesNotMatch(page, /id=["']adminToken["']/,
    `${name} must not render an ADMIN_TOKEN login field`);
  assert.doesNotMatch(page, /localStorage\.getItem\(['"]adminToken['"]\)/,
    `${name} must not restore a token login from localStorage`);
  assert.match(page, /fetch\(['"]\/api\/auth\/login['"]/,
    `${name} must use the password session login route`);
}
console.log('admin password-only login guard verified');
