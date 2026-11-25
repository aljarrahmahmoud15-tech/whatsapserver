const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const envExample = fs.readFileSync(path.join(__dirname, ".env.example"), "utf8");

assert.match(server, /const WHATSAPP_PROTOCOL_TIMEOUT_MS = Math\.max\(120000, Math\.min\(600000, Number\(process\.env\.WHATSAPP_PROTOCOL_TIMEOUT_MS \|\| 300000\)\)\);/);
assert.match(server, /protocolTimeout: WHATSAPP_PROTOCOL_TIMEOUT_MS/);
assert.match(server, /const WHATSAPP_INIT_TIMEOUT_MS = Number\(process\.env\.WHATSAPP_INIT_TIMEOUT_MS \|\| 300000\);/);
assert.match(envExample, /^WHATSAPP_PROTOCOL_TIMEOUT_MS=300000$/m);
// The library's fixed 30 s authentication wait must stay replaced by the bounded override,
// and the override must stay inside the initialization deadline.
assert.match(server, /const WHATSAPP_AUTH_TIMEOUT_CEILING_MS = Math\.max\(30000, Math\.floor\(\(WHATSAPP_INIT_TIMEOUT_MS - 30000\) \/ 2\)\);/);
assert.match(server, /authTimeoutMs: operationalSettings\(\)\.authTimeoutMs/);
assert.doesNotMatch(server, /authTimeoutMs:\s*30000\b/);
assert.match(envExample, /^WHATSAPP_AUTH_TIMEOUT_MS=120000$/m);

console.log("WhatsApp protocol timeout guardrails verified");
