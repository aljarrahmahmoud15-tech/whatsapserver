"use strict";

const assert = require("assert");
const { calculateFare } = require("./pricing");

function cents(input) {
  return calculateFare(input).priceCents;
}

assert.equal(cents({ serviceType: "order" }), 500);
assert.equal(cents({ serviceType: "passenger", distanceKm: 90 }), 500);
assert.equal(cents({ serviceType: "passenger", distanceKm: 91 }), 600);
assert.equal(cents({ serviceType: "passenger", distanceKm: 105 }), 600);
assert.equal(cents({ serviceType: "passenger", distanceKm: 106 }), 700);
assert.equal(cents({ serviceType: "passenger", distanceKm: 150 }), 900);
assert.equal(cents({ serviceType: "passenger", distanceKm: 150.1 }), 1500);
assert.equal(cents({ serviceType: "airport" }), 2500);
assert.equal(cents({ serviceType: "passenger", isAirport: true, distanceKm: 20 }), 2500);
assert.equal(calculateFare({ serviceType: "passenger" }).status, "distance_required");
assert.equal(calculateFare({ serviceType: "full-car" }).status, "manual_required");
console.log("pricing policy tests passed");
