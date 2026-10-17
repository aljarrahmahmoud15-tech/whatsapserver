const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const owner = fs.readFileSync('public/index.html', 'utf8');

assert.match(server, /const DEFAULT_PUBLIC_APP_URL = "https:\/\/alshaikh-delivery\.onrender\.com"/);
assert.match(server, /const SHEIKH_PUBLIC_HOST = "alshaikh-delivery\.onrender\.com"/);
assert.match(server, /function safePublicOrigin\(value\)/);
assert.match(server, /host !== SHEIKH_PUBLIC_HOST && !local/);
assert.match(server, /safePublicOrigin\(process\.env\.PUBLIC_BASE_URL\)/);
assert.match(server, /safePublicOrigin\(process\.env\.RENDER_EXTERNAL_URL\)/);
assert.match(server, /const origin = captainInviteBaseUrl\(req\)/);
assert.match(server, /const gateway = captainGatewayUrl\(PUBLIC_APP_URL\)/);

const cardAndInviteRoutes = server.slice(server.indexOf('function topupCardTextMessage'), server.indexOf('app.post("/api/redeem"'));
assert.match(cardAndInviteRoutes, /captainAppUrl\(captainInviteBaseUrl\(req\)\)/);
assert.doesNotMatch(cardAndInviteRoutes, /PUBLIC_BASE_URL\s*\|\|/);

const forbidden = /whatsapserver-2|server\s*2|meta[-_ ]?bot|waslni-stab/i;
assert.doesNotMatch(owner, forbidden);
assert.doesNotMatch(server, /https?:\/\/whatsapserver-2\b/i);
assert.doesNotMatch(server, /https?:\/\/[^\s"'`]*server2[^\s"'`]*/i);

console.log('Sheikh-only captain invite and top-up link isolation guardrails verified');
