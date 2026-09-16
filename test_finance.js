const assert = require("assert");
const { calculateSettlement } = require("./finance");

const regular = calculateSettlement({ priceCents: 2000, orderKind: "normal" });
assert.deepStrictEqual(regular, {
  orderKind: "normal",
  grossCents: 2000,
  producerRateBps: 1200,
  producerFeeCents: 240,
  companyCents: 80,
  producerNetCents: 240,
  captainFeeCents: 80,
  confirmingCaptainFeeCents: 320,
  captainGrossCents: 2000,
});

const special = calculateSettlement({ priceCents: 2000, orderKind: "order" });
assert.deepStrictEqual(special, {
  orderKind: "order",
  grossCents: 2000,
  producerRateBps: 1200,
  producerFeeCents: 240,
  companyCents: 80,
  producerNetCents: 240,
  captainFeeCents: 80,
  confirmingCaptainFeeCents: 320,
  captainGrossCents: 2000,
});

const fifteen = calculateSettlement({ priceCents: 1500 });
assert.strictEqual(fifteen.producerFeeCents, 180, "15 JOD: downloader receives 1.80 JOD");
assert.strictEqual(fifteen.companyCents, 60, "15 JOD: company receives 0.60 JOD");
assert.strictEqual(fifteen.confirmingCaptainFeeCents, 240, "15 JOD: executor pays 2.40 JOD");

const five = calculateSettlement({ priceCents: 500 });
assert.strictEqual(five.producerFeeCents, 60, "5 JOD: downloader receives 0.60 JOD");
assert.strictEqual(five.companyCents, 20, "5 JOD: company receives 0.20 JOD");
assert.strictEqual(five.confirmingCaptainFeeCents, 80, "5 JOD: executor pays 0.80 JOD");

console.log(JSON.stringify({ regular, special }));
