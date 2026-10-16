// Settlement policy by order kind:
// - The numeric value after "السعر" is the external order value.
// - It is never credited to the executor wallet.
// - Normal orders: 13% to the captain who posted the order, 2% to the company,
//   and a 15% total debit from the confirming executor wallet.
// - "order" / "اوردر" orders: 16% to the posted-order captain,
//   4% to the company, and a 20% debit from the confirming executor.
const REGULAR_PRODUCER_RATE_BPS = 1300;
const COMPANY_FROM_PRODUCER_RATE_BPS = 200;
const ORDER_PRODUCER_RATE_BPS = 1600;
const ORDER_COMPANY_RATE_BPS = 400;
// Legacy exports retained for callers that still pass the former percentage knobs.
const SPECIAL_ORDER_PRODUCER_RATE_BPS = ORDER_PRODUCER_RATE_BPS;
const SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS = ORDER_COMPANY_RATE_BPS;

function calculateSettlement({
  priceCents,
  orderKind = "normal",
  regularProducerRateBps = REGULAR_PRODUCER_RATE_BPS,
  specialOrderProducerRateBps = ORDER_PRODUCER_RATE_BPS,
  companyFromProducerRateBps = COMPANY_FROM_PRODUCER_RATE_BPS,
  specialOrderCompanyFromProducerRateBps = ORDER_COMPANY_RATE_BPS,
}) {
  const externalOrderValueCents = Math.round(Number(priceCents || 0));
  if (!Number.isSafeInteger(externalOrderValueCents) || externalOrderValueCents <= 0) throw new Error("priceCents must be a positive integer");
  const normalizedKind = orderKind === "order" ? "order" : "normal";

  if (normalizedKind === "order") {
    const producerFeeCents = Math.round(externalOrderValueCents * specialOrderProducerRateBps / 10000);
    const companyCents = Math.round(externalOrderValueCents * specialOrderCompanyFromProducerRateBps / 10000);
    return {
      orderKind: normalizedKind,
      grossCents: externalOrderValueCents,
      externalOrderValueCents,
      producerRateBps: specialOrderProducerRateBps,
      producerFeeCents,
      companyCents,
      producerNetCents: producerFeeCents,
      companyFeeCents: companyCents,
      captainFeeCents: companyCents,
      confirmingCaptainFeeCents: producerFeeCents + companyCents,
      executorWalletCreditCents: 0,
      // Backward-compatible field: it represents wallet credit, never the external fare.
      captainGrossCents: 0,
      settlementMode: "percentage_order",
    };
  }

  const producerFeeCents = Math.round(externalOrderValueCents * regularProducerRateBps / 10000);
  const companyCents = Math.round(externalOrderValueCents * companyFromProducerRateBps / 10000);
  const producerNetCents = producerFeeCents;
  const executorWalletCreditCents = 0;
  return {
    orderKind: normalizedKind,
    grossCents: externalOrderValueCents,
    externalOrderValueCents,
    producerRateBps: regularProducerRateBps,
    producerFeeCents,
    companyCents,
    producerNetCents,
    companyFeeCents: companyCents,
    captainFeeCents: companyCents,
    confirmingCaptainFeeCents: producerNetCents + companyCents,
    executorWalletCreditCents,
    // Backward-compatible field: it represents wallet credit, never the external fare.
    captainGrossCents: executorWalletCreditCents,
    settlementMode: "percentage_normal_order",
  };
}

function formatRatePercent(rateBps) {
  const value = Number(rateBps || 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function settlementLedgerNotes(orderKind = "normal", rates = {}) {
  const normalizedKind = orderKind === "order" ? "order" : "normal";
  const defaultProducer = normalizedKind === "order" ? ORDER_PRODUCER_RATE_BPS : REGULAR_PRODUCER_RATE_BPS;
  const defaultCompany = normalizedKind === "order" ? ORDER_COMPANY_RATE_BPS : COMPANY_FROM_PRODUCER_RATE_BPS;
  const producerRateBps = Number.isFinite(Number(rates.producerRateBps))
    ? Number(rates.producerRateBps)
    : Number.isFinite(Number(rates.regularProducerRateBps))
      ? Number(rates.regularProducerRateBps)
      : defaultProducer;
  const companyRateBps = Number.isFinite(Number(rates.companyRateBps))
    ? Number(rates.companyRateBps)
    : Number.isFinite(Number(rates.companyFromProducerRateBps))
      ? Number(rates.companyFromProducerRateBps)
      : defaultCompany;
  const producerRate = formatRatePercent(producerRateBps);
  const companyRate = formatRatePercent(companyRateBps);
  const totalRate = formatRatePercent(producerRateBps + companyRateBps);
  const kindLabel = normalizedKind === "order" ? "الأوردر" : "الطلب العادي";
  return {
    company: `${companyRate}% من قيمة ${kindLabel} من محفظة كابتن التنفيذ`,
    producer: `حصة المنزّل: ${producerRate}% من قيمة ${kindLabel}`,
    captain: `خصم حصة المنزّل والشركة من محفظة كابتن التنفيذ (${producerRate}% + ${companyRate}% = ${totalRate}% لـ${kindLabel})`,
    companyBot: `خصم حصة ${kindLabel} من محفظة الشركة لأن البوت نفذ الطلب (${producerRate}% + ${companyRate}% = ${totalRate}%)`,
    reversalCompany: `عكس حصة الشركة ${companyRate}% من ${kindLabel} بعد إزالة 👍`,
    reversalProducer: `عكس حصة المنزّل ${producerRate}% من ${kindLabel} بعد إزالة 👍`,
    reversalCaptain: `إعادة حصة المنزّل والشركة (${producerRate}% + ${companyRate}% = ${totalRate}% لـ${kindLabel}) بعد إزالة 👍`,
  };
}

module.exports = {
  REGULAR_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS,
  ORDER_PRODUCER_RATE_BPS,
  ORDER_COMPANY_RATE_BPS,
  calculateSettlement,
  settlementLedgerNotes,
};
