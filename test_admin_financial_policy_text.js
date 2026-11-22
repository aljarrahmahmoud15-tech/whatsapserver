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
assert.equal(REGULAR_PRODUCER_RATE_BPS, 1300);
assert.equal(COMPANY_FROM_PRODUCER_RATE_BPS, 300);
assert.equal(settlement.producerFeeCents, 65);
assert.equal(settlement.companyCents, 15);
assert.equal(settlement.confirmingCaptainFeeCents, 80);
const order5 = calculateSettlement({ priceCents: 500, orderKind: 'order' });
assert.equal(order5.producerFeeCents, 85);
assert.equal(order5.companyCents, 15);
assert.equal(order5.confirmingCaptainFeeCents, 100);
assert.equal(settlement.executorWalletCreditCents, 0);
assert.equal(ORDER_PRODUCER_RATE_BPS, 1700);
assert.equal(ORDER_COMPANY_RATE_BPS, 300);

assert.match(admin, /id="settlementOrderProducerRate"/);
assert.match(admin, /orderProducerRatePercent:orderProducer/);
console.log('admin financial policy text guard passed: normal 13% + 3%, order 17% + 3%');
