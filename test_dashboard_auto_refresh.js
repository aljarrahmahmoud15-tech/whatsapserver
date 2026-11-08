const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['public/admin-v26.html', 'public/admin-v27.html']) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /state\.refreshInFlight/);
  assert.match(html, /finally\(\(\)=>\{state\.refreshInFlight=false\}\)/);
}
assert.match(fs.readFileSync('public/admin-v26.html', 'utf8'), /loadData\(\)\.finally/);
assert.match(fs.readFileSync('public/admin-v27.html', 'utf8'), /loadBootstrap\(\)\.finally/);
console.log('dashboard automatic refresh guard: PASS');
