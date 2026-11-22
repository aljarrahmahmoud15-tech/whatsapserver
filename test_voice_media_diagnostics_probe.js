"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("server.js", "utf8");

// 1) The probe is registered as its own module-level route, protected like the other
//    owner read endpoints, and it is not accidentally nested inside another handler.
assert.ok(
  source.includes('app.get("/api/admin/group/voice-media-diagnostics", requireAdmin, adminReadLimiter, async (req, res) => {'),
  "voice media probe route requires admin and the read limiter"
);
const probeStart = source.indexOf('app.get("/api/admin/group/voice-media-diagnostics"');
const evidenceStart = source.indexOf('app.get("/api/admin/group/voice-booking-evidence"');
assert.ok(probeStart >= 0 && evidenceStart > probeStart, "probe route is registered before the evidence route");
const probeRouteText = source.slice(probeStart, evidenceStart);
assert.equal((probeRouteText.match(/app\.get\(/g) || []).length, 1, "probe route is not nested inside another handler");
assert.match(probeRouteText, /\}\);\n$/, "probe route closes at module level");
assert.match(probeRouteText, /readOnly: true/, "probe answers declare themselves read-only");
assert.match(probeRouteText, /financialMutation: false/, "probe answers declare no financial mutation");
assert.match(probeRouteText, /messageIdMasked: maskVoiceMessageReference\(row\.message_id\)/, "probe echoes a masked row handle only");

// 2) The probe helpers must never download, write, send or settle anything.
const helpersStart = source.indexOf("const VOICE_MEDIA_PROBE_TIMEOUT_MS");
const helpersEnd = source.indexOf("async function handleIncomingVoiceBookingIntake", helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, "probe helper slice exists");
const helpers = source.slice(helpersStart, helpersEnd);
assert.doesNotMatch(helpers, /db\.prepare|setSetting\(|INSERT |UPDATE /, "probe helpers never touch the database");
assert.doesNotMatch(helpers, /downloadMedia\(|resolveMediaBlob\(|sendMessage\(|sendText|react\(/, "probe never fetches media or sends anything to WhatsApp");
assert.match(helpers, /withTimeout\(client\.pupPage\.evaluate/, "probe reads the live page under a bounded timeout");

// 3) The allowlisted response keys must exclude every identifier that could leak a
//    group, contact or media path out of the browser page.
const allowlistText = helpers.match(/VOICE_MEDIA_PROBE_SAFE_KEYS = \[[^\]]*\]/);
assert.ok(allowlistText, "safe key allowlist is declared in the probe helper slice");
for (const forbidden of ["requestedId", "filehash", "directPath", "participant", "author", "from", "to", "id"]) {
  assert.ok(!allowlistText[0].includes(`"${forbidden}"`), `allowlist stays free of ${forbidden}`);
}

// 4) Behaviour of the pure helpers, isolated in a vm (server.js must never be required).
const context = {
  console: { log: () => {}, warn: () => {} },
  require: (id) => (id === "whatsapp-web.js/package.json" ? { version: "1.34.7" } : (() => { throw new Error(`unexpected require ${id}`); })()),
  window: undefined,
  client: null,
  withTimeout: async () => null,
};
vm.runInNewContext(`${helpers}\nthis.api = { maskVoiceMessageReference, sanitizeVoiceMediaProbe, voiceMediaProbeBranch, VOICE_MEDIA_PROBE_NEXT_STEP, VOICE_MEDIA_PROBE_SAFE_KEYS, WHATSAPP_WEBJS_LIBRARY_VERSION };`, context);
const api = context.api;
assert.equal(api.WHATSAPP_WEBJS_LIBRARY_VERSION, "1.34.7", "library version is read from the installed package");

const SYMBOLIC_GROUP = "123456789012345678@g.us";
const CORE = "AAAABBBBCCCCDDDDEEEEFFFF00001111";
const incoming = `false_${SYMBOLIC_GROUP}_${CORE}@c.us`;
const outgoing = `true_${SYMBOLIC_GROUP}_${CORE}@c.us`;
const incomingMask = api.maskVoiceMessageReference(incoming);
const outgoingMask = api.maskVoiceMessageReference(outgoing);
assert.equal(incomingMask, `incoming_…${CORE.slice(-6)}`, "incoming rows keep only the random stanza tail");
assert.equal(outgoingMask, `outgoing_…${CORE.slice(-6)}`, "rows sent by the bot number are still distinguishable");
assert.ok(!incomingMask.includes(SYMBOLIC_GROUP) && !incomingMask.includes("@g.us"), "mask never carries the group id");
assert.equal(api.maskVoiceMessageReference(""), null, "an empty id masks to null");

// Branch classification drives the owner's next step, so both decisive outcomes are pinned.
const keyPresentResolved = {
  available: true, found: true, mediaStage: "RESOLVED", hasMediaKey: true, hasMediaObject: true,
  hasFilehash: true, blobCacheHit: false, blobCacheEntries: 0,
};
assert.equal(api.voiceMediaProbeBranch(keyPresentResolved), "resolved_without_bytes", "key present, stage RESOLVED, no cached blob");
assert.equal(api.VOICE_MEDIA_PROBE_NEXT_STEP[api.voiceMediaProbeBranch(keyPresentResolved)], "upgrade_whatsapp_webjs", "that branch points at the library upgrade");

const keyAbsent = { available: true, found: true, mediaStage: "RESOLVED", hasMediaKey: false, hasMediaObject: true };
assert.equal(api.voiceMediaProbeBranch(keyAbsent), "media_key_absent", "no media key is a session delivery problem, not a byte problem");
assert.equal(api.VOICE_MEDIA_PROBE_NEXT_STEP[api.voiceMediaProbeBranch(keyAbsent)], "repair_session_or_protocol_channel", "that branch points at re-pair or a protocol channel");

assert.equal(api.voiceMediaProbeBranch({ available: true, found: true, mediaStage: "ERROR_DOWNLOAD", hasMediaKey: true }), "media_stage_blocked", "an ERROR stage blocks regardless of the key");
assert.equal(api.voiceMediaProbeBranch({ available: true, found: true, mediaStage: "FETCHING", hasMediaKey: true }), "media_stage_blocked", "FETCHING is still blocked");
assert.equal(api.voiceMediaProbeBranch({ ...keyPresentResolved, blobCacheHit: true }), "bytes_available", "a cache hit means the media is reachable now");
assert.equal(api.voiceMediaProbeBranch({ available: true, found: false }), "message_model_unavailable", "a row missing from the page store is reported as such");
assert.equal(api.voiceMediaProbeBranch({ available: false, reason: "media_probe_timeout" }), "probe_unavailable", "a probe timeout never looks like a media result");
assert.equal(api.voiceMediaProbeBranch(null), "probe_unavailable", "a null probe is handled");

// The sanitiser is the only path from the browser page into the response body.
const rawProbe = {
  ...keyPresentResolved,
  requestedId: incoming,
  filehash: "SECRETFILEHASH",
  directPath: "ABCDEFGH/SECRET Media blob path",
  webVersion: "2.3000.12",
  resolveMediaBlobAvailable: false,
  messageType: "ptt",
  mimetype: "audio/ogg; codecs=opus",
  sizeBytes: 18432,
  mediaBlobType: "",
  hasDirectPath: true,
};
const safe = api.sanitizeVoiceMediaProbe(rawProbe);
const safeJson = JSON.stringify(safe);
assert.ok(!safeJson.includes(SYMBOLIC_GROUP) && !safeJson.includes("SECRETFILEHASH") && !safeJson.includes("SECRET Media blob"), "sanitised probe leaks no identity, hash or media path");
assert.equal(safe.requestedId, undefined, "requested id is dropped");
assert.equal(safe.mediaStage, "RESOLVED", "diagnostic stage is kept");
assert.equal(safe.hasDirectPath, true, "direct path is reported as a boolean only");
assert.equal(safe.webVersion, "2.3000.12", "web client version is reported for upgrade correlation");
assert.equal(api.sanitizeVoiceMediaProbe({ available: false }), null, "an unavailable probe sanitises to null");
// Arrays created inside the vm come from another realm, so compare contents, not structure.
assert.equal(Array.from(api.VOICE_MEDIA_PROBE_SAFE_KEYS).includes("requestedId"), false, "allowlist itself never names an identity key");
assert.equal(Array.from(api.VOICE_MEDIA_PROBE_SAFE_KEYS).includes("filehash"), false, "allowlist never names the media hash");
console.log("voice media probe guards ok");
