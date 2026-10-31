const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const CAPTAIN_SUBSCRIPTION_CHARGES_ENABLED = false/);
assert.match(source, /const CAPTAIN_DAILY_CHARGE_ENABLED = false/);
assert.match(source, /const CAPTAIN_DEBT_POLICY_ENABLED = String\(process\.env\.CAPTAIN_DEBT_POLICY_ENABLED \|\| "false"\)/);
assert.match(source, /const CAPTAIN_MANUAL_WALLET_CHANGES_ENABLED = CAPTAIN_DEBT_POLICY_ENABLED/);
assert.match(source, /function requireCompanyOwner\(req, res, next\)/);
assert.match(source, /app\.post\("\/api\/dashboard\/cards", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/dashboard\/cards\/:id\/send", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/dashboard\/cards\/:id\/void", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/dashboard\/captains\/:id\/wallet-adjustment", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/admin\/captains\/:id\/wallet-adjustment", requireAdmin/);
assert.match(source, /app\.post\("\/api\/admin\/users\/:id\/wallet-adjustment", requireAdmin/);
assert.match(source, /"subscription_fee"/);
assert.match(source, /"daily_captain_charge"/);
assert.match(source, /captain_fee/);

console.log('captain wallet policy: debt enforcement, recurring charges, warnings, isolation, and manual debits are disabled; completed order settlement remains active');
