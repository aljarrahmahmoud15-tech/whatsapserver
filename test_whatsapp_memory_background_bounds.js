const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

function evaluate(code, context, exportCode) {
  vm.runInNewContext(`${code}\n${exportCode}`, context, { filename: "server.js.vm" });
  return context.result;
}

function loadBoundedConstants(env = {}) {
  const start = source.indexOf("function boundedEnvironmentInteger(");
  const end = source.indexOf("const UNRESOLVED_ORDER_BACKLOG_LIMIT", start);
  assert.ok(start >= 0 && end > start, "bounded environment constants must be extractable");
  const context = { process: { env: { ...env } } };
  evaluate(source.slice(start, end), context, `this.result = {
    boundedEnvironmentInteger,
    reaction: WHATSAPP_REACTION_SCAN_LIMIT,
    batch: WHATSAPP_RECOVERY_BATCH_LIMIT,
    hours: WHATSAPP_RECOVERY_SCAN_HOURS,
    pages: WHATSAPP_RECOVERY_MAX_PAGES,
    loads: WHATSAPP_RECOVERY_EARLIER_LOADS,
  };`);
  return context.result;
}

function makeMessage(id, timestamp, { fromMe = false, body = "synthetic" } = {}) {
  return {
    id: { _serialized: id, fromMe },
    t: timestamp,
    timestamp,
    from: { _serialized: "approved-group@g.us" },
    to: { _serialized: "bot@c.us" },
    author: { _serialized: "captain@c.us" },
    body,
    text: body,
    caption: "",
    type: "chat",
    isNotification: false,
    serialize() { return { id, timestamp, body }; },
  };
}

function makePageModules(initialModels, pageFactory, loadCalls) {
  const chat = {
    msgs: {
      getModelsArray() { return initialModels; },
    },
  };
  const loader = {
    async loadEarlierMsgs() {
      loadCalls.count += 1;
      return pageFactory(loadCalls.count);
    },
  };
  return {
    WAWebWidFactory: { createWid(id) { return { id }; } },
    WAWebCollections: { Chat: { get() { return chat; } } },
    WAWebChatLoadMessages: loader,
  };
}

function historyContext(initialModels, pageFactory) {
  const loadCalls = { count: 0 };
  const modules = makePageModules(initialModels, pageFactory, loadCalls);
  const context = {
    WHATSAPP_RECOVERY_EARLIER_LOADS: 3,
    WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS: 12000,
    resolveReadableGroupChat: async () => null,
    resolveGroupChat: async () => null,
    withTimeout: async (promise) => promise,
    client: {
      pupPage: {
        async evaluate(callback, ...args) {
          return callback(...args);
        },
      },
    },
    window: {
      require(name) {
        if (name === "WAWebLidMigrationUtils" || name === "WAWebQuotedMsgModelUtils") throw new Error(`module unavailable: ${name}`);
        const module = modules[name];
        if (!module) throw new Error(`unexpected module: ${name}`);
        return module;
      },
      WWebJS: {
        getMessageModel(message) {
          return { id: message.id?._serialized, timestamp: message.t, body: message.body };
        },
      },
    },
    loadCalls,
  };
  const start = source.indexOf("async function fetchGroupHistory(");
  const end = source.indexOf("async function fetchGroupOrderScanBatch(", start);
  assert.ok(start >= 0 && end > start, "fetchGroupHistory must be extractable");
  evaluate(source.slice(start, end), context, "this.fetchGroupHistory = fetchGroupHistory;");
  return context;
}

function orderScanContext(initialModels, pageFactory) {
  const loadCalls = { count: 0 };
  const modules = makePageModules(initialModels, pageFactory, loadCalls);
  const context = {
    WHATSAPP_RECOVERY_EARLIER_LOADS: 3,
    WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS: 12000,
    resolveReadableGroupChat: async () => null,
    withTimeout: async (promise) => promise,
    client: {
      pupPage: {
        async evaluate(callback, ...args) {
          return callback(...args);
        },
      },
    },
    window: {
      require(name) {
        const module = modules[name];
        if (!module) throw new Error(`unexpected module: ${name}`);
        return module;
      },
    },
    loadCalls,
  };
  const start = source.indexOf("async function fetchGroupOrderScanBatch(");
  const end = source.indexOf("async function fetchExactGroupEvidenceMessages(", start);
  assert.ok(start >= 0 && end > start, "fetchGroupOrderScanBatch must be extractable");
  evaluate(source.slice(start, end), context, "this.fetchGroupOrderScanBatch = fetchGroupOrderScanBatch;");
  return context;
}

test("bounded environment limits keep approved defaults, caps, and safe minimums", () => {
  const defaults = loadBoundedConstants();
  assert.deepEqual(
    { hours: defaults.hours, pages: defaults.pages, loads: defaults.loads, reaction: defaults.reaction },
    { hours: 6, pages: 5, loads: 3, reaction: 30 },
  );

  const fields = [
    ["WHATSAPP_RECOVERY_SCAN_HOURS", "hours", 6, 1, 6],
    ["WHATSAPP_RECOVERY_MAX_PAGES", "pages", 5, 1, 5],
    ["WHATSAPP_RECOVERY_EARLIER_LOADS", "loads", 3, 1, 3],
    ["WHATSAPP_REACTION_SCAN_LIMIT", "reaction", 30, 1, 30],
  ];
  const hostileValues = [
    ["unset", undefined],
    ["blank", "   "],
    ["negative", "-9"],
    ["zero", "0"],
    ["fractional", "2.5"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["huge", "999999999999999999999999"],
  ];
  for (const [name, property, fallback, minimum, maximum] of fields) {
    for (const [label, raw] of hostileValues) {
      const env = {};
      if (raw !== undefined) env[name] = raw;
      const values = loadBoundedConstants(env);
      const expected = ["unset", "blank", "fractional", "NaN", "Infinity"].includes(label)
        ? fallback
        : label === "huge" ? maximum : minimum;
      assert.equal(values[property], expected, `${name} ${label} must resolve safely`);
      assert.ok(values[property] >= minimum && values[property] <= maximum, `${name} ${label} must stay within bounds`);
    }
    const valid = loadBoundedConstants({ [name]: String(Math.max(minimum, Math.min(maximum, minimum + 1))) });
    assert.equal(valid[property], Math.max(minimum, Math.min(maximum, minimum + 1)), `${name} must accept an integer in range`);
  }

  const batchDefault = loadBoundedConstants();
  assert.equal(batchDefault.batch, 15, "recovery batch default must remain 15");
  for (const [raw, expected] of [["-5", 5], ["0", 5], ["4", 5], ["5", 5], ["15", 15], ["25", 25], ["26", 25], ["999999", 25]]) {
    assert.equal(loadBoundedConstants({ WHATSAPP_RECOVERY_BATCH_LIMIT: raw }).batch, expected, `recovery batch ${raw} must stay in 5..25`);
  }
  assert.equal(loadBoundedConstants({ WHATSAPP_RECOVERY_BATCH_LIMIT: "2.5" }).batch, 15, "fractional recovery batch must use its safe default");
  assert.equal(loadBoundedConstants({ WHATSAPP_RECOVERY_BATCH_LIMIT: "NaN" }).batch, 15, "NaN recovery batch must use its safe default");

  assert.match(source, /const WHATSAPP_RECOVERY_SCAN_HOURS = boundedEnvironmentInteger\("WHATSAPP_RECOVERY_SCAN_HOURS", 6, 1, 6\)/);
  assert.match(source, /const WHATSAPP_RECOVERY_MAX_PAGES = boundedEnvironmentInteger\("WHATSAPP_RECOVERY_MAX_PAGES", 5, 1, 5\)/);
  assert.match(source, /const WHATSAPP_RECOVERY_EARLIER_LOADS = boundedEnvironmentInteger\("WHATSAPP_RECOVERY_EARLIER_LOADS", 3, 1, 3\)/);
  assert.match(source, /const WHATSAPP_REACTION_SCAN_LIMIT = boundedEnvironmentInteger\("WHATSAPP_REACTION_SCAN_LIMIT", 30, 1, 30\)/);
});

test("background history fallback stops at three loads while explicit manual limit 12 remains available", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const context = historyContext(
    [makeMessage("history-initial", nowSeconds)],
    (count) => [makeMessage(`history-page-${count}`, nowSeconds - count)],
  );

  const background = await context.fetchGroupHistory("approved-group@g.us", 100, { includeOutgoing: true });
  assert.equal(context.loadCalls.count, 3, "background history callback must stop after the approved three earlier loads");
  assert.equal(background.chat.id, "approved-group@g.us");
  assert.equal(background.messages.length, 4);

  context.loadCalls.count = 0;
  const manual = await context.fetchGroupHistory("approved-group@g.us", 100, { includeOutgoing: true, earlierLoadLimit: 12 });
  assert.equal(context.loadCalls.count, 12, "explicit manual earlierLoadLimit=12 must not be narrowed to the background cap");
  assert.equal(manual.messages.length, 13);
});

test("in-page order scan applies the cutoff and batch filter without more than three earlier loads", async () => {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const cutoff = now - 6 * 60 * 60 * 1000;
  const oldSeconds = Math.floor((cutoff - 1000) / 1000);
  const context = orderScanContext(
    [makeMessage("order-recent", nowSeconds, { body: "recent synthetic order" })],
    (count) => [makeMessage(`order-old-${count}`, oldSeconds - count, { body: "old synthetic order" })],
  );

  const result = await context.fetchGroupOrderScanBatch("approved-group@g.us", {
    cutoff,
    batch: 2,
    includeOutgoing: true,
  });
  assert.equal(context.loadCalls.count, 3, "order scan must honor the default three-load cap even when the loader always returns a page");
  assert.ok(result.messages.length <= 2, "order scan must honor its bounded batch size");
  assert.deepEqual([...result.messages].map((message) => message.id), ["order-recent"]);
  assert.ok(result.messages.every((message) => Number(message.timestamp) * 1000 >= cutoff), "order scan must filter messages before the six-hour cutoff");
  assert.match(source, /fetchGroupOrderScanBatch\(groupId, \{ cutoff, batch: 50, includeOutgoing: true, earlierLoadLimit: WHATSAPP_RECOVERY_EARLIER_LOADS \}/);
  assert.match(source, /const maxPages = WHATSAPP_RECOVERY_MAX_PAGES/);
});

test("stored reaction recovery reconciles at most 30 unique approved-group targets and preserves gates", async () => {
  const acceptanceRows = Array.from({ length: 70 }, (_, index) => ({ message_id: `acceptance-${index}` }));
  const sourceRows = Array.from({ length: 70 }, (_, index) => ({ message_id: `source-${index}` }));
  const reconciled = [];
  const dbCalls = [];
  let retryCalls = 0;
  let backgroundCalls = 0;
  const context = {
    client: {},
    isReady: true,
    whatsappReactionScanRunning: false,
    configuredRuntimeGroupId: () => "approved-group@g.us",
    isConfiguredGroup: (groupId) => groupId === "approved-group@g.us",
    WHATSAPP_REACTION_SCAN_LIMIT: 30,
    db: {
      prepare(sql) {
        return {
          all(...args) {
            dbCalls.push({ sql, args });
            return sql.includes("acceptance_message_id") ? acceptanceRows : sourceRows;
          },
        };
      },
    },
    reconcileStoredThumbReaction: async (messageId) => { reconciled.push(messageId); },
    retryFailedBookingConfirmations: async () => { retryCalls += 1; },
    startBackgroundOrderRecovery: () => { backgroundCalls += 1; },
    console: { log() {}, warn() {}, error() {} },
  };
  const start = source.indexOf("async function scanPendingAcceptanceReactions()");
  const end = source.indexOf("const recentMessageEventKeys", start);
  assert.ok(start >= 0 && end > start, "stored reaction scanner must be extractable");
  evaluate(source.slice(start, end), context, "this.scanPendingAcceptanceReactions = scanPendingAcceptanceReactions;");

  await context.scanPendingAcceptanceReactions();
  assert.equal(reconciled.length, 30, "70 acceptance IDs plus 70 source IDs must yield no more than 30 reconciliations");
  assert.equal(new Set(reconciled).size, 30, "the background reaction targets must be unique");
  assert.ok(reconciled.every((messageId) => messageId.startsWith("acceptance-")), "the bounded selection must retain deterministic acceptance-first ordering");
  assert.equal(retryCalls, 1);
  assert.equal(backgroundCalls, 1, "background order recovery must still start after reconciliation");
  assert.ok(dbCalls.every(({ args }) => args.at(-1) === 30), "both DB selections must receive the approved reaction limit");
  assert.equal(context.whatsappReactionScanRunning, false, "scanner running state must clear after the batch");

  reconciled.length = 0;
  context.client = null;
  await context.scanPendingAcceptanceReactions();
  assert.equal(reconciled.length, 0, "missing client must preserve the scanner gate");
  context.client = {};
  context.isReady = false;
  await context.scanPendingAcceptanceReactions();
  assert.equal(reconciled.length, 0, "not-ready state must preserve the scanner gate");
  context.isReady = true;
  context.configuredRuntimeGroupId = () => "unapproved-group@g.us";
  await context.scanPendingAcceptanceReactions();
  assert.equal(reconciled.length, 0, "unapproved group must preserve the configured-group gate");

  const scannerSlice = source.slice(start, end);
  assert.match(scannerSlice, /\.slice\(0, WHATSAPP_REACTION_SCAN_LIMIT\)/);
  assert.match(scannerSlice, /await retryFailedBookingConfirmations\(groupId\);/);
  assert.match(scannerSlice, /startBackgroundOrderRecovery\(groupId\);/);
});

test("current-generation direct reaction handler remains uncapped and keeps immediate retry backoff", async () => {
  class FakeClient {
    constructor() { this.handlers = new Map(); }
    on(eventName, handler) { this.handlers.set(eventName, handler); return this; }
  }
  const handled = [];
  const retries = [];
  const context = {
    connectionGeneration: 0,
    groupSnapshotFlights: new Map(),
    officialGroupSnapshot: null,
    officialGroupSnapshotGroupId: null,
    officialGroupAdminPhones: new Set(),
    officialGroupAdminSnapshotGroupId: null,
    officialGroupAdminSnapshotAt: null,
    Client: FakeClient,
    LocalAuth: function LocalAuth() {},
    WHATSAPP_CLIENT_ID: "synthetic-client",
    AUTH_PATH: "/synthetic-auth",
    puppeteerConfig: {},
    installWhatsAppStorageSendGuard() {},
    handleMessageReaction: async (reaction) => { handled.push(reaction); },
    scheduleReactionRetry: (reaction, delays) => { retries.push({ reaction, delays }); },
    console: { log() {}, warn() {}, error() {} },
  };
  const start = source.indexOf("function createClient()");
  const end = source.indexOf("async function initializeWhatsApp()");
  assert.ok(start >= 0 && end > start, "createClient must be extractable");
  evaluate(source.slice(start, end), context, "this.createClient = createClient;");

  const instance = context.createClient();
  const reactionHandler = instance.handlers.get("message_reaction");
  assert.equal(typeof reactionHandler, "function");
  for (let index = 0; index < 31; index += 1) {
    await reactionHandler({ reaction: "👍", id: { _serialized: `live-reaction-${index}` } });
  }
  assert.equal(handled.length, 31, "direct current-generation reactions must not inherit the 30-item background scan cap");
  assert.equal(retries.length, 31, "each direct thumbs-up reaction must retain its immediate retry schedule");
  assert.ok(retries.every(({ delays }) => Array.isArray(delays) && delays[0] === 1500 && delays[1] === 5000));

  context.connectionGeneration += 1;
  await reactionHandler({ reaction: "👍", id: { _serialized: "stale-reaction" } });
  assert.equal(handled.length, 31, "stale direct reaction callbacks must remain generation-gated");
  const directSlice = source.slice(source.indexOf('instance.on("message_reaction"'), source.indexOf("installWhatsAppStorageSendGuard(instance)", start));
  assert.doesNotMatch(directSlice, /WHATSAPP_REACTION_SCAN_LIMIT|reactionMessageLocks|reactionRetrySchedules/);
});

function loadProcessTreeContext() {
  const memoryStart = source.indexOf("function readProcMemoryKb(");
  const watchdogStart = source.indexOf("function startRuntimeMemoryWatchdog(", memoryStart);
  assert.ok(memoryStart >= 0 && watchdogStart > memoryStart, "process-tree helpers must be extractable");
  const files = new Map([
    ["/proc/100/stat", "100 (node) S 1 0"],
    ["/proc/101/stat", "101 (child) S 100 0"],
    ["/proc/102/stat", "102 (grandchild) S 101 0"],
    ["/proc/999/stat", "999 (unrelated) S 1 0"],
    ["/proc/100/smaps_rollup", "Pss: 1024 kB\nVmRSS: 99999 kB"],
    ["/proc/101/smaps_rollup", "Pss: 2048 kB\nVmRSS: 99999 kB"],
    ["/proc/102/status", "VmRSS: 3072 kB"],
  ]);
  const context = {
    fs: {
      readdirSync() { return ["100", "101", "102", "999", "not-a-pid"]; },
      readFileSync(file) {
        if (!files.has(file)) throw new Error(`missing synthetic proc file ${file}`);
        return files.get(file);
      },
    },
  };
  evaluate(source.slice(memoryStart, watchdogStart), context, "this.processTreeRssMb = processTreeRssMb;");
  return context;
}

function loadWatchdogContext() {
  const start = source.indexOf("function startRuntimeMemoryWatchdog(");
  const end = source.indexOf("function stopRuntimeMemoryWatchdog(", start);
  assert.ok(start >= 0 && end > start, "runtime watchdog must be extractable");
  let intervalCallback = null;
  const recycleCalls = [];
  const pruneCalls = [];
  const sampleLogs = [];
  const context = {
    MEMORY_RECYCLE_INTERVAL_MS: 1000,
    MEMORY_PRUNE_TRIGGER_MB: 50,
    MEMORY_PRUNE_COOLDOWN_MS: 999999,
    MEMORY_RECYCLE_TRIGGER_MB: 700,
    MEMORY_RECYCLE_READY_GRACE_MS: 60000,
    MEMORY_RECYCLE_SUSTAINED_SAMPLES: 3,
    MEMORY_USAGE_SAMPLE_LOG_MAX: 120,
    memoryUsageSamples: [],
    runtimeMemoryWatchdogTimer: null,
    runtimeMemoryWatchdogRunning: false,
    lastMemoryRecycleAt: null,
    lastMemoryUsageMb: null,
    lastMemoryPruneAt: null,
    memoryRecycleAboveThresholdSamples: 0,
    qrCodeData: null,
    whatsappState: "ready",
    lastReadyAt: null,
    initializing: false,
    whatsappRestartInFlight: null,
    reconnectTimer: null,
    process: {
      pid: 100,
      version: "v-test",
      uptime: () => 12,
      memoryUsage: () => ({ rss: 100 * 1024 * 1024, heapUsed: 7 * 1024 * 1024 }),
    },
    processTreeRssMb: () => 800,
    setInterval(callback) { intervalCallback = callback; return { unref() {} }; },
    clearInterval() {},
    pruneRuntimeMemoryCaches() { pruneCalls.push("prune"); },
    cleanupStaleRuntimeTempFiles() { pruneCalls.push("temp"); },
    recycleBrowserForMemory: (reason) => { recycleCalls.push(reason); },
    global: {},
    console: { log() {}, warn() {}, error() {}, info(label, raw) { sampleLogs.push({ label, sample: JSON.parse(raw) }); } },
    intervalCallback: null,
    recycleCalls,
    pruneCalls,
    sampleLogs,
  };
  evaluate(source.slice(start, end), context, "this.startRuntimeMemoryWatchdog = startRuntimeMemoryWatchdog;");
  context.startRuntimeMemoryWatchdog();
  assert.equal(typeof intervalCallback, "function");
  context.intervalCallback = intervalCallback;
  return context;
}

test("process-tree PSS sums only descendants, falls back to RSS per process, and returns null without /proc", () => {
  const context = loadProcessTreeContext();
  assert.equal(context.processTreeRssMb(100), 6, "1024+2048 PSS and 3072 RSS fallback should total 6MB");
  context.fs.readdirSync = () => { throw new Error("/proc unavailable"); };
  assert.equal(context.processTreeRssMb(100), null, "unavailable /proc must be diagnosable as null");
});

test("watchdog chooses process-tree RSS, bounds telemetry to 120 samples, and preserves recycle gates", () => {
  const context = loadWatchdogContext();
  const tick = context.intervalCallback;

  tick();
  assert.equal(context.lastMemoryUsageMb.rssMb, 800, "tree RSS must win over lower Node RSS");
  assert.equal(context.lastMemoryUsageMb.nodeRssMb, 100);
  assert.equal(context.lastMemoryUsageMb.treeRssMb, 800);
  assert.equal(context.lastMemoryUsageMb.heapMb, 7);
  assert.equal(typeof context.lastMemoryUsageMb.at, "string");
  assert.equal(context.sampleLogs.length, 1, "each existing watchdog tick must record one memory measurement");
  assert.equal(context.sampleLogs[0].label, "[Runtime] memory sample:");
  assert.deepEqual(context.sampleLogs[0].sample, JSON.parse(JSON.stringify(context.lastMemoryUsageMb)));
  assert.equal(context.memoryRecycleAboveThresholdSamples, 1);

  context.processTreeRssMb = () => null;
  tick();
  assert.equal(context.lastMemoryUsageMb.rssMb, 100, "Node RSS must be the fallback when tree RSS is null");
  assert.equal(context.lastMemoryUsageMb.treeRssMb, null);

  const highTicks = (count) => {
    context.processTreeRssMb = () => 800;
    for (let index = 0; index < count; index += 1) tick();
  };
  const reset = () => {
    context.memoryRecycleAboveThresholdSamples = 0;
    context.runtimeMemoryWatchdogRunning = false;
    context.initializing = false;
    context.whatsappRestartInFlight = null;
    context.reconnectTimer = null;
    context.qrCodeData = null;
    context.whatsappState = "ready";
    context.lastReadyAt = new Date(Date.now() - 120000).toISOString();
    context.recycleCalls.length = 0;
  };

  reset();
  highTicks(2);
  assert.equal(context.recycleCalls.length, 0, "sustained threshold must require three samples");
  highTicks(1);
  assert.equal(context.recycleCalls.length, 1, "all clear gates must request exactly one controlled recycle");

  const gated = [
    ["ready grace", () => { context.lastReadyAt = new Date().toISOString(); }],
    ["QR", () => { context.lastReadyAt = new Date(Date.now() - 120000).toISOString(); context.qrCodeData = "synthetic-qr"; }],
    ["wrong account", () => { context.lastReadyAt = new Date(Date.now() - 120000).toISOString(); context.whatsappState = "wrong_account"; }],
    ["initialization", () => { context.lastReadyAt = new Date(Date.now() - 120000).toISOString(); context.initializing = true; }],
    ["reconnect", () => { context.lastReadyAt = new Date(Date.now() - 120000).toISOString(); context.reconnectTimer = {}; }],
    ["restart", () => { context.lastReadyAt = new Date(Date.now() - 120000).toISOString(); context.whatsappRestartInFlight = Promise.resolve(); }],
    ["watchdog run", () => { context.lastReadyAt = new Date(Date.now() - 120000).toISOString(); context.runtimeMemoryWatchdogRunning = true; }],
  ];
  for (const [label, configure] of gated) {
    reset();
    configure();
    highTicks(4);
    assert.equal(context.recycleCalls.length, 0, `${label} must prevent a memory recycle`);
  }

  reset();
  context.memoryUsageSamples.length = 0;
  context.processTreeRssMb = () => 400;
  for (let index = 0; index < 125; index += 1) tick();
  assert.equal(context.memoryUsageSamples.length, 120, "memory samples must retain at most 120 entries");
  for (const sample of context.memoryUsageSamples) {
    assert.deepEqual(Object.keys(sample).sort(), ["at", "heapMb", "nodeRssMb", "rssMb", "treeRssMb"]);
    assert.equal(typeof sample.rssMb, "number");
    assert.equal(typeof sample.nodeRssMb, "number");
    assert.equal(typeof sample.heapMb, "number");
    assert.equal(typeof sample.treeRssMb, "number");
    assert.ok(Number.isFinite(Date.parse(sample.at)), "sample timestamp must be a valid timestamp");
  }

  context.v8 = { getHeapStatistics: () => ({ heap_size_limit: 900 * 1024 * 1024 }) };
  context.operationalSettings = () => ({ source: "synthetic" });
  context.RENDER_MEMORY_LIMIT_MB = 2048;
  context.NODE_HEAP_MB = 768;
  context.CHROMIUM_HEAP_MB = 512;
  context.DATA_DIR = "/synthetic-data";
  context.AUTH_PATH = "/synthetic-auth";
  context.lastRuntimeTempCleanupAt = null;
  context.RUNTIME_TEMP_FILE_MAX_AGE_MS = 1234;
  context.safePathHealth = () => ({ exists: false });
  context.path = { join: (...parts) => parts.join("/") };
  context.baileysQrCodeData = null;
  context.isReady = true;
  context.whatsappLastEvent = "memory-test";
  context.whatsappLastError = null;
  context.reconnectAttempts = 0;
  context.lastReconnectReason = null;
  context.lastReconnectAt = null;
  context.lastDisconnectAt = null;
  context.lastInitializationStartedAt = null;
  context.lastInitializationFinishedAt = null;
  const healthStart = source.indexOf("function runtimeHealth()");
  const healthEnd = source.indexOf("function ensureSystemUsers()", healthStart);
  assert.ok(healthStart >= 0 && healthEnd > healthStart, "runtimeHealth must be extractable");
  evaluate(source.slice(healthStart, healthEnd), context, "this.runtimeHealth = runtimeHealth;");
  const health = context.runtimeHealth();
  assert.equal(health.memory.recentSamples.length, 120);
  assert.equal(health.memory.measuredScope, "process-tree (node + chromium)");
  assert.deepEqual(Object.keys(health.memory).sort(), [
    "chromiumHeapLimitMb", "externalBytes", "heapLimitBytes", "heapTotalBytes", "heapUsedBytes", "instanceRssMb",
    "lastPruneAt", "lastRecycleAt", "lastSample", "measuredScope", "nodeHeapLimitMb",
    "pruneTriggerMb", "recentSamples", "recycleTriggerMb", "rssBytes", "rssLimitMb",
  ].sort());
  const serialized = JSON.stringify(health);
  for (const forbiddenPayload of [
    "MESSAGE-BODY-SENTINEL",
    "phone-identity-sentinel",
    "123456789@c.us",
    "token-secret",
    "/real/auth/path",
    "--password=secret",
    "raw-page-data",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbiddenPayload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `health telemetry must not contain ${forbiddenPayload}`);
  }
  assert.doesNotMatch(serialized, /message-body|phone-number|whatsapp-id|credential|command-line/i);

  assert.match(source, /const MEMORY_USAGE_SAMPLE_LOG_MAX = 120/);
  assert.match(source, /recentSamples: memoryUsageSamples\.slice\(-MEMORY_USAGE_SAMPLE_LOG_MAX\)/);
});

test("background readers cannot enter native fetchMessages' unbounded history loop", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const history = historyContext([makeMessage("cached-recent", nowSeconds)], () => []);
  let historyResolutions = 0;
  let nativeHistoryCalls = 0;
  history.resolveReadableGroupChat = async () => {
    historyResolutions += 1;
    return { fetchMessages: async () => { nativeHistoryCalls += 1; return [makeMessage("manual-native", nowSeconds)]; } };
  };
  history.resolveGroupChat = async () => { throw new Error("background must not enumerate chats"); };
  await history.fetchGroupHistory("approved-group@g.us", 100, { includeOutgoing: true });
  assert.equal(historyResolutions, 0, "background history uses the explicitly capped page loader");
  assert.equal(nativeHistoryCalls, 0);
  const manual = await history.fetchGroupHistory("approved-group@g.us", 100, { includeOutgoing: true, earlierLoadLimit: 12 });
  assert.equal(historyResolutions, 1, "manual history retains the existing native reader");
  assert.equal(nativeHistoryCalls, 1);
  assert.equal(manual.messages[0].id._serialized, "manual-native");

  const scan = orderScanContext([makeMessage("scan-cached", nowSeconds)], () => []);
  let scanResolutions = 0;
  scan.resolveReadableGroupChat = async () => {
    scanResolutions += 1;
    throw new Error("background order scan must not enter native history");
  };
  await scan.fetchGroupOrderScanBatch("approved-group@g.us", { cutoff: Date.now() - 6 * 60 * 60 * 1000, batch: 10 });
  assert.equal(scanResolutions, 0, "background order scan cannot bypass its earlier-load ceiling");
});

test("cached-only fallback cannot allocate another earlier-load budget to a background page", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const context = historyContext([makeMessage("fallback-cached", nowSeconds)], (count) => [makeMessage(`must-not-load-${count}`, nowSeconds - count)]);
  const fallback = await context.fetchGroupHistory("approved-group@g.us", 100, { includeOutgoing: true, earlierLoadLimit: 3, cacheOnly: true });
  assert.equal(context.loadCalls.count, 0, "fallback must not double the fast page's three-load allowance");
  assert.equal(fallback.messages.length, 1, "fallback still returns cached evidence");
  const backgroundFallbacks = source.match(/fetchGroupHistory\(groupId, Math\.min\(WHATSAPP_RECOVERY_BATCH_LIMIT \* WHATSAPP_RECOVERY_MAX_PAGES, 200\), \{ includeOutgoing: true, earlierLoadLimit: WHATSAPP_RECOVERY_EARLIER_LOADS, cacheOnly: true \}\)/g) || [];
  assert.equal(backgroundFallbacks.length, 2, "both historical and acceptance recovery share the fast scan budget");
});
