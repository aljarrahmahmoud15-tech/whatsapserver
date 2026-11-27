const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const start = server.indexOf("function whatsappGrantPersistentStorage()");
const end = server.indexOf("\n  }\n", start) + 4;
const createAt = server.indexOf("\nfunction createClient()");
assert.ok(createAt >= 0 && start > createAt && end > start, "persistent-storage shim is defined inside createClient");
const shimSource = server.slice(start, end);

function loadShim(navigator) {
  const context = vm.createContext({ navigator });
  vm.runInContext(`${shimSource}\nthis.shim = whatsappGrantPersistentStorage;`, context);
  return context.shim;
}

test("shim makes persist() and persisted() resolve true", async () => {
  const storage = { persist: async () => false, persisted: async () => false, estimate: async () => ({}) };
  loadShim({ storage })();
  assert.equal(await storage.persist(), true);
  assert.equal(await storage.persisted(), true);
  assert.equal(typeof storage.estimate, "function", "other storage APIs stay untouched");
});

test("shim is a no-op without navigator.storage and never throws", () => {
  assert.doesNotThrow(() => loadShim({})());
  assert.doesNotThrow(() => loadShim(undefined)());
  const frozen = Object.freeze({});
  assert.doesNotThrow(() => loadShim({ storage: frozen })());
});

test("shim is self-contained so evaluateOnNewDocument can serialize it", () => {
  const body = shimSource.slice(shimSource.indexOf("{"));
  for (const outer of ["require(", "process.", "client", "WHATSAPP_", "console."]) {
    assert.ok(!body.includes(outer), `shim must not reference ${outer}`);
  }
  const rebuilt = new Function(`return (${shimSource.trim()})`)();
  assert.equal(typeof rebuilt, "function");
});

test("createClient passes the shim to whatsapp-web.js as evalOnNewDoc", () => {
  const createStart = server.indexOf("\nfunction createClient()");
  const createBody = server.slice(createStart, server.indexOf('instance.on("qr"', createStart));
  assert.ok(createBody.includes("function whatsappGrantPersistentStorage()"), "shim lives in the createClient slice used by lifecycle tests");
  assert.match(createBody, /new Client\(\{[\s\S]*evalOnNewDoc:\s*whatsappGrantPersistentStorage,[\s\S]*\}\);/);
  assert.match(createBody, /authStrategy:\s*new LocalAuth\(\{ clientId: WHATSAPP_CLIENT_ID, dataPath: AUTH_PATH \}\)/, "LocalAuth path unchanged");
});

test("installed whatsapp-web.js applies evalOnNewDoc before navigating to WhatsApp Web", () => {
  const clientSrc = fs.readFileSync(require.resolve("whatsapp-web.js/src/Client.js"), "utf8");
  const hook = clientSrc.indexOf("page.evaluateOnNewDocument(this.options.evalOnNewDoc)");
  const nav = clientSrc.indexOf("await page.goto(WhatsWebURL", hook);
  assert.ok(hook > 0 && nav > hook, "evalOnNewDoc runs before page.goto");
});
