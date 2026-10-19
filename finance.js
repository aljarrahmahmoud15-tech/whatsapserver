// Fixed settlement policy for every order kind:
// - The numeric value after "السعر" is the external order value.
// - It is never credited to the executor wallet.
// - Normal orders: 15% is credited to the captain who posted the order and 0% to the company.
// - Price orders: 20% is credited to the captain who posted the order and 0% to the company.
// - The confirming executor pays the producer share plus the company share.

const REGULAR_PRODUCER_RATE_BPS = 1500;
const SPECIAL_ORDER_PRODUCER_RATE_BPS = 2000;
const COMPANY_FROM_PRODUCER_RATE_BPS = 0;
const SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS = 0;

function calculateSettlement({
  priceCents,
  orderKind = "normal",
  regularProducerRateBps = REGULAR_PRODUCER_RATE_BPS,
  specialOrderProducerRateBps = SPECIAL_ORDER_PRODUCER_RATE_BPS,
  companyFromProducerRateBps = COMPANY_FROM_PRODUCER_RATE_BPS,
  specialOrderCompanyFromProducerRateBps = SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS,
}) {
  const externalOrderValueCents = Math.round(Number(priceCents || 0));
  if (!Number.isSafeInteger(externalOrderValueCents) || externalOrderValueCents <= 0) throw new Error("priceCents must be a positive integer");
  const normalizedKind = orderKind === "order" ? "order" : "normal";
  const producerRateBps = normalizedKind === "order" ? specialOrderProducerRateBps : regularProducerRateBps;
  const producerFeeCents = Math.round(externalOrderValueCents * producerRateBps / 10000);
  const companyRateBps = normalizedKind === "order" ? specialOrderCompanyFromProducerRateBps : companyFromProducerRateBps;
  const companyCents = Math.round(externalOrderValueCents * companyRateBps / 10000);
  const producerNetCents = producerFeeCents;
  const executorWalletCreditCents = 0;
  return {
    orderKind: normalizedKind,
    grossCents: externalOrderValueCents,
    externalOrderValueCents,
    producerRateBps,
    producerFeeCents,
    companyCents,
    producerNetCents,
    companyFeeCents: companyCents,
    captainFeeCents: companyCents,
    confirmingCaptainFeeCents: producerNetCents + companyCents,
    executorWalletCreditCents,
    // Backward-compatible field: it now represents wallet credit, never the external fare.
    captainGrossCents: executorWalletCreditCents,
  };
}

module.exports = {
  REGULAR_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS,
  calculateSettlement,
};
