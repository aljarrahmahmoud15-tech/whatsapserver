function createWhatsAppIdentityHandler({
  token,
  constantTimeEquals,
  phoneWithCountry,
  isValidJordanPhone,
  isBlockedPhone,
  findCaptainByPhone,
  findCustomerByPhone,
}) {
  return (req, res) => {
    const providedToken = String(req.get("authorization") || "")
      .trim()
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (!token || !constantTimeEquals(providedToken, token)) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const phone = phoneWithCountry(String(req.query?.phone || ""));
    if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) {
      return res.status(400).json({ error: "رقم الهاتف غير صالح" });
    }

    const captain = findCaptainByPhone(phone, { activeOnly: true });
    const customer = findCustomerByPhone(phone);

    if (captain && customer) {
      return res.json({ found: false, ambiguous: true, phone, reason: "phone_has_multiple_active_roles" });
    }
    if (captain) {
      return res.json({
        found: true,
        role: "captain",
        id: captain.id,
        phone,
        name: captain.name || captain.registration_name || "كابتن",
        status: captain.account_status || (captain.active ? "active" : "inactive"),
      });
    }
    if (customer) {
      return res.json({
        found: true,
        role: "customer",
        id: customer.id,
        phone,
        name: customer.name || "عميل",
        status: customer.active ? "active" : "inactive",
      });
    }
    return res.json({ found: false, ambiguous: false, phone, reason: "not_registered" });
  };
}

module.exports = { createWhatsAppIdentityHandler };
