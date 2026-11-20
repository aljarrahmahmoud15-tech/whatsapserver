"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");
const start = source.indexOf("async function downloadIncomingVoiceMediaWithRecovery");
const end = source.indexOf("async function handleIncomingVoiceBookingIntake", start);
assert.ok(start >= 0 && end > start, "media recovery helper exists");

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
  `${source.slice(start, end)}; globalThis.downloadIncomingVoiceMediaWithRecovery = downloadIncomingVoiceMediaWithRecovery;`,
  context,
);

(async () => {
  let lookups = 0;
  let firstCalls = 0;
  let liveCalls = 0;
  const firstMessage = { downloadMedia: async () => { firstCalls += 1; return { data: null, mimetype: null }; } };
  const liveMessage = { downloadMedia: async () => { liveCalls += 1; return { data: Buffer.from("audio").toString("base64"), mimetype: "audio/ogg" }; } };
  context.getWhatsAppMessageByIdVariants = async () => { lookups += 1; return liveMessage; };

  const recovered = await context.downloadIncomingVoiceMediaWithRecovery(firstMessage, "msg-recovery");
  assert.equal(recovered.mimeType, "audio/ogg");
  assert.equal(recovered.attempt, 2);
  assert.equal(firstCalls, 1);
  assert.equal(liveCalls, 1);
  assert.equal(lookups, 1);

  context.getWhatsAppMessageByIdVariants = async () => null;
  let failure = "";
  try {
    await context.downloadIncomingVoiceMediaWithRecovery({ downloadMedia: async () => ({ data: null, mimetype: null }) }, "msg-pending");
  } catch (error) {
    failure = error.message;
  }
  assert.equal(failure, "audio_media_pending");
  console.log("voice media recovery guardrails passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
