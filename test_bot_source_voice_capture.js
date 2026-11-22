"use strict";
// Owner-approved option (B): voice notes sent FROM the bot number inside the official group are
// captured, downloaded and transcribed, but they must never create a producer/downloader identity
// or an order candidate, and nothing about text, reaction, acceptance or deletion handling changes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync("server.js", "utf8");
const BOT_PHONE = "9627" + "7000" + "988";

// ---------------------------------------------------------------- static guards
assert.ok(
  source.includes('const VOICE_BOOKING_BOT_SOURCE_SETTING_KEY = "official_group_voice_booking_intake_bot_source_enabled";'),
  "bot-source capture has its own settings key",
);
assert.ok(
  /function voiceBookingBotSourceCaptureEnabled\(\) \{\n  return readBooleanSetting\(VOICE_BOOKING_BOT_SOURCE_SETTING_KEY, true\);\n\}/.test(source),
  "bot-source capture is adopted by default because the owner approved it",
);
assert.ok(
  source.includes("(isBotSourceVoice && !voiceBookingBotSourceCaptureEnabled())"),
  "the intake guard only lets bot audio through while the policy is on",
);
assert.doesNotMatch(
  source,
  /if \(!voiceBookingIntakeEnabled\(\) \|\| !isIncomingVoiceMessage\(message\) \|\| message\?\.fromMe \|\|/,
  "the unconditional bot-message rejection inside the intake guard is gone",
);
assert.ok(
  source.includes('let normalizedPhone = phoneWithCountry(senderPhone) || (isBotSourceVoice ? phoneWithCountry(connectedBotPhone()) : "");'),
  "bot-source audio falls back to the connected bot number instead of being skipped",
);
assert.ok(
  source.includes('if (isBotSourceVoice && extraction.status === "needs_review"'),
  "bot-source extraction is checked before any candidate path",
);
assert.ok(
  source.includes('voice_booking_intake.bot_source_capture_deferred') && source.includes("orderCandidateCreated: false"),
  "skipping the candidate is audited as transcription-only evidence",
);
assert.ok(
  source.includes('} else if (extraction.status === "needs_review" && Number.isFinite(Number(extraction.fields?.priceCents)) && Number(extraction.fields.priceCents) > 0) {\n          const producer = ensureProducerUser(normalizedPhone'),
  "incoming (captain) audio keeps its existing candidate creation path",
);

// The live message path must reach the intake for bot audio only and then return, so self messages
// stay invisible to text, order, reaction, acceptance and deletion handling.
const liveStart = source.indexOf("async function handleIncomingMessage(msg, { allowSelf = false } = {}) {");
assert.ok(liveStart >= 0, "live message handler found");
const liveSlice = source.slice(liveStart, source.indexOf("\nasync function ", liveStart + 10));
assert.ok(liveSlice.includes("if (msg.fromMe && !allowSelf) {"), "self messages still take a dedicated branch");
assert.ok(
  liveSlice.includes("voiceBookingIntakeEnabled() && voiceBookingBotSourceCaptureEnabled() && isIncomingVoiceMessage(msg)"),
  "only voice messages reach the intake from that branch",
);
assert.ok(liveSlice.includes("if (selfGroupId && selfGroupId === configuredRuntimeGroupId())"), "bot-source capture stays inside the official group");
const selfBranchReturn = liveSlice.indexOf("\n    return;");
assert.ok(selfBranchReturn > 0 && selfBranchReturn < liveSlice.indexOf("const body = String(msg.body"), "self messages return before body and reaction processing");
assert.ok(liveSlice.includes("if (!msg) return;"), "null messages are still rejected first");

// Historical scan follows the same policy, and the fetch helper contract is untouched.
assert.ok(
  source.includes("fetchGroupHistory(groupId, 200, { includeOutgoing: voiceBookingBotSourceCaptureEnabled(), earlierLoadLimit: WHATSAPP_RECOVERY_EARLIER_LOADS, cacheOnly: false })"),
  "the voice recovery scan sees outgoing audio only while the policy is on",
);
assert.ok(source.includes("(message?.fromMe && !voiceBookingBotSourceCaptureEnabled())"), "the historical row filter follows the same policy");
assert.ok(
  source.includes("const senderPhone = intakeMessage?.fromMe ? connectedBotPhone() : await resolveMessageSenderPhone(intakeMessage)"),
  "historical bot audio is attributed to the bot number",
);
assert.ok(
  source.includes("chat.fetchMessages(includeOutgoing ? { limit } : { limit, fromMe: false })"),
  "fetchGroupHistory still honours its includeOutgoing contract",
);

// Owner-only toggle plus honest disclosure.
assert.ok(
  source.includes('setSetting(VOICE_BOOKING_BOT_SOURCE_SETTING_KEY, botSourceCapture ? "1" : "0");'),
  "the owner-only PATCH endpoint can switch bot-source capture back off",
);
const policyStart = source.indexOf("function voiceBookingIntakePolicyResponse()");
const policySlice = source.slice(policyStart, source.indexOf("\nfunction ", policyStart + 10));
assert.ok(policySlice.includes("botSourceCapture,"), "policy response discloses botSourceCapture");
assert.ok(
  policySlice.includes('botSourceEffects: "capture_download_transcription_and_field_extraction_only_no_candidate"'),
  "policy response states the bot-source effect is transcription only",
);
assert.ok(policySlice.includes("draftBooking: false"), "policy still declares no draft booking");
assert.ok(policySlice.includes("financialMutation: false") && policySlice.includes("orderMutation: false"), "policy still declares no money or order mutation");
assert.doesNotMatch(source, /botSourceCapture.*draftBooking: true/, "bot-source capture never implies draft booking");

// ---------------------------------------------------------------- behavioural harness
const start = source.indexOf("async function handleIncomingVoiceBookingIntake");
const end = source.indexOf("\nfunction generalMessageDeletionEnabled", start);
assert.ok(start >= 0 && end > start, "voice intake handler slice exists");
const intakeSlice = source.slice(start, end);

function buildContext(options = {}) {
  const statements = [];
  const audits = [];
  let producerCalls = 0;
  let candidateCalls = 0;
  const prepare = (sql) => ({
    get: () => {
      statements.push(["get", sql]);
      if (sql.includes("FROM voice_booking_intakes WHERE message_id=?")) return options.existingRow || null;
      return null;
    },
    run: (...args) => {
      statements.push(["run", sql, args]);
      audits.push(sql);
      if (sql.includes("INSERT INTO order_candidates")) candidateCalls += 1;
      return { changes: 1 };
    },
  });
  const context = {
    Buffer,
    console: { warn: () => {}, log: () => {} },
    db: { prepare: (sql) => prepare(sql) },
    fs: { mkdtempSync: () => "/tmp/fake-voice-dir", writeFileSync: () => {}, rmSync: () => {} },
    path,
    crypto: { createHash: () => ({ update: () => ({ digest: () => "a".repeat(64) }) }) },
    setTimeout: (fn) => fn(),
    audit: (action, entityType, entityId, payload) => audits.push({ action, entityType, entityId, payload }),
    now: () => new Date().toISOString(),
    displayPhone: (value) => `+${String(value || "").slice(-4)}`,
    voiceBookingIntakeEnabled: () => true,
    voiceBookingBotSourceCaptureEnabled: () => options.botSourceCapture !== false,
    isIncomingVoiceMessage: (message) => message?.type === "ptt" || message?.type === "audio",
    configuredRuntimeGroupId: () => "group-1@g.us",
    connectedBotPhone: () => BOT_PHONE,
    phoneWithCountry: (value) => String(value || ""),
    serializedWhatsappUserId: () => "",
    serializedMessageId: () => "false_group-1@g.us_BOTVOICE1",
    resolveMessageSenderPhone: async () => options.incomingSenderPhone || "",
    orderTraceKey: (value) => `key:${String(value).slice(0, 4)}`,
    voiceBookingIntakeFailedRetryEligible: () => false,
    VOICE_BOOKING_INTAKE_MAX_BYTES: 15 * 1024 * 1024,
    voiceBookingSpeechToTextEffective: () => options.transcribe === true,
    voiceBookingFieldExtractionEffective: () => options.extract === true,
    transcribeVoiceBookingAudio: async () => ({ transcript: "السعر خمسة من عمان إلى الزرقاء", language: "ar", confidence: 0.91, provider: "openai" }),
    extractVoiceBookingFields: () => options.extraction || { status: "needs_review", confidence: 0.8, fields: { priceCents: 500, fromCity: "عمان", toCity: "الزرقاء" } },
    ensureProducerUser: () => { producerCalls += 1; return { id: 5, active: 1 }; },
    createOrderCandidate: () => { candidateCalls += 1; return { id: 77 }; },
    downloadIncomingVoiceMediaWithRecovery: async () => {
      if (options.mediaFails) {
        const error = new Error("audio_media_pending");
        error.voiceMediaDiagnostic = { attempt: 1, reason: "media_download_error", mimeType: "", filename: "", dataChars: 0, downloadError: "Evaluation failed: media key missing", liveRefetched: true };
        throw error;
      }
      return { media: { data: Buffer.from("voice-bytes").toString("base64"), mimetype: "audio/ogg; codecs=opus" }, mimeType: "audio/ogg; codecs=opus" };
    },
  };
  vm.runInNewContext(`${intakeSlice}; globalThis.handleIncomingVoiceBookingIntake = handleIncomingVoiceBookingIntake;`, context);
  return { context, statements, audits, calls: () => ({ producerCalls, candidateCalls }) };
}

const botVoice = { type: "ptt", fromMe: true, from: "group-1@g.us", timestamp: 1_760_000_000 };
const captainVoice = { type: "ptt", fromMe: false, from: "group-1@g.us", timestamp: 1_760_000_000 };

(async () => {
  // 1) bot-source voice with the policy on is captured, not refused by the guard. Media still fails
  //    live (that is the separate known defect), which is exactly the diagnostic the owner wants.
  const captured = buildContext({ mediaFails: true });
  const capturedResult = await captured.context.handleIncomingVoiceBookingIntake(botVoice, {
    groupId: "group-1@g.us",
    senderPhone: captured.context.connectedBotPhone(),
    senderName: "وصلني الآن",
  });
  assert.equal(capturedResult.stage, "media_download", "bot audio passes the guard and reaches media download");
  assert.equal(capturedResult.status, "failed");
  assert.equal(capturedResult.reason, "audio_media_pending");
  const capturedSql = captured.audits.filter((entry) => typeof entry === "string").join(" || ");
  assert.ok(/INSERT OR IGNORE INTO voice_booking_intakes/.test(capturedSql), "a bot-source voice note gets an intake row");
  assert.ok(!/status='skipped'/.test(capturedSql), "bot-source audio is never skipped as unresolved identity");
  const receipt = captured.statements.find((entry) => entry[1].includes("INSERT OR IGNORE INTO voice_booking_intakes"));
  assert.ok(receipt, "receipt statement recorded");
  assert.equal(receipt[2][2], BOT_PHONE, "the intake row is attributed to the bot number");
  const sealed = captured.audits.find((entry) => typeof entry === "object" && entry.action === "voice_booking_intake.failed");
  assert.ok(sealed, "failure diagnostic captured for bot audio as well");
  assert.equal(sealed.payload.mediaDiagnostic.downloadError, "Evaluation failed: media key missing");

  // 2) with the policy off the behaviour is exactly the previous one: the guard refuses bot audio.
  const off = buildContext({ botSourceCapture: false, mediaFails: true });
  const offResult = await off.context.handleIncomingVoiceBookingIntake(botVoice, {
    groupId: "group-1@g.us",
    senderPhone: off.context.connectedBotPhone(),
    senderName: "وصلني الآن",
  });
  assert.equal(offResult.status, "not_applicable");
  assert.equal(offResult.stage, "guard");
  assert.equal(off.audits.filter((entry) => typeof entry === "string").length, 0, "no statement runs when the policy is off");

  // 3) full capture path: transcribed and extracted, but NO producer and NO candidate.
  const full = buildContext({ transcribe: true, extract: true });
  const fullResult = await full.context.handleIncomingVoiceBookingIntake(botVoice, {
    groupId: "group-1@g.us",
    senderPhone: full.context.connectedBotPhone(),
    senderName: "وصلني الآن",
  });
  assert.equal(fullResult.status, "downloaded", "bot audio completes transcription");
  assert.equal(fullResult.stage, "transcription_or_extraction");
  assert.ok(String(fullResult.transcript).length > 0, "transcript captured");
  const deferred = full.audits.find((entry) => typeof entry === "object" && entry.action === "voice_booking_intake.bot_source_capture_deferred");
  assert.ok(deferred, "the skipped candidate is audited");
  assert.equal(deferred.payload.orderCandidateCreated, false);
  assert.equal(deferred.payload.financialMutation, false);
  assert.equal(deferred.payload.orderMutation, false);
  assert.equal(deferred.payload.reason, "bot_source_capture_is_transcription_only");
  assert.equal(full.calls().producerCalls, 0, "no producer/downloader identity is created for the bot number");
  assert.equal(full.calls().candidateCalls, 0, "no order candidate is created from bot audio");
  const fullSql = full.audits.filter((entry) => typeof entry === "string").join(" || ");
  assert.ok(!/INSERT INTO order_candidates/.test(fullSql), "no candidate insert");
  assert.ok(!/INSERT INTO orders|UPDATE users SET|wallet_ledger/.test(fullSql), "no money or order statement executed");
  assert.ok(/UPDATE voice_booking_intakes SET status='downloaded',transcript=/.test(fullSql), "transcript stored on the intake row");

  // 4) regression: an incoming captain voice note still creates a candidate exactly as before.
  const incoming = buildContext({ transcribe: true, extract: true, incomingSenderPhone: "0700" + "000000" });
  const incomingResult = await incoming.context.handleIncomingVoiceBookingIntake(captainVoice, {
    groupId: "group-1@g.us",
    senderPhone: "0700" + "000000",
    senderName: "Captain",
  });
  assert.equal(incomingResult.status, "downloaded");
  assert.equal(incoming.calls().producerCalls, 1, "producer lookup still happens for real captain audio");
  const candidateAudit = incoming.audits.find((entry) => typeof entry === "object" && entry.action === "voice_booking_intake.candidate_created");
  assert.ok(candidateAudit, "candidate creation for captain audio is untouched");
  assert.equal(candidateAudit.entityId, 77);
  assert.equal(candidateAudit.payload.settlementMutation, false);

  // 5) a bot voice note outside the official group is still refused.
  const outside = buildContext({ mediaFails: true });
  const outsideResult = await outside.context.handleIncomingVoiceBookingIntake({ ...botVoice, from: "group-2@g.us" }, {
    groupId: "group-2@g.us",
    senderPhone: outside.context.connectedBotPhone(),
    senderName: "وصلني الآن",
  });
  assert.equal(outsideResult.status, "not_applicable");
  assert.equal(outsideResult.stage, "guard");

  console.log("bot-source voice capture isolation passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
