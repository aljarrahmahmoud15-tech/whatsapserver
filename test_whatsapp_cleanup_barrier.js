const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

function sliceBetween(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${label} start must exist`);
  assert.ok(end > start, `${label} end must follow start`);
  return source.slice(start, end);
}

const lifecycleSlice = sliceBetween(
  "function enqueueClientCleanup(",
  "async function loadBaileys",
  "cleanup/restart lifecycle",
);
const createClientSlice = sliceBetween(
  "function createClient()",
  "async function initializeWhatsApp()",
  "createClient",
);
const initializeSlice = sliceBetween(
  "async function initializeWhatsApp()",
  "function connectedBotPhone()",
  "initializeWhatsApp",
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A timed-out synthetic operation may settle after the test has moved on.
  // Keep that deliberate late rejection from becoming a process-level failure.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function makeFakeClient(label, options = {}) {
  const destroyDeferred = options.destroyDeferred || null;
  const initializeDeferred = options.initializeDeferred || null;
  const handlers = new Map();
  return {
    label,
    handlers,
    destroyCalls: 0,
    initializeCalls: 0,
    info: options.info || { wid: null },
    on(event, handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event, ...args) {
      const handler = handlers.get(event);
      assert.equal(typeof handler, "function", `${label} must register ${event}`);
      return handler(...args);
    },
    destroy() {
      this.destroyCalls += 1;
      if (typeof options.destroy === "function") return options.destroy(this);
      return destroyDeferred ? destroyDeferred.promise : Promise.resolve();
    },
    initialize() {
      this.initializeCalls += 1;
      if (typeof options.initialize === "function") return options.initialize(this);
      return initializeDeferred ? initializeDeferred.promise : Promise.resolve();
    },
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeHarness() {
  const counters = {
    cleanupCalls: 0,
    cleanupFailures: 0,
    forceTerminateCalls: 0,
    profileLockClears: 0,
    storageMonitorStops: 0,
    scheduleCalls: [],
    scheduleAfterCleanup: [],
    checkpointCalls: [],
    timerCalls: [],
    clearTimerCalls: 0,
    clientCreates: 0,
    assertionCalls: 0,
    assertionFailures: 0,
    logs: [],
  };
  const clientQueue = [];
  let cleanupFailuresRemaining = 0;
  let assertionFailuresRemaining = 0;
  let timeoutModes = [];
  let timerId = 0;

  function fakeSetTimeout(callback, ms) {
    const timer = {
      id: ++timerId,
      ms,
      unref() {
        return this;
      },
    };
    counters.timerCalls.push({ callback, ms, timer });
    // The lifecycle's post-destroy one-second wait is intentionally driven
    // synchronously. Other timers remain captured and inert.
    if (ms === 1000) callback();
    return timer;
  }

  function fakeClearTimeout() {
    counters.clearTimerCalls += 1;
  }

  function fakeClientConstructor() {
    const instance = clientQueue.shift();
    assert.ok(instance, "a synthetic client must be queued before createClient()");
    counters.clientCreates += 1;
    return instance;
  }

  const context = {
    console: {
      log(...args) { counters.logs.push(["log", ...args]); },
      warn(...args) { counters.logs.push(["warn", ...args]); },
      error(...args) { counters.logs.push(["error", ...args]); },
    },
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    Client: fakeClientConstructor,
    LocalAuth: function LocalAuth() { return {}; },
    puppeteerConfig: {},
    WHATSAPP_CLIENT_ID: "synthetic-client",
    AUTH_PATH: "/synthetic/auth",
    BOT_PHONE_INTL: "",
    BOT_PHONE: "",
    WHATSAPP_DISPLAY_NAME: "",
    GROUP_HYDRATION_READY_DELAY_MS: 30000,
    path: { join(...parts) { return parts.join("/"); } },
    fs: {
      existsSync() { return false; },
      mkdirSync() {},
      readdirSync() { return []; },
      renameSync() {},
    },
    crypto: { randomBytes() { return Buffer.from("synthetic"); } },
    process: { pid: 99999 },
    groupSnapshotFlights: { clear() {} },
    // Dependencies of the extracted functions are intentionally tiny stubs.
    getChromiumBrowserProcess() { return null; },
    forceTerminateChromiumProcess: async () => {
      counters.forceTerminateCalls += 1;
      return true;
    },
    cleanupOwnedChromiumProcesses: async () => {
      counters.cleanupCalls += 1;
      if (cleanupFailuresRemaining > 0) {
        cleanupFailuresRemaining -= 1;
        counters.cleanupFailures += 1;
        throw new Error("synthetic orphan cleanup failure");
      }
      return false;
    },
    clearChromiumProfileLocks() {
      counters.profileLockClears += 1;
    },
    stopWhatsAppStorageMonitor() {
      counters.storageMonitorStops += 1;
    },
    scheduleReconnect() {
      counters.scheduleCalls.push({ cleanupCalls: counters.cleanupCalls });
      counters.scheduleAfterCleanup.push(counters.cleanupCalls > 0);
    },
    assertClientCleanupComplete() {
      counters.assertionCalls += 1;
      if (assertionFailuresRemaining > 0) {
        assertionFailuresRemaining -= 1;
        counters.assertionFailures += 1;
        return Promise.reject(new Error("synthetic cleanup barrier is not complete"));
      }
      return Promise.resolve();
    },
    recordOwnerControlCheckpoint(name) {
      counters.checkpointCalls.push(name);
    },
    recordWhatsAppPageDiagnostic() {},
    boundedDiagnosticText(value) { return String(value || ""); },
    phoneWithCountry(value) { return String(value || ""); },
    operationalSettings() { return { initTimeoutMs: 1000 }; },
    withTimeoutStrict(value, _ms, fallback) {
      let evaluated;
      try {
        evaluated = typeof value === "function" ? value() : value;
      } catch (error) {
        return Promise.reject(error);
      }
      const mode = timeoutModes.shift() || "pass";
      if (mode === "timeout") return Promise.resolve(fallback);
      return Promise.resolve(evaluated);
    },
    withTimeout(value) {
      try {
        return Promise.resolve(typeof value === "function" ? value() : value);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    installWhatsAppStorageSendGuard() {},
    installWhatsAppSendDiagnostics: async () => {},
    startWhatsAppStorageMonitor() {},
    enforceCaptainWalletThresholdsForAll: async () => {},
    normalizeAllCaptains: async () => ({ status: "not_needed" }),
    registerGroupMembersAsCaptains: async () => ({ results: [] }),
    retryCaptainStatusNotifications: async () => ({ attempted: 0 }),
    retryFailedBookingConfirmations: async () => ({ attempted: 0 }),
    configuredRuntimeGroupId() { return null; },
    startBackgroundOrderRecovery() {},
    isConfiguredGroup() { return false; },
    scheduleConfiguredGroupCaptainSync() {},
    sendConfiguredGroupCaptainWelcome: async () => {},
    captureGroupDiscoveryCandidate: async () => {},
    cacheIncomingWhatsAppMessage() {},
    shouldHandleMessageEvent() { return false; },
    observeAdminSentMessage() {},
    observeFinalBookingConfirmationMessage() {},
    recordGroupMessageTelemetry() {},
    handleIncomingMessage: async () => {},
    scheduleNonCriticalConfiguredGroupMaintenance() {},
    recordConfirmationMessageAck() {},
    handleCaptainAccessCardAck: async () => {},
    resolveGroupChatId() { return ""; },
    handleMessageReaction: async () => {},
    scheduleReactionRetry() {},
  };

  const bootstrap = `
    let client = null;
    let isReady = false;
    let whatsappState = "starting";
    let whatsappLastEvent = null;
    let whatsappLastError = null;
    let qrCodeData = null;
    const clientDisposalStates = new WeakMap();
    let clientCleanupBarrier = Promise.resolve();
    let reconnectTimer = null;
    let whatsappRestartInFlight = null;
    let reconnectAttempts = 0;
    let lastReconnectReason = null;
    let lastReconnectAt = null;
    let lastReadyAt = null;
    let lastDisconnectAt = null;
    let lastInitializationStartedAt = null;
    let lastInitializationFinishedAt = null;
    let initializing = false;
    let initializationRunId = 0;
    let connectionGeneration = 0;
    let memoryRecycleAboveThresholdSamples = 0;
    let lastQrTime = null;
    let temporaryQrGrant = null;
    let whatsappWatchdogTimer = null;
    let groupSnapshotFlights = globalThis.groupSnapshotFlights;
    let officialGroupSnapshot = null;
    let officialGroupSnapshotGroupId = null;
    let officialGroupAdminPhones = new Set();
    let officialGroupAdminSnapshotGroupId = null;
    let officialGroupAdminSnapshotAt = null;
    ${lifecycleSlice}
    ${createClientSlice}
    ${initializeSlice}
    this.api = {
      enqueueClientCleanup,
      waitForClientCleanup,
      disposeClientInstance,
      destroyClient,
      disposeAndScheduleReconnect,
      restartWhatsApp,
      initializeWhatsApp,
      createClient,
    };
    this.getState = () => ({
      client,
      isReady,
      whatsappState,
      whatsappLastEvent,
      whatsappLastError,
      qrCodeData,
      reconnectTimer,
      whatsappRestartInFlight,
      initializing,
      initializationRunId,
      connectionGeneration,
      lastDisconnectAt,
      lastReadyAt,
      lastInitializationStartedAt,
      lastInitializationFinishedAt,
    });
    this.setState = (patch) => {
      if (Object.prototype.hasOwnProperty.call(patch, "client")) client = patch.client;
      if (Object.prototype.hasOwnProperty.call(patch, "isReady")) isReady = patch.isReady;
      if (Object.prototype.hasOwnProperty.call(patch, "whatsappState")) whatsappState = patch.whatsappState;
      if (Object.prototype.hasOwnProperty.call(patch, "whatsappLastEvent")) whatsappLastEvent = patch.whatsappLastEvent;
      if (Object.prototype.hasOwnProperty.call(patch, "whatsappLastError")) whatsappLastError = patch.whatsappLastError;
      if (Object.prototype.hasOwnProperty.call(patch, "qrCodeData")) qrCodeData = patch.qrCodeData;
      if (Object.prototype.hasOwnProperty.call(patch, "reconnectTimer")) reconnectTimer = patch.reconnectTimer;
      if (Object.prototype.hasOwnProperty.call(patch, "whatsappRestartInFlight")) whatsappRestartInFlight = patch.whatsappRestartInFlight;
      if (Object.prototype.hasOwnProperty.call(patch, "initializing")) initializing = patch.initializing;
      if (Object.prototype.hasOwnProperty.call(patch, "initializationRunId")) initializationRunId = patch.initializationRunId;
      if (Object.prototype.hasOwnProperty.call(patch, "connectionGeneration")) connectionGeneration = patch.connectionGeneration;
      if (Object.prototype.hasOwnProperty.call(patch, "lastDisconnectAt")) lastDisconnectAt = patch.lastDisconnectAt;
      if (Object.prototype.hasOwnProperty.call(patch, "lastReadyAt")) lastReadyAt = patch.lastReadyAt;
    };
  `;

  vm.runInNewContext(bootstrap, context, { filename: "server.lifecycle.vm.js" });
  return {
    context,
    api: context.api,
    counters,
    clientQueue,
    deferred,
    state: () => context.getState(),
    setState: (patch) => context.setState(patch),
    setCleanupFailures(value) { cleanupFailuresRemaining = value; },
    setAssertionFailures(value) { assertionFailuresRemaining = value; },
    setTimeoutModes(modes) { timeoutModes = [...modes]; },
  };
}

function lastState(harness) {
  return harness.state();
}

function observableLifecycleState(state) {
  return {
    client: state.client,
    isReady: state.isReady,
    whatsappState: state.whatsappState,
    whatsappLastEvent: state.whatsappLastEvent,
    whatsappLastError: state.whatsappLastError,
    qrCodeData: state.qrCodeData,
    lastDisconnectAt: state.lastDisconnectAt,
    connectionGeneration: state.connectionGeneration,
  };
}

test("disposeClientInstance is single-flight across success, rejection, and timeout", async () => {
  {
    const h = makeHarness();
    const destroy = h.deferred();
    const old = makeFakeClient("success-old", { destroyDeferred: destroy });
    const first = h.api.disposeClientInstance(old, "success-a");
    const second = h.api.disposeClientInstance(old, "success-b");
    assert.strictEqual(first, second, "concurrent disposal callers must share one promise");
    await flush();
    assert.equal(old.destroyCalls, 1, "destroy must start once while the promise is pending");
    destroy.resolve();
    await first;
    assert.equal(old.destroyCalls, 1);
    assert.equal(h.counters.forceTerminateCalls, 0);
    assert.ok(h.counters.cleanupCalls <= 1, "owned-process cleanup must be at most once");
    assert.equal(h.counters.profileLockClears, 1, "profile locks must be released exactly once after cleanup");
  }

  {
    const h = makeHarness();
    const old = makeFakeClient("reject-old", {
      destroy: () => Promise.reject(new Error("synthetic destroy rejection")),
    });
    const first = h.api.disposeClientInstance(old, "reject-a");
    const second = h.api.disposeClientInstance(old, "reject-b");
    assert.strictEqual(first, second);
    await assert.doesNotReject(first, "destroy rejection must reach forced cleanup, not strand the barrier");
    assert.equal(old.destroyCalls, 1);
    assert.equal(h.counters.forceTerminateCalls, 1, "rejection must trigger forced Chromium cleanup once");
    assert.ok(h.counters.cleanupCalls <= 1);
    assert.ok(h.counters.logs.some((entry) => entry[0] === "warn"), "cleanup failure must be observable");
  }

  {
    const h = makeHarness();
    const destroy = h.deferred();
    const old = makeFakeClient("timeout-old", { destroyDeferred: destroy });
    h.setTimeoutModes(["timeout"]);
    const disposal = h.api.disposeClientInstance(old, "timeout");
    await disposal;
    assert.equal(old.destroyCalls, 1);
    assert.equal(h.counters.forceTerminateCalls, 1, "timeout must force termination once");
    const cleanupCalls = h.counters.cleanupCalls;
    destroy.resolve();
    await flush();
    assert.equal(old.destroyCalls, 1, "late destroy resolution must not start a second disposal");
    assert.equal(h.counters.forceTerminateCalls, 1);
    assert.equal(h.counters.cleanupCalls, cleanupCalls);
  }
});

test("initialize waits for a slow predecessor disposal, including callback-owned cleanup", async () => {
  const h = makeHarness();
  const oldDestroy = h.deferred();
  const old = makeFakeClient("callback-owned-old", { destroyDeferred: oldDestroy });
  const next = makeFakeClient("successor");
  h.clientQueue.push(next);

  h.setState({ client: old });
  h.api.disposeAndScheduleReconnect(old, "callback-owned");
  h.setState({ client: null });
  const init = h.api.initializeWhatsApp();
  await flush();
  assert.equal(old.destroyCalls, 1, "callback-owned cleanup must be registered immediately");
  assert.equal(h.counters.clientCreates, 0, "initialize must not create a successor during cleanup");
  assert.equal(h.counters.scheduleCalls.length, 0, "callback reconnect must not outrun cleanup");

  oldDestroy.resolve();
  await init;
  await flush();
  assert.equal(h.counters.clientCreates, 1, "successor creation may start only after cleanup settles");
  assert.equal(next.initializeCalls, 1);
  assert.ok(h.counters.scheduleAfterCleanup.every(Boolean), "every reconnect must follow cleanup");
});

test("manual restart invalidates a suspended initialize and prevents double disposal", async () => {
  const h = makeHarness();
  const oldInit = h.deferred();
  const oldDestroy = h.deferred();
  const old = makeFakeClient("old-init", { initializeDeferred: oldInit, destroyDeferred: oldDestroy });
  h.clientQueue.push(old);

  const initialization = h.api.initializeWhatsApp();
  await flush();
  assert.equal(h.counters.clientCreates, 1);
  assert.equal(old.initializeCalls, 1);

  const restartA = h.api.restartWhatsApp("manual test restart");
  const restartB = h.api.restartWhatsApp("duplicate manual test restart");
  assert.strictEqual(restartA, restartB, "concurrent restart callers must share one promise");
  await flush();
  assert.equal(old.destroyCalls, 1);
  assert.equal(h.counters.clientCreates, 1);

  oldInit.resolve({ late: true });
  await flush();
  assert.equal(old.destroyCalls, 1, "stale initialize success must not dispose the old instance twice");
  assert.equal(h.counters.clientCreates, 1);

  oldDestroy.resolve();
  await Promise.all([initialization, restartA]);
  assert.equal(h.counters.clientCreates, 1, "restart must not implicitly double-start initialization");
  assert.equal(lastState(h).isReady, false);
});

test("late rejection from an old initialize cannot clobber a ready successor", async () => {
  const h = makeHarness();
  const oldInit = h.deferred();
  const oldDestroy = h.deferred();
  const old = makeFakeClient("old-reject", { initializeDeferred: oldInit, destroyDeferred: oldDestroy });
  const successorInit = h.deferred();
  const successor = makeFakeClient("new-ready", { initializeDeferred: successorInit });
  h.clientQueue.push(old, successor);

  const oldRun = h.api.initializeWhatsApp();
  await flush();
  const restart = h.api.restartWhatsApp("replace old run");
  await flush();
  oldDestroy.resolve();
  await restart;

  const newRun = h.api.initializeWhatsApp();
  await flush();
  assert.equal(h.counters.clientCreates, 2);
  successorInit.resolve({ ok: true });
  await newRun;
  successor.emit("ready");
  await flush();
  const beforeLateRejection = lastState(h);
  assert.equal(beforeLateRejection.isReady, true);
  assert.equal(beforeLateRejection.whatsappState, "ready");
  const scheduleCount = h.counters.scheduleCalls.length;

  oldInit.reject(new Error("late stale initialize rejection"));
  await oldRun;
  await flush();
  const afterLateRejection = lastState(h);
  assert.equal(afterLateRejection.isReady, true);
  assert.equal(afterLateRejection.whatsappState, beforeLateRejection.whatsappState);
  assert.equal(afterLateRejection.whatsappLastEvent, beforeLateRejection.whatsappLastEvent);
  assert.equal(afterLateRejection.whatsappLastError, beforeLateRejection.whatsappLastError);
  assert.equal(h.counters.scheduleCalls.length, scheduleCount, "stale rejection must not schedule over the ready successor");
});

test("initialize timeout clears the client before a late ready and waits for disposal", async () => {
  const h = makeHarness();
  const initDeferred = h.deferred();
  const destroyDeferred = h.deferred();
  const old = makeFakeClient("timed-out", {
    initializeDeferred: initDeferred,
    destroyDeferred,
  });
  h.clientQueue.push(old);
  h.setTimeoutModes(["timeout"]);

  const initialization = h.api.initializeWhatsApp();
  await flush();
  assert.equal(old.initializeCalls, 1);
  assert.equal(old.destroyCalls, 1);
  assert.equal(lastState(h).client, null, "a timed-out client must be cleared before late events");
  assert.equal(lastState(h).isReady, false);
  assert.equal(h.counters.scheduleCalls.length, 0, "retry must wait for timed-out client disposal");

  old.emit("ready");
  assert.equal(lastState(h).isReady, false, "late ready from a cleared client must be ignored");
  assert.notEqual(lastState(h).whatsappState, "ready");
  destroyDeferred.resolve();
  await initialization;
  assert.equal(h.counters.scheduleCalls.length, 1);
  assert.ok(h.counters.scheduleAfterCleanup[0], "timeout retry must follow cleanup");
});

test("stale lifecycle callbacks are blocked by both generation and instance identity", async () => {
  const h = makeHarness();
  const old = makeFakeClient("old-events");
  const successor = makeFakeClient("successor-events");
  h.clientQueue.push(old, successor);
  h.api.createClient();
  const oldGeneration = lastState(h).connectionGeneration;
  h.api.createClient();
  const successorGeneration = lastState(h).connectionGeneration;
  assert.ok(successorGeneration > oldGeneration);

  const sentinel = {
    client: successor,
    isReady: true,
    whatsappState: "sentinel-state",
    whatsappLastEvent: "sentinel-event",
    whatsappLastError: "sentinel-error",
    qrCodeData: "sentinel-qr",
    lastDisconnectAt: "sentinel-disconnect",
    connectionGeneration: successorGeneration,
  };
  h.setState(sentinel);
  for (const [event, args] of [
    ["qr", ["late-qr"]],
    ["authenticated", []],
    ["auth_failure", ["late-auth-failure"]],
    ["disconnected", ["late-disconnect"]],
    ["ready", []],
  ]) {
    old.emit(event, ...args);
  }
  assert.deepEqual(observableLifecycleState(lastState(h)), sentinel, "old-generation callbacks must not mutate state");
  assert.equal(h.counters.scheduleCalls.length, 0);

  // Rewind only the harness generation to the old value: the instance check
  // must still reject the same old callbacks after a successor is installed.
  h.setState({ connectionGeneration: oldGeneration });
  for (const [event, args] of [
    ["qr", ["same-generation-late-qr"]],
    ["authenticated", []],
    ["auth_failure", ["same-generation-late-auth-failure"]],
    ["disconnected", ["same-generation-late-disconnect"]],
    ["ready", []],
  ]) {
    old.emit(event, ...args);
  }
  assert.deepEqual(observableLifecycleState(lastState(h)), { ...sentinel, connectionGeneration: oldGeneration }, "identity mismatch must reject callbacks even with a matching generation");
  assert.equal(h.counters.scheduleCalls.length, 0);
});

test("current disconnected schedules only after cleanup, while an old callback cannot schedule after manual restart", async () => {
  {
    const h = makeHarness();
    const destroy = h.deferred();
    const current = makeFakeClient("current-disconnected", { destroyDeferred: destroy });
    h.clientQueue.push(current);
    h.api.createClient();
    h.setState({ client: current });

    current.emit("disconnected", "synthetic disconnect");
    await flush();
    assert.equal(h.counters.scheduleCalls.length, 0);
    assert.equal(lastState(h).client, null);
    destroy.resolve();
    await flush();
    assert.equal(h.counters.scheduleCalls.length, 1);
    assert.ok(h.counters.scheduleAfterCleanup[0], "current reconnect must follow cleanup");
  }

  {
    const h = makeHarness();
    const destroy = h.deferred();
    const old = makeFakeClient("old-disconnected", { destroyDeferred: destroy });
    h.clientQueue.push(old);
    h.api.createClient();
    h.setState({ client: old });
    old.emit("disconnected", "old disconnect");
    const restart = h.api.restartWhatsApp("manual restart while old cleanup waits");
    await flush();
    assert.equal(h.counters.scheduleCalls.length, 0, "neither old callback nor restart may outrun cleanup");
    destroy.resolve();
    await restart;
    await flush();
    assert.equal(h.counters.scheduleCalls.length, 1, "only the current manual restart may schedule the retry");
  }
});

test("cleanup failure propagates until orphan retry succeeds, and a rejecting cleanup assertion blocks createClient", async () => {
  {
    const h = makeHarness();
    const oldDestroy = h.deferred();
    const old = makeFakeClient("orphan-failure-old", { destroyDeferred: oldDestroy });
    const successor = makeFakeClient("should-not-start");
    h.clientQueue.push(successor);
    h.setState({ client: old });
    h.setCleanupFailures(1);

    const initialization = h.api.initializeWhatsApp();
    await flush();
    oldDestroy.resolve();
    await initialization;
    assert.equal(h.counters.clientCreates, 0, "cleanup failure must prevent successor creation");
    await assert.rejects(h.api.waitForClientCleanup(), "failed cleanup must remain observable through the barrier");

    // A subsequent no-client destroy is the explicit orphan-cleanup retry.
    await h.api.destroyClient();
    const recovered = makeFakeClient("recovered-successor");
    h.clientQueue.push(recovered);
    await h.api.initializeWhatsApp();
    assert.equal(h.counters.clientCreates, 1, "successor may start after a successful orphan retry");
  }

  {
    const h = makeHarness();
    const blocked = makeFakeClient("cleanup-assertion-blocked");
    h.clientQueue.push(blocked);
    h.setAssertionFailures(1);
    await h.api.initializeWhatsApp();
    assert.equal(h.counters.assertionFailures, 1);
    assert.equal(h.counters.clientCreates, 0, "assertClientCleanupComplete rejection must precede createClient");

    const allowed = makeFakeClient("cleanup-assertion-allowed");
    h.clientQueue.push(allowed);
    await h.api.initializeWhatsApp();
    assert.equal(h.counters.clientCreates, 1, "create may proceed after the cleanup assertion succeeds");
  }
});

test("owned-process exit verification remains bounded and rejects an occupied profile", async () => {
  const code = sliceBetween("async function assertClientCleanupComplete()", "function enqueueClientCleanup(", "owned-process verification");
  let probes = 0;
  let pauses = 0;
  const context = {
    listOwnedChromiumPids: () => { probes += 1; return probes < 4 ? [111] : []; },
    setTimeout: (callback, ms) => { assert.equal(ms, 100); pauses += 1; callback(); },
  };
  vm.runInNewContext(`${code}\nthis.verify = assertClientCleanupComplete;`, context);
  await assert.doesNotReject(context.verify());
  assert.equal(probes, 4);
  assert.equal(pauses, 3);
  probes = 0;
  pauses = 0;
  context.listOwnedChromiumPids = () => { probes += 1; return [111]; };
  await assert.rejects(context.verify(), /successor start blocked/);
  assert.equal(probes, 20 + 1, "verification must not loop indefinitely");
  assert.equal(pauses, 20);
});
