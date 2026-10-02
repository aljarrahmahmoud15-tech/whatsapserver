const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('./public/admin-v24.html', 'utf8');
assert.match(page, /وصلني الآن/, 'V24 branding is present');
assert.match(page, /id="activeCaptains"/, 'active captain metric exists');
assert.match(page, /id="confirmedOrders"/, 'confirmed order metric exists');
assert.match(page, /id="negativeWallets"/, 'negative wallet metric exists');
assert.match(page, /id="reviewOrders"/, 'review metric exists');
assert.match(page, /\/api\/admin\/captains/, 'captains are read from the bot API');
assert.match(page, /\/api\/admin\/orders/, 'orders are read from the bot API');
assert.match(page, /\/api\/admin\/settlements\?limit=300/, 'settlements are read from the bot API');
assert.match(page, /\/api\/admin\/orders\/open\?summary=1/, 'review count is read from the bot API');
assert.match(page, /\/api\/admin\/qr-temporary-link/, 'QR uses the protected bot endpoint');
assert.match(page, /\/status/, 'service status is read from the bot');
assert.doesNotMatch(page, /id="activeCaptains"[^>]*>\s*161\s*</, 'active captain preview number is not hard-coded');
assert.doesNotMatch(page, /id="confirmedOrders"[^>]*>\s*243\s*</, 'confirmed order preview number is not hard-coded');
assert.doesNotMatch(page, /id="negativeWallets"[^>]*>\s*34\s*</, 'negative wallet preview number is not hard-coded');
assert.doesNotMatch(page, /wallet-adjustment|captain-wallet-pool\/(?:execute|preview)/, 'V24 summary does not expose financial mutation routes');

const scriptMatch = page.match(/<script>([\s\S]*)<\/script>/);
assert.ok(scriptMatch, 'V24 inline script exists');
assert.doesNotThrow(() => new vm.Script(scriptMatch[1]), 'V24 JavaScript parses');

console.log('V24 live bot-data UI guardrails verified');
