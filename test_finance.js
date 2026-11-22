const assert = require("assert");
const { calculateSettlement, settlementLedgerNotes } = require("./finance");
// Owner-approved policy (2026-11-22): normal 13% downloader + 3% company = 16% executor debit,
// «أوردر» 17% downloader + 3% company = 20% executor debit.
const expectedNormal = (priceCents) => ({
  orderKind: "normal",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1300,
  producerFeeCents: Math.round(priceCents * 0.13),
  companyCents: Math.round(priceCents * 0.03),
  producerNetCents: Math.round(priceCents * 0.13),
  companyFeeCents: Math.round(priceCents * 0.03),
  captainFeeCents: Math.round(priceCents * 0.03),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.13) + Math.round(priceCents * 0.03),
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
  settlementMode: "percentage_normal_order",
});
const expectedOrder = (priceCents) => ({
  orderKind: "order",
  grossCents: priceCents,
  externalOrderValueCents: priceCents,
  producerRateBps: 1700,
  producerFeeCents: Math.round(priceCents * 0.17),
  companyCents: Math.round(priceCents * 0.03),
  producerNetCents: Math.round(priceCents * 0.17),
  companyFeeCents: Math.round(priceCents * 0.03),
  captainFeeCents: Math.round(priceCents * 0.03),
  confirmingCaptainFeeCents: Math.round(priceCents * 0.17) + Math.round(priceCents * 0.03),
  executorWalletCreditCents: 0,
  captainGrossCents: 0,
  settlementMode: "percentage_order",
});
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "normal" }), expectedNormal(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 2000, orderKind: "order" }), expectedOrder(2000));
assert.deepStrictEqual(calculateSettlement({ priceCents: 10000, orderKind: "order" }), expectedOrder(10000), "الأوردر يستخدم 17% للمنزّل و3% للشركة");
assert.strictEqual(calculateSettlement({ priceCents: 10000, orderKind: "order" }).confirmingCaptainFeeCents, 2000);
assert.strictEqual(calculateSettlement({ priceCents: 10000, orderKind: "normal" }).confirmingCaptainFeeCents, 1600);

// Owner's worked examples for «أوردر»: 5 -> 1.00, 10 -> 2.00, 15 -> 3.00, 20 -> 4.00 JOD debited.
const orderExamples = [[500, 85, 15, 100], [1000, 170, 30, 200], [1500, 255, 45, 300], [2000, 340, 60, 400]];
for (const [priceCents, producerCents, companyCents, debitCents] of orderExamples) {
  const settlement = calculateSettlement({ priceCents, orderKind: "order" });
  assert.strictEqual(settlement.producerFeeCents, producerCents, `${priceCents} cents: downloader share`);
  assert.strictEqual(settlement.companyCents, companyCents, `${priceCents} cents: company share`);
  assert.strictEqual(settlement.confirmingCaptainFeeCents, debitCents, `${priceCents} cents: executor debit is 20%`);
  assert.strictEqual(settlement.executorWalletCreditCents, 0, `${priceCents} cents: the fare never credits the executor`);
}

// Normal request examples at 16%.
const normalExamples = [[500, 65, 15, 80], [1000, 130, 30, 160], [1500, 195, 45, 240], [2000, 260, 60, 320]];
for (const [priceCents, producerCents, companyCents, debitCents] of normalExamples) {
  const settlement = calculateSettlement({ priceCents, orderKind: "normal" });
  assert.strictEqual(settlement.producerFeeCents, producerCents, `${priceCents} cents: downloader share`);
  assert.strictEqual(settlement.companyCents, companyCents, `${priceCents} cents: company share`);
  assert.strictEqual(settlement.confirmingCaptainFeeCents, debitCents, `${priceCents} cents: executor debit is 16%`);
  assert.strictEqual(settlement.externalOrderValueCents, priceCents);
  assert.strictEqual(settlement.executorWalletCreditCents, 0);
}

const normalLedgerNotes = settlementLedgerNotes("normal");
assert.match(normalLedgerNotes.producer, /13%/);
assert.match(normalLedgerNotes.company, /3%/);
assert.match(normalLedgerNotes.captain, /13% \+ 3% = 16% لـالطلب العادي/);
const orderLedgerNotes = settlementLedgerNotes("order");
assert.match(orderLedgerNotes.producer, /17%/);
assert.match(orderLedgerNotes.company, /3%/);
assert.match(orderLedgerNotes.captain, /17% \+ 3% = 20% لـالأوردر/);
assert.match(orderLedgerNotes.reversalCaptain, /17% \+ 3% = 20% لـالأوردر/);

console.log("finance policy verified: normal 13%+3%=16%, order 17%+3%=20%");
