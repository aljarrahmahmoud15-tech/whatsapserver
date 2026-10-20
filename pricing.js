"use strict";

const DEFAULT_FARE_POLICY = Object.freeze({
  version: 1,
  currency: "JOD",
  order: Object.freeze({ fixedCents: 500 }),
  airport: Object.freeze({ fixedCents: 2500 }),
  passenger: Object.freeze({
    baseDistanceKm: 90,
    baseCents: 500,
    incrementKm: 15,
    incrementCents: 100,
    longDistanceThresholdKm: 150,
    longDistanceFixedCents: 1500,
  }),
  fullCar: Object.freeze({ fixedCents: null }),
});

function normalizeServiceType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["order", "اوردر", "أوردر"].includes(text)) return "order";
  if (["passenger", "normal", "راكب", "راكبة", "طلب عادي"].includes(text)) return "passenger";
  if (["airport", "مطار", "استقبال مطار", "المطار"].includes(text)) return "airport";
  if (["full-car", "full_car", "fullcar", "سيارة كاملة", "سياره كامله"].includes(text)) return "full_car";
  return text || "passenger";
}

function normalizedDistanceKm(value) {
  if (value === undefined || value === null || value === "") return null;
  const distance = Number(String(value).replace(",", "."));
  if (!Number.isFinite(distance) || distance < 0 || distance > 10000) return NaN;
  return distance;
}

function quote(priceCents, serviceType, ruleKey, extra = {}) {
  return {
    status: "quoted",
    serviceType,
    ruleKey,
    priceCents,
    priceJod: priceCents / 100,
    currency: "JOD",
    ...extra,
  };
}

function calculateFare({ serviceType = "passenger", distanceKm, isAirport = false } = {}, policy = DEFAULT_FARE_POLICY) {
  const normalizedType = normalizeServiceType(serviceType);
  const airportTrip = Boolean(isAirport) || normalizedType === "airport";
  if (airportTrip) return quote(policy.airport.fixedCents, "airport", "airport_fixed");
  if (normalizedType === "order") return quote(policy.order.fixedCents, "order", "order_fixed");
  if (normalizedType === "full_car") {
    return { status: "manual_required", serviceType: "full_car", ruleKey: "full_car_manual", priceCents: null, priceJod: null, currency: "JOD" };
  }

  const distance = normalizedDistanceKm(distanceKm);
  if (Number.isNaN(distance)) return { status: "invalid", serviceType: "passenger", error: "distanceKm must be a number between 0 and 10000" };
  if (distance === null) return { status: "distance_required", serviceType: "passenger", ruleKey: "passenger_distance_required", currency: "JOD" };
  if (distance <= policy.passenger.baseDistanceKm) {
    return quote(policy.passenger.baseCents, "passenger", "passenger_base", { distanceKm: distance });
  }
  if (distance > policy.passenger.longDistanceThresholdKm) {
    return quote(policy.passenger.longDistanceFixedCents, "passenger", "passenger_over_150_fixed", { distanceKm: distance });
  }
  const increments = Math.ceil((distance - policy.passenger.baseDistanceKm) / policy.passenger.incrementKm);
  return quote(policy.passenger.baseCents + increments * policy.passenger.incrementCents, "passenger", "passenger_distance_step", { distanceKm: distance, increments });
}

function farePolicyResponse(policy = DEFAULT_FARE_POLICY) {
  return {
    version: policy.version,
    currency: policy.currency,
    rules: {
      order: { fixedJod: policy.order.fixedCents / 100, label: "أوردر" },
      passenger: {
        baseDistanceKm: policy.passenger.baseDistanceKm,
        baseJod: policy.passenger.baseCents / 100,
        incrementKm: policy.passenger.incrementKm,
        incrementJod: policy.passenger.incrementCents / 100,
        overDistanceKm: policy.passenger.longDistanceThresholdKm,
        overDistanceFixedJod: policy.passenger.longDistanceFixedCents / 100,
        label: "راكب",
      },
      airport: { fixedJod: policy.airport.fixedCents / 100, label: "المطار" },
      fullCar: { fixedJod: null, label: "حجز خاص · تسعير يدوي" },
    },
  };
}

module.exports = { DEFAULT_FARE_POLICY, calculateFare, farePolicyResponse, normalizeServiceType };
