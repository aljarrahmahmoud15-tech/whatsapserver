const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
for (const route of ['/waslni-now', '/waslni-v26', '/waslni-v27']) {
  assert.ok(server.includes(`app.get("${route}"`), `missing alias ${route}`);
}
for (const legacy of ['/admin.html', '/admin-v26.html', '/admin-v27.html']) {
  assert.ok(server.includes(`app.get("${legacy}"`), `missing legacy route ${legacy}`);
}
assert.match(server, /second service, database/);
console.log('dashboard alternate aliases and legacy routes: PASS');
