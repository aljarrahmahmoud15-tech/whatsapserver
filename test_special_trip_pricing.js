"use strict";

const assert = require("assert");
const { calculateSpecialTripFare, SPECIAL_TRIP_TARIFF } = require("./special-trip-pricing");

const short = calculateSpecialTripFare({ distanceKm: 10, durationMin: 10 });
assert.strictEqual(short.status, "quoted");
assert.strictEqual(short.calculationMode, "distance_only");
assert.strictEqual(short.band, "under_25km");
assert(Math.abs(short.opening - SPECIAL_TRIP_TARIFF.baseFareUnderThreshold) < 1e-9);
assert(short.fare >= SPECIAL_TRIP_TARIFF.minimumFare);
assert.strictEqual(short.timeCharge, 0);
assert.strictEqual(short.fare, calculateSpecialTripFare({ distanceKm: 10, durationMin: 1000 }).fare);

const boundary = calculateSpecialTripFare({ distanceKm: 25, durationMin: 20 });
assert.strictEqual(boundary.band, "over_25km");
assert.strictEqual(boundary.opening, SPECIAL_TRIP_TARIFF.baseFareOverThreshold);

const invalid = calculateSpecialTripFare({ distanceKm: -1, durationMin: 10 });
assert.strictEqual(invalid.status, "invalid");
assert.strictEqual(calculateSpecialTripFare({ distanceKm: 10 }).status, "quoted");

console.log("special trip pricing tests passed");
