"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");

// Slice 1: the media download helper plus its payload classifier (kept adjacent on purpose so the
// isolated harness can load the unit without booting the server).
const downloadStart = source.indexOf("async function downloadIncomingVoiceMediaWithRecovery");
const downloadEnd = source.indexOf("async function handleIncomingVoiceBookingIntake", downloadStart);
assert.ok(downloadStart >= 0 && downloadEnd > downloadStart, "media download slice exists");

// Slice 2: the bounded failed-intake retry predicate (declared inside the intake region).
const retryStart = source.indexOf("const VOICE_BOOKING_INTAKE_RETRY_WINDOW_MS");
const retryEnd = source.indexOf("\nfunction generalMessageDeletionEnabled", retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart, "retry eligibility slice exists");

const context = {
  Buffer,
  clearTimeout,
  console,
  isReady: true,
  setTimeout,
  client: {},
  withTimeout: async (promise) => promise,
  getWhatsAppMessageByIdVariants: async () => null,
};
vm.runInNewContext(
  `${source.slice(downloadStart, downloadEnd)}
   ${source.slice(retryStart, retryEnd)}
   globalThis.downloadIncomingVoiceMediaWithRecovery = downloadIncomingVoiceMediaWithRecovery;
   globalThis.voiceMediaAcceptance = voiceMediaAcceptance;
   globalThis.voiceBookingIntakeFailedRetryEligible = voiceBookingIntakeFailedRetryEligible;`,
  context,
);

(async () => {
  const { voiceMediaAcceptance, voiceBookingIntakeFailedRetryEligible, downloadIncomingVoiceMediaWithRecovery } = context;

  // 1) Payload classification keeps the strict audio/* preference but no longer discards a real
  //    audio payload that the client reported with an empty/generic mimetype.
  assert.deepEqual(
    { accepted: voiceMediaAcceptance({ data: "", mimetype: "audio/ogg" }).accepted, reason: voiceMediaAcceptance({ data: "", mimetype: "audio/ogg" }).reason },
    { accepted: false, reason: "audio_media_pending" },
  );
  assert.deepEqual(
    { accepted: voiceMediaAcceptance(undefined).accepted, chars: voiceMediaAcceptance(undefined).diagnostic.dataChars },
    { accepted: false, chars: 0 },
  );

  const explicit = voiceMediaAcceptance({ data: "AAAA", mimetype: "AUDIO/OGG; codecs=opus" });
  assert.equal(explicit.accepted, true);
  assert.equal(explicit.mimeType, "audio/ogg; codecs=opus");
  assert.equal(explicit.reason, "audio_mime_accepted");

  const emptyMime = voiceMediaAcceptance({ data: "AAAA", mimetype: "" });
  assert.equal(emptyMime.accepted, true);
  assert.equal(emptyMime.reason, "audio_mime_octet_fallback");
  assert.equal(emptyMime.mimeType, "audio/ogg; codecs=opus");

  const octet = voiceMediaAcceptance({ data: "AAAA", mimetype: "application/octet-stream" });
  assert.equal(octet.accepted, true);
  assert.equal(octet.reason, "audio_mime_octet_fallback");

  const byExtension = voiceMediaAcceptance({ data: "AAAA", mimetype: "text/plain", filename: "Audio Message.opus" });
  assert.equal(byExtension.accepted, true);
  assert.equal(byExtension.reason, "audio_mime_extension_fallback");

  const notAudio = voiceMediaAcceptance({ data: "AAAA", mimetype: "image/jpeg" });
  assert.equal(notAudio.accepted, false);
  assert.equal(notAudio.reason, "audio_media_required");

  // 2) The whatsapp-web.js error text is now attached to the thrown failure instead of being
  //    swallowed, so a media defect is attributable.
  let downloadError = null;
  let calls = 0;
  context.getWhatsAppMessageByIdVariants = async () => null;
  try {
    await downloadIncomingVoiceMediaWithRecovery({
      downloadMedia: async () => { calls += 1; throw new Error("Evaluation failed: media key missing for message"); },
    }, "false_x@g.us_Y");
  } catch (error) {
    downloadError = error;
  }
  assert.equal(downloadError.message, "audio_media_pending");
  assert.equal(calls, 3, "three bounded attempts");
  assert.equal(downloadError.voiceMediaDiagnostic.downloadError, "Evaluation failed: media key missing for message");
  assert.equal(downloadError.voiceMediaDiagnostic.reason, "media_download_error");
  assert.equal(downloadError.voiceMediaDiagnostic.attempt, 3);
  assert.equal(downloadError.voiceMediaDiagnostic.liveRefetched, true);

  const recovered = await downloadIncomingVoiceMediaWithRecovery({
    downloadMedia: async () => ({ data: Buffer.from("audio-payload").toString("base64"), mimetype: "application/octet-stream" }),
  }, "false_x@g.us_Z");
  assert.equal(recovered.mimeType, "audio/ogg; codecs=opus");
  assert.equal(recovered.attempt, 1);
  assert.equal(recovered.diagnostic.reason, "audio_mime_octet_fallback");
  assert.ok(recovered.diagnostic.dataChars > 0);

  // 3) Retry window: only failed rows inside 24h and below the attempt cap are reopened.
  const iso = (offsetMs) => new Date(Date.now() - offsetMs).toISOString();
  assert.equal(voiceBookingIntakeFailedRetryEligible({ status: "failed", attempts: 1, last_seen_at: iso(60 * 60 * 1000) }), true);
  assert.equal(voiceBookingIntakeFailedRetryEligible({ status: "failed", attempts: 1, last_seen_at: iso(25 * 60 * 60 * 1000) }), false);
  assert.equal(voiceBookingIntakeFailedRetryEligible({ status: "failed", attempts: 4, last_seen_at: iso(60 * 1000) }), false);
  assert.equal(voiceBookingIntakeFailedRetryEligible({ status: "downloaded", attempts: 1, last_seen_at: iso(60 * 1000) }), false);
  assert.equal(voiceBookingIntakeFailedRetryEligible({ status: "skipped", attempts: 1, last_seen_at: iso(60 * 1000) }), false);
  assert.equal(voiceBookingIntakeFailedRetryEligible({ status: "failed", attempts: 1, last_seen_at: "" }), false);
  assert.equal(voiceBookingIntakeFailedRetryEligible(null), false);

  console.log("voice media diagnostics + bounded retry guardrails passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
