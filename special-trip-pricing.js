"use strict";

const SPECIAL_TRIP_TARIFF = Object.freeze({
  thresholdKm: 25,
  baseFareUnderThreshold: 0.8455,
  perKmUnderThreshold: 0.1786,
  perMinuteUnderThreshold: 0.0456,
  baseFareOverThreshold: 0.9025,
  perKmOverThreshold: 0.19,
  perMinuteOverThreshold: 0.0475,
  minimumFare: 1.6074,
  cancellationFee: 1.14,
});

function calculateSpecialTripFare({ distanceKm, durationMin } = {}) {
  const distance = Number(distanceKm);
  const duration = Number(durationMin);
  if (!Number.isFinite(distance) || distance < 0 || distance > 10000) return { status: "invalid", reason: "distance" };
  if (!Number.isFinite(duration) || duration < 0 || duration > 100000) return { status: "invalid", reason: "duration" };
  const overThreshold = distance >= SPECIAL_TRIP_TARIFF.thresholdKm;
  const opening = overThreshold ? SPECIAL_TRIP_TARIFF.baseFareOverThreshold : SPECIAL_TRIP_TARIFF.baseFareUnderThreshold;
  const perKm = overThreshold ? SPECIAL_TRIP_TARIFF.perKmOverThreshold : SPECIAL_TRIP_TARIFF.perKmUnderThreshold;
  const perMinute = overThreshold ? SPECIAL_TRIP_TARIFF.perMinuteOverThreshold : SPECIAL_TRIP_TARIFF.perMinuteUnderThreshold;
  const distanceCharge = distance * perKm;
  const timeCharge = duration * perMinute;
  const rawFare = opening + distanceCharge + timeCharge;
  const fare = Math.max(rawFare, SPECIAL_TRIP_TARIFF.minimumFare);
  return {
    status: "quoted",
    distanceKm: distance,
    durationMin: duration,
    band: overThreshold ? "over_25km" : "under_25km",
    opening,
    perKm,
    perMinute,
    distanceCharge,
    timeCharge,
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
