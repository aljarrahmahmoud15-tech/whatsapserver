"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateDirectRideFare,
  canTransition,
  haversineDistanceKm,
  isFreshLocation,
  normalizeCoordinatePair,
  rankNearestCaptains,
} = require("./direct-ride-policy");

test("normalizes valid coordinate pairs and rejects invalid coordinates", () => {
  assert.deepEqual(normalizeCoordinatePair({ lat: 31.95, lng: 35.91 }), { lat: 31.95, lng: 35.91 });
  assert.equal(normalizeCoordinatePair({ lat: 91, lng: 35 }), null);
  assert.equal(normalizeCoordinatePair({ lat: 31, lng: "x" }), null);
});

test("calculates a route estimate and applies the official meter tariff", () => {
  const quote = calculateDirectRideFare({ distanceKm: 12, durationMin: 20 });
  assert.equal(quote.status, "quoted");
  assert.equal(quote.fareCents, 450);
  assert.equal(calculateDirectRideFare({ distanceKm: 12, durationMin: 1000 }).fareCents, 450);
  const minimum = calculateDirectRideFare({ distanceKm: 0, durationMin: 0 });
  assert.equal(minimum.fareCents, 100);
});

test("can estimate a route from two coordinates when duration is missing", () => {
  const distance = haversineDistanceKm({ lat: 31.9539, lng: 35.9106 }, { lat: 31.9632, lng: 35.9304 });
  const quote = calculateDirectRideFare({ origin: { lat: 31.9539, lng: 35.9106 }, destination: { lat: 31.9632, lng: 35.9304 } });
  assert.ok(distance > 1);
  assert.equal(quote.status, "quoted");
  assert.ok(quote.durationMin > 0);
});

test("ranks only active locations that are fresh and nearest", () => {
  const nowMs = Date.parse("2026-10-20T10:00:00.000Z");
  const ranked = rankNearestCaptains([
    { userId: 3, lat: 31.954, lng: 35.911, recordedAt: "2026-10-20T09:59:40.000Z" },
    { userId: 2, lat: 31.9545, lng: 35.9115, recordedAt: "2026-10-20T09:59:30.000Z" },
    { userId: 1, lat: 31.954, lng: 35.911, recordedAt: "2026-10-20T09:57:00.000Z" },
  ], { lat: 31.9539, lng: 35.9106 }, { nowMs });
  assert.deepEqual(ranked.map((item) => item.userId), [3, 2]);
  assert.ok(ranked[0].distanceToPickupKm < ranked[1].distanceToPickupKm);
});

test("enforces the direct ride lifecycle transitions", () => {
  assert.equal(canTransition("priced", "rider_confirmed"), true);
  assert.equal(canTransition("assigned", "in_trip"), false);
  assert.equal(canTransition("in_trip", "completed"), true);
  assert.equal(canTransition("completed", "assigned"), false);
});

test("location freshness accepts a timestamp within the configured window", () => {
  const nowMs = Date.parse("2026-10-20T10:00:00.000Z");
  assert.equal(isFreshLocation({ lat: 31, lng: 35, recordedAt: "2026-10-20T09:59:20.000Z" }, { nowMs }), true);
  assert.equal(isFreshLocation({ lat: 31, lng: 35, recordedAt: "2026-10-20T09:57:00.000Z" }, { nowMs }), false);
});
