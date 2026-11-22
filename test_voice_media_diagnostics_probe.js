"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("server.js", "utf8");

// ---------------------------------------------------------------------------
// Stage 0 of the owner-approved media remediation: the read-only WhatsApp Web
// media probe. Two guarantees matter to a live money bot: the route must be
// reachable only by the owner, and it must never mutate WhatsApp, the intake
// table or any settlement. An opt-in byte fetch is allowed, but only through
// downloadMedia(), which is a read on WhatsApp and writes nothing anywhere.
// ---------------------------------------------------------------------------

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
assert.match(probeRouteText, /orderMutation: false/, "probe answers declare no order mutation");
assert.match(probeRouteText, /messageIdMasked: maskVoiceMessageReference\(row\.message_id\)/, "probe echoes a masked row handle only");

// 2) The observation probe must never fetch, send, react or write.
const helpersStart = source.indexOf("const VOICE_MEDIA_OCTET_MIME_TYPES");
const helpersEnd = source.indexOf("async function handleIncomingVoiceBookingIntake", helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, "probe helper slice exists");
const helpers = source.slice(helpersStart, helpersEnd);
const observeStart = helpers.indexOf("async function probeWhatsAppVoiceMediaState");
const observeEnd = helpers.indexOf("const VOICE_MEDIA_FETCH_DIAGNOSTIC_TIMEOUT_MS");
assert.ok(observeStart >= 0 && observeEnd > observeStart, "observation helper slice exists");
const observeOnly = helpers.slice(observeStart, observeEnd);
assert.doesNotMatch(observeOnly, /downloadMedia\(|resolveMediaBlob\(/, "the observation probe never asks WhatsApp for media bytes");
assert.doesNotMatch(helpers, /db\.prepare|setSetting\(|INSERT |UPDATE /, "no probe helper touches the database");
assert.doesNotMatch(helpers, /sendMessage\(|sendText|\.react\(|createGroup|addParticipants|deleteMessage|revoke/, "no probe helper sends, reacts, deletes or groups");

// 3) The optional byte fetch is bounded, opt-in, and cannot reach any mutating path.
assert.match(helpers, /const VOICE_MEDIA_FETCH_DIAGNOSTIC_TIMEOUT_MS = \d+;/, "the diagnostic fetch has its own bounded timeout");
assert.match(helpers, /media = await withTimeout\(target\.downloadMedia\(\), VOICE_MEDIA_FETCH_DIAGNOSTIC_TIMEOUT_MS, null\);/, "the fetch reuses the intake download call under a bounded timeout");
assert.match(helpers, /if \(!client \|\| !isReady \|\| !messageId\) return \{ attempted: false, reason: "client_not_ready" \};/, "the fetch refuses to run outside a ready session");
assert.match(probeRouteText, /const attemptFetch = req\.query\.attemptFetch === "1" \|\| req\.query\.attemptFetch === "true";/, "the byte fetch only runs when explicitly requested");
assert.match(probeRouteText, /const fetchCap = attemptFetch \? Math\.min\(rows\.length, 2\) : 0;/, "the byte fetch is capped at two rows");
assert.ok(probeRouteText.indexOf("attemptVoiceMediaFetchForDiagnostics") > 0, "the route wires the opt-in fetch");
// 3b) A sealed row is usually older than the newest rows, and this route never echoes its raw
//     message id, so the owner must be able to point the probe at one intake row number. That
//     selection has to stay inside the configured group and must not accept a free-form id.
assert.match(probeRouteText, /const requestedIntakeId = Number\(req\.query\.intakeId \|\| 0\) \|\| 0;/, "the intake row selector is numeric only");
assert.match(probeRouteText, /FROM voice_booking_intakes WHERE group_id=\? AND id=\? ORDER BY id DESC LIMIT 1/, "the intake row selector is scoped to the configured group");
assert.ok(
  probeRouteText.indexOf("if (requestedIntakeId > 0)") < probeRouteText.indexOf("} else if (requestedMessageId)"),
  "the numeric row selector is checked before the message id selector"
);
assert.equal((probeRouteText.match(/FROM voice_booking_intakes/g) || []).length, 3, "the route keeps exactly the three read-only row selections");

// 4) The allowlisted response keys must exclude every identifier that could leak a
//    group, contact or media path out of the browser page.
const allowlistText = helpers.match(/VOICE_MEDIA_PROBE_SAFE_KEYS = \[[^\]]*\]/);
assert.ok(allowlistText, "safe key allowlist is declared in the probe helper slice");
for (const forbidden of ["requestedId", "filehash", "directPath", "participant", "author", "from", "to", "id"]) {
  assert.ok(!allowlistText[0].includes(`"${forbidden}"`), `allowlist stays free of ${forbidden}`);
}

// ---------------------------------------------------------------------------
// 5) Behaviour in isolation. server.js is never required: the helpers are sliced
//    and run in a fresh vm context with symbolic fixtures only.
// ---------------------------------------------------------------------------
const SYMBOLIC_GROUP = "approved-group@g.us";
const CORE = "AAAABBBBCCCCDDDDEEEEFFFF00001111";

function buildContext(overrides) {
  const context = {
    console: { log: () => {}, warn: () => {} },
    require: (id) => (id === "whatsapp-web.js/package.json" ? { version: "1.34.8" } : (() => { throw new Error(`unexpected require ${id}`); })()),
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    RegExp,
    Set,
    window: undefined,
    client: null,
    isReady: false,
    withTimeout: async (promise) => await promise,
    getWhatsAppMessageByIdVariants: async () => null,
    ...overrides,
  };
  vm.runInNewContext(
    `${helpers}\nthis.api = { maskVoiceMessageReference, sanitizeVoiceMediaProbe, voiceMediaProbeBranch, attemptVoiceMediaFetchForDiagnostics, voiceMediaAcceptance, VOICE_MEDIA_PROBE_NEXT_STEP, VOICE_MEDIA_PROBE_SAFE_KEYS, VOICE_MEDIA_FETCH_DIAGNOSTIC_TIMEOUT_MS, WHATSAPP_WEBJS_LIBRARY_VERSION };`,
    context
  );
  return context.api;
}

// 5a) Pure helpers: masking, sanitising, branch classification.
const pure = buildContext({});
assert.equal(pure.WHATSAPP_WEBJS_LIBRARY_VERSION, "1.34.8", "library version is read from the installed package");
assert.equal(pure.VOICE_MEDIA_FETCH_DIAGNOSTIC_TIMEOUT_MS, 12000, "the diagnostic fetch timeout is exported for the response");

const incomingMask = pure.maskVoiceMessageReference(`false_${SYMBOLIC_GROUP}_${CORE}@c.us`);
const outgoingMask = pure.maskVoiceMessageReference(`true_${SYMBOLIC_GROUP}_${CORE}@c.us`);
assert.equal(incomingMask, `incoming_…${CORE.slice(0, 6)}…${CORE.slice(-4)}`, "incoming rows echo only the random stanza id");
assert.equal(outgoingMask, `outgoing_…${CORE.slice(0, 6)}…${CORE.slice(-4)}`, "rows sent by the bot number are still distinguishable");
assert.ok(!incomingMask.includes(SYMBOLIC_GROUP) && !incomingMask.includes("@g.us"), "mask never carries the group id");
const PARTICIPANT = "fixture-contact-identity@c.us";
const rowA = pure.maskVoiceMessageReference(`false_${SYMBOLIC_GROUP}_${CORE}_${PARTICIPANT}`);
const rowB = pure.maskVoiceMessageReference(`false_${SYMBOLIC_GROUP}_ZZZZ1111YYYY2222XXXX3333WWWW_${PARTICIPANT}`);
assert.equal(rowA, `incoming_…${CORE.slice(0, 6)}…${CORE.slice(-4)}`, "participant suffix is dropped from the handle");
assert.notEqual(rowA, rowB, "two rows from the same sender get different handles");
assert.ok(!rowA.includes("fixture-contact-identity") && !rowA.includes(PARTICIPANT), "mask never carries a contact or lid identity");
assert.equal(pure.maskVoiceMessageReference(""), null, "an empty id masks to null");

const keyPresentResolved = {
  available: true, found: true, mediaStage: "RESOLVED", hasMediaKey: true, hasMediaObject: true,
  hasFilehash: true, blobCacheHit: false, blobCacheEntries: 0,
};
assert.equal(pure.voiceMediaProbeBranch(keyPresentResolved), "resolved_without_bytes", "key present, stage RESOLVED, no cached blob");
assert.equal(pure.VOICE_MEDIA_PROBE_NEXT_STEP[apiBranch(pure, keyPresentResolved)], "upgrade_whatsapp_webjs", "that branch points at the library upgrade");
function apiBranch(api, probe) { return api.voiceMediaProbeBranch(probe); }

assert.equal(pure.voiceMediaProbeBranch({ available: true, found: true, mediaStage: "RESOLVED", hasMediaKey: false, hasMediaObject: true }), "media_key_absent", "no media key is a session delivery problem, not a byte problem");
assert.equal(pure.VOICE_MEDIA_PROBE_NEXT_STEP.media_key_absent, "repair_session_or_protocol_channel", "that branch points at re-pair or a protocol channel");
assert.equal(pure.voiceMediaProbeBranch({ available: true, found: true, mediaStage: "ERROR_DOWNLOAD", hasMediaKey: true }), "media_stage_blocked", "an ERROR stage blocks regardless of the key");
assert.equal(pure.voiceMediaProbeBranch({ available: true, found: true, mediaStage: "FETCHING", hasMediaKey: true }), "media_stage_blocked", "FETCHING is still blocked");
// Measured live on 2026-11-22: key, direct path, file hash and size are all present while the
// stage sits at INIT, i.e. the installed client never forced the fetch. That must point at the upgrade.
assert.equal(pure.voiceMediaProbeBranch({ available: true, found: true, mediaStage: "INIT", hasMediaKey: true, hasDirectPath: true, hasFilehash: true, hasMediaObject: true, blobCacheHit: false }), "media_never_fetched", "key present with a stage that never advanced is a never-fetched media");
assert.equal(pure.VOICE_MEDIA_PROBE_NEXT_STEP.media_never_fetched, "upgrade_whatsapp_webjs", "the never-fetched branch points at the library upgrade");
assert.equal(pure.voiceMediaProbeBranch({ available: true, found: true, mediaStage: "INIT", hasMediaKey: true, hasDirectPath: false, hasMediaObject: true }), "waiting_on_media_stage", "without a direct path there is nothing to fetch yet");
assert.equal(pure.voiceMediaProbeBranch({ ...keyPresentResolved, blobCacheHit: true }), "bytes_available", "a cache hit means the media is reachable now");
assert.equal(pure.voiceMediaProbeBranch({ available: true, found: false }), "message_model_unavailable", "a row missing from the page store is reported as such");
assert.equal(pure.voiceMediaProbeBranch({ available: false, reason: "media_probe_timeout" }), "probe_unavailable", "a probe timeout never looks like a media result");
assert.equal(pure.voiceMediaProbeBranch(null), "probe_unavailable", "a null probe is handled");

const rawProbe = {
  ...keyPresentResolved,
  requestedId: `false_${SYMBOLIC_GROUP}_${CORE}@c.us`,
  filehash: "SECRETFILEHASH",
  directPath: "ABCDEFGH/SECRET Media blob path",
  webVersion: "2.3000.WEB_BUILD_FIXTURE",
  resolveMediaBlobAvailable: true,
  messageType: "ptt",
  mimetype: "audio/ogg; codecs=opus",
  sizeBytes: 18432,
  mediaBlobType: "",
  hasDirectPath: true,
  blobCacheModule: "WAWebMediaInMemoryBlobCache",
};
const safe = pure.sanitizeVoiceMediaProbe(rawProbe);
const safeJson = JSON.stringify(safe);
assert.ok(!safeJson.includes(SYMBOLIC_GROUP) && !safeJson.includes("SECRETFILEHASH") && !safeJson.includes("SECRET Media blob"), "sanitised probe leaks no identity, hash or media path");
assert.equal(safe.requestedId, undefined, "requested id is dropped");
assert.equal(safe.mediaStage, "RESOLVED", "diagnostic stage is kept");
assert.equal(safe.resolveMediaBlobAvailable, true, "the presence of the new media entry point is observable");
assert.equal(safe.blobCacheModule, "WAWebMediaInMemoryBlobCache", "the resolved cache module name is observable");
assert.equal(safe.hasDirectPath, true, "direct path is reported as a boolean only");
assert.equal(safe.webVersion, "2.3000.WEB_BUILD_FIXTURE", "web client version is reported for upgrade correlation");
assert.equal(pure.sanitizeVoiceMediaProbe({ available: false }), null, "an unavailable probe sanitises to null");
assert.equal(Array.from(pure.VOICE_MEDIA_PROBE_SAFE_KEYS).includes("requestedId"), false, "allowlist itself never names an identity key");
assert.equal(Array.from(pure.VOICE_MEDIA_PROBE_SAFE_KEYS).includes("filehash"), false, "allowlist never names the media hash");

(async () => {
// 5b) The opt-in fetch: refuses without a ready session, and reports bytes only.
const notReady = buildContext({ client: null, isReady: false });
const refused = await notReady.attemptVoiceMediaFetchForDiagnostics(`false_${SYMBOLIC_GROUP}_${CORE}@c.us`);
assert.equal(JSON.stringify(refused), JSON.stringify({ attempted: false, reason: "client_not_ready" }), "a session that is not ready performs no fetch at all");

const readyNoMessage = buildContext({ client: { pupPage: {} }, isReady: true });
const absent = await readyNoMessage.attemptVoiceMediaFetchForDiagnostics(`false_${SYMBOLIC_GROUP}_${CORE}@c.us`);
assert.equal(absent.attempted, false, "an unavailable message performs no fetch");
assert.equal(absent.reason, "message_or_download_unavailable", "the reason names the missing message");

const mediaLikeIntake = { mimetype: "audio/ogg; codecs=opus", data: "QUJDRA==".repeat(64), filename: "audio.opus" };
let downloadCalls = 0;
const fetching = buildContext({
  client: { pupPage: {} },
  isReady: true,
  getWhatsAppMessageByIdVariants: async () => ({
    downloadMedia: async () => { downloadCalls += 1; return mediaLikeIntake; },
  }),
});
const gotBytes = await fetching.attemptVoiceMediaFetchForDiagnostics(`false_${SYMBOLIC_GROUP}_${CORE}@c.us`);
assert.equal(downloadCalls, 1, "the fetch calls downloadMedia exactly once");
assert.equal(gotBytes.attempted, true, "the fetch reports that it ran");
assert.equal(gotBytes.ok, true, "a payload that the intake would accept is reported as accepted");
assert.equal(gotBytes.reason, "audio_mime_accepted", "the accepted reason comes from the shared intake classifier");
assert.equal(gotBytes.approxBytes, Math.floor(mediaLikeIntake.data.length * 3 / 4), "bytes are reported as an approximate size, never the audio itself");
assert.equal(gotBytes.diagnostic.dataChars, mediaLikeIntake.data.length, "the raw base64 length is available for comparison");
assert.ok(!("data" in gotBytes.diagnostic) && !String(JSON.stringify(gotBytes.diagnostic)).includes(mediaLikeIntake.data.slice(0, 8)), "no media payload is returned");

const pending = buildContext({
  client: { pupPage: {} },
  isReady: true,
  getWhatsAppMessageByIdVariants: async () => ({ downloadMedia: async () => undefined }),
});
const stillPending = await pending.attemptVoiceMediaFetchForDiagnostics(`false_${SYMBOLIC_GROUP}_${CORE}@c.us`);
assert.equal(stillPending.ok, false, "an empty media stays a failure");
assert.equal(stillPending.reason, "audio_media_pending", "the defect keeps its own name after a fetch attempt");
assert.equal(stillPending.approxBytes, 0, "no bytes are invented");

const thrown = buildContext({
  client: { pupPage: {} },
  isReady: true,
  getWhatsAppMessageByIdVariants: async () => ({ downloadMedia: async () => { throw new Error(`media key missing ${"x".repeat(300)}`); } }),
});
const errored = await thrown.attemptVoiceMediaFetchForDiagnostics(`false_${SYMBOLIC_GROUP}_${CORE}@c.us`);
assert.equal(errored.ok, false, "a throwing download is still a clean diagnostic");
assert.equal(errored.reason, "media_fetch_error", "the reason separates a real error from an empty payload");
assert.equal(errored.downloadError.length, 180, "the download error text is truncated before it is reported");
console.log("voice media probe guards ok");
})().catch((error) => { console.error(error); process.exitCode = 1; });
