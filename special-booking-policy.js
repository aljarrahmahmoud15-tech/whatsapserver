"use strict";

const APPROVAL_MODES = Object.freeze({
  owner: "owner",
  customer: "customer",
  owner_and_customer: "owner_and_customer",
  auto: "auto",
});

const PUBLISH_MODES = Object.freeze({
  after_owner_approval: "after_owner_approval",
  manual: "manual",
});

const PRICE_MODES = Object.freeze({
  manual: "manual",
  tariff: "tariff",
});

const DEFAULT_SPECIAL_BOOKING_POLICY = Object.freeze({
  version: 1,
  enabled: true,
  approvalMode: APPROVAL_MODES.owner_and_customer,
  publishMode: PUBLISH_MODES.after_owner_approval,
  priceMode: PRICE_MODES.manual,
  captainAcceptanceRequired: true,
  ownerNotification: true,
});

const APPROVAL_MODE_LABELS = Object.freeze({
  owner: "موافقة المالك فقط",
  customer: "تأكيد العميل فقط",
  owner_and_customer: "تأكيد العميل + موافقة المالك",
  auto: "اعتماد تلقائي بعد اكتمال البيانات",
});

const PUBLISH_MODE_LABELS = Object.freeze({
  after_owner_approval: "النشر بعد موافقة المالك",
  manual: "نشر يدوي من V27",
});

const PRICE_MODE_LABELS = Object.freeze({
  manual: "سعر خاص يدخله المالك",
  tariff: "حسب جدول التسعيرة المعتمد",
});

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "on", "yes"].includes(String(value).trim().toLowerCase());
}

function normalizeSpecialBookingPolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const approvalMode = Object.values(APPROVAL_MODES).includes(source.approvalMode) ? source.approvalMode : DEFAULT_SPECIAL_BOOKING_POLICY.approvalMode;
  const publishMode = Object.values(PUBLISH_MODES).includes(source.publishMode) ? source.publishMode : DEFAULT_SPECIAL_BOOKING_POLICY.publishMode;
  const priceMode = Object.values(PRICE_MODES).includes(source.priceMode) ? source.priceMode : DEFAULT_SPECIAL_BOOKING_POLICY.priceMode;
  return {
    version: DEFAULT_SPECIAL_BOOKING_POLICY.version,
    enabled: booleanValue(source.enabled, DEFAULT_SPECIAL_BOOKING_POLICY.enabled),
    approvalMode,
    publishMode,
    priceMode,
    captainAcceptanceRequired: booleanValue(source.captainAcceptanceRequired, DEFAULT_SPECIAL_BOOKING_POLICY.captainAcceptanceRequired),
    ownerNotification: booleanValue(source.ownerNotification, DEFAULT_SPECIAL_BOOKING_POLICY.ownerNotification),
  };
}

function specialBookingPolicyResponse(policy = DEFAULT_SPECIAL_BOOKING_POLICY) {
  const current = normalizeSpecialBookingPolicy(policy);
  return {
    ...current,
    labels: {
      approvalMode: APPROVAL_MODE_LABELS[current.approvalMode],
      publishMode: PUBLISH_MODE_LABELS[current.publishMode],
      priceMode: PRICE_MODE_LABELS[current.priceMode],
    },
    options: {
      approvalModes: Object.entries(APPROVAL_MODE_LABELS).map(([value, label]) => ({ value, label })),
      publishModes: Object.entries(PUBLISH_MODE_LABELS).map(([value, label]) => ({ value, label })),
      priceModes: Object.entries(PRICE_MODE_LABELS).map(([value, label]) => ({ value, label })),
    },
  };
}

function isSpecialBookingKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return ["special", "special_booking", "full-car", "full_car", "fullcar", "حجز خاص", "سيارة كاملة", "سياره كامله"].includes(kind);
}

module.exports = {
  APPROVAL_MODES,
  PUBLISH_MODES,
  PRICE_MODES,
  DEFAULT_SPECIAL_BOOKING_POLICY,
  normalizeSpecialBookingPolicy,
  specialBookingPolicyResponse,
  isSpecialBookingKind,
};
