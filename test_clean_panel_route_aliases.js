// The panel posts to a few read routes with a JSON body; without the POST alias the
// button answers 404 and the section stays empty. Also guards the pairing-code route.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const v26 = fs.readFileSync(path.join(__dirname, 'public', 'admin-v26.html'), 'utf8');

for (const [label, getRe, postRe] of [
  ['orders/confirmed',
    /app\.get\("\/api\/admin\/orders\/confirmed", requireAdmin, confirmedOrdersReadHandler\);/,
    /app\.post\("\/api\/admin\/orders\/confirmed", requireAdmin, \(req, res\) => \{\n  req\.query = Object\.assign\(\{\}, req\.query, req\.body \|\| \{\}\);\n  return confirmedOrdersReadHandler\(req, res\);\n\}\);/],
  ['group/summary',
    /app\.get\("\/api\/admin\/group\/summary", requireAdmin, adminReadSingleFlight\("group-summary", 8000\), groupSummaryReadHandler\);/,
    /app\.post\("\/api\/admin\/group\/summary", requireAdmin, adminReadSingleFlight\("group-summary", 8000\), \(req, res\) => \{\n  req\.query = Object\.assign\(\{\}, req\.query, req\.body \|\| \{\}\);\n  return groupSummaryReadHandler\(req, res\);\n\}\);/],
]) {
  assert.match(server, getRe, `${label}: GET must stay registered`);
  assert.match(server, postRe, `${label}: POST alias must exist`);
}

// the panel really posts to both paths
assert.match(v26, /api\('\/api\/admin\/orders\/confirmed',\{method:'POST'/, 'panel posts to orders/confirmed');
assert.match(v26, /api\('\/api\/admin\/group\/summary',\{method:'POST'/, 'panel posts to group/summary');

// pairing code route: owner only, guarded, and rate limited
assert.match(server, /app\.post\("\/api\/admin\/whatsapp\/pairing-code", requireBotWalletOwner/, 'pairing route owner-only');
assert.match(server, /await client\.requestPairingCode\(phone, true, 180000\)/, 'pairing code request');
assert.match(server, /if \(elapsed < 120000\)/, 'pairing rate limit');
assert.match(server, /if \(isReady\) return res\.status\(409\)/, 'no pairing when already linked');

console.log('Panel route aliases verified: confirmed-orders and group-summary POST aliases exist, and the owner pairing-code route is guarded');
