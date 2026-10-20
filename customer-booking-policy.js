"use strict";

const DEFAULT_CUSTOMER_BOOKING_POLICY = Object.freeze({
  version: 1,
  enabled: true,
  approvalMode: "owner",
  publishMode: "manual",
  ownerNotification: true,
  passengerDistanceMode: "owner_quote",
});

function normalizeCustomerBookingPolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    version: 1,
    enabled: source.enabled !== false,
    approvalMode: "owner",
    publishMode: "manual",
    ownerNotification: source.ownerNotification !== false,
    passengerDistanceMode: "owner_quote",
  };
}

function customerBookingPolicyResponse(policy = DEFAULT_CUSTOMER_BOOKING_POLICY) {
  const normalized = normalizeCustomerBookingPolicy(policy);
  return {
    ...normalized,
    labels: {
      enabled: "استقبال طلبات الراكب والأوردر",
      approvalMode: "موافقة المالك قبل النشر",
      publishMode: "نشر يدوي من V27",
      passengerDistanceMode: "تثبيت السعر من المالك عند المراجعة",
    },
  };
}

module.exports = {
  DEFAULT_CUSTOMER_BOOKING_POLICY,
  normalizeCustomerBookingPolicy,
  customerBookingPolicyResponse,
};
