const assert = require("assert");
const { calculateSettlement } = require("./finance");

const expectedNormal = (priceCents) => ({
  orderKind: "normal",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1000,
  producerFeeCents: Math.round(priceCents * 0.10),
  companyCents: Math.round(priceCents * 0.02),
  producerNetCents: Math.round(priceCents * 0.10),
  companyFeeCents: Math.round(priceCents * 0.02),
  captainFeeCents: Math.round(priceCents * 0.02),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.12),
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
  settlementMode: "percentage_normal_order",
});

const expectedOrder = (priceCents) => ({
  orderKind: "order",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1600,
  producerFeeCents: Math.round(priceCents * 0.16),
  companyCents: Math.round(priceCents * 0.04),
  producerNetCents: Math.round(priceCents * 0.16),
  companyFeeCents: Math.round(priceCents * 0.04),
  captainFeeCents: Math.round(priceCents * 0.04),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.20),
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
  settlementMode: "percentage_order",
});

assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "normal" }), expectedNormal(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "order" }), expectedOrder(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 500, orderKind: "order" }), expectedOrder(500), "اوردر يستخدم 16% للمنزل و4% للشركة مهما تغير السعر");
assert.strictEqual(calculateSettlement({ priceCents: 500, orderKind: "order" }).confirmingCaptainFeeCents, 100);

const normalExample = calculateSettlement({ priceCents: 1500 });
assert.strictEqual(normalExample.producerFeeCents, 150, "15 JOD: downloader receives 1.50 JOD");
assert.strictEqual(normalExample.companyCents, 30, "15 JOD: company receives 0.30 JOD");
assert.strictEqual(normalExample.confirmingCaptainFeeCents, 180, "15 JOD: executor pays 1.80 JOD");
assert.strictEqual(normalExample.externalOrderValueCents, 1500);
assert.strictEqual(normalExample.executorWalletCreditCents, 0);

const five = calculateSettlement({ priceCents: 500 });
assert.strictEqual(five.producerFeeCents, 50, "5 JOD: downloader receives 0.50 JOD");
assert.strictEqual(five.companyCents, 10, "5 JOD: company receives 0.10 JOD");
assert.strictEqual(five.confirmingCaptainFeeCents, 60, "5 JOD: executor pays 0.60 JOD");
assert.strictEqual(five.externalOrderValueCents, 500);
assert.strictEqual(five.executorWalletCreditCents, 0);

console.log("finance policy verified: 16%/4% order and 10%/2% normal-order values");
