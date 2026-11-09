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
assert.match(admin, /التعديل يؤثر على الطلبات التي تُثبت بعد الحفظ فقط/);
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1200);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 400);
assert.equal(settlement.producerFeeCents, 60);
assert.equal(settlement.companyCents, 20);
assert.equal(settlement.confirmingCaptainFeeCents, 80);
assert.equal(settlement.executorWalletCreditCents, 0);
assert.equal(ORDER_PRODUCER_RATE_BPS, 1200);
assert.equal(ORDER_COMPANY_RATE_BPS, 400);

console.log('admin financial policy text guard passed: normal and order 12% + 4%');
