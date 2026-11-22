"use strict";
// Owner-approved diagnostic 2026-11-22: HTTP 429 from the speech-to-text provider must record the
// provider's own machine-readable reason inside voice_booking_intakes.error_code, so an exhausted
// quota and a request-rate ceiling stop looking identical in the read-only probe.
// Run in isolation: the transcription helpers are sliced out of server.js and evaluated in a fresh
// vm context with a symbolic credential. The server is never required and never booted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("server.js", "utf8");

function sliceBetween(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = endMarker === null ? source.length : source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${label} slice exists`);
  return source.slice(start, end);
}
function constDeclaration(name) {
  const match = source.match(new RegExp(`^const ${name} = .+$`, "m"));
  assert.ok(match, `const ${name} is declared`);
  return match[0];
}

const boundedSlice = sliceBetween("function boundedVoiceTranscript", "function extractVoiceBookingFields", "transcript bounding helper");
const confidenceSlice = sliceBetween("function voiceTranscriptConfidence", "function voiceTranscriptionProviderErrorCode", "confidence helper");
const helperSlice = sliceBetween("function voiceTranscriptionProviderErrorCode", "async function transcribeVoiceBookingAudio", "provider error code helper");
const transcribeSlice = sliceBetween("async function transcribeVoiceBookingAudio", "async function downloadIncomingVoiceMediaWithRecovery", "transcription function");

const code = [
  constDeclaration("VOICE_BOOKING_STT_MAX_TRANSCRIPT_CHARS"),
  constDeclaration("VOICE_BOOKING_STT_ERROR_CODE_MAX_CHARS"),
  boundedSlice,
  confidenceSlice,
  helperSlice,
  transcribeSlice,
].join("\n");

// Symbolic only: built at runtime so no credential-shaped literal ever appears in a committed line.
const STT_KEY_SENTINEL = ["stt", "symbolic", "fixture", "credential"].join("-");
const PROVIDER_FREE_TEXT = ["provider", "billing", "sentence", "must-not-be-stored"].join(" ");

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
function unparseableResponse(status) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("non-json body");
    },
  };
}

async function runTranscribe(response) {
  const context = {
    process: { env: { VOICE_BOOKING_STT_API_KEY: STT_KEY_SENTINEL } },
    console: { warn: () => {}, log: () => {}, error: () => {} },
    Buffer,
    Blob,
    FormData,
    AbortController,
    setTimeout,
    clearTimeout,
    fs: { readFileSync: () => Buffer.from("symbolic-opus-bytes") },
    fetch: async () => response,
  };
  vm.runInNewContext(code, context);
  return context.transcribeVoiceBookingAudio("/tmp/symbolic-audio.bin", "audio/ogg; codecs=opus");
}

async function expectRejectedMessage(response, expectedMessage) {
  await assert.rejects(
    () => runTranscribe(response),
    (error) => {
      assert.equal(error.message, expectedMessage);
      assert.ok(error.message.length <= 120, "stored reason stays inside the existing 120-char slice");
      assert.ok(!error.message.includes(STT_KEY_SENTINEL), "the credential never reaches the stored reason");
      assert.ok(!error.message.includes(PROVIDER_FREE_TEXT), "provider free text never reaches the stored reason");
      assert.doesNotMatch(error.message, /Bearer/);
      return true;
    },
  );
}

test("quota exhaustion is recorded as the provider code, not as a bare 429", async () => {
  await expectRejectedMessage(
    jsonResponse(429, { error: { message: PROVIDER_FREE_TEXT, type: "insufficient_quota", param: null, code: "insufficient_quota" } }),
    "speech_to_text_http_429:insufficient_quota",
  );
});

test("a request-rate ceiling is distinguishable from a finished balance", async () => {
  await expectRejectedMessage(
    jsonResponse(429, { error: { message: PROVIDER_FREE_TEXT, type: "rate_limit_error", param: null, code: "rate_limit_exceeded" } }),
    "speech_to_text_http_429:rate_limit_exceeded.rate_limit_error",
  );
});

test("when the provider sends only a type the type is kept", async () => {
  await expectRejectedMessage(
    jsonResponse(429, { error: { message: PROVIDER_FREE_TEXT, type: "rate_limit_error", param: null, code: null } }),
    "speech_to_text_http_429:rate_limit_error",
  );
});

test("a non-json body keeps the historic message byte-for-byte", async () => {
  await expectRejectedMessage(unparseableResponse(429), "speech_to_text_http_429");
  await expectRejectedMessage(jsonResponse(503, null), "speech_to_text_http_503");
});

test("an empty or missing error object adds no suffix", async () => {
  await expectRejectedMessage(jsonResponse(429, { error: {} }), "speech_to_text_http_429");
  await expectRejectedMessage(jsonResponse(429, { detail: "opaque upstream body" }), "speech_to_text_http_429");
});

test("a hostile error code is stripped to safe characters and bounded", async () => {
  const hostile = "  quota exceeded!!! \u0000\t[after some time]  " + "u".repeat(400);
  let captured = "";
  await assert.rejects(
    () => runTranscribe(jsonResponse(429, { error: { message: PROVIDER_FREE_TEXT, code: hostile, type: null } })),
    (error) => {
      captured = error.message;
      return true;
    },
  );
  assert.match(captured, /^speech_to_text_http_429:[A-Za-z0-9_.-]+$/);
  const suffix = captured.slice("speech_to_text_http_429:".length);
  assert.equal(suffix.length, 48, "suffix is capped by the declared maximum length");
  assert.doesNotMatch(suffix, / /, "no whitespace survives sanitisation");
});

test("a successful transcription is untouched by the diagnostic", async () => {
  const result = await runTranscribe(jsonResponse(200, { text: "السعر خمسة دنانير من المطار", language: "ar" }));
  assert.equal(result.provider, "openai");
  assert.equal(result.transcript, "السعر خمسة دنانير من المطار");
  assert.equal(result.language, "ar");
});

test("the diagnostic is label-only: no new provider call, no header or message read", () => {
  assert.equal(transcribeSlice.match(/voiceTranscriptionProviderErrorCode\(payload\)/g).length, 1);
  assert.equal((transcribeSlice.match(/fetch\(/g) || []).length, 1, "still exactly one outbound provider request");
  assert.doesNotMatch(helperSlice, /\.message/);
  assert.doesNotMatch(helperSlice, /headers/);
  assert.doesNotMatch(helperSlice, /apiKey/);
  assert.doesNotMatch(helperSlice, /process\.env/);
  assert.match(transcribeSlice, /speech_to_text_http_\$\{response\.status\}:\$\{providerErrorCode\}/);
  assert.match(transcribeSlice, /speech_to_text_http_\$\{response\.status\}`/);
  // Every capture point that writes voice error codes must still bound the stored length.
  assert.equal(source.match(/String\(error\?\.message \|\| error\)\.slice\(0, 120\)/g).length, 4);
});
