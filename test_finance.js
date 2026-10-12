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

const expectedFixedOrder = (priceCents) => ({
  orderKind: "order",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: null,
  producerFeeCents: 85,
  companyCents: 15,
  producerNetCents: 85,
  companyFeeCents: 15,
  captainFeeCents: 15,
  confirmingCaptainFeeCents: 100,
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
  settlementMode: "fixed_order_values",
});

assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "normal" }), expectedNormal(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "order" }), expectedFixedOrder(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 500, orderKind: "order" }), expectedFixedOrder(500), "اوردر يستخدم القيم الثابتة مهما تغير السعر");

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

console.log("finance policy verified: fixed order values and percentage normal-order values");
