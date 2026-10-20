const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

// --- owner policy: no debt, an acceptance the balance cannot cover is cancelled ------------
assert.match(server, /const CAPTAIN_MIN_BALANCE_CENTS = 0;/);
assert.doesNotMatch(server, /CAPTAIN_MIN_BALANCE_CENTS = Number\(process\.env\.CAPTAIN_MIN_BALANCE_CENTS \|\| -300\)/);
assert.match(server, /return \{ allowed: false, state: "insufficient_balance", walletOwner, balanceCents, requiredCents, projectedBalanceCents: balanceCents - requiredCents \};/);
assert.doesNotMatch(server, /negative_balance_allowed/);
assert.doesNotMatch(server, /notifyOfficialGroupNegativeBalanceAcceptance/);
assert.match(server, /order\.acceptance\.insufficient_balance/);


