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
  return { status: "manual_required", serviceType: "passenger", ruleKey: "passenger_owner_quote", priceCents: null, priceJod: null, currency: "JOD" };
}

function farePolicyResponse(policy = DEFAULT_FARE_POLICY) {
  return {
    version: policy.version,
    currency: policy.currency,
    rules: {
      order: { fixedJod: policy.order.fixedCents / 100, label: "أوردر" },
      passenger: {
        priceMode: "owner_quote",
        label: "راكب · سعر يثبته المالك",
      },
      airport: { fixedJod: policy.airport.fixedCents / 100, label: "المطار" },
      fullCar: { fixedJod: null, label: "طلب رحلة ذكية · حساب بالكيلومتر" },
    },
  };
}

module.exports = { DEFAULT_FARE_POLICY, calculateFare, farePolicyResponse, normalizeServiceType };
