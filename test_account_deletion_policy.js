const test = require("node:test");
const assert = require("node:assert/strict");
const { canDeleteAccount } = require("./account-deletion-policy");

const confirm = "حذف حسابي";

test("allows an active customer after explicit confirmation", () => {
  assert.deepEqual(canDeleteAccount({ role: "customer", active: true, confirmation: confirm }), { ok: true, status: 200, reason: "eligible" });
});

test("requires confirmation for customer and captain", () => {
  assert.equal(canDeleteAccount({ role: "customer", active: true, confirmation: "" }).reason, "confirmation_required");
  assert.equal(canDeleteAccount({ role: "captain", active: true, walletCents: 0, confirmation: "حذف" }).reason, "confirmation_required");
});

test("rejects inactive and protected accounts", () => {
  assert.equal(canDeleteAccount({ role: "customer", active: false, confirmation: confirm }).reason, "account_not_active");
  assert.equal(canDeleteAccount({ role: "captain", active: true, isBot: true, walletCents: 0, confirmation: confirm }).reason, "protected_system_account");
});

test("rejects roles outside customer and captain", () => {
  const result = canDeleteAccount({ role: "company", active: true, confirmation: confirm });
  assert.equal(result.status, 400);
  assert.equal(result.reason, "unsupported_role");
});

test("blocks captain deletion until wallet is settled", () => {
  const result = canDeleteAccount({ role: "captain", active: true, walletCents: 125, confirmation: confirm });
  assert.equal(result.status, 409);
  assert.equal(result.reason, "non_zero_wallet_requires_settlement");
});

test("accepts a zero-balance captain", () => {
  assert.deepEqual(canDeleteAccount({ role: "captain", active: true, walletCents: 0, confirmation: confirm }), { ok: true, status: 200, reason: "eligible" });
});
