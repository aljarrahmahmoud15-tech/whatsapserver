const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('./admin.html', 'utf8');

assert.match(html, /id="adminUsername"/, 'owner username field must exist');
assert.match(html, /id="adminPassword"/, 'owner password field must exist');
assert.match(html, /fetch\('\/api\/auth\/login'/, 'dashboard must support the server session login route');
assert.match(html, /credentials:'same-origin'/, 'session login and logout must include same-origin credentials');
assert.match(html, /function headers\(\)\{return \{\.\.\.\(token\?/s, 'Bearer header must be optional for cookie sessions');
assert.match(html, /async function logout\(\)\{[\s\S]*?\/api\/auth\/logout/s, 'logout must clear the server session');
assert.match(html, /async function bootstrap\(\)[\s\S]*?\/api\/admin\/bot\/status/s, 'dashboard must detect an existing authenticated session');
assert.match(html, /function isAuthError\(error\)[\s\S]*?unauthorized/s, 'dashboard must recognize cookie-session expiry');
assert.match(html, /catch\(e\)\{\$\('status'\)\.textContent=e\.message;if\(isAuthError\(e\)\)void logout\(\)\}/, 'expired sessions must return to the login screen instead of leaving stale controls visible');
assert.match(html, /onclick="enforceNegativeWalletPolicy\(true\)"/, 'negative-wallet action must remain wired');
assert.match(html, /\/api\/admin\/captains\/enforce-wallet-policy/, 'negative-wallet action must keep its protected endpoint');
assert.doesNotMatch(html, /function setMetriclocalStorage/, 'login patch must not corrupt following function declarations');

console.log('admin session login, cookie credentials, bootstrap, logout, and wallet action wiring verified');
