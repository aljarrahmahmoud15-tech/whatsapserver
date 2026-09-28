const assert = require("assert");
const { calculateSettlement } = require("./finance");

const regular = calculateSettlement({ priceCents: 2000, orderKind: "normal" });
assert.deepStrictEqual(regular, {
  orderKind: "normal",
  grossCents: 2000,
  externalOrderValueCents: 2000,
  producerRateBps: 1200,
  producerFeeCents: 240,
  companyCents: 60,
  producerNetCents: 240,
  companyFeeCents: 60,
  captainFeeCents: 60,
  confirmingCaptainFeeCents: 300,
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
});

const special = calculateSettlement({ priceCents: 2000, orderKind: "order" });
assert.deepStrictEqual(special, {
  orderKind: "order",
  grossCents: 2000,
  externalOrderValueCents: 2000,
  producerRateBps: 1200,
  producerFeeCents: 240,
  companyCents: 60,
  producerNetCents: 240,
  companyFeeCents: 60,
  captainFeeCents: 60,
  confirmingCaptainFeeCents: 300,
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
});

const fifteen = calculateSettlement({ priceCents: 1500 });
assert.strictEqual(fifteen.producerFeeCents, 180, "15 JOD: downloader receives 1.80 JOD");
assert.strictEqual(fifteen.companyCents, 45, "15 JOD: company receives 0.45 JOD");
assert.strictEqual(fifteen.confirmingCaptainFeeCents, 225, "15 JOD: executor pays 2.25 JOD");
assert.strictEqual(fifteen.externalOrderValueCents, 1500, "15 JOD: external order value remains outside wallets");
assert.strictEqual(fifteen.executorWalletCreditCents, 0, "15 JOD: executor receives no fare credit");

const five = calculateSettlement({ priceCents: 500 });
assert.strictEqual(five.producerFeeCents, 60, "5 JOD: downloader receives 0.60 JOD");
assert.strictEqual(five.companyCents, 15, "5 JOD: company receives 0.15 JOD");
assert.strictEqual(five.confirmingCaptainFeeCents, 75, "5 JOD: executor pays 0.75 JOD");
assert.strictEqual(five.externalOrderValueCents, 500, "5 JOD: external order value remains outside wallets");
assert.strictEqual(five.executorWalletCreditCents, 0, "5 JOD: executor receives no fare credit");

console.log(JSON.stringify({ regular, special }));
