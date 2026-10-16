const assert = require("assert");
const { calculateSettlement, settlementLedgerNotes } = require("./finance");

const expectedNormal = (priceCents) => ({
  orderKind: "normal",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1250,
  producerFeeCents: Math.round(priceCents * 0.125),
  companyCents: Math.round(priceCents * 0.025),
  producerNetCents: Math.round(priceCents * 0.125),
  companyFeeCents: Math.round(priceCents * 0.025),
  captainFeeCents: Math.round(priceCents * 0.025),
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

const normalExample = calculateSettlement({ priceCents: 1500 });
assert.strictEqual(normalExample.producerFeeCents, 188, "15 JOD: downloader receives 1.875 JOD");
assert.strictEqual(normalExample.companyCents, 38, "15 JOD: company receives 0.375 JOD");
assert.strictEqual(normalExample.confirmingCaptainFeeCents, 226, "15 JOD: executor pays 2.26 JOD");
assert.strictEqual(normalExample.externalOrderValueCents, 1500);
assert.strictEqual(normalExample.executorWalletCreditCents, 0);

const five = calculateSettlement({ priceCents: 500 });
assert.strictEqual(five.producerFeeCents, 63, "5 JOD: downloader receives 0.625 JOD");
assert.strictEqual(five.companyCents, 13, "5 JOD: company receives 0.125 JOD");
assert.strictEqual(five.confirmingCaptainFeeCents, 76, "5 JOD: executor pays 0.76 JOD");
assert.strictEqual(five.externalOrderValueCents, 500);
assert.strictEqual(five.executorWalletCreditCents, 0);

const normalLedgerNotes = settlementLedgerNotes("normal");
assert.match(normalLedgerNotes.producer, /12\.5%/);
assert.match(normalLedgerNotes.company, /2\.5%/);
assert.match(normalLedgerNotes.captain, /12\.5% \+ 2\.5% = 15%/);
const orderLedgerNotes = settlementLedgerNotes("order");
assert.match(orderLedgerNotes.producer, /16%/);
assert.match(orderLedgerNotes.company, /4%/);
assert.match(orderLedgerNotes.captain, /16% \+ 4% = 20%/);

console.log("finance policy verified: 16%/4% order and 12.5%/2.5% normal-order values");
