const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const [name, file] of [['V26', './public/admin-v26.html'], ['V27', './public/admin-v27.html']]) {
  const page = fs.readFileSync(file, 'utf8');
  assert.match(page, /function bootstrap\(\)\{state\.token='';localStorage\.removeItem\('adminToken'\);\$\('appView'\)\.classList\.add\('hidden'\);\$\('loginView'\)\.classList\.remove\('hidden'\);\}/,
    `${name} must show the password gate on every page load`);
  assert.doesNotMatch(page, /async function bootstrap\(\)\{try\{if\(state\.token\)/,
    `${name} must not auto-open from an existing browser session`);
}
console.log('admin password gate on every page load verified');
