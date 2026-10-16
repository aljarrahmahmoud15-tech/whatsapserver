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
assert.match(admin, /التسوية لجميع الأنواع: 12\.5% للكابتن الأول و2\.5% للشركة، بإجمالي خصم 15%/);
assert.match(admin, /12\.5% لصاحب الطلب و2\.5% للشركة/);
assert.match(admin, /الشركة/);
assert.doesNotMatch(admin, /16%|4%.*الشركة/);
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1250);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 250);
assert.equal(settlement.producerFeeCents, 63);
assert.equal(settlement.companyCents, 13);
assert.equal(settlement.confirmingCaptainFeeCents, 76);
assert.equal(settlement.executorWalletCreditCents, 0);

console.log('admin financial policy text guard passed: 12.5% + 2.5% = 15% for all order types');
