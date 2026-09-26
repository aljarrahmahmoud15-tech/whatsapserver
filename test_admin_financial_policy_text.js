const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  REGULAR_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  calculateSettlement,
} = require('./finance');

const admin = fs.readFileSync('admin.html', 'utf8');
const settlement = calculateSettlement({ priceCents: 500, orderKind: 'normal' });

assert.match(admin, /12% لصاحب الطلب و4% للشركة/);
assert.match(admin, /12% للكابتن الأول و4% للشركة، بإجمالي خصم 16%/);
assert.match(admin, /خصم التنفيذ 16%/);
assert.match(admin, /الشركة 4%/);
assert.match(admin, /4%|16%/);
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1200);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 400);
assert.equal(settlement.producerFeeCents, 60);
assert.equal(settlement.companyCents, 20);
assert.equal(settlement.confirmingCaptainFeeCents, 80);
assert.equal(settlement.executorWalletCreditCents, 0);

console.log('admin financial policy text guard passed: 12% + 4% = 16%');
