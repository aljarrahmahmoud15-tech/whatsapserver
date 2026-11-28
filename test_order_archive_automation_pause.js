const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");
assert.match(source, /const ORDER_ARCHIVE_AUTOMATION_ENABLED = false;/,
  "terminal-order auto-archive stays paused until separately re-authorized");

const archiveMatch = source.match(/^function archiveExpiredOrders\(\) \{[\s\S]*?^\}/m);
assert.ok(archiveMatch, "scheduled archive function exists for explicit future restoration");
const archiveContext = { ORDER_ARCHIVE_AUTOMATION_ENABLED: false };
vm.runInNewContext(`${archiveMatch[0]}\nthis.runArchive = archiveExpiredOrders;`, archiveContext);
const result = archiveContext.runArchive();
assert.deepEqual({ ...result }, {
  archivedOrders: 0,
  archivedCandidates: 0,
  skipped: true,
  reason: "owner_review_required",
});

const schedulerMatch = source.match(/^function startOrderArchiveScheduler\(\) \{[\s\S]*?^\}/m);
assert.ok(schedulerMatch, "archive scheduler exists");
let cutoffInitializations = 0;
let archiveCalls = 0;
let scheduledIntervals = 0;
const schedulerContext = {
  ORDER_ARCHIVE_AUTOMATION_ENABLED: false,
  initializeCaptainOrderVisibilityCutoffOnce: async () => {
    cutoffInitializations += 1;
    return { skipped: true };
  },
  archiveExpiredOrders: () => { archiveCalls += 1; },
  setInterval: () => { scheduledIntervals += 1; throw new Error("disabled archive must not schedule a sweep"); },
  setTimeout: () => { throw new Error("unexpected cutoff retry"); },
  console: { error() {} },
};
vm.runInNewContext(`${schedulerMatch[0]}\nthis.startScheduler = startOrderArchiveScheduler;`, schedulerContext);
schedulerContext.startScheduler();
assert.equal(cutoffInitializations, 1, "the unrelated visibility-cutoff initialization remains available");
assert.equal(archiveCalls, 0, "no startup archive sweep runs");
assert.equal(scheduledIntervals, 0, "no periodic terminal archive is scheduled");

console.log("terminal order archive remains paused during owner-reviewed Captain archive workflow");
