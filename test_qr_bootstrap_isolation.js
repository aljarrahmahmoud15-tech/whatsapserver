const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");

assert.match(
  source,
  /const WHATSAPP_QR_BOOTSTRAP = process\.env\.WHATSAPP_QR_BOOTSTRAP === "true"/,
  "QR bootstrap must be explicitly enabled by environment",
);
assert.match(
  source,
  /WHATSAPP_QR_BOOTSTRAP[\s\S]{0,180}!WHATSAPP_GROUP_ID/,
  "QR bootstrap must require a bot identity but no group ID",
);
assert.match(
  source,
  /ready in QR bootstrap mode; group processing remains disabled/,
  "ready must stop before business schedulers in bootstrap mode",
);
assert.match(
  source,
  /typeof WHATSAPP_QR_BOOTSTRAP !== "undefined" && WHATSAPP_QR_BOOTSTRAP[\s\S]{0,180}typeof WHATSAPP_CONFIGURED !== "undefined" && !WHATSAPP_CONFIGURED\) return;/,
  "incoming WhatsApp events must be ignored in bootstrap mode",
);
assert.match(
  source,
  /} else if \(WHATSAPP_QR_BOOTSTRAP\) \{[\s\S]{0,260}initializeWhatsApp\(\);[\s\S]{0,120}startWhatsAppWatchdog\(\);/,
  "bootstrap mode must initialize only the QR client and watchdog",
);

console.log("QR bootstrap isolation guardrails verified");
