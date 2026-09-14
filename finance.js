// Shared-captain settlement policy: the captain who posts the order receives
// 12%, while the captain who confirms it pays 12% to that poster plus 4% to
// the company (16% total from the confirming captain's wallet).
const REGULAR_PRODUCER_RATE_BPS = 1200;
const SPECIAL_ORDER_PRODUCER_RATE_BPS = 1200;
const COMPANY_FROM_PRODUCER_RATE_BPS = 400;
const SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS = 400;

function calculateSettlement({
  priceCents,
  orderKind = "normal",
  regularProducerRateBps = REGULAR_PRODUCER_RATE_BPS,
  specialOrderProducerRateBps = SPECIAL_ORDER_PRODUCER_RATE_BPS,
  companyFromProducerRateBps = COMPANY_FROM_PRODUCER_RATE_BPS,
  specialOrderCompanyFromProducerRateBps = SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS,
}) {
  const grossCents = Math.round(Number(priceCents || 0));
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) throw new Error("priceCents must be a positive integer");
  const normalizedKind = orderKind === "order" ? "order" : "normal";
  const producerRateBps = normalizedKind === "order" ? specialOrderProducerRateBps : regularProducerRateBps;
  const producerFeeCents = Math.round(grossCents * producerRateBps / 10000);
  const companyRateBps = normalizedKind === "order" ? specialOrderCompanyFromProducerRateBps : companyFromProducerRateBps;
  const companyCents = Math.round(grossCents * companyRateBps / 10000);
  const producerNetCents = producerFeeCents;
  return {
    orderKind: normalizedKind,
    grossCents,
    producerRateBps,
    producerFeeCents,
    companyCents,
    producerNetCents,
    captainFeeCents: companyCents,
    confirmingCaptainFeeCents: producerNetCents + companyCents,
    captainGrossCents: grossCents,
  };
}

module.exports = {
  REGULAR_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS,
  calculateSettlement,
};
