// Settlement policy by order kind:
// - The numeric value after "السعر" is the external order value.
// - It is never credited to the executor wallet.
// - Normal orders: 13% to the captain who posted the order, 2% to the company,
//   and a 15% total debit from the confirming executor wallet.
// - "order" / "اوردر" orders: fixed +0.85 JOD to the posted-order captain,
//   fixed +0.15 JOD to the company, and fixed -1.00 JOD from the executor.
const REGULAR_PRODUCER_RATE_BPS = 1300;
const COMPANY_FROM_PRODUCER_RATE_BPS = 200;
// Legacy exports retained for callers that still pass the former percentage knobs.
// They are intentionally ignored for fixed-value order settlements.
const SPECIAL_ORDER_PRODUCER_RATE_BPS = 1300;
const SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS = 200;
const ORDER_FIXED_PRODUCER_CENTS = 85;
const ORDER_FIXED_COMPANY_CENTS = 15;
const ORDER_FIXED_EXECUTOR_DEBIT_CENTS = 100;

function calculateSettlement({
  priceCents,
  orderKind = "normal",
  regularProducerRateBps = REGULAR_PRODUCER_RATE_BPS,
  specialOrderProducerRateBps = SPECIAL_ORDER_PRODUCER_RATE_BPS,
  companyFromProducerRateBps = COMPANY_FROM_PRODUCER_RATE_BPS,
  specialOrderCompanyFromProducerRateBps = SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS,
}) {
  void specialOrderProducerRateBps;
  void specialOrderCompanyFromProducerRateBps;
  const externalOrderValueCents = Math.round(Number(priceCents || 0));
  if (!Number.isSafeInteger(externalOrderValueCents) || externalOrderValueCents <= 0) throw new Error("priceCents must be a positive integer");
  const normalizedKind = orderKind === "order" ? "order" : "normal";

  if (normalizedKind === "order") {
    return {
      orderKind: normalizedKind,
      grossCents: externalOrderValueCents,
      externalOrderValueCents,
      producerRateBps: null,
      producerFeeCents: ORDER_FIXED_PRODUCER_CENTS,
      companyCents: ORDER_FIXED_COMPANY_CENTS,
      producerNetCents: ORDER_FIXED_PRODUCER_CENTS,
      companyFeeCents: ORDER_FIXED_COMPANY_CENTS,
      captainFeeCents: ORDER_FIXED_COMPANY_CENTS,
      confirmingCaptainFeeCents: ORDER_FIXED_EXECUTOR_DEBIT_CENTS,
      executorWalletCreditCents: 0,
      // Backward-compatible field: it represents wallet credit, never the external fare.
      captainGrossCents: 0,
      settlementMode: "fixed_order_values",
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

module.exports = {
  REGULAR_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS,
  ORDER_FIXED_PRODUCER_CENTS,
  ORDER_FIXED_COMPANY_CENTS,
  ORDER_FIXED_EXECUTOR_DEBIT_CENTS,
  calculateSettlement,
};
