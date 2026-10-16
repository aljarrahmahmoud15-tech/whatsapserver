const assert = require("assert");
const { calculateSettlement } = require("./finance");

const expectedNormal = (priceCents) => ({
  orderKind: "normal",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1300,
  producerFeeCents: Math.round(priceCents * 0.13),
  companyCents: Math.round(priceCents * 0.02),
  producerNetCents: Math.round(priceCents * 0.13),
  companyFeeCents: Math.round(priceCents * 0.02),
  captainFeeCents: Math.round(priceCents * 0.02),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.15),
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

const fifteen = calculateSettlement({ priceCents: 1500 });
assert.strictEqual(fifteen.producerFeeCents, 195, "15 JOD: downloader receives 1.95 JOD");
assert.strictEqual(fifteen.companyCents, 30, "15 JOD: company receives 0.30 JOD");
assert.strictEqual(fifteen.confirmingCaptainFeeCents, 225, "15 JOD: executor pays 2.25 JOD");
assert.strictEqual(fifteen.externalOrderValueCents, 1500);
assert.strictEqual(fifteen.executorWalletCreditCents, 0);

const five = calculateSettlement({ priceCents: 500 });
assert.strictEqual(five.producerFeeCents, 65, "5 JOD: downloader receives 0.65 JOD");
assert.strictEqual(five.companyCents, 10, "5 JOD: company receives 0.10 JOD");
assert.strictEqual(five.confirmingCaptainFeeCents, 75, "5 JOD: executor pays 0.75 JOD");
assert.strictEqual(five.externalOrderValueCents, 500);
assert.strictEqual(five.executorWalletCreditCents, 0);

console.log("finance policy verified: 16%/4% order and 13%/2% normal-order values");
