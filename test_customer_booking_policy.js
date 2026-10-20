"use strict";

const assert = require("assert");
const {
  DEFAULT_CUSTOMER_BOOKING_POLICY,
  normalizeCustomerBookingPolicy,
  customerBookingPolicyResponse,
} = require("./customer-booking-policy");

const defaults = normalizeCustomerBookingPolicy(DEFAULT_CUSTOMER_BOOKING_POLICY);
assert.equal(defaults.enabled, true);
assert.equal(defaults.approvalMode, "owner");
assert.equal(defaults.publishMode, "manual");
assert.equal(defaults.passengerDistanceMode, "owner_quote");
assert.equal(defaults.ownerNotification, true);

const disabled = normalizeCustomerBookingPolicy({ enabled: false, ownerNotification: false, approvalMode: "auto", publishMode: "automatic" });
assert.equal(disabled.enabled, false);
assert.equal(disabled.ownerNotification, false);
assert.equal(disabled.approvalMode, "owner");
assert.equal(disabled.publishMode, "manual");

const response = customerBookingPolicyResponse(defaults);
assert.equal(response.labels.publishMode, "نشر يدوي من V27");
assert.equal(response.labels.passengerDistanceMode, "تثبيت المسافة والسعر عند المراجعة");

console.log("customer booking policy tests passed");
