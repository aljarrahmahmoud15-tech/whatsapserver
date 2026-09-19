const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const CAPTAIN_SUBSCRIPTION_CENTS = 100/);
assert.match(source, /const CAPTAIN_SUBSCRIPTION_START = "2026-09-18T00:00:00\.000Z"/);
assert.match(source, /const CAPTAIN_SUBSCRIPTION_PERIOD_DAYS = 7/);
assert.match(source, /CREATE TABLE IF NOT EXISTS captain_subscription_charges/);
assert.match(source, /UNIQUE\(user_id, period_start\)/);
assert.match(source, /role='captain' AND active=1 AND is_bot=0 AND account_status='active'/);
assert.match(source, /FROM orders o WHERE \(o\.producer_user_id=users\.id OR o\.captain_user_id=users\.id\)/);
assert.match(source, /FROM order_candidates oc WHERE oc\.producer_user_id=users\.id/);
assert.match(source, /"skipped_debt_limit"/);
assert.match(source, /"subscription_fee"/);
assert.match(source, /function startCaptainSubscriptionScheduler\(\)/);
assert.match(source, /startCaptainSubscriptionScheduler\(\);/);
assert.match(source, /app\.get\("\/api\/admin\/subscriptions", requireAdmin/);
assert.match(source, /currentBalance: money\(row\.wallet_cents\)/);
assert.match(source, /const CAPTAIN_DAILY_CHARGE_CENTS = 10/);
assert.match(source, /CREATE TABLE IF NOT EXISTS captain_daily_charges/);
assert.match(source, /UNIQUE\(user_id, charge_date\)/);
assert.match(source, /function applyCaptainDailyCharges\(stamp = now\(\)\)/);
assert.match(source, /"daily_captain_charge"/);
assert.match(source, /DAILY-CAPTAIN-\$\{chargeDate\}-\$\{captain\.id\}/);
assert.match(source, /setInterval\(\(\) => applyCaptainDailyCharges\(\), CAPTAIN_DAILY_CHARGE_INTERVAL_MS\)/);
assert.match(source, /const CAPTAIN_DAILY_CHARGE_ENABLED = false/);
assert.doesNotMatch(source, /CAPTAIN_DAILY_CHARGE_ENABLED = process\.env/);
assert.match(source, /if \(CAPTAIN_DAILY_CHARGE_ENABLED\) \{/);
const dailyBlock = source.slice(source.indexOf('function applyCaptainDailyCharges'), source.indexOf('function startCaptainSubscriptionScheduler'));
assert.equal(dailyBlock.includes('notifyCaptain'), false, 'daily charge must not notify captains');
assert.match(source, /app\.get\("\/api\/admin\/daily-charges", requireAdmin/);
assert.match(source, /chargeAmountCents: CAPTAIN_DAILY_CHARGE_CENTS/);
assert.match(source, /activeCount: rows\.filter\(\(row\) => Boolean\(row\.active\)\)\.length/);

console.log('captain subscription approval, activity window, idempotency, and scheduler guardrails verified');
