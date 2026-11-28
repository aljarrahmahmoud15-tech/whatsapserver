const assert = require('node:assert/strict');
const source = require('node:fs').readFileSync('server.js', 'utf8');

assert.match(source, /const CAPTAIN_SUBSCRIPTION_CHARGES_ENABLED = false/);
assert.match(source, /const CAPTAIN_DAILY_CHARGE_ENABLED = false/);
assert.match(source, /const CAPTAIN_DEBT_POLICY_ENABLED = String\(process\.env\.CAPTAIN_DEBT_POLICY_ENABLED \|\| "false"\)/);
assert.match(source, /const CAPTAIN_MANUAL_WALLET_CHANGES_ENABLED = CAPTAIN_DEBT_POLICY_ENABLED/);
assert.match(source, /function requireCompanyOwner\(req, res, next\)/);
assert.match(source, /app\.post\("\/api\/dashboard\/cards", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/dashboard\/cards\/:id\/send", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/dashboard\/cards\/:id\/void", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/dashboard\/captains\/:id\/wallet-adjustment", requireCompanyOwner/);
assert.match(source, /app\.post\("\/api\/admin\/captains\/:id\/wallet-adjustment", requireOwnerAdmin/);
assert.match(source, /app\.post\("\/api\/admin\/users\/:id\/wallet-adjustment", requireOwnerAdmin/);

const walletHandlerStart = source.indexOf('async function handleAdminWalletAdjustment');
const walletHandlerEnd = source.indexOf('function handleAdminDirectWalletCredit', walletHandlerStart);
assert.ok(walletHandlerStart >= 0 && walletHandlerEnd > walletHandlerStart);
const walletHandler = source.slice(walletHandlerStart, walletHandlerEnd);
assert.match(walletHandler, /if \(direction === "debit"\) return res\.status\(403\)/);
assert.match(walletHandler, /code: "MANUAL_WALLET_DEBIT_DISABLED"/);
assert.match(walletHandler, /direction !== "credit"/);
assert.doesNotMatch(walletHandler, /type: "admin_debit"/);
assert.doesNotMatch(walletHandler, /const signedAmount = -amountCents/);
assert.match(walletHandler, /if \(direction === "credit"\) \{/);

const dashboardStart = source.indexOf('app.post("/api/dashboard/captains/:id/wallet-adjustment"');
const dashboardEnd = source.indexOf('\napp.post("/api/admin/whatsapp/restart"', dashboardStart);
assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart);
const dashboardHandler = source.slice(dashboardStart, dashboardEnd);
assert.match(dashboardHandler, /if \(direction === "debit"\) return res\.status\(403\)/);
assert.match(dashboardHandler, /direction !== "credit"/);
assert.doesNotMatch(dashboardHandler, /admin_debit/);
assert.doesNotMatch(dashboardHandler, /const signedAmount/);
assert.match(dashboardHandler, /if \(direction === "credit"\) \{/);

assert.match(source, /weeklySubscriptionScheduler\.start\(\)/);
assert.match(source, /app\.post\("\/api\/admin\/captain-subscriptions\/execute"/);
assert.match(source, /app\.post\("\/api\/admin\/captain-withdrawal-requests\/:id\/decision"/);
assert.match(source, /captain_fee/);

console.log('general manual wallet debits are disabled; wallet credits, weekly subscription flow, and owner-approved withdrawal requests remain');
