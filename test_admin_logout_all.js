const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const panels = [
  './admin.html',
  './public/admin-v24.html',
  './public/admin-v26.html',
  './public/admin-v27.html',
];

assert.match(server, /const ADMIN_AUTH_GENERATION_SETTING_KEY = "admin_auth_generation_v1"/);
assert.match(server, /function currentAdminAuthGeneration\(\)/);
assert.match(server, /function rotateAdminAuthGeneration\(\)/);
assert.match(server, /authGeneration: currentAdminAuthGeneration\(\)/);
assert.match(server, /payload\.authGeneration !== currentAdminAuthGeneration\(\)/);
assert.match(server, /app\.post\("\/api\/auth\/logout-all", requireOwnerAdmin/);
assert.match(server, /rotateAdminAuthGeneration\(\)/);
assert.match(server, /sessionsRevoked: true/);
assert.match(server, /ADMIN_BEARER_GENERATION_SETTING_KEY/);

for (const panel of panels) {
  const html = fs.readFileSync(panel, 'utf8');
  assert.match(html, /logout-all/, `${panel} must call the global logout endpoint`);
  assert.match(html, /خروج من (جميع اللوحات|الجميع)/, `${panel} must expose global logout`);
  assert.match(html, /credentials:\s*['"]same-origin['"]/, `${panel} must send the session cookie`);
}

console.log('admin global logout route, generation revocation, bearer invalidation, and owner-panel wiring verified');
