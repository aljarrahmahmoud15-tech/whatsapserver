const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Guardrails for the owner-approved CPU instrumentation (2026-11-25). The helpers must stay
// observational: bounded samples, clamped percentages, both cgroup layouts supported, and no
// new timer and no decision logic driven by the CPU figures.
const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

function cpuHelperRegion() {
  const start = source.indexOf("const CPU_SAMPLE_LOG_MAX");
  const end = source.indexOf("async function recycleBrowserForMemory", start);
  assert.ok(start >= 0 && end > start, "cpu helpers must be extractable from server.js");
  return source.slice(start, end);
}

function loadCpuHelpers({ files = {}, cpuUsageSteps = [], uptimeSeconds = 1000, cpuCount = 1, loadavg = [0.5, 0.4, 0.3] } = {}) {
  const logs = [];
  let cpuCalls = 0;
  const context = {
    console: { info: (...args) => logs.push(args.join(" ")), warn: () => {}, log: () => {} },
    process: {
      cpuUsage: () => {
        const step = cpuUsageSteps[Math.min(cpuCalls, cpuUsageSteps.length - 1)] || [0, 0];
        cpuCalls += 1;
        return { user: step[0], system: step[1] };
      },
      uptime: () => uptimeSeconds,
    },
    fs: {
      readFileSync(file) {
        const entry = files[file];
        if (entry === undefined) {
          const error = new Error(`ENOENT: no such file or directory, open '${file}'`);
          error.code = "ENOENT";
          throw error;
        }
        return typeof entry === "function" ? entry() : entry;
      },
    },
    os: {
      cpus: () => Array.from({ length: cpuCount }, () => ({ model: "synthetic" })),
      loadavg: () => loadavg,
    },
  };
  vm.runInNewContext(
    `${cpuHelperRegion()}\nthis.result = { sampleCpuUsage, cpuUsageSummary, readCgroupCpuMicroseconds, cpuUsageSamples, CPU_SAMPLE_LOG_MAX };`,
    context,
    { filename: "server.js.vm" },
  );
  return { ...context.result, logs };
}

test("cpu sample reports node and container window percentages from the elapsed wall time", () => {
  let cgroupUsec = 1000000;
  const helper = loadCpuHelpers({
    files: { "/sys/fs/cgroup/cpu.stat": () => `usage_usec ${cgroupUsec}\nuser_usec ${cgroupUsec}\nsystem_usec 0\n` },
    cpuUsageSteps: [[0, 0], [500000, 250000]],
    uptimeSeconds: 1000,
  });
  const baseline = helper.sampleCpuUsage(1000);
  assert.equal(baseline.windowSeconds, null, "the first sample only establishes a baseline");
  assert.equal(baseline.nodeCpuPct, null);
  assert.equal(baseline.instanceCpuPct, null);
  assert.equal(baseline.instanceCpuSecondsTotal, 1, "cgroup v2 usage_usec is read directly");

  cgroupUsec = 2500000;
  const sample = helper.sampleCpuUsage(101000);
  assert.equal(sample.windowSeconds, 100);
  assert.equal(sample.nodeCpuPct, 0.8, "0.75s of process cpu over a 100s window");
  assert.equal(sample.instanceCpuPct, 1.5, "1.5s of container cpu over a 100s window");
  assert.equal(sample.cpuCount, 1);
  assert.equal(sample.loadAvg1m, 0.5);
  assert.equal(sample.nodeCpuPctSinceBoot, 0.1, "0.75s over 1000s of uptime");
  assert.equal(helper.logs.filter((line) => line.includes("[Runtime] cpu sample:")).length, 2);
});

test("cpu percentages never go negative when a counter is reset", () => {
  let cgroupUsec = 5000000;
  const helper = loadCpuHelpers({
    files: { "/sys/fs/cgroup/cpu.stat": () => `usage_usec ${cgroupUsec}\n` },
    cpuUsageSteps: [[4000000, 1000000], [0, 0]],
  });
  helper.sampleCpuUsage(1000);
  cgroupUsec = 1000000;
  const sample = helper.sampleCpuUsage(61000);
  assert.equal(sample.nodeCpuPct, 0);
  assert.equal(sample.instanceCpuPct, 0);
});

test("cpu sampler supports the cgroup v1 cpuacct layout and degrades without it", () => {
  const v1 = loadCpuHelpers({ files: { "/sys/fs/cgroup/cpuacct/cpuacct.usage": "2000000000" } });
  assert.equal(v1.readCgroupCpuMicroseconds(), 2000000, "nanoseconds are converted to microseconds");

  const combined = loadCpuHelpers({ files: { "/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage": "3500000000" } });
  assert.equal(combined.readCgroupCpuMicroseconds(), 3500000);

  const absent = loadCpuHelpers({ cpuUsageSteps: [[0, 0], [1000000, 0]] });
  assert.equal(absent.readCgroupCpuMicroseconds(), null);
  absent.sampleCpuUsage(1000);
  const sample = absent.sampleCpuUsage(11000);
  assert.equal(sample.instanceCpuPct, null, "container cpu is unknown without a cgroup counter");
  assert.equal(sample.instanceCpuSecondsTotal, null);
  assert.equal(sample.nodeCpuPct, 10, "1s of process cpu over a 10s window");
});

test("cpu sample history stays bounded", () => {
  const helper = loadCpuHelpers({
    files: { "/sys/fs/cgroup/cpu.stat": "usage_usec 5000000\n" },
    cpuUsageSteps: [[100000, 100000]],
  });
  for (let index = 0; index < 80; index += 1) helper.sampleCpuUsage(1000 + index * 120000);
  assert.equal(helper.cpuUsageSamples.length, helper.CPU_SAMPLE_LOG_MAX);
  assert.equal(helper.CPU_SAMPLE_LOG_MAX, 60);
});

test("cpu summary reports windowed min/max/avg and ignores the baseline sample", () => {
  const helper = loadCpuHelpers({
    files: { "/sys/fs/cgroup/cpu.stat": "usage_usec 1000000\n" },
    cpuUsageSteps: [[0, 0]],
  });
  let now = 0;
  helper.sampleCpuUsage(now);
  // Constant counters: every window reports zero usage, and the baseline sample has no window.
  for (let index = 0; index < 3; index += 1) {
    now += 100000;
    helper.sampleCpuUsage(now);
  }
  const summary = helper.cpuUsageSummary();
  assert.equal(summary.samples, 4);
  assert.equal(summary.last.windowSeconds, 100);
  assert.equal(summary.nodeWindowPct.min, 0, "identical process counters mean zero usage in the window");
  assert.equal(summary.nodeWindowPct.max, 0);
  assert.equal(summary.nodeWindowPct.avg, 0);
  assert.equal(summary.instanceWindowPct.avg, 0);
});

test("cpu summary reports min/max/avg across measured windows", () => {
  let cgroupUsec = 1000000;
  const helper = loadCpuHelpers({
    files: { "/sys/fs/cgroup/cpu.stat": () => `usage_usec ${cgroupUsec}\n` },
    cpuUsageSteps: [[0, 0], [200000, 0], [600000, 0], [600000, 0]],
  });
  let now = 0;
  helper.sampleCpuUsage(now);
  now += 100000; cgroupUsec += 100000;
  helper.sampleCpuUsage(now);
  now += 100000; cgroupUsec += 300000;
  helper.sampleCpuUsage(now);
  now += 100000;
  helper.sampleCpuUsage(now);
  const summary = helper.cpuUsageSummary();
  assert.equal(summary.samples, 4);
  assert.equal(summary.last.windowSeconds, 100);
  assert.equal(summary.nodeWindowPct.min, 0);
  assert.equal(summary.nodeWindowPct.max, 0.4);
  assert.equal(summary.nodeWindowPct.avg, 0.2);
  assert.equal(summary.instanceWindowPct.min, 0);
  assert.equal(summary.instanceWindowPct.max, 0.3);
  assert.equal(summary.instanceWindowPct.avg, 0.1);
});

test("cpu instrumentation is observational only", () => {
  const region = cpuHelperRegion();
  assert.doesNotMatch(region, /setInterval|setTimeout/, "cpu sampling must not create its own timer");
  assert.doesNotMatch(region, /require\(/, "cpu helpers must not pull in extra modules");

  const watchdogStart = source.indexOf("function startRuntimeMemoryWatchdog()");
  const watchdogEnd = source.indexOf("}, MEMORY_RECYCLE_INTERVAL_MS)", watchdogStart);
  assert.ok(watchdogStart >= 0 && watchdogEnd > watchdogStart, "memory watchdog must be extractable");
  const watchdog = source.slice(watchdogStart, watchdogEnd);
  assert.equal(
    (watchdog.match(/sampleCpuUsage\(\)/g) || []).length,
    2,
    "one baseline sample at start plus one per existing tick",
  );
  assert.match(watchdog, /if \(runtimeMemoryWatchdogTimer \|\| MEMORY_RECYCLE_INTERVAL_MS <= 0\) return;\n\s*\/\/[^\n]*\n\s*sampleCpuUsage\(\);/);
  assert.doesNotMatch(watchdog, /if\s*\([^)]*Cpu/, "cpu figures must never gate pruning or recycling");

  assert.match(source, /cpu: \{\s*\n\s*\.\.\.cpuUsageSummary\(\),/, "health payload must expose cpu readings");
  assert.ok(source.includes('const os = require("os");'), "os module must be required for cpu counts");
});
