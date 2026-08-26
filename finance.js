const REGULAR_PRODUCER_RATE_BPS = 1500;
const SPECIAL_ORDER_PRODUCER_RATE_BPS = 2000;
const COMPANY_FROM_PRODUCER_RATE_BPS = 1500;

function calculateSettlement({
  priceCents,
  orderKind = "normal",
  regularProducerRateBps = REGULAR_PRODUCER_RATE_BPS,
  specialOrderProducerRateBps = SPECIAL_ORDER_PRODUCER_RATE_BPS,
  companyFromProducerRateBps = COMPANY_FROM_PRODUCER_RATE_BPS,
}) {
  const grossCents = Math.round(Number(priceCents || 0));
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) throw new Error("priceCents must be a positive integer");
  const normalizedKind = orderKind === "order" ? "order" : "normal";
  const producerRateBps = normalizedKind === "order" ? specialOrderProducerRateBps : regularProducerRateBps;
  const producerFeeCents = Math.round(grossCents * producerRateBps / 10000);
  const companyCents = Math.round(producerFeeCents * companyFromProducerRateBps / 10000);
  const producerNetCents = producerFeeCents - companyCents;
  return {
    orderKind: normalizedKind,
    grossCents,
    producerRateBps,
    producerFeeCents,
    companyCents,
    producerNetCents,
    captainFeeCents: producerFeeCents,
    captainGrossCents: grossCents,
  };
}

module.exports = {
  REGULAR_PRODUCER_RATE_BPS,
  SPECIAL_ORDER_PRODUCER_RATE_BPS,
  COMPANY_FROM_PRODUCER_RATE_BPS,
  calculateSettlement,
};
