// Fixed settlement policy for every order kind:
// - The numeric value after "السعر" is the external order value.
// - It is never credited to the executor wallet.
// - 12% is credited to the captain who posted the order.
// - 3% is credited to the company.
// - 15% total is debited from the confirming executor wallet.
const REGULAR_PRODUCER_RATE_BPS = 1200;
const SPECIAL_ORDER_PRODUCER_RATE_BPS = 1200;
const COMPANY_FROM_PRODUCER_RATE_BPS = 300;
const SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS = 300;

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
