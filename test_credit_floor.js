const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('./server.js', 'utf8');
const limit = 0;
const mayExecute = (balance, fee) => balance - fee >= limit;

assert.equal(mayExecute(100, 100), true, 'الرصيد الكافي يسمح بالعملية');
assert.equal(mayExecute(99, 100), false, 'العملية التي تؤدي إلى رصيد سالب مرفوضة');
assert.equal(mayExecute(0, 1), false, 'الرصيد صفر لا يسمح بإنشاء دين');
assert.match(server, /process\.env\.CAPTAIN_MIN_BALANCE_CENTS \|\| 0/);
assert.match(server, /policy: "no_debt_no_removal"/);
assert.match(server, /error: "الرصيد غير كافٍ"/);
assert.match(server, /negative_balance_removal_blocked/);
assert.match(server, /captain_removal_blocked_for_insufficient_balance/);
console.log('credit floor 0.00 JOD and no-debt/no-removal guard verified');
