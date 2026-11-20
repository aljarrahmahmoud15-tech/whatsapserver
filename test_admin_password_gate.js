const assert = require('node:assert/strict');
const fs = require('node:fs');

const v26 = fs.readFileSync('./public/admin-v26.html', 'utf8');
const v27 = fs.readFileSync('./public/admin-v27.html', 'utf8');

assert.match(v26, /async function bootstrap\(\)\{state\.token='';localStorage\.removeItem\('adminToken'\);/,
  'V26 must clear only the legacy local token marker');
assert.match(v26, /fetch\('\/api\/staff\/me',\{credentials:'same-origin',cache:'no-store'\}\)/,
  'V26 must restore a valid server cookie session through a read-only endpoint');
assert.match(v26, /await loadBootstrap\(\)/,
  'V26 must load the dashboard after restoring the server session');
assert.doesNotMatch(v26, /async function login\(\)[\s\S]*?localStorage\.setItem\(['"]adminToken/,
  'V26 login must not persist an admin token in localStorage');
assert.match(v27, /function bootstrap\(\)\{state\.token='';localStorage\.removeItem\('adminToken'\);/,
  'V27 remains on its existing password gate outside this bounded V26 change');
console.log('V26 cookie-session restore guard verified; V27 unchanged');
