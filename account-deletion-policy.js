const CUSTOMER_DELETE_CONFIRMATION = "حذف حسابي";
const CAPTAIN_DELETE_CONFIRMATION = "حذف حسابي";

function canDeleteAccount({ role, active, isBot = false, walletCents = 0, confirmation }) {
  if (!active) return { ok: false, status: 404, reason: "account_not_active" };
  if (isBot) return { ok: false, status: 403, reason: "protected_system_account" };
  if (!["customer", "captain"].includes(role)) return { ok: false, status: 400, reason: "unsupported_role" };
  if (confirmation !== (role === "captain" ? CAPTAIN_DELETE_CONFIRMATION : CUSTOMER_DELETE_CONFIRMATION)) {
    return { ok: false, status: 400, reason: "confirmation_required" };
  }
  if (role === "captain" && Number(walletCents || 0) !== 0) {
    return { ok: false, status: 409, reason: "non_zero_wallet_requires_settlement" };
  }
  return { ok: true, status: 200, reason: "eligible" };
}

module.exports = { canDeleteAccount, CUSTOMER_DELETE_CONFIRMATION, CAPTAIN_DELETE_CONFIRMATION };
