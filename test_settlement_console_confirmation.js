const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
assert.match(source, /function logSettlementCompleted\(/);
assert.match(source, /\[Settlement\] COMPLETED/);
assert.match(source, /\[Settlement\] CONFIRMED 13% downloader=/);
assert.match(source, /2% company=/);
assert.match(source, /15% executor_debit=/);
assert.match(source, /maskSettlementPhone\(producer\?\.phone\)/);
assert.match(source, /logSettlementCompleted\(\{ mode: "live"/);
assert.match(source, /logSettlementCompleted\(\{ mode: "historical"/);
console.log('Settlement console confirmation guardrails: OK');
