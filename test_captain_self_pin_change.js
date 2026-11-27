const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const page = fs.readFileSync('public/captain.html', 'utf8');
const start = server.indexOf('app.post("/api/captain/change-pin"');
const end = server.indexOf('app.delete("/api/captain/account"', start);
assert.ok(start >= 0 && end > start, 'self-change route boundaries must remain explicit');
const route = server.slice(start, end);

assert.match(route, /requireCaptain, adminMutationLimiter/,
  'the retired path keeps its Captain-auth and mutation rate-limit guards');
assert.match(route, /status\(403\)/, 'Captain self-change must be rejected');
assert.match(route, /captain_pin_owner_only/);
assert.match(route, /تغيير رمز الدخول متاح للمالك فقط/);
assert.doesNotMatch(route, /db\.prepare|bcrypt|sendBotText|audit\(|UPDATE users|INSERT INTO|DELETE FROM/,
  'self-change rejection must not read or mutate PIN/account data or send WhatsApp');

assert.doesNotMatch(page, /captain-change-pin-form|\/api\/captain\/change-pin|captain-current-pin/);
assert.match(page, /تغيير رمز الدخول أو استعادته متاح للمالك فقط/);
assert.match(page, /id="whatsapp-login-btn"/,
  'the separate WhatsApp login option remains available');

console.log('Captain self PIN change is blocked without data or WhatsApp side effects: PASS');
