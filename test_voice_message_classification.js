"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");
const start = source.indexOf("function incomingMessageMediaClassification(");
const end = source.indexOf("async function handleIncomingVoiceMessagePolicy", start);
assert.ok(start >= 0 && end > start, "voice classification helpers must exist");
const helpers = source.slice(start, end);
const context = {};
vm.runInNewContext(`${helpers}\nthis.incomingMessageMediaClassification = incomingMessageMediaClassification;\nthis.isIncomingVoiceMessage = isIncomingVoiceMessage;`, context);

assert.equal(context.isIncomingVoiceMessage({ type: "audio", hasMedia: true }), true);
assert.equal(context.isIncomingVoiceMessage({ type: "ptt", hasMedia: true }), true);
assert.equal(context.isIncomingVoiceMessage({ type: "chat", hasMedia: true, mimetype: "audio/ogg; codecs=opus" }), true);
assert.equal(context.isIncomingVoiceMessage({ type: "chat", _data: { mimetype: "audio/ogg", isPtt: true } }), true);
assert.equal(context.isIncomingVoiceMessage({ type: "chat", hasMedia: true, mimetype: "image/jpeg" }), false);
assert.equal(context.isIncomingVoiceMessage({ type: "chat", body: "السعر 5" }), false);

const classified = context.incomingMessageMediaClassification({ type: "chat", hasMedia: true, mimetype: "audio/ogg" });
assert.deepEqual(JSON.parse(JSON.stringify(classified)), {
  rawType: "chat",
  mimeType: "audio/ogg",
  isPtt: false,
  hasMedia: true,
  voice: true,
});

assert.match(source, /rawType: mediaClassification\.rawType \|\| null/);
assert.match(source, /mimeType: mediaClassification\.mimeType \|\| null/);
assert.match(source, /voiceDetected: mediaClassification\.voice/);
console.log("voice message classification guardrails passed");
