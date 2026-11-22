"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync("server.js", "utf8");
const start = source.indexOf("async function handleIncomingVoiceBookingIntake");
const end = source.indexOf("\nfunction generalMessageDeletionEnabled", start);
assert.ok(start >= 0 && end > start, "voice intake handler slice exists");
const intakeSlice = source.slice(start, end);
// Both retry decision points must read last_seen_at, otherwise the 24h window silently fails
// closed and every failed row stays sealed as a duplicate.
const windowReads = source.match(/SELECT id,status,attempts,last_seen_at FROM voice_booking_intakes WHERE message_id=\? LIMIT 1/g) || [];
assert.equal(windowReads.length, 2, "intake handler and recovery scan both read the retry window column");
assert.doesNotMatch(source, /SELECT id,status,attempts FROM voice_booking_intakes/);

function buildContext(existingRow) {
  const statements = [];
  const audits = [];
  let db;
  const prepare = (sql) => ({
    get: () => {
      statements.push(["get", sql]);
      if (sql.includes("FROM voice_booking_intakes WHERE message_id=?")) return existingRow;
      return null;
    },
    run: (...args) => {
      statements.push(["run", sql, args]);
      audits.push(sql);
      return { changes: 1 };
    },
  });
  db = { prepare: (sql) => prepare(sql) };
  const context = {
    Buffer,
    console: { warn: () => {}, log: () => {} },
    db,
    fs: {
      mkdtempSync: () => "/tmp/fake-voice-dir",
      writeFileSync: () => {},
      rmSync: () => {},
    },
    path,
    crypto: { createHash: () => ({ update: () => ({ digest: () => "a".repeat(64) }) }) },
    audit: (action, entityType, entityId, payload) => audits.push({ action, entityType, entityId, payload }),
    now: () => new Date().toISOString(),
    voiceBookingIntakeEnabled: () => true,
    isIncomingVoiceMessage: () => true,
    configuredRuntimeGroupId: () => "group-1@g.us",
    phoneWithCountry: (value) => String(value || ""),
    serializedWhatsappUserId: () => "",
    serializedMessageId: () => "false_group-1@g.us_ABCDEF",
    resolveMessageSenderPhone: async () => "962700000000",
    orderTraceKey: (value) => `key:${String(value).slice(0, 4)}`,
    VOICE_BOOKING_INTAKE_MAX_BYTES: 15 * 1024 * 1024,
    voiceBookingSpeechToTextEffective: () => false,
    transcribeVoiceBookingAudio: async () => { throw new Error("must_not_be_called"); },
    ensureProducerUser: () => null,
    createOrderCandidate: () => null,
    downloadIncomingVoiceMediaWithRecovery: async () => {
      const error = new Error("audio_media_pending");
      error.voiceMediaDiagnostic = { attempt: 3, reason: "media_download_error", mimeType: "", filename: "", dataChars: 0, downloadError: "Evaluation failed: media key missing", liveRefetched: true };
      throw error;
    },
  };
  vm.runInNewContext(
    `${intakeSlice}; globalThis.handleIncomingVoiceBookingIntake = handleIncomingVoiceBookingIntake;`,
    context,
  );
  return { context, statements, audits };
}

(async () => {
  // A) failed row inside the window and below the attempt cap is reopened, never duplicated.
  // (45 minutes old, i.e. past the 15 minute backoff, so the retry is allowed to proceed.)
  const fresh = buildContext({ id: 107, status: "failed", attempts: 1, last_seen_at: new Date(Date.now() - 45 * 60 * 1000).toISOString() });
  const firstResult = await fresh.context.handleIncomingVoiceBookingIntake({ type: "ptt" }, { groupId: "group-1@g.us", senderPhone: "0700000000", senderName: "Producer" });
  assert.equal(firstResult.status, "failed");
  assert.equal(firstResult.reason, "audio_media_pending");
  const reopen = fresh.audits.find((entry) => typeof entry === "object" && entry.action === "voice_booking_intake.retry_attempted");
  assert.ok(reopen, "retry_attempted audited");
  assert.equal(reopen.payload.financialMutation, false);
  assert.equal(reopen.payload.orderMutation, false);
  assert.equal(reopen.payload.attempts, 2);
  const sealed = fresh.audits.find((entry) => typeof entry === "object" && entry.action === "voice_booking_intake.failed");
  assert.ok(sealed, "failure audited with diagnostic");
  assert.equal(sealed.payload.mediaDiagnostic.downloadError, "Evaluation failed: media key missing");
  assert.equal(sealed.payload.mediaDiagnostic.attempt, 3);
  const sqlText = fresh.audits.filter((entry) => typeof entry === "string").join(" || ");
  assert.ok(/UPDATE voice_booking_intakes SET status='received',attempts=\?/.test(sqlText), "row reopened in place");
  assert.ok(/UPDATE voice_booking_intakes SET status='failed',error_code=\?/.test(sqlText), "failure recorded in place");
  assert.ok(!/INSERT OR IGNORE INTO voice_booking_intakes/.test(sqlText), "no duplicate intake row for a known message");
  assert.ok(!/INSERT INTO orders|wallet_ledger/.test(sqlText), "no money or order statement executed");

  // B) the attempt cap (8) keeps the strict duplicate exit (bounded churn, no retry storm).
  const exhausted = buildContext({ id: 108, status: "failed", attempts: 8, last_seen_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() });
  const secondResult = await exhausted.context.handleIncomingVoiceBookingIntake({ type: "ptt" }, { groupId: "group-1@g.us", senderPhone: "0700000000", senderName: "Producer" });
  assert.equal(secondResult.status, "duplicate");
  assert.equal(secondResult.stage, "idempotency");
  assert.equal(secondResult.intakeId, 108);
  const exhaustedSql = exhausted.audits.filter((entry) => typeof entry === "string").join(" || ");
  assert.ok(!/UPDATE voice_booking_intakes SET status='received'/.test(exhaustedSql), "capped row is not reopened");
  // B2) a recently failed row waits out the 15 minute backoff instead of burning attempts on every
  // ~30 second recovery pass (the defect the owner approved this change to remove).
  const backingOff = buildContext({ id: 110, status: "failed", attempts: 3, last_seen_at: new Date(Date.now() - 60 * 1000).toISOString() });
  const backoffResult = await backingOff.context.handleIncomingVoiceBookingIntake({ type: "ptt" }, { groupId: "group-1@g.us", senderPhone: "0700" + "000000", senderName: "Producer" });
  assert.equal(backoffResult.status, "duplicate");
  assert.equal(backoffResult.stage, "idempotency");
  assert.equal(backoffResult.intakeId, 110);
  assert.equal(backingOff.audits.filter((entry) => typeof entry === "object" && entry.action === "voice_booking_intake.retry_attempted").length, 0, "no retry audited inside the backoff");
  const backoffSql = backingOff.audits.filter((entry) => typeof entry === "string").join(" || ");
  assert.ok(!/UPDATE voice_booking_intakes SET status='received'/.test(backoffSql), "row inside the backoff is not reopened");
  assert.ok(!/UPDATE voice_booking_intakes SET status='failed'/.test(backoffSql), "row inside the backoff is not re-attempted or re-failed");
  // B3) one row past the backoff and one row below the cap are both required: 8 attempts spread over
  // at least ~2 hours of retries rather than ~3 minutes.
  const eligibleAgain = buildContext({ id: 111, status: "failed", attempts: 7, last_seen_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() });
  await eligibleAgain.context.handleIncomingVoiceBookingIntake({ type: "ptt" }, { groupId: "group-1@g.us", senderPhone: "0700" + "000000", senderName: "Producer" });
  const lateRetry = eligibleAgain.audits.find((entry) => typeof entry === "object" && entry.action === "voice_booking_intake.retry_attempted");
  assert.ok(lateRetry, "last allowed attempt still runs after the backoff");
  assert.equal(lateRetry.payload.attempts, 8);

  // C) a completed row is never reopened (transcripts stay stable, no re-creation of anything).
  const done = buildContext({ id: 109, status: "downloaded", attempts: 2, last_seen_at: new Date().toISOString() });
  const thirdResult = await done.context.handleIncomingVoiceBookingIntake({ type: "ptt" }, { groupId: "group-1@g.us", senderPhone: "0700000000", senderName: "Producer" });
  assert.equal(thirdResult.status, "duplicate");

  console.log("voice intake failed-row retry isolation passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
