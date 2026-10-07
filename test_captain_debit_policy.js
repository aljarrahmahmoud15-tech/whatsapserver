const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const CAPTAIN_SUBSCRIPTION_CHARGES_ENABLED = false/);
assert.match(source, /const CAPTAIN_DAILY_CHARGE_ENABLED = false/);
assert.match(source, /const CAPTAIN_NON_SETTLEMENT_DEBITS_ENABLED = false/);
assert.match(source, /تم إيقاف جميع الخصومات اليدوية؛ الخصم المسموح هو تسوية الطلب المكتمل فقط/);
assert.match(source, /policy: "order_settlement_only", mutation: "none"/);
assert.match(source, /type=\"subscription_fee\"|"subscription_fee"/);
assert.match(source, /type=\"daily_captain_charge\"|"daily_captain_charge"/);
assert.match(source, /type: \"captain_fee\"|"captain_fee"/);

const manualDebitGuards = (source.match(/direction === "debit" && !CAPTAIN_NON_SETTLEMENT_DEBITS_ENABLED/g) || []).length;
assert.equal(manualDebitGuards, 2, 'both manual wallet debit routes must be blocked');

console.log('captain debit policy: recurring and manual debits disabled; completed order settlement remains the only debit path');
