// Settlement policy by order kind:
// - The numeric value after "السعر" is the external order value.
// - It is never credited to the executor wallet.
// - Normal orders: 12.5% to the captain who posted the order, 2.5% to the company,
//   and a 15% total debit from the confirming executor wallet.
// - "order" / "اوردر" orders use the same 12.5% captain + 2.5% company split,
//   with a 15% total debit from the confirming executor.
const REGULAR_PRODUCER_RATE_BPS = 1250;
const COMPANY_FROM_PRODUCER_RATE_BPS = 250;
const ORDER_PRODUCER_RATE_BPS = 1250;
const ORDER_COMPANY_RATE_BPS = 250;
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

function settlementLedgerNotes(orderKind = "normal") {
  if (orderKind === "order") {
    return {
      company: "2.5% من قيمة الأوردر من محفظة كابتن التنفيذ",
      producer: "حصة المنزّل: 12.5% من قيمة الأوردر",
      captain: "خصم حصة المنزّل والشركة من محفظة كابتن التنفيذ (12.5% + 2.5% = 15% للأوردر)",
      companyBot: "خصم حصة الأوردر من محفظة الشركة لأن البوت نفذ الطلب (12.5% + 2.5% = 15%)",
      reversalCompany: "عكس حصة الشركة 2.5% من الأوردر بعد إزالة 👍",
      reversalProducer: "عكس حصة المنزّل 12.5% من الأوردر بعد إزالة 👍",
      reversalCaptain: "إعادة حصة المنزّل والشركة (12.5% + 2.5% = 15% للأوردر) بعد إزالة 👍",
    };
  }
  return {
    company: "2.5% من قيمة الطلب العادي من محفظة كابتن التنفيذ",
    producer: "حصة المنزّل: 12.5% من قيمة الطلب العادي",
    captain: "خصم حصة المنزّل والشركة من محفظة كابتن التنفيذ (12.5% + 2.5% = 15% للطلب العادي)",
    companyBot: "خصم حصة الطلب العادي من محفظة الشركة لأن البوت نفذ الطلب (12.5% + 2.5% = 15%)",
    reversalCompany: "عكس حصة الشركة 2.5% من الطلب العادي بعد إزالة 👍",
    reversalProducer: "عكس حصة المنزّل 12.5% من الطلب العادي بعد إزالة 👍",
    reversalCaptain: "إعادة حصة المنزّل والشركة (12.5% + 2.5% = 15% للطلب العادي) بعد إزالة 👍",
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
