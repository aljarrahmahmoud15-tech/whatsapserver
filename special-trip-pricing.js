"use strict";

const SPECIAL_TRIP_TARIFF = Object.freeze({
  thresholdKm: 25,
  baseFareUnderThreshold: 0.8455,
  perKmUnderThreshold: 0.1786,
  baseFareOverThreshold: 0.9025,
  perKmOverThreshold: 0.19,
  minimumFare: 1.6074,
  cancellationFee: 1.14,
});

function calculateSpecialTripFare({ distanceKm, durationMin } = {}) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance < 0 || distance > 10000) return { status: "invalid", reason: "distance" };
  const overThreshold = distance >= SPECIAL_TRIP_TARIFF.thresholdKm;
  const opening = overThreshold ? SPECIAL_TRIP_TARIFF.baseFareOverThreshold : SPECIAL_TRIP_TARIFF.baseFareUnderThreshold;
  const perKm = overThreshold ? SPECIAL_TRIP_TARIFF.perKmOverThreshold : SPECIAL_TRIP_TARIFF.perKmUnderThreshold;
  const distanceCharge = distance * perKm;
  const rawFare = opening + distanceCharge;
  const fare = Math.max(rawFare, SPECIAL_TRIP_TARIFF.minimumFare);
  const suppliedDuration = durationMin === undefined || durationMin === null || durationMin === "" ? null : Number(durationMin);
  if (suppliedDuration !== null && (!Number.isFinite(suppliedDuration) || suppliedDuration < 0 || suppliedDuration > 100000)) return { status: "invalid", reason: "duration" };
  return {
    status: "quoted",
    calculationMode: "distance_only",
    distanceKm: distance,
    durationMin: suppliedDuration,
    band: overThreshold ? "over_25km" : "under_25km",
    opening,
    perKm,
    distanceCharge,
    timeCharge: 0,
    rawFare,
    fare,
    fareCents: Math.round(fare * 100),
    minimumFare: SPECIAL_TRIP_TARIFF.minimumFare,
    cancellationFee: SPECIAL_TRIP_TARIFF.cancellationFee,
  };
}

function specialTripTariffResponse() {
  return { ...SPECIAL_TRIP_TARIFF };
}

module.exports = { SPECIAL_TRIP_TARIFF, calculateSpecialTripFare, specialTripTariffResponse };
