"use strict";
// Owner-approved 2026-11-23: «فعل حذف مقطع الصوت الان جميع مقطع الصوت».
// This isolates two things without booting the server: the new voice delete permit, and the voice
// policy handler that must hand that permit to the central deletion path. The previous build flipped
// the owner switch on but every audio deletion still came back paused with
// owner_policy_low_balance_acceptance_only, so the guard below is what proves the switch is live.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("server.js", "utf8");

const permitStart = source.indexOf("function voiceMessageDeletePermitValid(context, groupId)");
const permitEnd = source.indexOf("\nasync function deleteWhatsAppMessageForEveryone", permitStart);
assert.ok(permitStart >= 0 && permitEnd > permitStart, "voice delete permit must exist before the central deletion path");
const permitSymbol = Symbol("voice_permit");
const permitSandbox = {
  VOICE_MESSAGE_DELETE_PERMIT: permitSymbol,
  configuredRuntimeGroupId: () => "official-test@g.us",
  isConfiguredGroup: (groupId) => groupId === "official-test@g.us",
  voiceMessageDeletionEnabled: () => true,
  voiceMessageDeletionEmergencyStopped: () => false,
};
vm.runInNewContext(`${source.slice(permitStart, permitEnd)}\nthis.validate = voiceMessageDeletePermitValid;`, permitSandbox);
const validPermit = {
  [permitSymbol]: true,
  policyAction: "voice_message",
  reason: "unapproved_audio_message",
};
assert.equal(permitSandbox.validate(validPermit, "official-test@g.us"), true);
assert.equal(permitSandbox.validate({ ...validPermit, [permitSymbol]: false }, "official-test@g.us"), false);
assert.equal(permitSandbox.validate({ ...validPermit, policyAction: "general_unapproved_message" }, "official-test@g.us"), false);
assert.equal(permitSandbox.validate({ ...validPermit, reason: "unapproved_general_message" }, "official-test@g.us"), false);
assert.equal(permitSandbox.validate(validPermit, "other-group@g.us"), false);
permitSandbox.voiceMessageDeletionEnabled = () => false;
assert.equal(permitSandbox.validate(validPermit, "official-test@g.us"), false);
permitSandbox.voiceMessageDeletionEnabled = () => true;
permitSandbox.voiceMessageDeletionEmergencyStopped = () => true;
assert.equal(permitSandbox.validate(validPermit, "official-test@g.us"), false, "an emergency stop must never delete audio");
permitSandbox.voiceMessageDeletionEmergencyStopped = () => false;
permitSandbox.configuredRuntimeGroupId = () => "";
assert.equal(permitSandbox.validate(validPermit, "official-test@g.us"), false, "an unconfigured group id must never delete audio");

const handlerStart = source.indexOf("async function handleIncomingVoiceMessagePolicy(message, { groupId, senderPhone })");
const handlerEnd = source.indexOf("\nfunction messageTextForPolicy(message)", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "voice policy handler must be sliceable");
let deleteCalls = 0;
const handlerSandbox = {
  // Same classification rule the live server uses, so a text message cannot reach the audio path.
  isIncomingVoiceMessage: (message) => {
    const rawType = String(message?.type || "").trim().toLowerCase();
    const mimeType = String(message?.mimetype || "").trim().toLowerCase();
    return rawType === "audio" || rawType === "ptt" || message?.isPtt === true || /^audio\//.test(mimeType);
  },
  voiceMessageDeletionEnabled: () => true,
  voiceMessageDeletionEmergencyStopped: () => false,
  configuredRuntimeGroupId: () => "official-test@g.us",
  phoneWithCountry: (phone) => String(phone || ""),
  isGroupSetupOwner: () => false,
  isOfficialGroupAdminPhone: () => false,
  officialGroupAdminSnapshotReady: () => true,
  serializedMessageId: (message) => message?.id || "",
  messageIdCandidates: () => [],
  deleteWhatsAppMessageForEveryone: async (_id, context) => {
    deleteCalls += 1;
    assert.equal(context.policyAction, "voice_message", "audio deletions must declare the voice action");
    assert.equal(context.reason, "unapproved_audio_message", "audio deletions must keep the audio reason");
    assert.equal(context[permitSymbol], true, "audio deletions must carry the owner voice permit");
    assert.equal(context.groupId, "official-test@g.us");
    return { ok: true };
  },
  audit: () => {},
  VOICE_MESSAGE_DELETE_PERMIT: permitSymbol,
};
vm.runInNewContext(`${source.slice(handlerStart, handlerEnd)}\nthis.handle = handleIncomingVoiceMessagePolicy;`, handlerSandbox);

(async () => {
  const official = "official-test@g.us";
  const captain = { id: "v1", type: "ptt", fromMe: false };
  const deleted = await handlerSandbox.handle(captain, { groupId: official, senderPhone: "962790000001" });
  assert.equal(deleted.status, "deleted");
  assert.equal(deleteCalls, 1);

  const octet = await handlerSandbox.handle({ id: "v2", type: "audio", fromMe: false }, { groupId: official, senderPhone: "962790000001" });
  assert.equal(octet.status, "deleted", "an audio clip is a voice clip whatever the client calls it");

  const wrongGroup = await handlerSandbox.handle({ id: "v3", type: "ptt", fromMe: false }, { groupId: "other@g.us", senderPhone: "962790000001" });
  assert.equal(wrongGroup.status, "not_applicable", "only the configured official group is in scope");
  const outgoing = await handlerSandbox.handle({ id: "v4", type: "ptt", fromMe: true }, { groupId: official, senderPhone: "962790000001" });
  assert.equal(outgoing.status, "not_applicable", "the bot's own audio is never deleted");
  const notVoice = await handlerSandbox.handle({ id: "v5", type: "chat", fromMe: false }, { groupId: official, senderPhone: "962790000001" });
  assert.equal(notVoice.status, "not_applicable", "text messages are not this policy's job");

  handlerSandbox.isGroupSetupOwner = () => true;
  const ownerClip = await handlerSandbox.handle({ id: "v6", type: "ptt", fromMe: false }, { groupId: official, senderPhone: "962790000002" });
  assert.equal(ownerClip.status, "skipped", "the owner's audio stays in the group");
  handlerSandbox.isGroupSetupOwner = () => false;
  handlerSandbox.isOfficialGroupAdminPhone = () => true;
  const adminClip = await handlerSandbox.handle({ id: "v7", type: "ptt", fromMe: false }, { groupId: official, senderPhone: "962790000003" });
  assert.equal(adminClip.status, "skipped", "group admins' audio stays in the group");
  handlerSandbox.isOfficialGroupAdminPhone = () => false;

  handlerSandbox.officialGroupAdminSnapshotReady = () => false;
  const noSnapshot = await handlerSandbox.handle({ id: "v8", type: "ptt", fromMe: false }, { groupId: official, senderPhone: "962790000001" });
  assert.equal(noSnapshot.status, "skipped", "deletion waits for the admin snapshot instead of guessing");

  handlerSandbox.officialGroupAdminSnapshotReady = () => true;
  handlerSandbox.voiceMessageDeletionEnabled = () => false;
  const disabled = await handlerSandbox.handle({ id: "v9", type: "ptt", fromMe: false }, { groupId: official, senderPhone: "962790000001" });
  assert.equal(disabled.status, "disabled");
  handlerSandbox.voiceMessageDeletionEnabled = () => true;
  handlerSandbox.voiceMessageDeletionEmergencyStopped = () => true;
  const paused = await handlerSandbox.handle({ id: "v10", type: "ptt", fromMe: false }, { groupId: official, senderPhone: "962790000001" });
  assert.equal(paused.status, "paused", "the emergency stop must remain the owner's kill switch");
  handlerSandbox.voiceMessageDeletionEmergencyStopped = () => false;

  const missingId = await handlerSandbox.handle({ type: "ptt", fromMe: false }, { groupId: official, senderPhone: "962790000001" });
  assert.equal(missingId.status, "skipped", "an unaddressable message cannot be deleted");

  assert.equal(deleteCalls, 2, "only the two eligible member clips reached the deletion path");
  console.log("isolated voice-message deletion behavior: passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
