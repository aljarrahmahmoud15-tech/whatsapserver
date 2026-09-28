const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  REGULAR_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  calculateSettlement,
} = require('./finance');

const admin = fs.readFileSync('admin.html', 'utf8');
const settlement = calculateSettlement({ priceCents: 500, orderKind: 'normal' });

assert.match(admin, /12% لصاحب الطلب و3% للشركة/);
assert.match(admin, /12% للكابتن الأول و3% للشركة، بإجمالي خصم 15%/);
assert.match(admin, /خصم التنفيذ 15%/);
assert.match(admin, /الشركة 3%/);
assert.doesNotMatch(admin, /4%|16%/);
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1200);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 300);
assert.equal(settlement.producerFeeCents, 60);
assert.equal(settlement.companyCents, 15);
assert.equal(settlement.confirmingCaptainFeeCents, 75);
assert.equal(settlement.executorWalletCreditCents, 0);

console.log('admin financial policy text guard passed: 12% + 3% = 15%');
