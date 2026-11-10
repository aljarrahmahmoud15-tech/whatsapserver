"use strict";

// Shared low-balance policy. Wallet values are integer cents and rates are basis points.
const TOTAL_COMMISSION_BPS = 1_600; // 16% = 12% producer + 4% company
const PRODUCER_COMMISSION_BPS = 1_200;
const COMPANY_COMMISSION_BPS = 400;

function requiredCommissionCents(fareCents, totalCommissionBps = TOTAL_COMMISSION_BPS) {
  const fare = Number(fareCents);
  const rate = Number(totalCommissionBps);
  if (!Number.isSafeInteger(fare) || fare < 0) throw new RangeError("fareCents must be a non-negative integer");
  if (!Number.isSafeInteger(rate) || rate < 0) throw new RangeError("totalCommissionBps must be a non-negative integer");
  return Math.floor((fare * rate + 5_000) / 10_000);
}

function evaluateBalance({ balanceCents, requiredCents, minimumBalanceCents = 0 }) {
  const balance = Number(balanceCents);
  const required = Number(requiredCents);
  const minimum = Number(minimumBalanceCents);
  if (![balance, required, minimum].every(Number.isSafeInteger)) throw new TypeError("balance values must be safe integers");
  if (required < 0) throw new RangeError("requiredCents must be non-negative");
  const projectedBalanceCents = balance - required;
  const allowed = projectedBalanceCents >= minimum;
  return {
    allowed,
    state: allowed ? "allowed" : "insufficient_balance",
    balanceCents: balance,
    requiredCents: required,
    projectedBalanceCents,
  };
}

function isDoneMessage(body) {
  const normalized = String(body || "").replace(/[\u200e\u200f]/g, "").trim().replace(/\s+/g, " ");
  return new Set(["تم", "تم.", "تم!", "تم جاهز", "تم جاهز الآن"]).has(normalized);
}

function buildIdempotencyKey({ orderId, captainId, sourceMessageId = "" }) {
  const order = Number(orderId);
  const captain = Number(captainId);
  const source = String(sourceMessageId || "").trim();
  if (!Number.isSafeInteger(order) || order <= 0) throw new RangeError("orderId must be a positive integer");
  if (!Number.isSafeInteger(captain) || captain <= 0) throw new RangeError("captainId must be a positive integer");
  return `INSUFFICIENT-HOME-${order}-CAPTAIN-${captain}${source ? `-SOURCE-${source}` : ""}`;
}

module.exports = {
  COMPANY_COMMISSION_BPS,
  PRODUCER_COMMISSION_BPS,
  TOTAL_COMMISSION_BPS,
  buildIdempotencyKey,
  evaluateBalance,
  isDoneMessage,
  requiredCommissionCents,
};
