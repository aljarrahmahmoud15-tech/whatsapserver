"use strict";

const SPECIAL_TRIP_TARIFF = Object.freeze({
  dayOpeningFare: 0.468,
  nightOpeningFare: 0.518,
  perKm: 0.336,
  waitingPerMinute: 0.0576,
  minimumFare: 1,
  cancellationFee: 0.5,
  roundingIncrement: 0.05,
  nightStartHour: 22,
  nightEndHour: 6,
  nightWindow: "22:00-06:00",
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isNightTime(timeValue) {
  const match = String(timeValue || "").trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return false;
  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) return false;
  return hour >= SPECIAL_TRIP_TARIFF.nightStartHour || hour < SPECIAL_TRIP_TARIFF.nightEndHour;
}

function roundFare(value, increment = SPECIAL_TRIP_TARIFF.roundingIncrement) {
  const amount = finiteNumber(value);
  const step = finiteNumber(increment);
  if (amount === null || step === null || step <= 0) return null;
  return Number((Math.round((amount + Number.EPSILON) / step) * step).toFixed(2));
}

function calculateSpecialTripFare({ distanceKm, waitingMin = 0, durationMin, tripTime, departureTime, isNight } = {}) {
  const distance = finiteNumber(distanceKm);
  const waiting = waitingMin === undefined || waitingMin === null || waitingMin === "" ? 0 : finiteNumber(waitingMin);
  if (distance === null || distance <= 0 || distance > 10000) return { status: "invalid", reason: "distance" };
  if (waiting === null || waiting < 0 || waiting > 100000) return { status: "invalid", reason: "waiting" };

  const suppliedDuration = durationMin === undefined || durationMin === null || durationMin === "" ? null : finiteNumber(durationMin);
  if (suppliedDuration !== null && (suppliedDuration < 0 || suppliedDuration > 100000)) return { status: "invalid", reason: "duration" };
  if (durationMin !== undefined && durationMin !== null && durationMin !== "" && suppliedDuration === null) return { status: "invalid", reason: "duration" };

  const night = typeof isNight === "boolean" ? isNight : isNightTime(tripTime || departureTime);
  const opening = night ? SPECIAL_TRIP_TARIFF.nightOpeningFare : SPECIAL_TRIP_TARIFF.dayOpeningFare;
  const distanceCharge = distance * SPECIAL_TRIP_TARIFF.perKm;
  const waitingCharge = waiting * SPECIAL_TRIP_TARIFF.waitingPerMinute;
  const rawFare = opening + distanceCharge + waitingCharge;
  const fareBeforeMinimum = roundFare(rawFare);
  const fare = Math.max(fareBeforeMinimum === null ? rawFare : fareBeforeMinimum, SPECIAL_TRIP_TARIFF.minimumFare);

  return {
    status: "quoted",
    calculationMode: "meter_distance_plus_waiting",
    distanceKm: distance,
    durationMin: suppliedDuration,
    waitingMin: waiting,
    period: night ? "night" : "day",
    isNight: night,
    opening,
    perKm: SPECIAL_TRIP_TARIFF.perKm,
    waitingPerMinute: SPECIAL_TRIP_TARIFF.waitingPerMinute,
    distanceCharge,
    waitingCharge,
    timeCharge: waitingCharge,
    rawFare,
    fareBeforeMinimum,
    fare,
    fareCents: Math.round(fare * 100),
    minimumFare: SPECIAL_TRIP_TARIFF.minimumFare,
    cancellationFee: SPECIAL_TRIP_TARIFF.cancellationFee,
    roundingIncrement: SPECIAL_TRIP_TARIFF.roundingIncrement,
  };
}

function specialTripTariffResponse() {
  return { ...SPECIAL_TRIP_TARIFF, roundingRule: "nearest_0.05_jod_half_up" };
}

module.exports = { SPECIAL_TRIP_TARIFF, calculateSpecialTripFare, specialTripTariffResponse, isNightTime, roundFare };
