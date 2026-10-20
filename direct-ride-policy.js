"use strict";

const { calculateSpecialTripFare } = require("./special-trip-pricing");

const DIRECT_RIDE_STATUSES = Object.freeze([
  "requested",
  "priced",
  "rider_confirmed",
  "dispatch_pending",
  "offered",
  "assigned",
  "arrived",
  "in_trip",
  "completed",
  "cancelled",
]);

const DIRECT_RIDE_TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const DIRECT_RIDE_LOCATION_MAX_AGE_MS = 90 * 1000;
const DIRECT_RIDE_COORDINATE_EPSILON = 1e-7;

const DIRECT_RIDE_TRANSITIONS = Object.freeze({
  requested: new Set(["priced", "cancelled"]),
  priced: new Set(["rider_confirmed", "cancelled"]),
  rider_confirmed: new Set(["dispatch_pending", "cancelled"]),
  dispatch_pending: new Set(["offered", "cancelled"]),
  offered: new Set(["assigned", "dispatch_pending", "cancelled"]),
  assigned: new Set(["arrived", "cancelled"]),
  arrived: new Set(["in_trip", "cancelled"]),
  in_trip: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCoordinatePair({ lat, lng } = {}) {
  const latitude = finiteNumber(lat);
  const longitude = finiteNumber(lng);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lng: longitude };
}

function sameCoordinatePair(a, b) {
  const left = normalizeCoordinatePair(a);
  const right = normalizeCoordinatePair(b);
  if (!left || !right) return false;
  return Math.abs(left.lat - right.lat) <= DIRECT_RIDE_COORDINATE_EPSILON
    && Math.abs(left.lng - right.lng) <= DIRECT_RIDE_COORDINATE_EPSILON;
}

function haversineDistanceKm(origin, destination) {
  const from = normalizeCoordinatePair(origin);
  const to = normalizeCoordinatePair(destination);
  if (!from || !to) return null;
  const earthRadiusKm = 6371.0088;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDurationMinutes(distanceKm, averageSpeedKmh = 30) {
  const distance = finiteNumber(distanceKm);
  const speed = finiteNumber(averageSpeedKmh);
  if (distance === null || distance < 0 || speed === null || speed <= 0) return null;
  return Math.max(1, (distance / speed) * 60);
}

function normalizeRouteEstimate({ distanceKm, durationMin, origin, destination } = {}) {
  let distance = finiteNumber(distanceKm);
  let duration = finiteNumber(durationMin);
  if (distance === null && origin && destination) distance = haversineDistanceKm(origin, destination);
  if (duration === null && distance !== null) duration = estimateDurationMinutes(distance);
  if (distance === null || duration === null || distance < 0 || duration < 0 || distance > 10000 || duration > 100000) return null;
  return { distanceKm: distance, durationMin: duration };
}

function calculateDirectRideFare(route = {}) {
  const normalized = normalizeRouteEstimate(route);
  if (!normalized) return { status: "invalid", reason: "route" };
  return calculateSpecialTripFare({
    ...normalized,
    waitingMin: route.waitingMin,
    tripTime: route.tripTime,
    isNight: typeof route.isNight === "boolean" ? route.isNight : undefined,
  });
}

function isFreshLocation(record, { nowMs = Date.now(), maxAgeMs = DIRECT_RIDE_LOCATION_MAX_AGE_MS } = {}) {
  if (!record) return false;
  const latitude = finiteNumber(record.lat);
  const longitude = finiteNumber(record.lng);
  const timestamp = Date.parse(record.recordedAt || record.recorded_at || record.updatedAt || record.updated_at || "");
  if (!normalizeCoordinatePair({ lat: latitude, lng: longitude }) || !Number.isFinite(timestamp)) return false;
  return timestamp <= nowMs && nowMs - timestamp <= Math.max(1000, Number(maxAgeMs) || DIRECT_RIDE_LOCATION_MAX_AGE_MS);
}

function rankNearestCaptains(captains, origin, { nowMs = Date.now(), maxAgeMs = DIRECT_RIDE_LOCATION_MAX_AGE_MS } = {}) {
  const from = normalizeCoordinatePair(origin);
  if (!from || !Array.isArray(captains)) return [];
  return captains
    .filter((captain) => isFreshLocation(captain, { nowMs, maxAgeMs }))
    .map((captain) => ({
      ...captain,
      distanceToPickupKm: haversineDistanceKm(from, { lat: captain.lat, lng: captain.lng }),
    }))
    .filter((captain) => Number.isFinite(captain.distanceToPickupKm))
    .sort((a, b) => a.distanceToPickupKm - b.distanceToPickupKm || Number(a.userId || a.user_id || 0) - Number(b.userId || b.user_id || 0));
}

function canTransition(from, to) {
  return typeof from === "string" && typeof to === "string" && DIRECT_RIDE_TRANSITIONS[from]?.has(to) === true;
}

function isTerminalStatus(status) {
  return DIRECT_RIDE_TERMINAL_STATUSES.has(String(status || ""));
}

function finalFareForTrip({ distanceKm, durationMin } = {}) {
  return calculateDirectRideFare({ distanceKm, durationMin });
}

module.exports = {
  DIRECT_RIDE_STATUSES,
  DIRECT_RIDE_TERMINAL_STATUSES,
  DIRECT_RIDE_LOCATION_MAX_AGE_MS,
  DIRECT_RIDE_TRANSITIONS,
  normalizeCoordinatePair,
  sameCoordinatePair,
  haversineDistanceKm,
  estimateDurationMinutes,
  normalizeRouteEstimate,
  calculateDirectRideFare,
  isFreshLocation,
  rankNearestCaptains,
  canTransition,
  isTerminalStatus,
  finalFareForTrip,
};
