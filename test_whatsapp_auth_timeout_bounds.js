const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

function sliceConstants(source) {
  const start = source.indexOf("const WHATSAPP_AUTH_TIMEOUT_CEILING_MS");
  assert.ok(start > -1, "auth timeout constants exist in server.js");
  const end = source.indexOf("const WHATSAPP_GROUP_CREATE_TIMEOUT_MS", start);
  assert.ok(end > start, "auth timeout constants end before the next constant");
  return `${source.slice(start, end)}\nthis.OUT = { WHATSAPP_AUTH_TIMEOUT_CEILING_MS, WHATSAPP_AUTH_TIMEOUT_MS };\n`;
}

function evaluateConstants({ initTimeoutMs, authTimeoutEnv }) {
  const script = sliceConstants(server);
  const context = vm.createContext({
    WHATSAPP_INIT_TIMEOUT_MS: initTimeoutMs,
    process: { env: authTimeoutEnv === undefined ? {} : { WHATSAPP_AUTH_TIMEOUT_MS: String(authTimeoutEnv) } },
  });
  vm.runInContext(script, context);
  return context.OUT;
}

// Behaviour: the library's 30 s abort is replaced, and the value can never outlive the
// outer initialization guard that owns the deadline.
assert.strictEqual(evaluateConstants({ initTimeoutMs: 300000 }).WHATSAPP_AUTH_TIMEOUT_MS, 120000, "default auth timeout is 120 s");
assert.strictEqual(evaluateConstants({ initTimeoutMs: 300000, authTimeoutEnv: 90000 }).WHATSAPP_AUTH_TIMEOUT_MS, 90000, "explicit env value inside the ceiling is honoured");
assert.strictEqual(evaluateConstants({ initTimeoutMs: 300000, authTimeoutEnv: 500000 }).WHATSAPP_AUTH_TIMEOUT_MS, 135000, "oversized env value is clamped to the ceiling");
assert.strictEqual(evaluateConstants({ initTimeoutMs: 300000, authTimeoutEnv: 1000 }).WHATSAPP_AUTH_TIMEOUT_MS, 30000, "undersized env value never drops below the 30 s floor");
assert.strictEqual(evaluateConstants({ initTimeoutMs: 300000, authTimeoutEnv: "not-a-number" }).WHATSAPP_AUTH_TIMEOUT_MS, 120000, "non-numeric env value falls back to the default");
assert.strictEqual(evaluateConstants({ initTimeoutMs: 180000 }).WHATSAPP_AUTH_TIMEOUT_MS, 75000, "a short init timeout lowers the auth ceiling");
assert.strictEqual(evaluateConstants({ initTimeoutMs: 60000 }).WHATSAPP_AUTH_TIMEOUT_MS, 30000, "a minimal init timeout keeps the library floor");
assert.strictEqual(evaluateConstants({ initTimeoutMs: 900000 }).WHATSAPP_AUTH_TIMEOUT_CEILING_MS, 435000, "ceiling stays below half of the init timeout");

for (const initTimeoutMs of [60000, 90000, 180000, 300000, 900000]) {
  for (const authTimeoutEnv of [undefined, 1000, 120000, 900000, 5000000]) {
    const out = evaluateConstants({ initTimeoutMs, authTimeoutEnv });
    assert.ok(Number.isInteger(out.WHATSAPP_AUTH_TIMEOUT_MS), `integer for init=${initTimeoutMs} env=${authTimeoutEnv}`);
    assert.ok(out.WHATSAPP_AUTH_TIMEOUT_MS >= 30000, `never below the library floor for init=${initTimeoutMs}`);
    assert.ok(out.WHATSAPP_AUTH_TIMEOUT_MS <= out.WHATSAPP_AUTH_TIMEOUT_CEILING_MS, `never above the ceiling for init=${initTimeoutMs}`);
    // Two auth waits plus boot overhead must still leave the outer guard as the real deadline.
    assert.ok(out.WHATSAPP_AUTH_TIMEOUT_MS * 2 <= Math.max(60000, initTimeoutMs), `two auth waits stay inside the init timeout for init=${initTimeoutMs}`);
  }
}

// The owner-facing runtime override is clamped by the same bounds, so it cannot extend past
// the outer initialization deadline either.
const sliceStart = server.indexOf("function boundedIntegerSetting(key, fallback, minimum, maximum)");
assert.ok(sliceStart > -1, "boundedIntegerSetting exists");
const boundedSlice = `${server.slice(sliceStart, server.indexOf("\n}", sliceStart) + 2)}\nthis.pick = (key, fallback, minimum, maximum) => boundedIntegerSetting(key, fallback, minimum, maximum);\n`;
const { WHATSAPP_AUTH_TIMEOUT_CEILING_MS, WHATSAPP_AUTH_TIMEOUT_MS } = evaluateConstants({ initTimeoutMs: 300000 });
for (const [storedValue, expected] of [[undefined, WHATSAPP_AUTH_TIMEOUT_MS], ["350000", WHATSAPP_AUTH_TIMEOUT_CEILING_MS], ["5000", 30000], ["45000", 45000], ["junk", WHATSAPP_AUTH_TIMEOUT_MS]]) {
  const context = vm.createContext({
    getSetting: () => storedValue,
    Number,
    Math,
  });
  vm.runInContext(boundedSlice, context);
  assert.strictEqual(context.pick("whatsapp_auth_timeout_ms", WHATSAPP_AUTH_TIMEOUT_MS, 30000, WHATSAPP_AUTH_TIMEOUT_CEILING_MS), expected, `stored override ${String(storedValue)} clamps correctly`);
}

// Wiring: the option must reach both the client and the operator-facing readout.
assert.match(server, /authTimeoutMs: operationalSettings\(\)\.authTimeoutMs/, "createClient passes the bounded auth timeout to whatsapp-web.js");
assert.match(server, /authTimeoutMs: boundedIntegerSetting\("whatsapp_auth_timeout_ms", WHATSAPP_AUTH_TIMEOUT_MS, 30000, WHATSAPP_AUTH_TIMEOUT_CEILING_MS\)/, "operational settings expose the bounded auth timeout");
assert.match(server, /const WHATSAPP_AUTH_TIMEOUT_CEILING_MS = Math\.max\(30000, Math\.floor\(\(WHATSAPP_INIT_TIMEOUT_MS - 30000\) \/ 2\)\);/, "ceiling is derived from the init timeout");
assert.match(server, /const WHATSAPP_AUTH_TIMEOUT_MS = Math\.max\(30000, Math\.min\(Number\(process\.env\.WHATSAPP_AUTH_TIMEOUT_MS\) \|\| 120000, WHATSAPP_AUTH_TIMEOUT_CEILING_MS\)\);/, "default auth timeout is env-driven and bounded");

// Regression guards: no hardcoded shortcut and no weakened outer initialization deadline.
assert.doesNotMatch(server, /authTimeoutMs:\s*30000\b/, "auth timeout is never pinned to the old 30 s constant");
assert.doesNotMatch(server, /authTimeoutMs:\s*0\b/, "auth timeout is never disabled");
assert.match(server, /const initialized = await withTimeoutStrict\(currentClient\.initialize\(\), operationalSettings\(\)\.initTimeoutMs, initTimeoutMarker\);/, "outer initialization guard still bounds the total time");

// Environment documentation stays in sync with the constant.
const envExample = fs.readFileSync(path.join(__dirname, ".env.example"), "utf8");
assert.match(envExample, /^WHATSAPP_AUTH_TIMEOUT_MS=120000$/m, ".env.example documents the auth timeout");

console.log("WhatsApp auth timeout bounds and wiring verified");
