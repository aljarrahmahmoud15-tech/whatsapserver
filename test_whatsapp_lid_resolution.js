const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("server.js", "utf8");
assert.match(source, /CREATE TABLE IF NOT EXISTS whatsapp_identities/);
assert.match(source, /CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_identities_phone/);
assert.match(source, /function persistWhatsappIdentity\(/);
assert.match(source, /function findPersistedWhatsappPhone\(/);
assert.match(source, /refusing conflicting identity mapping/);
assert.match(source, /reaction\?\._data\?\.senderUserJid/);
assert.match(source, /client\.getContactLidAndPhone\(lidIds\)/);
assert.match(source, /resolveWhatsappLidsFromConfiguredGroup\(lidIds\)/);
assert.match(source, /configured_group_toPn/);
assert.match(source, /app\.get\("\/api\/admin\/group\/resolve-identity", requireAdmin/);
assert.match(source, /async function auditActiveCaptainLidMappings\(/);
assert.match(source, /client\.getContactLidAndPhone\(chunk\.map\(/);
assert.match(source, /captain_lid_audit/);
assert.match(source, /app\.post\("\/api\/admin\/group\/audit-lid-mappings", requireAdmin/);
assert.match(source, /financialMutation: false/);
assert.match(source, /A WhatsApp LID ending with @lid is required/);
assert.match(source, /accepted_message_sender/);
assert.match(source, /for \(const delay of \[1500, 5000\]\)/);
assert.match(source, /reconcileStoredThumbReaction\(messageId\)/);
const start = source.indexOf("const whatsappLidPhoneCache = new Map();");
const end = source.indexOf("function recordGroupMessageTelemetry(", start);
assert.ok(start >= 0 && end > start, "LID phone resolver exists");

let lookupCalls = 0;
const context = {
  client: {
    async getContactLidAndPhone(ids) {
      lookupCalls += 1;
      if (String(ids[0]) === "123456789012345@lid") return [{ lid: "123456789012345@lid", pn: "962785344508@c.us" }];
      return [];
    },
    pupPage: {
      async evaluate(_callback, ids) {
        return Array.from(ids).map((lid) => ({ lid, pn: "962772531964@c.us" }));
      },
    },
  },
  isReady: true,
  withTimeout: async (promise) => promise,
  getSetting: (_key, fallback) => fallback || "120363426604560611@g.us",
  isConfiguredGroup: () => true,
  readGroupSnapshot: async () => ({ isGroup: true }),
  orderTraceKey: (value) => String(value),
  phoneWithCountry(value = "") {
    const digits = String(value).replace(/[^0-9]/g, "").replace(/^00/, "");
    return digits.startsWith("0") ? `962${digits.slice(1)}` : digits;
  },
  isValidJordanPhone: (phone) => /^9627\d{8}$/.test(String(phone)),
  connectedBotPhone: () => "962779110123",
  console,
};

vm.runInNewContext(`${source.slice(start, end)}
this.resolveWhatsappUserPhone = resolveWhatsappUserPhone;
this.resolveMessageSenderPhone = resolveMessageSenderPhone;
this.directJordanPhoneFromWhatsappValue = directJordanPhoneFromWhatsappValue;`, context);

(async () => {
  assert.equal(context.directJordanPhoneFromWhatsappValue("962778689642@c.us"), "962778689642");
  assert.equal(context.directJordanPhoneFromWhatsappValue("123456789012345@lid"), "");

  const fromLid = await context.resolveWhatsappUserPhone("123456789012345@lid");
  assert.equal(fromLid, "962785344508");
  assert.equal(lookupCalls, 1);

  const cached = await context.resolveWhatsappUserPhone({ _serialized: "123456789012345@lid" });
  assert.equal(cached, "962785344508");
  assert.equal(lookupCalls, 1, "resolved LID is cached for later messages and reactions");

  const fromConfiguredGroup = await context.resolveWhatsappUserPhone("264256670928948@lid");
  assert.equal(fromConfiguredGroup, "962772531964");

  const sender = await context.resolveMessageSenderPhone({
    fromMe: false,
    author: "123456789012345@lid",
  }, {
    number: "123456789012345",
    id: { _serialized: "123456789012345@lid" },
  });
  assert.equal(sender, "962785344508");

  assert.equal(await context.resolveMessageSenderPhone({ fromMe: true }), "962779110123");
  console.log("WhatsApp LID sender resolution verified");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
