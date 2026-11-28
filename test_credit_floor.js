const assert = require('node:assert/strict');
const fs = require('node:fs');
const { evaluateBalance } = require('./insufficient-balance-cleanup');
const server = fs.readFileSync('./server.js', 'utf8');

assert.equal(evaluateBalance({ balanceCents: 100, requiredCents: 100 }).allowed, true, 'الرصيد الكافي يسمح بالعملية حتى حد الصفر');
assert.equal(evaluateBalance({ balanceCents: 99, requiredCents: 100 }).allowed, false, 'العملية التي تؤدي إلى رصيد سالب مرفوضة');
assert.equal(evaluateBalance({ balanceCents: 0, requiredCents: 1 }).allowed, false, 'الرصيد صفر لا يسمح بإنشاء دين');
assert.equal(evaluateBalance({ balanceCents: 0, requiredCents: 1 }).projectedBalanceCents, -1);
assert.match(server, /process\.env\.CAPTAIN_MIN_BALANCE_CENTS \|\| 0/);
assert.match(server, /policy: "no_debt_no_removal"/);
assert.match(server, /order_settlement_rejects_negative_balance/);
assert.match(server, /negative_balance_removal_blocked/);
assert.match(server, /captain_removal_blocked_for_insufficient_balance/);
console.log('credit floor 0.00 JOD and no-debt/no-removal guard verified using evaluateBalance');
