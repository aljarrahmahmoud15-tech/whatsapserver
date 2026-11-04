const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const page = fs.readFileSync('public/captain.html', 'utf8');

assert.match(server, /app\.post\("\/api\/captain\/change-pin",\s*requireCaptain/);
assert.match(server, /newPin === "00000"/);
assert.match(server, /bcrypt\.compareSync\(currentPin, captain\.captain_pin_hash\)/);
assert.match(server, /captain\.pin\.self_updated/);
assert.match(page, /captain-change-pin-form/);
assert.match(page, /\/api\/captain\/change-pin/);
assert.match(page, /newPin==='00000'/);

console.log('captain self PIN change guardrails: ok');
