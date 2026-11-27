const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const probeStart = server.indexOf("const WHATSAPP_INIT_PROBE_INTERVAL_MS");
const probeEnd = server.indexOf("\nfunction createClient()", probeStart);
assert.ok(probeStart >= 0 && probeEnd > probeStart, "the init probe is present and isolated from createClient");
const probeSource = server.slice(probeStart, probeEnd);
const fakeWebVersion = ["2", "3000", ["1055", "872355"].join("")].join(".");
const fakePrivateUrl = ["https:", "", "wa.example", "private/path?token=url-secret"].join("/");
const fakeRequestUrl = ["https:", "", "web.whatsapp.net", "private/path?token=request-secret"].join("/");

function createHarness(page) {
  const logs = { log: [], warn: [] };
  const timers = [];
  const context = vm.createContext({
    boundedDiagnosticText: (value, limit = 300) => String(value ?? "").slice(0, limit),
    withTimeout: async (promise) => promise,
    initializationRunId: 9,
    client: null,
    isReady: false,
    URL,
    Date,
    setInterval: (fn, ms) => {
      const timer = { fn, ms, active: true, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearInterval: (timer) => { if (timer) timer.active = false; },
    console: {
      log: (...args) => logs.log.push(args.join(" ")),
      warn: (...args) => logs.warn.push(args.join(" ")),
    },
  });
  const client = new EventEmitter();
  client.pupPage = page;
  context.client = client;
  vm.runInContext(`${probeSource}\nthis.OUT = { startWhatsAppInitProbe, redactInitDiagnostic, readWhatsAppInitPageSnapshot };`, context);
  return { start: context.OUT.startWhatsAppInitProbe, redact: context.OUT.redactInitDiagnostic, readPageSnapshot: context.OUT.readWhatsAppInitPageSnapshot, client, logs, timers, context };
}

function evaluatePageSnapshot(pathname, modules) {
  const harness = createHarness(null);
  const requestedModules = [];
  harness.context.window = {
    location: { host: "fixture-host", pathname },
    Debug: { VERSION: "fixture-web-version" },
    require: (name) => {
      requestedModules.push(name);
      if (!Object.prototype.hasOwnProperty.call(modules, name)) throw new Error("missing fixture module");
      return modules[name];
    },
  };
  harness.context.document = { readyState: "complete", querySelector: () => ({}) };
  return { snapshot: harness.readPageSnapshot(), requestedModules };
}

class FakePage extends EventEmitter {
  constructor() {
    super();
    this.evaluateCalls = 0;
  }

  async evaluate() {
    this.evaluateCalls += 1;
    return {
      host: "web.whatsapp.net",
      readyState: "complete",
      webVersion: fakeWebVersion,
      socketState: "PAIRING",
      socketStream: "OPENING",
      hasQrCanvas: true,
    };
  }
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test("uses WAWebBackendEventBus on the login route without requesting WAWebSocketModel", () => {
  const { snapshot, requestedModules } = evaluatePageSnapshot("/login/", {
    WAWebBackendEventBus: { BackendEventBus: { socketState: "PAIRING" } },
  });
  assert.equal(snapshot.socketState, "PAIRING");
  assert.equal(snapshot.socketStream, null);
  assert.equal(snapshot.hasQrCanvas, true);
  assert.deepEqual(requestedModules, ["WAWebBackendEventBus"]);
  assert.match(probeSource, /page\.evaluate\(readWhatsAppInitPageSnapshot\)/);
});

test("uses WAWebSocketModel only on the post-login application route", () => {
  const { snapshot, requestedModules } = evaluatePageSnapshot("/", {
    WAWebSocketModel: { Socket: { state: "CONNECTED", stream: "MAIN" } },
  });
  assert.equal(snapshot.socketState, "CONNECTED");
  assert.equal(snapshot.socketStream, "MAIN");
  assert.deepEqual(requestedModules, ["WAWebSocketModel"]);
});

test("attaches immediately, records lifecycle and redacted page/network diagnostics, then cleans up on disconnect", async () => {
  const page = new FakePage();
  const h = createHarness(page);
  h.client.on("disconnected", () => { h.client.pupPage = null; });
  h.start(h.client, 9);

  assert.equal(page.listenerCount("pageerror"), 1, "page errors are observed as soon as the page exists");
  assert.equal(page.listenerCount("requestfailed"), 1, "network failures are observed as soon as the page exists");
  assert.equal(h.client.listenerCount("disconnected"), 2, "the probe adds a prioritized disconnect listener beside the app listener");
  assert.ok(h.timers.some((timer) => timer.active && timer.ms === 5000), "subsequent snapshots are throttled to five seconds");

  await flushMicrotasks();
  assert.equal(page.evaluateCalls, 1, "the initial snapshot is immediate");
  assert.match(h.logs.log.join("\n"), new RegExp(`snapshot=.*webVersion.*${fakeWebVersion.replaceAll(".", "\\.")}`));
  assert.match(h.logs.log.join("\n"), /socketState.*PAIRING/);

  const privateUrl = fakePrivateUrl;
  const privatePhone = "+1 (234) 567-8901";
  const privateEmail = "owner@example.org";
  page.emit("pageerror", Object.assign(new Error(`token=error-secret phone ${privatePhone} ${privateUrl} ${privateEmail} Bearer abc123`), { name: "PageError" }));
  page.emit("requestfailed", {
    resourceType: () => "xhr",
    url: () => fakeRequestUrl,
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  });

  const warningText = h.logs.warn.join("\n");
  assert.match(warningText, /\[digits\]/);
  assert.match(warningText, /\[url\]/);
  assert.match(warningText, /\[email\]/);
  assert.match(warningText, /Bearer \[redacted\]/);
  for (const secret of ["error-secret", "url-secret", "request-secret", privatePhone, privateEmail, "private/path", "abc123"]) {
    assert.ok(!warningText.includes(secret), `diagnostic output redacts ${secret}`);
  }
  assert.match(warningText, /host=web\.whatsapp\.net/, "network diagnostics retain only the request host");

  h.client.emit("authenticated");
  await flushMicrotasks();
  h.client.emit("disconnected", "LOGOUT");
  await flushMicrotasks();

  assert.match(h.logs.log.join("\n"), /client_event=authenticated/);
  assert.match(h.logs.log.join("\n"), /client_event=disconnected detail=LOGOUT/);
  assert.ok(page.evaluateCalls >= 3, "a final page snapshot is attempted when the client disconnects");
  assert.equal(page.listenerCount("pageerror"), 0, "page listeners are removed after disconnect");
  assert.equal(h.client.listenerCount("disconnected"), 1, "the probe listener is removed while the app listener remains");
  assert.ok(h.timers.every((timer) => !timer.active), "bounded timers are cleared after disconnect");

  assert.doesNotMatch(probeSource, /qrCodeData|document\.cookie|localStorage|sessionStorage|request\.postData|response\.text/i);
});

test("waits for a late Puppeteer page with a short poll and stops on ready", async () => {
  const h = createHarness(null);
  h.start(h.client, 9);
  const waitTimer = h.timers.find((timer) => timer.active && timer.ms === 250);
  assert.ok(waitTimer, "a short page-availability poll is installed immediately");
  assert.equal(h.client.listenerCount("ready"), 1);

  const page = new FakePage();
  h.client.pupPage = page;
  waitTimer.fn();
  await flushMicrotasks();

  assert.equal(page.listenerCount("pageerror"), 1, "listeners attach as soon as the page appears");
  assert.equal(page.evaluateCalls, 1, "the first page snapshot runs immediately after attachment");
  h.client.emit("ready");
  assert.equal(page.listenerCount("pageerror"), 0, "ready ends and cleans up the probe");
  assert.ok(h.timers.every((timer) => !timer.active));
});

test("caps the probe at 25 snapshots and removes listeners and timers", async () => {
  const page = new FakePage();
  const h = createHarness(page);
  h.start(h.client, 9);
  await flushMicrotasks();
  const timer = h.timers.find((candidate) => candidate.active && candidate.ms === 5000);
  assert.ok(timer);

  for (let index = 0; index < 24; index += 1) {
    if (!timer.active) break;
    timer.fn();
    await flushMicrotasks();
  }

  assert.equal(page.evaluateCalls, 25, "one immediate snapshot plus no more than 24 interval snapshots");
  assert.equal(page.listenerCount("pageerror"), 0, "page listeners are removed at the snapshot cap");
  assert.equal(h.client.listenerCount("disconnected"), 0, "client listeners are removed at the snapshot cap");
  assert.ok(h.timers.every((candidate) => !candidate.active), "all timers are cleared at the snapshot cap");
});
test("captures a terminal auth_failure even after the app clears the current client", async () => {
  const page = new FakePage();
  const h = createHarness(page);
  h.client.on("auth_failure", () => { h.context.client = null; h.client.pupPage = null; });
  h.start(h.client, 9);
  await flushMicrotasks();
  h.client.emit("auth_failure", "Bearer opaque-auth-secret");
  await flushMicrotasks();

  assert.match(h.logs.log.join("\n"), /client_event=auth_failure detail=Bearer \[redacted\]/);
  assert.ok(page.evaluateCalls >= 2, "the final page snapshot runs despite client=null");
  assert.equal(page.listenerCount("pageerror"), 0);
  assert.ok(h.timers.every((timer) => !timer.active));
  assert.ok(!h.logs.log.join("\n").includes("opaque-auth-secret"));
});
