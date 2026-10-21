const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');

const selfStart = server.indexOf('app.post("/api/captain/register", captainRegistrationLimiter');
const selfEnd = server.indexOf('function captainInviteBaseUrl', selfStart);
assert.ok(selfStart >= 0 && selfEnd > selfStart, 'self-registration route exists');
const selfRoute = server.slice(selfStart, selfEnd);
assert.match(selfRoute, /captainRegistrationLimiter/);
assert.match(selfRoute, /isValidJordanPhone/);
assert.match(selfRoute, /isProtectedOwnerIdentity/);
assert.match(selfRoute, /status: "pending"/);
assert.match(selfRoute, /accountCreated: false/);
assert.match(selfRoute, /INSERT INTO captain_invites/);
assert.match(selfRoute, /captain\.join\.self_requested/);
assert.match(selfRoute, /ownersOnly: true/);
assert.doesNotMatch(selfRoute, /INSERT INTO users/);
assert.doesNotMatch(selfRoute, /addCaptainToConfiguredGroup/);
assert.doesNotMatch(selfRoute, /wallet_cents/);

assert.match(server, /app\.post\("\/api\/captain\/invites\/:token\/apply", captainRegistrationLimiter/);
assert.match(captain, /تسجيل كابتن جديد ذاتيًا/);
assert.match(captain, /تسجيل كابتن جديد/);
assert.match(captain, /لا يُنشأ الحساب أو يُفعّل الدخول قبل موافقة المالك/);
assert.match(captain, /const registrationUrl = inviteToken \? .*\/api\/captain\/register/);
assert.match(captain, /id="entry-login"/);
assert.match(captain, /id="invite-hint"/);

console.log('captain self-registration pending gate and unified entry UI verified');
