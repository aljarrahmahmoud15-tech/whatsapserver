"use strict";

const assert = require("assert");
const {
  DEFAULT_SPECIAL_BOOKING_POLICY,
  normalizeSpecialBookingPolicy,
  specialBookingPolicyResponse,
  isSpecialBookingKind,
} = require("./special-booking-policy");

assert.equal(DEFAULT_SPECIAL_BOOKING_POLICY.approvalMode, "owner_and_customer");
assert.equal(DEFAULT_SPECIAL_BOOKING_POLICY.priceMode, "tariff");
assert.equal(normalizeSpecialBookingPolicy({ approvalMode: "owner", enabled: false }).approvalMode, "owner");
assert.equal(normalizeSpecialBookingPolicy({ approvalMode: "unsupported" }).approvalMode, "owner_and_customer");
assert.equal(specialBookingPolicyResponse({ priceMode: "tariff" }).labels.priceMode, "التعرفة الرسمية · فتحة + كيلومتر + انتظار");
assert.equal(isSpecialBookingKind("full-car"), true);
assert.equal(isSpecialBookingKind("special_booking"), true);
assert.equal(isSpecialBookingKind("normal"), false);
console.log("special booking policy tests passed");
