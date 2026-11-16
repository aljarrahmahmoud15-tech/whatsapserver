const assert = require("assert");
const { calculateSettlement, settlementLedgerNotes } = require("./finance");
const expectedNormal = (priceCents) => ({
  orderKind: "normal",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1200,
  producerFeeCents: Math.round(priceCents * 0.12),
  companyCents: Math.round(priceCents * 0.03),
  producerNetCents: Math.round(priceCents * 0.12),
  companyFeeCents: Math.round(priceCents * 0.03),
  captainFeeCents: Math.round(priceCents * 0.03),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.15),
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
  settlementMode: "percentage_normal_order",
});
const expectedOrder = (priceCents) => ({
  orderKind: "order",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1200,
  producerFeeCents: Math.round(priceCents * 0.12),
  companyCents: Math.round(priceCents * 0.03),
  producerNetCents: Math.round(priceCents * 0.12),
  companyFeeCents: Math.round(priceCents * 0.03),
  captainFeeCents: Math.round(priceCents * 0.03),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.12) + Math.round(priceCents * 0.03),
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
  settlementMode: "percentage_order",
});
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "normal" }), expectedNormal(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "order" }), expectedOrder(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 10000, orderKind: "order" }), expectedOrder(10000), "الأوردر يستخدم 12% للمنزّل و3% للشركة");
assert.strictEqual(calculateSettlement({ priceCents: 10000, orderKind: "order" }).confirmingCaptainFeeCents, 1500);

const normalExample = calculateSettlement({ priceCents: 1500 });
assert.strictEqual(normalExample.producerFeeCents, 180, "15 JOD: downloader receives 1.80 JOD");
assert.strictEqual(normalExample.companyCents, 45, "15 JOD: company receives 0.60 JOD");
assert.strictEqual(normalExample.confirmingCaptainFeeCents, 225, "15 JOD: executor pays 2.40 JOD");
assert.strictEqual(normalExample.externalOrderValueCents, 1500);
assert.strictEqual(normalExample.executorWalletCreditCents, 0);

const five = calculateSettlement({ priceCents: 500 });
assert.strictEqual(five.producerFeeCents, 60, "5 JOD: downloader receives 0.60 JOD");
assert.strictEqual(five.companyCents, 15, "5 JOD: company receives 0.20 JOD");
assert.strictEqual(five.confirmingCaptainFeeCents, 75, "5 JOD: executor pays 0.80 JOD");
assert.strictEqual(five.externalOrderValueCents, 500);
assert.strictEqual(five.executorWalletCreditCents, 0);

const normalLedgerNotes = settlementLedgerNotes("normal");
assert.match(normalLedgerNotes.producer, /12%/);
assert.match(normalLedgerNotes.company, /3%/);
assert.match(normalLedgerNotes.captain, /12% \+ 3% = 15%/);
const orderLedgerNotes = settlementLedgerNotes("order");
assert.match(orderLedgerNotes.producer, /12%/);
assert.match(orderLedgerNotes.company, /3%/);
assert.match(orderLedgerNotes.captain, /12% \+ 3% = 15%/);

console.log("finance policy verified: normal and order 12%/3%");
