const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const envExample = fs.readFileSync(path.join(__dirname, ".env.example"), "utf8");

assert.match(server, /const WHATSAPP_PROTOCOL_TIMEOUT_MS = Math\.max\(120000, Math\.min\(600000, Number\(process\.env\.WHATSAPP_PROTOCOL_TIMEOUT_MS \|\| 300000\)\)\);/);
assert.match(server, /protocolTimeout: WHATSAPP_PROTOCOL_TIMEOUT_MS/);
assert.match(server, /const WHATSAPP_INIT_TIMEOUT_MS = Number\(process\.env\.WHATSAPP_INIT_TIMEOUT_MS \|\| 300000\);/);
assert.match(envExample, /^WHATSAPP_PROTOCOL_TIMEOUT_MS=300000$/m);

console.log("WhatsApp protocol timeout guardrails verified");
