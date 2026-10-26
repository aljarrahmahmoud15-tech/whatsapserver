const assert = require('assert/strict');
const fs = require('fs');

const captain = fs.readFileSync('public/captain.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

const tripsStart = captain.indexOf("$('#trips').innerHTML =");
const ledgerStart = captain.indexOf("$('#ledger').innerHTML", tripsStart);
assert.ok(tripsStart >= 0 && ledgerStart > tripsStart, 'captain trip renderer exists');
const tripsRenderer = captain.slice(tripsStart, ledgerStart);

assert.match(captain, /\.settlement-summary\{/);
assert.match(captain, /تمت التسوية المالية للطلب #\$\{orderNo\}/);
assert.match(tripsRenderer, /settlement-summary/);
assert.match(tripsRenderer, /role="status"/);
assert.match(tripsRenderer, /const orderNo = escapeHtml\(trip\.order_no\)/);
assert.doesNotMatch(tripsRenderer, /row-main/);
assert.doesNotMatch(tripsRenderer, /row-meta/);
assert.doesNotMatch(tripsRenderer, /خصم التنفيذ/);
assert.doesNotMatch(tripsRenderer, /حصة التنزيل/);
assert.doesNotMatch(tripsRenderer, /القيمة الخارجية/);

// The redesign is presentation-only: financial values remain available from the API.
assert.match(server, /netEarnings: money\(/);
assert.match(server, /executedDebit: money\(/);
assert.match(server, /entries,/);
assert.match(server, /trips,/);

console.log('captain settlement card design guardrails verified');
