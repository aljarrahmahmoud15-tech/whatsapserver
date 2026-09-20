const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("server.js", "utf8");
const start = source.indexOf("function reactionId(value)");
const end = source.indexOf("function cancelOrderForReactionRemoval", start);
assert.ok(start >= 0 && end > start, "reaction identity helpers exist");

const context = {
  client: {
    info: { wid: { _serialized: "27153336946853@lid" } },
    async getContactLidAndPhone(ids) {
      return ids.map((lid) => lid === "987654321098765@lid" ? { lid, pn: "962786856851@c.us" } : null);
    },
    async getContactById() { return null; },
    pupPage: {
      async evaluate(_callback, ids) {
        if (!Array.isArray(ids)) return { isGroup: true, participants: [] };
        return ids.map((lid) => lid === "246813579024681@lid" ? { lid, pn: "962787847477@c.us" } : null).filter(Boolean);
      },
    },
  },
  isReady: true,
  connectedBotPhone: () => "962779110123",
  directJordanPhoneFromWhatsappValue(value) {
    const serialized = typeof value === "string" ? value : (value?._serialized || value?.id || "");
    if (/@lid$/i.test(String(serialized))) return "";
    const raw = String(serialized).split("@")[0].replace(/^00/, "");
    const phone = raw.startsWith("0") ? `962${raw.slice(1)}` : raw;
    return /^9627\d{8}$/.test(phone) ? phone : "";
  },
  serializedWhatsappUserId(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (value._serialized) return String(value._serialized).trim();
    if (value.id) return this.serializedWhatsappUserId(value.id);
    if (value.user && value.server) return `${value.user}@${value.server}`;
    return "";
  },
  resolveWhatsappUserPhone: null,
  findPersistedWhatsappPhone: () => "",
  persistWhatsappIdentity: () => null,
  resolveWhatsappLidsFromConfiguredGroup: async () => [],
  getSetting: (_key, fallback) => fallback || "120363426604560611@g.us",
  isConfiguredGroup: () => true,
  readGroupSnapshot: async () => ({ isGroup: true }),
  withTimeout: async (promise) => promise,
  orderTraceKey: (value) => `trace:${String(value)}`,
  maskSettlementPhone: (value) => String(value),
  phoneWithCountry(value) {
    const digits = String(value || "").replace(/[^0-9]/g, "").replace(/^00/, "");
    return digits.startsWith("0") ? `962${digits.slice(1)}` : digits;
  },
  isValidJordanPhone: (value) => /^9627\d{8}$/.test(String(value)),
  console,
};

// Make the resolver self-contained in the VM by including the source helpers it calls.
const resolverStart = source.indexOf("const whatsappLidPhoneCache = new Map();");
const resolverEnd = source.indexOf("function recordGroupMessageTelemetry(", resolverStart);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, "LID resolver exists");
vm.runInNewContext(`${source.slice(resolverStart, resolverEnd)}\n${source.slice(start, end)}\nthis.resolveReactionSenderPhone = resolveReactionSenderPhone;`, context);

(async () => {
  assert.equal(await context.resolveReactionSenderPhone({ senderId: "962786856851@c.us" }), "962786856851");
  assert.equal(await context.resolveReactionSenderPhone({ senderUserJid: "987654321098765@lid" }), "962786856851");
  assert.equal(await context.resolveReactionSenderPhone({ sender: { senderUserJid: "246813579024681@lid" } }), "962787847477");
  assert.equal(await context.resolveReactionSenderPhone({ senderId: "27153336946853@lid" }), "962779110123");
  assert.equal(await context.resolveReactionSenderPhone({ hasReactionByMe: true }), "962779110123");
  console.log("reaction sender identity resolution verified");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
