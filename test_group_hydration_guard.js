const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("server.js", "utf8");

assert.match(source, /async function readGroupSnapshot\(groupId\)/, "group snapshot resolver must exist");
assert.match(source, /withStageTimeout\("wwebjs_get_chat", 8000/, "WWebJS chat fetch must have a labeled stage timeout");
assert.match(source, /withStageTimeout\("find_or_create_latest_chat", 8000/, "chat discovery must have a labeled stage timeout");
assert.match(source, /withStageTimeout\("group_metadata_query", 14000/, "group metadata query must have a labeled stage timeout");
assert.match(source, /withStageTimeout\("group_metadata_fallback_update", 8000/, "metadata fallback update must have a labeled stage timeout");
assert.match(source, /withStageTimeout\("refetch_hydrated_chat", 7000/, "hydrated chat refetch must have a labeled stage timeout");
assert.match(source, /WAWebGroupQueryJob/, "snapshot resolver must refresh group metadata when available");
assert.match(source, /group_participants_empty/, "empty participant snapshots must be diagnosed explicitly");
assert.match(source, /group_snapshot_evaluation_timeout/, "snapshot evaluation timeouts must be diagnosed explicitly");
assert.match(source, /group_snapshot_stage_timeout/, "timed-out page stages must report their own failure class");
assert.match(source, /stage: error\.snapshotStage/, "timed-out page stages must expose the stage name");
assert.match(source, /lastGroupHydrationDiagnostic/, "group hydration state must be exposed to runtime diagnostics");
assert.match(source, /groupHydration: \{ \.\.\.lastGroupHydrationDiagnostic \}/, "public/V27 status must expose group hydration state");
assert.match(source, /const groupSnapshotFlights = new Map\(\)/, "group hydration must keep a single-flight registry");
assert.match(source, /const key = `\$\{generationAtStart\}:\$\{groupId\}`/, "hydration single-flight must be scoped to connection generation and group");
assert.match(source, /createGroupSnapshotFlight\(key,/, "snapshot reads must share an in-flight evaluation");
assert.match(source, /pageAtStart\.evaluate/, "snapshot evaluation must use the page captured for its connection generation");
assert.match(source, /if \(groupSnapshotFlights\.get\(key\) === flight\) groupSnapshotFlights\.delete\(key\)/, "settled or expired flights must be removed without deleting a newer retry");
assert.match(source, /function handleWhatsAppBrowserPageError\(instance, generation, error\)/, "active browser page crashes must have a recovery handler");
assert.match(source, /page\.on\("error", \(error\) => handleWhatsAppBrowserPageError\(instance, generation, error\)\)/, "Puppeteer page errors must be routed to controlled recovery");
assert.match(source, /restartWhatsApp\("Chromium page crashed"\)/, "a crashed active page must schedule the controlled reconnect path");
assert.match(source, /groupSnapshotFlights\.clear\(\)/, "a new WhatsApp client generation must discard stale snapshot flights");
assert.match(source, /function scheduleNonCriticalConfiguredGroupMaintenance/, "non-critical group maintenance must have a deferred path");
const messageHandler = source.slice(source.indexOf('instance.on("message", async (msg) =>'), source.indexOf('instance.on("message_reaction", async (reaction) =>'));
assert.ok(messageHandler.indexOf("await handleIncomingMessage") < messageHandler.indexOf("scheduleNonCriticalConfiguredGroupMaintenance"), "message handling must precede non-critical group maintenance");
assert.match(source, /WHATSAPP_REACTION_SEND_TIMEOUT/, "reaction send timeout must be distinguishable from readback failure");
assert.match(source, /reaction_send_timeout/, "reaction send timeout must be logged distinctly");
assert.match(source, /reaction_sent_visibility_unconfirmed/, "reaction readback failure must be logged distinctly");

const flightStart = source.indexOf("function createGroupSnapshotFlight(");
const flightEnd = source.indexOf("async function readGroupSnapshot", flightStart);
assert.ok(flightStart >= 0 && flightEnd > flightStart, "group snapshot flight helper exists");
const flightContext = { groupSnapshotFlights: new Map(), setTimeout, clearTimeout };
vm.runInNewContext(`${source.slice(flightStart, flightEnd)}\nthis.createGroupSnapshotFlight = createGroupSnapshotFlight;`, flightContext);

const pageErrorStart = source.indexOf("function handleWhatsAppBrowserPageError(");
const pageErrorEnd = source.indexOf("async function installWhatsAppSendDiagnostics", pageErrorStart);
assert.ok(pageErrorStart >= 0 && pageErrorEnd > pageErrorStart, "page crash recovery helper exists");
const pageErrors = [];
const restartCalls = [];
const pageErrorContext = {
  connectionGeneration: 7,
  client: {},
  whatsappRestartInFlight: null,
  whatsappLastError: null,
  whatsappLastEvent: null,
  isReady: true,
  boundedDiagnosticText(value, limit = 1200) { return String(value || "").slice(0, limit); },
  recordWhatsAppPageDiagnostic(type, payload) { pageErrors.push({ type, payload }); },
  console: { warn() {}, error() {} },
};
pageErrorContext.restartWhatsApp = (reason) => {
  restartCalls.push(reason);
  pageErrorContext.whatsappRestartInFlight = Promise.resolve();
  return pageErrorContext.whatsappRestartInFlight;
};
vm.runInNewContext(`${source.slice(pageErrorStart, pageErrorEnd)}\nthis.handleWhatsAppBrowserPageError = handleWhatsAppBrowserPageError;`, pageErrorContext);

(async () => {
  let resolveFirst;
  let evaluations = 0;
  const timedOut = flightContext.createGroupSnapshotFlight("generation-a:configured-group", () => new Promise((resolve) => { resolveFirst = resolve; }), 10);
  const timeoutResult = await timedOut.timed;
  assert.equal(timeoutResult.reason, "group_snapshot_evaluation_timeout");
  assert.equal(timeoutResult.stage, "page_evaluate", "the global timeout must identify the Puppeteer evaluation stage");
  assert.equal(flightContext.groupSnapshotFlights.has("generation-a:configured-group"), true, "a timed-out flight must remain registered while its page evaluation is unresolved");

  const blockedRetry = flightContext.createGroupSnapshotFlight("generation-a:configured-group", () => {
    evaluations += 1;
    return Promise.resolve({ ok: true });
  }, 250);
  assert.strictEqual(blockedRetry, timedOut, "calls during a stalled evaluation must share the timed-out flight instead of starting overlapping page work");
  assert.equal(evaluations, 0, "a second page evaluation must not start while the first remains unresolved");

  resolveFirst({ ok: true, snapshot: { participants: [] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flightContext.groupSnapshotFlights.has("generation-a:configured-group"), false, "the flight must be released after the underlying page evaluation settles");

  let resolveRetry;
  const retry = flightContext.createGroupSnapshotFlight("generation-a:configured-group", () => new Promise((resolve) => { resolveRetry = resolve; }), 250);
  assert.notStrictEqual(retry, timedOut, "a new evaluation may start after the previous page work has actually settled");
  await new Promise((resolve) => setImmediate(resolve));
  resolveRetry({ ok: true, snapshot: { participants: ["synthetic"] } });
  const retryResult = await retry.timed;
  assert.equal(retryResult.ok, true);
  assert.equal(flightContext.groupSnapshotFlights.has("generation-a:configured-group"), false);

  const activeInstance = pageErrorContext.client;
  pageErrorContext.handleWhatsAppBrowserPageError(activeInstance, 7, { name: "Error", message: "Page crashed!" });
  assert.equal(pageErrorContext.isReady, false, "a crashed active page must clear the ready flag");
  assert.equal(pageErrorContext.whatsappLastEvent, "browser_page_error");
  assert.equal(restartCalls.length, 1, "a crashed active page must start one controlled reconnect");
  assert.equal(restartCalls[0], "Chromium page crashed");
  assert.equal(pageErrors[0].type, "browser_page_error");

  pageErrorContext.handleWhatsAppBrowserPageError(activeInstance, 7, { name: "Error", message: "Page crashed again" });
  assert.equal(restartCalls.length, 1, "duplicate crash events during reconnect must not schedule another restart");
  pageErrorContext.connectionGeneration = 8;
  pageErrorContext.whatsappRestartInFlight = null;
  pageErrorContext.isReady = true;
  pageErrorContext.handleWhatsAppBrowserPageError(activeInstance, 7, { name: "Error", message: "late page error" });
  assert.equal(restartCalls.length, 1, "an error from an old client generation must not restart the current client");

  console.log("group hydration timeout retry and Chromium page recovery verified");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
