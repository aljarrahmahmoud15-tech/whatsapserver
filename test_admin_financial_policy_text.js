const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  REGULAR_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  ORDER_PRODUCER_RATE_BPS,
  ORDER_COMPANY_RATE_BPS,
  calculateSettlement,
} = require('./finance');

const admin = fs.readFileSync('admin.html', 'utf8');
const settlement = calculateSettlement({ priceCents: 500, orderKind: 'normal' });

assert.match(admin, /id="ownerSettingsCard"/);
assert.match(admin, /saveSettlementPolicy/);
assert.match(admin, /التعديل يؤثر على الطلبات التي تُثبت بعد الحفظ فقط/);
assert.match(admin, /الشركة/);
assert.doesNotMatch(admin, /16%|4%.*الشركة/);
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1250);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 250);
assert.equal(settlement.producerFeeCents, 63);
assert.equal(settlement.companyCents, 13);
assert.equal(settlement.confirmingCaptainFeeCents, 76);
assert.equal(settlement.executorWalletCreditCents, 0);
assert.equal(ORDER_PRODUCER_RATE_BPS, 1500);
assert.equal(ORDER_COMPANY_RATE_BPS, 500);

console.log('admin financial policy text guard passed: normal 12.5% + 2.5%, order 15% + 5%');
