const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const captain = fs.readFileSync('./public/captain.html', 'utf8');

assert.match(server, /CREATE TABLE IF NOT EXISTS captain_login_links/);
assert.match(server, /token_hash TEXT NOT NULL UNIQUE/);
assert.match(server, /expires_at TEXT NOT NULL/);
assert.match(server, /used_at TEXT/);
assert.match(server, /revoked_at TEXT/);
assert.match(server, /function issueCaptainAutoLoginLink\(/);
assert.match(server, /crypto\.randomBytes\(32\)\.toString\("base64url"\)/);
assert.match(server, /10 \* 60 \* 1000/);
assert.match(server, /UPDATE captain_login_links SET revoked_at=/);
assert.match(server, /captain\.login_link\.issued/);
assert.match(server, /app\.post\("\/api\/captain\/login-link\/exchange"/);
assert.match(server, /SELECT l\.id,l\.captain_user_id,l\.expires_at,l\.used_at,l\.revoked_at/);
assert.match(server, /link\.expires_at <= stamp/);
assert.match(server, /SET used_at=\?,updated_at=\?/);
assert.match(server, /used_at IS NULL AND revoked_at IS NULL AND expires_at>\?/);
assert.match(server, /captain\.login_link\.exchanged/);
assert.match(server, /authMethod: "magic_link"/);
assert.match(server, /setCaptainSessionCookie\(res, sessionToken\)/);

assert.match(server, /const accessLink = issueCaptainAutoLoginLink\(prepared, baseUrl\)/);
assert.match(server, /رابط الدخول التلقائي لمرة واحدة/);
assert.match(server, /الرابط صالح لمدة 10 دقائق ويفتح الحساب تلقائيًا/);
assert.match(server, /accessCardSent = captain \? await sendCaptainAppLink\(captain, captainInviteBaseUrl\(req\)\)/);

assert.match(captain, /let autoLoginToken = queryParams\.get\('access'\)/);
assert.match(captain, /function clearAutoLoginToken\(\)/);
assert.match(captain, /history\.replaceState/);
assert.match(captain, /async function loginWithAutoLink\(\)/);
assert.match(captain, /\/api\/captain\/login-link\/exchange/);
assert.match(captain, /clearAutoLoginToken\(\); showSection\('app'\)/);
assert.match(captain, /انتهت صلاحية رابط الدخول/);
assert.match(captain, /<meta name="referrer" content="no-referrer">/);

console.log('captain automatic one-time login link guardrails verified');
