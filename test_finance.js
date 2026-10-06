const assert = require("assert");
const { calculateSettlement } = require("./finance");

const expected = (priceCents, orderKind = "normal") => ({
  orderKind,
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1200,
  producerFeeCents: Math.round(priceCents * 0.12),
  companyCents: Math.round(priceCents * 0.04),
  producerNetCents: Math.round(priceCents * 0.12),
  companyFeeCents: Math.round(priceCents * 0.04),
  captainFeeCents: Math.round(priceCents * 0.04),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.16),
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
});

assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "normal" }), expected(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "order" }), expected(2000, "order"));
const fifteen = calculateSettlement({ priceCents: 1500 });
assert.strictEqual(fifteen.producerFeeCents, 180, "15 JOD: downloader receives 1.95 JOD");
assert.strictEqual(fifteen.companyCents, 60, "15 JOD: company receives 0.30 JOD");
assert.strictEqual(fifteen.confirmingCaptainFeeCents, 240, "15 JOD: executor pays 2.25 JOD");
assert.strictEqual(fifteen.externalOrderValueCents, 1500);
assert.strictEqual(fifteen.executorWalletCreditCents, 0);
const five = calculateSettlement({ priceCents: 500 });
assert.strictEqual(five.producerFeeCents, 60, "5 JOD: downloader receives 0.65 JOD");
assert.strictEqual(five.companyCents, 20, "5 JOD: company receives 0.10 JOD");
assert.strictEqual(five.confirmingCaptainFeeCents, 80, "5 JOD: executor pays 0.75 JOD");
assert.strictEqual(five.externalOrderValueCents, 500);
assert.strictEqual(five.executorWalletCreditCents, 0);
console.log("finance policy verified: 12% downloader + 4% company = 15% executor debit");
