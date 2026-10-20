"use strict";

const assert = require("assert");
const { calculateSpecialTripFare, SPECIAL_TRIP_TARIFF, isNightTime } = require("./special-trip-pricing");

const day = calculateSpecialTripFare({ distanceKm: 10, waitingMin: 0, tripTime: "12:00" });
assert.strictEqual(day.status, "quoted");
assert.strictEqual(day.calculationMode, "meter_distance_plus_waiting");
assert.strictEqual(day.period, "day");
assert.strictEqual(day.opening, SPECIAL_TRIP_TARIFF.dayOpeningFare);
assert.strictEqual(day.fare, 3.85);
assert.strictEqual(day.fareCents, 385);

const night = calculateSpecialTripFare({ distanceKm: 10, waitingMin: 0, tripTime: "23:00" });
assert.strictEqual(night.period, "night");
assert.strictEqual(night.opening, 0.518);
assert.strictEqual(night.fare, 3.9);

const withWaiting = calculateSpecialTripFare({ distanceKm: 10, waitingMin: 10, tripTime: "12:00" });
assert.strictEqual(withWaiting.waitingCharge, 0.576);
assert.strictEqual(withWaiting.fare, 4.4);
assert.strictEqual(withWaiting.fare, calculateSpecialTripFare({ distanceKm: 10, waitingMin: 10, durationMin: 1000, tripTime: "12:00" }).fare);

const thirtyKm = calculateSpecialTripFare({ distanceKm: 30, tripTime: "12:00" });
assert.strictEqual(thirtyKm.rawFare, 10.548);
assert.strictEqual(thirtyKm.fare, 10.55);
assert.strictEqual(thirtyKm.fareCents, 1055);
assert.strictEqual(calculateSpecialTripFare({ distanceKm: 30, tripTime: "23:00" }).fare, 10.6);

const minimum = calculateSpecialTripFare({ distanceKm: 0, tripTime: "12:00" });
assert.strictEqual(minimum.fare, 1);
assert.strictEqual(minimum.fareCents, 100);

assert.strictEqual(isNightTime("22:00"), true);
assert.strictEqual(isNightTime("05:59"), true);
assert.strictEqual(isNightTime("06:00"), false);
assert.strictEqual(isNightTime("21:59"), false);
assert.strictEqual(calculateSpecialTripFare({ distanceKm: -1 }).status, "invalid");
assert.strictEqual(calculateSpecialTripFare({ distanceKm: 1, waitingMin: -1 }).reason, "waiting");

console.log("special trip pricing tests passed");
