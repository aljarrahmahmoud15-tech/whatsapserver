const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const page = fs.readFileSync('public/captain.html', 'utf8');

assert.match(server, /CREATE TABLE IF NOT EXISTS captain_auth_challenges[\s\S]*purpose TEXT NOT NULL DEFAULT 'login'/,
  'login OTP challenge storage remains available');

function routeBetween(startMarker, endMarker) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `route boundaries must exist for ${startMarker}`);
  return server.slice(start, end);
}

const requestRoute = routeBetween(
  'app.post("/api/captain/pin-recovery/request-code"',
  'app.post("/api/captain/pin-recovery/reset"',
);
const resetRoute = routeBetween(
  'app.post("/api/captain/pin-recovery/reset"',
  'app.post("/api/captain/login-link/exchange"',
);
for (const [name, route] of [['request', requestRoute], ['reset', resetRoute]]) {
  assert.match(route, /consumeRateLimit\(captainPinRecoveryRate/,
    `${name} endpoint keeps a rate-limit guard`);
  assert.match(route, /status\(403\)/, `${name} endpoint rejects self-recovery`);
  assert.match(route, /captain_pin_owner_only/);
  assert.match(route, /استعادة رمز الدخول متاحة للمالك فقط/);
  assert.doesNotMatch(route, /db\.prepare|sendBotText|bcrypt|audit\(|UPDATE users|INSERT INTO|DELETE FROM/,
    `${name} rejection cannot alter the account, create a challenge, or send WhatsApp`);
}

assert.doesNotMatch(page, /pin-recovery|forgot-pin-btn|recovery-code|\/api\/captain\/pin-recovery/,
  'the Captain UI no longer offers a self-service recovery form');
assert.match(page, /لا يمكنك تغيير الرمز أو استعادته ذاتيًا/);
assert.match(page, /id="whatsapp-login-btn"/);
assert.match(page, /\/api\/captain\/whatsapp\/request-code/,
  'WhatsApp remains a login method, not a PIN reset channel');
assert.match(page, /id="group-verification-form"/,
  'official-group membership verification remains unchanged');

console.log('Captain self PIN recovery endpoints are owner-only and side-effect free: PASS');
