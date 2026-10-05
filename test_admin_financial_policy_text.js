const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  REGULAR_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  calculateSettlement,
} = require('./finance');

const admin = fs.readFileSync('admin.html', 'utf8');
const settlement = calculateSettlement({ priceCents: 500, orderKind: 'normal' });

assert.match(admin, /13% لصاحب الطلب و2% للشركة/);
assert.match(admin, /13% للكابتن الأول و2% للشركة، بإجمالي خصم 15%/);
assert.match(admin, /خصم التنفيذ 15%/);
assert.match(admin, /الشركة 2%/);
assert.doesNotMatch(admin, /12%|الشركة 4%|خصم التنفيذ 16%/);
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1300);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 200);
assert.equal(settlement.producerFeeCents, 65);
assert.equal(settlement.companyCents, 10);
assert.equal(settlement.confirmingCaptainFeeCents, 75);
assert.equal(settlement.executorWalletCreditCents, 0);

console.log('admin financial policy text guard passed: 13% + 2% = 15%');
