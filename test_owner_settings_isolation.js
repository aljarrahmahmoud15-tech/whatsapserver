const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const finance = fs.readFileSync('finance.js', 'utf8');
const v26 = fs.readFileSync('public/admin-v26.html', 'utf8');

assert.match(server, /function requireOwnerAdmin/);
assert.match(server, /app\.get\("\/api\/admin\/settings", requireOwnerAdmin/);
assert.match(server, /app\.patch\("\/api\/admin\/settings\/settlement", requireOwnerAdmin/);
assert.match(server, /app\.patch\("\/api\/admin\/settings\/notifications", requireOwnerAdmin/);
assert.match(server, /currentSettlementPolicy/);
assert.match(server, /effectiveSettlementRates/);
assert.match(server, /if \(getSetting\(key\) === null\) setSetting\(key, value\)/);
assert.match(server, /settlementPolicyFromDetails/);
assert.match(finance, /function settlementLedgerNotes/);
assert.match(finance, /producerRateBps/);
assert.match(v26, /openOwnerSettings/);
assert.match(v26, /ownerNotificationForm/);
assert.match(v26, /\/api\/admin\/settings\/settlement/);
assert.match(v26, /\/api\/admin\/settings\/notifications/);
assert.doesNotMatch(v26, /test-group@g\.us/);
assert.match(v26, /TAJ|تاج/);
assert.doesNotMatch(v26, /server.?2|whatsapp.?clean/i);

console.log('owner settings and Taj isolation guard: PASS');
