// Owner policy: every captain deduction stays stopped until the owner resumes it
// explicitly. A restart must never resurrect the weekly Thursday 22:00 charge.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// 1) The gate is a stored setting that defaults to OFF.
assert.match(server, /const CAPTAIN_SUBSCRIPTION_CHARGES_ENABLED = false;/, 'legacy default must stay false');
assert.match(server, /function subscriptionChargesEnabled\(\) \{/, 'gate helper must exist');
assert.match(server, /if \(!subscriptionChargesEnabled\(\)\) return \{ status: "disabled_by_owner"/, 'subscription charge must be gated');
assert.match(server, /function startCaptainSubscriptionScheduler\(\) \{\n  if \(subscriptionChargesEnabled\(\)\) \{/, 'interval must be gated by the setting');
assert.doesNotMatch(server, /if \(!CAPTAIN_SUBSCRIPTION_CHARGES_ENABLED\) return \{ status: "disabled_by_owner"/, 'hard-coded gate must be replaced');
assert.match(server, /const CAPTAIN_DAILY_CHARGE_ENABLED = false;/, 'daily charge stays disabled');

// 2) Boot must not force the weekly schedule back on.
assert.doesNotMatch(server, /setSetting\("captain_weekly_schedule_v1", JSON\.stringify\(\{ enabled: true/, 'boot must not force enabled:true');
assert.match(server, /if \(getSetting\("captain_weekly_schedule_v1", null\) === null\) \{\n    setSetting\("captain_weekly_schedule_v1", JSON\.stringify\(\{ enabled: false/, 'boot must seed a disabled default only when absent');
assert.match(server, /let weeklySubscriptionScheduler = null;/, 'scheduler handle must be reachable for the routes');
assert.doesNotMatch(server, /const weeklySubscriptionScheduler = createWeeklySubscriptionScheduler/, 'scheduler must not be block-scoped');

// 3) Owner routes: read + toggle, and enabling needs the confirmation phrase.
assert.match(server, /app\.get\("\/api\/admin\/subscriptions\/schedule", requireAdmin/, 'read route');
assert.match(server, /app\.post\("\/api\/admin\/subscriptions\/schedule", requireBotWalletOwner/, 'toggle route');
assert.match(server, /if \(enabled && confirmation !== "ENABLE_CAPTAIN_DEDUCTIONS"\)/, 'enabling requires confirmation');
assert.match(server, /setSetting\("captain_subscription_charges_enabled", enabled \? "true" : "false"\)/, 'toggle must persist the gate');

console.log('Captain deduction policy verified: weekly subscription and daily charges stay stopped by default, restarts cannot re-arm them, and resuming needs an explicit owner confirmation');