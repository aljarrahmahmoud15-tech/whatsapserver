"use strict";
// Owner-approved unit 2026-11-23: «صحّح نص النسب».
// The amounts were always right; the WORDS were wrong. A «أوردر» settlement was labelled with the
// normal 13% because the details snapshot stored policy.producerRateBps regardless of order kind
// (server.js write sites ~11077/~11152, protected money functions), and both readers took that one
// pair: settlementPolicyFromDetails -> settlementFinancials.policy and -> canonicalLedgerNote.
// Fix is display-only: recover the percentage from the cents the record actually stored, so a label
// can never contradict its amount, and so already-saved rows are corrected without rewriting them.
// The server is never required and never booted; readers are sliced into a vm context.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("server.js", "utf8");
const indexHtml = fs.readFileSync("public/index.html", "utf8");
const { settlementLedgerNotes } = require("./finance");

function sliceBetween(text, startMarker, endMarker, label) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${label} slice exists`);
  return text.slice(start, end);
}
function constDeclaration(name) {
  const match = source.match(new RegExp(`^const ${name} = .+$`, "m"));
  assert.ok(match, `const ${name} is declared`);
  return match[0];
}

const helpersSlice = sliceBetween(source, "function settlementDisplayRateBps({", "function settlementFinancials(row) {", "display rate helpers");
const financialsSlice = sliceBetween(source, "function settlementFinancials(row) {", "function canonicalLedgerNote(entry, rateOverride", "settlement serializer");
const noteSlice = sliceBetween(source, "function canonicalLedgerNote(entry, rateOverride", "function settlementRows(", "canonical ledger note");
const snapshotSlice = sliceBetween(source, "function settlementPolicyFromDetails(details) {", "function safePathHealth(targetPath) {", "snapshot reader");
const percentSlice = sliceBetween(source, "function ratePercentFromBps(value) {", "function settlementPolicyResponse() {", "percent formatter");

function loadReaders() {
  const context = {
    settlementLedgerNotes,
    money: (cents) => (Number(cents || 0) / 100).toFixed(2),
  };
  vm.createContext(context);
  vm.runInContext([
    constDeclaration("PRODUCER_RATE_BPS"),
    constDeclaration("SPECIAL_ORDER_RATE_BPS"),
    constDeclaration("COMPANY_FROM_PRODUCER_RATE_BPS"),
    constDeclaration("SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS"),
    percentSlice,
    snapshotSlice,
    helpersSlice,
    financialsSlice,
    noteSlice,
    "this.settlementFinancials = settlementFinancials;",
    "this.canonicalLedgerNote = canonicalLedgerNote;",
    "this.settlementDisplayRateBps = settlementDisplayRateBps;",
    "this.ledgerNoteDisplayRates = ledgerNoteDisplayRates;",
  ].join("\n"), context);
  return context;
}
const readers = loadReaders();

// An «أوردر» of 5.00 JOD settled 0.85 to the downloader captain and 0.15 to the company (17% + 3%),
// while the legacy snapshot beside it still said 13% + 3% — the exact defect the owner reported.
const orderRow = {
  settlement_id: 40, order_id: 934, order_no: 934, settlement_status: "applied",
  price_cents: 500, company_cents: 15, producer_cents: 85, captain_fee_cents: 100,
  settlement_company_cents: 15, settlement_producer_cents: 85, settlement_captain_fee_cents: 100,
  order_kind: "order",
  settlement_details_json: JSON.stringify({ orderNo: 934, priceCents: 500, orderKind: "order", producerRateBps: 1300, companyRateBps: 300 }),
};
const normalRow = {
  settlement_id: 41, order_id: 936, order_no: 936, settlement_status: "applied",
  price_cents: 500, company_cents: 15, producer_cents: 65, captain_fee_cents: 80,
  settlement_company_cents: 15, settlement_producer_cents: 65, settlement_captain_fee_cents: 80,
  order_kind: "normal",
  settlement_details_json: JSON.stringify({ orderNo: 936, priceCents: 500, orderKind: "normal", producerRateBps: 1300, companyRateBps: 300 }),
};

function ledgerEntry(row, type, amountCents) {
  return {
    order_id: row.order_id,
    type,
    amount_cents: amountCents,
    details_json: row.settlement_details_json,
    order_kind: row.order_kind,
    note: "قديمة",
  };
}

test("the settlements policy field shows 17/3/20 on an «أوردر» row", () => {
  const policy = readers.settlementFinancials(orderRow).policy;
  assert.equal(policy.producerRatePercent, 17, "order downloader share is labelled 17%");
  assert.equal(policy.companyRatePercent, 3, "company share stays 3%");
  assert.equal(policy.totalRatePercent, 20, "the executor debit is 20%");
});

test("the settlements policy field keeps 13/3/16 on a normal row", () => {
  const policy = readers.settlementFinancials(normalRow).policy;
  assert.equal(policy.producerRatePercent, 13);
  assert.equal(policy.companyRatePercent, 3);
  assert.equal(policy.totalRatePercent, 16);
});

test("no money field moved: the «أوردر» row still serialises the same cents", () => {
  const finance = readers.settlementFinancials(orderRow);
  assert.equal(finance.price, "5.00", "external order value");
  assert.equal(finance.company, "0.15", "company share");
  assert.equal(finance.postedShare, "0.85", "downloader share");
  assert.equal(finance.executorDebit, "1.00", "executor debit");
  assert.equal(finance.captain, "0.00", "the fare never credits the executor");
  assert.equal(finance.settlementMode, undefined, "the serializer adds no settlement semantics");
  assert.equal(finance.policyRateBps.producer, 1700, "display bps exposed for note reuse");
  assert.equal(finance.policyRateBps.company, 300);
  assert.equal(finance.policyRateBps.orderKind, "order");
});

test("ledger notes of an «أوردر» row read 17% for the downloader share", () => {
  const note = readers.canonicalLedgerNote(ledgerEntry(orderRow, "commission_producer", 85));
  assert.match(note, /17%/);
  assert.match(note, /الأوردر/);
  assert.doesNotMatch(note, /13%/, "the stale normal label must be gone");
});

test("ledger notes of an «أوردر» row read 3% for the company share", () => {
  assert.equal(readers.canonicalLedgerNote(ledgerEntry(orderRow, "commission_company", 15)), "3% من قيمة الأوردر من محفظة كابتن التنفيذ");
});

test("the executor debit note of an «أوردر» row states 17% + 3% = 20%", () => {
  assert.match(readers.canonicalLedgerNote(ledgerEntry(orderRow, "captain_fee", 100)), /17% \+ 3% = 20% لـالأوردر/);
});

test("reversal notes of an «أوردر» row read 17% after a removed 👍", () => {
  const producer = readers.canonicalLedgerNote(ledgerEntry(orderRow, "reversal_producer", -85));
  assert.match(producer, /عكس حصة المنزّل 17% من الأوردر/);
  assert.match(readers.canonicalLedgerNote(ledgerEntry(orderRow, "reversal_captain_fee", 100)), /17% \+ 3% = 20% لـالأوردر/);
});

test("normal rows keep their own wording", () => {
  assert.match(readers.canonicalLedgerNote(ledgerEntry(normalRow, "commission_producer", 65)), /حصة المنزّل: 13% من قيمة الطلب العادي/);
  assert.match(readers.canonicalLedgerNote(ledgerEntry(normalRow, "captain_fee", 80)), /13% \+ 3% = 16% لـالطلب العادي/);
});

test("a historical row settled at another rate keeps the rate that produced its cents", () => {
  const legacy = {
    ...normalRow,
    order_id: 900, settlement_id: 30, order_no: 900,
    price_cents: 1500, settlement_producer_cents: 180, settlement_company_cents: 45, settlement_captain_fee_cents: 225,
    settlement_details_json: JSON.stringify({ orderNo: 900, priceCents: 1500, orderKind: "normal", producerRateBps: 1200, companyRateBps: 300 }),
  };
  const legacyPolicy = readers.settlementFinancials(legacy).policy;
  assert.equal(legacyPolicy.producerRatePercent, 12, "the historical rate that produced 1.80 of 15.00");
  assert.equal(legacyPolicy.companyRatePercent, 3);
  assert.equal(legacyPolicy.totalRatePercent, 15);
  assert.match(readers.canonicalLedgerNote(ledgerEntry(legacy, "commission_producer", 180)), /حصة المنزّل: 12%/);
});

test("an odd price is labelled by the matching approved rate, not by a noisy ratio", () => {
  const odd = {
    ...orderRow,
    price_cents: 333, settlement_producer_cents: 57, settlement_company_cents: 10, settlement_captain_fee_cents: 67,
    settlement_details_json: JSON.stringify({ orderNo: 941, priceCents: 333, orderKind: "order", producerRateBps: 1300, companyRateBps: 300 }),
  };
  assert.equal(odd.settlement_company_cents, 10, "round(333*3%) = 10 cents");
  assert.equal(readers.settlementFinancials(odd).policy.producerRatePercent, 17, "17% reproduces 57 cents from 333");
});

test("a row without recorded price metadata keeps the snapshot label instead of inventing one", () => {
  const bare = { ...orderRow, settlement_details_json: JSON.stringify({ orderNo: 934, orderKind: "order", producerRateBps: 1300, companyRateBps: 300 }) };
  assert.equal(readers.ledgerNoteDisplayRates(ledgerEntry(bare, "commission_producer", 85), "order", { producerRateBps: 1300, companyRateBps: 300 }, null).kindProducerRateBps, undefined);
  assert.equal(readers.canonicalLedgerNote(ledgerEntry(bare, "commission_producer", 85)), "حصة المنزّل: 13% من قيمة الأوردر");
});

test("the settlements view feeds the exact split into every ledger note", () => {
  const finance = readers.settlementFinancials(orderRow);
  assert.match(readers.canonicalLedgerNote(ledgerEntry(orderRow, "commission_producer", 85), finance.policyRateBps), /17%/);
  assert.match(readers.canonicalLedgerNote(ledgerEntry(orderRow, "captain_fee", 100), finance.policyRateBps), /17% \+ 3% = 20% لـالأوردر/);
});

test("writing a NEW «أوردر» settlement already uses the order pair (finance.js prefers kind rates)", () => {
  const policy = { producerRateBps: 1300, companyRateBps: 300, specialOrderProducerRateBps: 1700, specialOrderCompanyRateBps: 300 };
  assert.match(settlementLedgerNotes("order", policy).producer, /حصة المنزّل: 17%/);
  assert.match(settlementLedgerNotes("order", policy).captain, /17% \+ 3% = 20% لـالأوردر/);
  assert.match(settlementLedgerNotes("normal", policy).producer, /حصة المنزّل: 13%/);
  assert.match(settlementLedgerNotes("normal", policy).captain, /13% \+ 3% = 16% لـالطلب العادي/);
});

test("the display helpers are wired only into the two readers, never into money paths", () => {
  const references = source.match(/settlementDisplayRateBps\(/g) || [];
  assert.equal(references.length, 6, "one definition plus five call sites, all inside the readers");
  for (const name of ["function calculateConfiguredSettlement", "function settlePendingOrder", "function cancelOrderForReactionRemoval", "function currentSettlementPolicy", "function settlementPolicyResponse"]) {
    const start = source.indexOf(name);
    assert.ok(start >= 0, `${name} exists`);
    const body = source.slice(start, source.indexOf("\n}\n", start));
    assert.doesNotMatch(body, /settlementDisplayRateBps|ledgerNoteDisplayRates|policyRateBps/, `${name} must not use display helpers`);
  }
});

test("the new helpers contain no database or wallet statement at all", () => {
  for (const forbidden of ["db.prepare(", "setSetting(", "UPDATE users", "INSERT INTO", "client.", "sendMessage"]) {
    assert.ok(!helpersSlice.includes(forbidden), `helpers must not contain ${forbidden}`);
    assert.ok(!snapshotSlice.includes(forbidden), `snapshot reader must not contain ${forbidden}`);
  }
});

test("«/api/admin/overview» states both kinds from the saved policy", () => {
  const adminOverview = sliceBetween(source, 'app.get("/api/admin/overview"', 'app.get("/api/admin/leads"', "admin overview route");
  assert.ok(adminOverview.includes("const overviewRates = settlementPolicyResponse();"), "rates are read from the saved policy");
  assert.ok(adminOverview.includes("producerWalletCredit: `${overviewRates.producerRatePercent}%`"), "normal downloader rate is derived");
  assert.ok(adminOverview.includes("producerWalletCredit: `${overviewRates.specialOrderProducerRatePercent}%`"), "order downloader rate is derived");
  assert.ok(adminOverview.includes("confirmingCaptainWalletDebit: `${overviewRates.specialOrderTotalRatePercent}%`"), "order debit is derived");
  assert.ok(!/producerWalletCredit: "\d/.test(adminOverview), "no hard-coded producer rate literal remains");
  assert.ok(!adminOverview.includes("confirmingCaptainWalletDebit: \"15%\""), "the stale 15% debit literal is gone");
  assert.ok(!adminOverview.includes("يخصمان 15%"), "the stale combined 15% sentence is gone");
  assert.ok(adminOverview.includes("الطلب العادي يخصم ${overviewRates.totalRatePercent}% والأوردر يخصم ${overviewRates.specialOrderTotalRatePercent}%"), "debt sentence splits the two kinds");
});

test("«/api/captain/overview» states both kinds from the saved policy", () => {
  const captainOverview = sliceBetween(source, 'app.get("/api/captain/overview"', 'app.post("/api/auth/login"', "captain overview route");
  assert.ok(captainOverview.includes("const captainRates = settlementPolicyResponse();"), "captain reads the saved policy");
  assert.ok(captainOverview.includes("postedRate: `${captainRates.specialOrderProducerRatePercent}%`"), "captain sees the order rate");
  assert.ok(!captainOverview.includes("postedRate: '12%'"), "the stale 12% literal is gone");
  assert.ok(!captainOverview.includes("executorDebit: '15%'"), "the stale 15% literal is gone");
});

test("the legacy ops panel states the rate of the kind it is about to settle", () => {
  assert.ok(!indexHtml.includes("خصم العمولة: 15% (12%"), "the stale one-size label is gone");
  assert.ok(indexHtml.includes("const isOrderKind=/(?:^|\\s)(?:أ?وردر|order)(?:$|\\s)/i.test(String(match.rawText||''))"), "the label detects the order kind with the server's own keyword rule");
  assert.ok(indexHtml.includes("recoverySettlement.order||{}"), "the label reads the order pair");
  assert.ok(indexHtml.includes("recoverySettlement.normalOrders||{}"), "the label reads the normal pair");
  assert.ok(indexHtml.includes("kindRules.confirmingCaptainWalletDebit"), "the stated debit comes from the saved policy");
  assert.ok(indexHtml.includes("خصم العمولة: حسب نسب المالك المحفوظة"), "an unreadable policy falls back to neutral wording, never a stale number");
  assert.ok(indexHtml.includes("const s=await api('/api/admin/overview')"), "the label source is the admin-visible overview");
});

test("finance.js keeps the normal-kind chain and only extends the order-kind chain", () => {
  const finance = fs.readFileSync("finance.js", "utf8");
  assert.ok(finance.includes(": firstFiniteNumber([rates.kindProducerRateBps, rates.producerRateBps, rates.regularProducerRateBps], defaultProducer);"), "normal branch keeps its original preference order");
  assert.ok(finance.includes(": firstFiniteNumber([rates.kindCompanyRateBps, rates.companyRateBps, rates.companyFromProducerRateBps], defaultCompany);"), "normal company branch is unchanged in effect");
  assert.ok(finance.includes("firstFiniteNumber([rates.kindProducerRateBps, rates.orderProducerRateBps, rates.specialOrderProducerRateBps, rates.producerRateBps, rates.regularProducerRateBps], defaultProducer)"), "order branch prefers its own pair");
  assert.ok(!/const producerRateBps = Number\.isFinite\(Number\(rates\.producerRateBps\)\)\n    \? Number\(rates\.producerRateBps\)/.test(finance), "the kind-blind selection is gone");
  assert.ok(!finance.includes("setSetting") && !finance.includes("require(\"better-sqlite3\")"), "finance.js stays side-effect free");
});
