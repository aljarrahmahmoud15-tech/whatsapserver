const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
assert.match(source, /function logSettlementCompleted\(/);
assert.match(source, /\[Settlement\] COMPLETED/);
assert.match(source, /\[Settlement\] CONFIRMED order_policy=12.5%\/2.5% for all order types/);
assert.match(source, /company=/);
assert.match(source, /executor_debit=/);
assert.match(source, /maskSettlementPhone\(producer\?\.phone\)/);
assert.match(source, /logSettlementCompleted\(\{ mode: "live"/);
assert.match(source, /logSettlementCompleted\(\{ mode: "historical"/);
console.log('Settlement console confirmation guardrails: OK');
