"use strict";

const assert = require("assert");
const { calculateFare } = require("./pricing");

function cents(input) {
  return calculateFare(input).priceCents;
}

assert.equal(cents({ serviceType: "order" }), 500);
assert.equal(cents({ serviceType: "passenger", distanceKm: 90 }), null);
assert.equal(cents({ serviceType: "passenger", distanceKm: 150 }), null);
assert.equal(cents({ serviceType: "airport" }), 2500);
assert.equal(cents({ serviceType: "passenger", isAirport: true, distanceKm: 20 }), 2500);
assert.equal(calculateFare({ serviceType: "passenger" }).status, "manual_required");
assert.equal(calculateFare({ serviceType: "passenger", distanceKm: 90 }).ruleKey, "passenger_owner_quote");
assert.equal(calculateFare({ serviceType: "full-car" }).status, "manual_required");
console.log("pricing policy tests passed");
