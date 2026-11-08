const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('public/admin-v27.html', 'utf8');
assert.match(html, /publicJson\('\/status\?fresh=1'\)/);
assert.match(html, /liveCaptains=state\.status\?\.captains/);
assert.match(html, /state\.loadedAt=state\.status\?\.groupHydration\?\.at/);
assert.match(html, /تمت مزامنة المصدر الحي/);
console.log('V27 live status sync and timestamp preference: PASS');
