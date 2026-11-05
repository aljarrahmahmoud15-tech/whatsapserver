const test = require("node:test");
const assert = require("node:assert/strict");
const { createWhatsAppIdentityHandler } = require("./whatsapp-identity-route");

const TOKEN = "local-test-token";
const normalize = (value) => {
  const digits = String(value ?? "").replace(/[^0-9]/g, "").replace(/^00/, "");
  return digits.startsWith("0") ? `962${digits.slice(1)}` : digits;
};
const validJordanPhone = (phone) => /^9627\d{8}$/.test(phone);
const blockedPhones = new Set(["962790000009"]);

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeHandler({ captain = null, customer = null, onLookup = null } = {}) {
  return createWhatsAppIdentityHandler({
    token: TOKEN,
    constantTimeEquals: (actual, expected) => actual === expected,
    phoneWithCountry: normalize,
    isValidJordanPhone: validJordanPhone,
    isBlockedPhone: (phone) => blockedPhones.has(phone),
    findCaptainByPhone: (phone, options) => {
      onLookup?.("captain", phone, options);
      return captain;
    },
    findCustomerByPhone: (phone) => {
      onLookup?.("customer", phone);
      return customer;
    },
  });
}

function call(handler, options = {}) {
  const authorization = Object.prototype.hasOwnProperty.call(options, "authorization")
    ? options.authorization
    : `Bearer ${TOKEN}`;
  const phone = Object.prototype.hasOwnProperty.call(options, "phone")
    ? options.phone
    : "0790000000";
  const req = {
    query: { phone },
    get(name) { return name.toLowerCase() === "authorization" ? authorization : undefined; },
  };
  const res = makeResponse();
  handler(req, res);
  return res;
}

test("rejects a missing or invalid bearer token", () => {
  const response = call(makeHandler(), { authorization: "Bearer wrong" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: "غير مصرح" });
});

test("rejects a missing, malformed, or empty authorization header", () => {
  for (const authorization of [undefined, "", "Basic local-test-token", "Bearer"]) {
    const response = call(makeHandler(), { authorization });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { error: "غير مصرح" });
  }
});

test("accepts bearer casing and surrounding whitespace", () => {
  const response = call(makeHandler(), { authorization: "  bEaReR   local-test-token  " });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    found: false,
    ambiguous: false,
    phone: "962790000000",
    reason: "not_registered",
  });
});

test("rejects invalid and blocked phone numbers", () => {
  const invalid = call(makeHandler(), { phone: "123" });
  assert.equal(invalid.statusCode, 400);

  const blocked = call(makeHandler(), { phone: "0790000009" });
  assert.equal(blocked.statusCode, 400);
});

test("normalizes international phone formats and rejects a missing phone", () => {
  for (const phone of ["00962790000000", "+962790000000"]) {
    const response = call(makeHandler(), { phone });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.phone, "962790000000");
  }

  const missing = call(makeHandler(), { phone: undefined });
  assert.equal(missing.statusCode, 400);
});

test("does not perform identity lookups when authorization or phone validation fails", () => {
  const lookups = [];
  const handler = makeHandler({ onLookup: (...args) => lookups.push(args) });

  call(handler, { authorization: "Bearer wrong" });
  call(handler, { phone: "123" });

  assert.equal(lookups.length, 0);
});

test("returns an active captain identity", () => {
  const response = call(makeHandler({
    captain: { id: 12, name: "كابتن اختبار", active: 1, account_status: "active" },
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    found: true,
    role: "captain",
    id: 12,
    phone: "962790000000",
    name: "كابتن اختبار",
    status: "active",
  });
});

test("returns an active customer identity", () => {
  const response = call(makeHandler({
    customer: { id: 33, name: "عميل اختبار", active: 1 },
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    found: true,
    role: "customer",
    id: 33,
    phone: "962790000000",
    name: "عميل اختبار",
    status: "active",
  });
});

test("does not return an inactive captain or customer", () => {
  const captainResponse = call(makeHandler({ captain: null }));
  assert.equal(captainResponse.body.found, false);

  const customerResponse = call(makeHandler({ customer: null }));
  assert.equal(customerResponse.body.found, false);
});

test("uses safe fallback names when identity names are empty", () => {
  const captainResponse = call(makeHandler({
    captain: { id: 12, name: "", registration_name: "", active: 1, account_status: "active" },
  }));
  assert.equal(captainResponse.body.name, "كابتن");

  const customerResponse = call(makeHandler({
    customer: { id: 33, name: "", active: 1 },
  }));
  assert.equal(customerResponse.body.name, "عميل");
});

test("returns not registered for an unknown phone", () => {
  const response = call(makeHandler());
  assert.deepEqual(response.body, {
    found: false,
    ambiguous: false,
    phone: "962790000000",
    reason: "not_registered",
  });
});

test("does not guess when a phone has both active roles", () => {
  const response = call(makeHandler({
    captain: { id: 12, name: "كابتن", active: 1, account_status: "active" },
    customer: { id: 33, name: "عميل", active: 1 },
  }));
  assert.deepEqual(response.body, {
    found: false,
    ambiguous: true,
    phone: "962790000000",
    reason: "phone_has_multiple_active_roles",
  });
});
