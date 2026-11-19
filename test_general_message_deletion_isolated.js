"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");
const permitStart = source.indexOf("function generalUnapprovedMessageDeletePermitValid(context, groupId)");
const permitEnd = source.indexOf("\nasync function deleteWhatsAppMessageForEveryone", permitStart);
assert.ok(permitStart >= 0 && permitEnd > permitStart);

const permitSymbol = Symbol("general_permit");
const permitSandbox = {
  GENERAL_UNAPPROVED_MESSAGE_DELETE_PERMIT: permitSymbol,
  configuredRuntimeGroupId: () => "official-test@g.us",
  isConfiguredGroup: (groupId) => groupId === "official-test@g.us",
  generalMessageDeletionEnabled: () => true,
  generalMessageDeletionEmergencyStopped: () => false,
};
vm.runInNewContext(`${source.slice(permitStart, permitEnd)}\nthis.validate = generalUnapprovedMessageDeletePermitValid;`, permitSandbox);
const validPermit = {
  [permitSymbol]: true,
  policyAction: "general_unapproved_message",
  reason: "unapproved_general_message",
};
assert.equal(permitSandbox.validate(validPermit, "official-test@g.us"), true);
assert.equal(permitSandbox.validate({ ...validPermit, [permitSymbol]: false }, "official-test@g.us"), false);
assert.equal(permitSandbox.validate({ ...validPermit, policyAction: "low_balance_acceptance" }, "official-test@g.us"), false);
assert.equal(permitSandbox.validate(validPermit, "other-group@g.us"), false);
permitSandbox.generalMessageDeletionEnabled = () => false;
assert.equal(permitSandbox.validate(validPermit, "official-test@g.us"), false);
permitSandbox.generalMessageDeletionEnabled = () => true;
permitSandbox.generalMessageDeletionEmergencyStopped = () => true;
assert.equal(permitSandbox.validate(validPermit, "official-test@g.us"), false);

const handlerStart = source.indexOf("function messageTextForPolicy(message)");
const handlerEnd = source.indexOf("\nfunction snapshotFromGroupChat", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
let deleteCalls = 0;
const handlerSandbox = {
  generalMessageDeletionEnabled: () => true,
  generalMessageDeletionEmergencyStopped: () => false,
  isIncomingVoiceMessage: () => false,
  configuredRuntimeGroupId: () => "official-test@g.us",
  phoneWithCountry: (phone) => String(phone || ""),
  isGroupSetupOwner: () => false,
  isOfficialGroupAdminPhone: () => false,
  officialGroupAdminSnapshotReady: () => true,
  serializedMessageId: (message) => message?.id || "",
  messageIdCandidates: () => [],
  deleteWhatsAppMessageForEveryone: async (_id, context) => {
    deleteCalls += 1;
    assert.equal(context.policyAction, "general_unapproved_message");
    assert.equal(context.reason, "unapproved_general_message");
    assert.equal(context[permitSymbol], true);
    return { ok: true };
  },
  audit: () => {},
  GENERAL_UNAPPROVED_MESSAGE_DELETE_PERMIT: permitSymbol,
};
vm.runInNewContext(`${source.slice(handlerStart, handlerEnd)}\nthis.handle = handleIncomingGeneralMessageDeletionPolicy;`, handlerSandbox);

(async () => {
  const deleted = await handlerSandbox.handle({ id: "m1", body: "رسالة عشوائية", type: "chat" }, { groupId: "official-test@g.us", senderPhone: "962790000001" });
  assert.equal(deleted.status, "deleted");
  assert.equal(deleteCalls, 1);
  for (const body of ["تم", "راكب", "أوردر", "https://example.test/x", "السعر 10 دينار", "10"]) {
    const preserved = await handlerSandbox.handle({ id: `p-${body}`, body, type: "chat" }, { groupId: "official-test@g.us", senderPhone: "962790000001" });
    assert.equal(preserved.status, "preserved", body);
  }
  const image = await handlerSandbox.handle({ id: "img", type: "image", caption: "" }, { groupId: "official-test@g.us", senderPhone: "962790000001" });
  assert.equal(image.status, "skipped");
  const wrongGroup = await handlerSandbox.handle({ id: "wrong", body: "رسالة عشوائية", type: "chat" }, { groupId: "other@g.us", senderPhone: "962790000001" });
  assert.equal(wrongGroup.status, "not_applicable");
  handlerSandbox.isGroupSetupOwner = () => true;
  const owner = await handlerSandbox.handle({ id: "owner", body: "رسالة عشوائية", type: "chat" }, { groupId: "official-test@g.us", senderPhone: "962790000002" });
  assert.equal(owner.status, "skipped");
  handlerSandbox.isGroupSetupOwner = () => false;
  handlerSandbox.isOfficialGroupAdminPhone = () => true;
  const admin = await handlerSandbox.handle({ id: "admin", body: "رسالة عشوائية", type: "chat" }, { groupId: "official-test@g.us", senderPhone: "962790000003" });
  assert.equal(admin.status, "skipped");
  handlerSandbox.isOfficialGroupAdminPhone = () => false;
  handlerSandbox.generalMessageDeletionEnabled = () => false;
  const disabled = await handlerSandbox.handle({ id: "disabled", body: "رسالة عشوائية", type: "chat" }, { groupId: "official-test@g.us", senderPhone: "962790000001" });
  assert.equal(disabled.status, "disabled");
  handlerSandbox.generalMessageDeletionEnabled = () => true;
  handlerSandbox.generalMessageDeletionEmergencyStopped = () => true;
  const paused = await handlerSandbox.handle({ id: "paused", body: "رسالة عشوائية", type: "chat" }, { groupId: "official-test@g.us", senderPhone: "962790000001" });
  assert.equal(paused.status, "paused");
  console.log("isolated general-message deletion behavior: passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
