const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  REGULAR_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  calculateSettlement,
} = require('./finance');

const admin = fs.readFileSync('admin.html', 'utf8');
const settlement = calculateSettlement({ priceCents: 500, orderKind: 'normal' });

assert.match(admin, /12\.5% لصاحب الطلب و2\.5% للشركة/);
assert.match(admin, /الأوردر 16% للكابتن الأول و4% للشركة، بإجمالي خصم 20%/);
assert.match(admin, /الطلب العادي 12\.5% \+ 2\.5% = 15%/);
assert.match(admin, /الشركة/);
assert.match(admin, /4% للشركة/);
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1250);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 250);
assert.equal(settlement.producerFeeCents, 63);
assert.equal(settlement.companyCents, 13);
assert.equal(settlement.confirmingCaptainFeeCents, 76);
assert.equal(settlement.executorWalletCreditCents, 0);

console.log('admin financial policy text guard passed: order 16% + 4% = 20%, normal 12.5% + 2.5% = 15%');
