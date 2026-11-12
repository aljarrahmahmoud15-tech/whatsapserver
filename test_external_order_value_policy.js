const assert = require('node:assert/strict');
const fs = require('node:fs');
const { calculateSettlement } = require('./finance');

const server = fs.readFileSync('./server.js', 'utf8');
const settlement = calculateSettlement({ priceCents: 1000, orderKind: 'normal' });

assert.equal(settlement.externalOrderValueCents, 1000);
assert.equal(settlement.executorWalletCreditCents, 0);
assert.equal(settlement.producerNetCents, 120);
assert.equal(settlement.companyCents, 40);
assert.equal(settlement.confirmingCaptainFeeCents, 160);
assert.match(server, /externalOrderValue: money\(externalOrderValueCents\)/);
assert.match(server, /executorWalletCredit: money\(executorWalletCreditCents\)/);
assert.match(server, /settlement\.executorWalletCreditCents/);
assert.match(server, /executor_wallet_credit=0\.00 JOD/);
assert.match(server, /external_value_not_credited=true/);
assert.doesNotMatch(server, /settlement\.captainGrossCents/);

console.log('external order value policy verified: fare stays external and executor wallet credit is zero');
