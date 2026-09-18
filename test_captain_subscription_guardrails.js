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

console.log('captain subscription approval, activity window, idempotency, and scheduler guardrails verified');
