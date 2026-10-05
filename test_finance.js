const assert = require("assert");
const { calculateSettlement } = require("./finance");

const expected = (priceCents, orderKind = "normal") => ({
  orderKind,
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
});

assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "normal" }), expected(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "order" }), expected(2000, "order"));
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
console.log("finance policy verified: 13% downloader + 2% company = 15% executor debit");
