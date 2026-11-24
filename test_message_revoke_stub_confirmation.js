"use strict";
// Owner-approved 2026-11-24, option (ب) («اختر الخيار (ب) ونفذ التعديل المقترح الآن»).
//
// Live evidence this test encodes, gathered read-only on the official group after cf2e364 was published:
//   18:07:35, 18:23:47, 18:24:20, 18:24:38, 18:47:01 and 18:47:18 each contain a WhatsApp «revoked» message
//   whose serialized id keeps the same group and the same author segment as the audited deletion, while the
//   audit for that message reported failure with reason message_not_found 4-5 seconds later. The Render trace
//   for the same attempts shows delete(true) accepted on the first direct attempt, the original id vanishing
//   from the WhatsApp Web store, and the page path then answering message_not_found.
// So a successful admin revoke REKEYS the message: WhatsApp Web keeps a revoked stub under a new id with the
// ORIGINAL send timestamp. The old verification could only look for the original id, therefore every real
// revoke was audited as a failure and the approved reason notice never ran.
//
// This file proves, without booting the server:
//   1. whatsappSerializedIdAuthorParts() extracts the author segment (and only the author segment);
//   2. whatsappRevokeStubEvidence() confirms a revoke only on a positive signal — same chat, same author,
//      type "revoked", timestamp of the original message — and fails closed for delete-for-me (no stub),
//      another author's stub, a still-live target, an unreadable chat or a broken page;
//   3. the central deletion path only credits that confirmation after it actually called delete(true), and
//      the existing "absence is never success" rule is still enforced;
//   4. end to end: the live failure signature now yields ok+revoked and exactly one official-group notice.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const source = fs.readFileSync("server.js", "utf8");
const slice = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

// ---------- static guardrails ----------
assert.match(source, /if \(!result\?\.ok && deleteAttempted && deletionContext\.groupId && revokeAuthorParts\.length\) \{/,
  "the revoke-stub confirmation must require an actual delete(true) attempt, a group and an author segment");
assert.match(source, /reason: "target_still_live"/, "a still-live target must block the confirmation");
assert.match(source, /method: "revoke_stub_evidence"/);
assert.match(source, /revokeStubEvidence\.found === true/, "only a positive stub match may credit the deletion");
// The refusal from unit H stands: absence alone is still never a verified deletion.
assert.doesNotMatch(source, /if \(!matching\.length\) return \{ verified: true, reason: "absent_from_chat_history" \}/,
  "absence must never become a verified deletion");
assert.match(source, /verified: false,\s*reason: sawMessage \? "message_still_present" : lastReason/s,
  "verification must still report unconfirmed absence");
const coreSource = slice("async function deleteWhatsAppMessageForEveryone(messageId, context = {})", "\nasync function collectRejectedAcceptanceDeletionCandidates");
assert.equal((coreSource.match(/\.delete\(true\)/g) || []).length, 3, "three delete(true) call sites");
assert.equal((coreSource.match(/deleteAttempted = true;/g) || []).length, 3, "every delete(true) site records the attempt");
assert.doesNotMatch(coreSource, /sendDeleteMsgs/, "the central path never calls the bot-only delete command itself");

// ---------- fixtures (symbolic only: labels, never real ids or phones) ----------
const GROUP = "official-test@g.us";
const AUTHOR = "aaaa111@lid";
const OTHER_AUTHOR = "bbbb222@lid";
const ORIGINAL_ID = `false_${GROUP}_${AUTHOR}_key9001`;
const STUB_ID = `false_${GROUP}_${AUTHOR}_key9002`;
const OTHER_STUB_ID = `false_${GROUP}_${OTHER_AUTHOR}_key7001`;
const ORIGINAL_TS = 1763000000;
const VOICE_PERMIT = Symbol("voice");
const GENERAL_PERMIT = Symbol("general");

function makePage(options = {}) {
  const {
    rekeyedStub = false,
    deleteForMeOnly = false,
    otherAuthorStub = false,
    stubTimestamp = ORIGINAL_TS,
    keepTargetLive = false,
    withoutChatCollection = false,
    requireThrows = false,
  } = options;
  const store = new Map();
  const models = [];
  const original = { id: { _serialized: ORIGINAL_ID, remote: GROUP, fromMe: false }, author: AUTHOR, type: "chat", body: "hello", t: ORIGINAL_TS };
  store.set(ORIGINAL_ID, original);
  models.push(original);
  if (rekeyedStub || otherAuthorStub) {
    store.delete(ORIGINAL_ID);
    const author = otherAuthorStub ? OTHER_AUTHOR : AUTHOR;
    const id = otherAuthorStub ? OTHER_STUB_ID : STUB_ID;
    const stub = { id: { _serialized: id, remote: GROUP, fromMe: false }, author, type: "revoked", body: "", t: stubTimestamp };
    store.set(id, stub);
    models.push(stub);
    if (keepTargetLive) { store.set(ORIGINAL_ID, original); }
  }
  if (deleteForMeOnly) { store.delete(ORIGINAL_ID); models.length = 0; models.push({ ...original, type: "chat" }); }
  const window = {
    require(name) {
      if (requireThrows) throw new Error("page module unavailable");
      if (name === "WAWebWidFactory") return { createWid: (value) => ({ value }) };
      if (name === "WAWebCollections") {
        return {
          Msg: {
            get: (id) => store.get(id) || null,
            getMessagesById: async (ids) => ({ messages: ids.map((id) => store.get(id) || null).filter(Boolean) }),
          },
          Chat: {
            get: () => (withoutChatCollection ? null : { id: GROUP, msgs: { getModelsArray: () => models } }),
            find: async () => null,
          },
        };
      }
      if (name === "WAWebFindChatAction") return { findOrCreateLatestChat: async () => ({ chat: null }) };
      throw new Error(`unexpected module ${name}`);
    },
  };
  return { store, models, window, original };
}

function evidenceSandbox(page) {
  const sandbox = {
    window: page.window,
    console: { log() {}, warn() {} },
    setTimeout: (fn) => setImmediate(fn),
    client: { pupPage: { evaluate: async (fn, arg) => fn(arg) } },
    withTimeout: async (promise, _ms, fallback) => { try { return await promise; } catch (error) { if (fallback === undefined) throw error; return fallback; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${slice("function whatsappSerializedIdAuthorParts(values)", "\nasync function deleteWhatsAppMessageForEveryone")}
this.authorPartsOf = whatsappSerializedIdAuthorParts; this.evidence = whatsappRevokeStubEvidence;`, sandbox);
  return sandbox;
}

const evidenceInput = (extra = {}) => ({
  groupId: GROUP,
  authorParts: [AUTHOR],
  targetIds: [ORIGINAL_ID],
  targetTimestamp: ORIGINAL_TS,
  startedAtMs: ORIGINAL_TS * 1000,
  ...extra,
});

(async () => {
  // ---------- 1. author segment extraction ----------
  {
    const sandbox = evidenceSandbox(makePage());
    // vm results come from another realm, so compare plain host arrays.
    const partsOf = (values) => Array.from(sandbox.authorPartsOf(values));
    assert.deepEqual(partsOf([ORIGINAL_ID, "junk", "", null]), [AUTHOR], "the author segment only");
    assert.deepEqual(partsOf([`false_${GROUP}_${AUTHOR}`]), [], "a group id alone is not an author");
    assert.deepEqual(partsOf([AUTHOR]), [AUTHOR], "a bare author jid is accepted");
    assert.deepEqual(partsOf([`5.sender-a@c.us_${GROUP}_${AUTHOR}_key`]), [AUTHOR], "a device-prefixed id works too");
  }

  // ---------- 2. the positive revoke signal ----------
  {
    const page = makePage({ rekeyedStub: true });
    const sandbox = evidenceSandbox(page);
    const result = await sandbox.evidence(evidenceInput());
    assert.equal(result.found, true, "a revoked stub for the same author at the original timestamp confirms the revoke");
    assert.equal(result.targetAbsent, true);
    assert.equal(result.reason, "revoked_stub_confirmed");
    assert.equal(result.stubTimestamp, ORIGINAL_TS);
  }

  // ---------- 3. fail-closed cases ----------
  {
    // delete-for-me: the original vanishes and NO revoked stub exists.
    const page = makePage({ deleteForMeOnly: true });
    const sandbox = evidenceSandbox(page);
    const result = await sandbox.evidence(evidenceInput());
    assert.equal(result.found, false, "a bot-only deletion must never be credited as deleted for everyone");
    assert.equal(result.reason, "no_revoked_stub_in_window");
  }
  {
    // Another captain's revoke in the same second belongs to a different message.
    const page = makePage({ otherAuthorStub: true });
    const sandbox = evidenceSandbox(page);
    const result = await sandbox.evidence(evidenceInput());
    assert.equal(result.found, false, "a stub from another author does not confirm this deletion");
    assert.equal(result.reason, "revoked_stub_author_mismatch");
  }
  {
    // The violating message is still live for everyone.
    const page = makePage({ rekeyedStub: true, keepTargetLive: true });
    const sandbox = evidenceSandbox(page);
    const result = await sandbox.evidence(evidenceInput());
    assert.equal(result.found, false, "absence must still be proven, not assumed");
    assert.equal(result.reason, "target_still_live");
  }
  {
    // Outside the original message's timestamp.
    const page = makePage({ rekeyedStub: true, stubTimestamp: ORIGINAL_TS + 3600 });
    const sandbox = evidenceSandbox(page);
    const result = await sandbox.evidence(evidenceInput());
    assert.equal(result.found, false, "an unrelated revoke at another time is not evidence");
    assert.equal(result.reason, "no_revoked_stub_in_window");
  }
  {
    const page = makePage({ withoutChatCollection: true });
    const sandbox = evidenceSandbox(page);
    assert.equal((await sandbox.evidence(evidenceInput())).reason, "chat_history_unavailable");
    const broken = makePage({ requireThrows: true });
    const brokenSandbox = evidenceSandbox(broken);
    assert.equal((await brokenSandbox.evidence(evidenceInput())).checked, false, "a page that cannot answer fails closed");
    assert.equal((await sandbox.evidence({ ...evidenceInput(), groupId: "" })).reason, "evidence_input_incomplete");
    const noClient = evidenceSandbox(makePage());
    noClient.client = null;
    assert.equal((await noClient.evidence(evidenceInput())).reason, "page_unavailable");
  }

  // ---------- 4. end to end through the central deletion path ----------
  const coreSandbox = (page) => {
    const sandbox = {
      window: page.window,
      console: { log() {}, warn() {} },
      setTimeout: (fn) => setImmediate(fn),
      Date,
      client: { pupPage: { evaluate: async (fn, arg) => fn(arg) } },
      withTimeout: async (promise, _ms, fallback) => { try { return await promise; } catch (error) { if (fallback === undefined) throw error; return fallback; } },
      LOW_BALANCE_ACCEPTANCE_DELETE_PERMIT: Symbol("low"),
      GENERAL_UNAPPROVED_MESSAGE_DELETE_PERMIT: GENERAL_PERMIT,
      VOICE_MESSAGE_DELETE_PERMIT: VOICE_PERMIT,
      configuredRuntimeGroupId: () => GROUP,
      isConfiguredGroup: (groupId) => groupId === GROUP,
      generalMessageDeletionEnabled: () => true,
      generalMessageDeletionEmergencyStopped: () => false,
      voiceMessageDeletionEnabled: () => true,
      voiceMessageDeletionEmergencyStopped: () => false,
      orderTraceKey: (value) => String(value || "").slice(-6),
      audits: [],
      audit(action, _type, _id, details) { sandbox.audits.push({ action, details }); },
      getPersistedWhatsAppMessageReceipt: () => null,
      getCachedIncomingWhatsAppMessage: () => null,
      messageIdLookupVariants: (value) => (value ? [String(value)] : []),
      getWhatsAppMessageByIdVariants: async () => null,
      messageIdCandidates: (message) => [message?.id?._serialized].filter(Boolean),
      serializedMessageId: (message) => message?.id?._serialized || null,
      sourceMessageIdsEqual: (a, b) => String(a) === String(b),
      resolveMessageSenderPhone: async () => "",
      directJordanPhoneFromWhatsappValue: () => "",
      phoneWithCountry: (value) => String(value || ""),
      resolveGroupChatId: () => GROUP,
      messageIdCore: (value) => String(value || "").split("_").slice(-2, -1)[0] || "",
    };
    vm.createContext(sandbox);
    vm.runInContext(`${slice("async function whatsappMessageRevokeCapability(message)", "\nasync function collectRejectedAcceptanceDeletionCandidates")}
this.deleteCore = deleteWhatsAppMessageForEveryone;`, sandbox);
    return sandbox;
  };
  // The exact live signature: the bot is an admin so delete(true) is accepted, WhatsApp Web rekeys the
  // message as a revoked stub, the reload and the id lookups find nothing, and the page path reports
  // message_not_found. Before this change the audit said failure and no notice was sent.
  {
    const page = makePage();
    const calls = { deleteTrue: 0, revokeForEveryone: 0 };
    // Mirrors whatsapp-web.js 1.34.8 delete(true) plus WhatsApp Web's rekeying of a revoked message.
    page.original.delete = async (everyone) => {
      calls.deleteTrue += 1;
      if (everyone) {
        calls.revokeForEveryone += 1;
        page.store.delete(ORIGINAL_ID);
        page.models.length = 0;
        page.models.push({ id: { _serialized: STUB_ID, remote: GROUP, fromMe: false }, author: AUTHOR, type: "revoked", body: "", t: ORIGINAL_TS });
        page.store.set(STUB_ID, page.models[0]);
        return;
      }
      page.store.delete(ORIGINAL_ID);
      page.models.length = 0;
    };
    page.original.reload = async () => null;
    page.original.getChat = async () => ({ fetchMessages: async () => [] });
    const sandbox = coreSandbox(page);
    // the page revoke path needs the capability and command modules as well
    const baseRequire = page.window.require;
    page.window.require = (name) => {
      if (name === "WAWebMsgActionCapability") return { canSenderRevokeMsg: () => false, canAdminRevokeMsg: () => true };
      if (name === "WAWebCmd") return { Cmd: { sendRevokeMsgs: async () => { calls.revokeForEveryone += 1; } } };
      if (name === "WWebJS" || name === "Debug") return {};
      return baseRequire(name);
    };
    page.window.WWebJS = { compareWwebVersions: () => true };
    page.window.Debug = { VERSION: "2.3000.1" };
    const result = await sandbox.deleteCore(ORIGINAL_ID, {
      message: page.original,
      reason: "unapproved_general_message",
      groupId: GROUP,
      policyAction: "general_unapproved_message",
      [GENERAL_PERMIT]: true,
    });
    assert.equal(calls.deleteTrue, 1, "the direct delete(true) ran once, as in the live trace");
    assert.equal(result.ok, true, "the revoked stub confirms the deletion for everyone");
    assert.equal(result.revoked, true);
    assert.equal(result.method, "revoke_stub_evidence");
    assert.equal(result.acknowledgement, "revoked_stub_confirmed");
    assert.equal(result.priorReason, "message_not_found", "the earlier failure reason is kept for the audit trail");
    const final = sandbox.audits.find((entry) => entry.action === "whatsapp.message_deletion");
    assert.equal(final.details.outcome, "success");
    assert.equal(final.details.revokeStubEvidence.found, true);
    assert.equal(final.details.revokeStubEvidence.stubTimestamp, ORIGINAL_TS);

    // and the approved group notice is now reachable, because the deletion is confirmed
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "revoke-stub-"));
    const db = new Database(path.join(tempDir, "stub.sqlite"));
    db.exec(`CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_phone TEXT NOT NULL, recipient_role TEXT NOT NULL, event TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'pending', message_id TEXT, source_message_id TEXT, idempotency_key TEXT, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(idempotency_key);`);
    const sent = [];
    const noticeSandbox = {
      db, console: { log() {}, warn() {} }, Date,
      notificationEnabled: () => true,
      configuredRuntimeGroupId: () => GROUP,
      isOfficialGroupTarget: (target) => target === GROUP,
      isServer2OutboundTargetAllowed: (target) => target === GROUP,
      messageIdCore: (value) => String(value || "").split("_").slice(-2, -1)[0] || "",
      phoneWithCountry: (value) => String(value || ""),
      findCaptainByPhone: () => ({ registration_name: "أبو أحمد" }),
      client: { sendMessage() {} }, isReady: true,
      now: () => "2026-11-24T18:00:00.000Z",
      audits: [],
      audit(action, _type, _id, details) { noticeSandbox.audits.push({ action, details }); },
      async sendWhatsAppAtMostOnce(to, content) { sent.push({ to, content }); return { status: "sent", message: { id: { _serialized: "sent-1" } } }; },
    };
    vm.createContext(noticeSandbox);
    vm.runInContext(`${slice("const MESSAGE_DELETION_REASON_TEXTS = Object.freeze({", "\nasync function handleIncomingVoiceMessagePolicy")}
this.notify = notifyOfficialGroupMessageDeletionReason;`, noticeSandbox);
    const notice = await noticeSandbox.notify({ groupId: GROUP, messageId: ORIGINAL_ID, reason: "unapproved_general_message", deletion: result, senderName: "أبو أحمد", senderPhone: "sender-a" });
    assert.equal(notice.status, "sent", "a confirmed revoke now produces the reason notice in the group");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, GROUP);
    assert.equal(sent[0].content, "🗑️ حُذفت رسالة من أبو أحمد.\nالسبب: القروب مخصص لطلبات الرحلات والردود المعتمدة عليها فقط، وهذه الرسالة ليست منها.");
    assert.equal(noticeSandbox.audits[0].details.financialMutation, false);
  }
  // Without any stub the same run must still fail: the confirmation never invents success.
  {
    const page = makePage();
    // delete-for-me: the bot's own copy disappears and WhatsApp Web keeps no revoked stub for anyone else.
    page.original.delete = async () => { page.store.delete(ORIGINAL_ID); page.models.length = 0; };
    page.original.reload = async () => null;
    page.original.getChat = async () => ({ fetchMessages: async () => [] });
    const sandbox = coreSandbox(page);
    const baseRequire = page.window.require;
    page.window.require = (name) => {
      if (name === "WAWebMsgActionCapability") return { canSenderRevokeMsg: () => false, canAdminRevokeMsg: () => true };
      if (name === "WAWebCmd") return { Cmd: { sendRevokeMsgs: async () => {} } };
      return baseRequire(name);
    };
    page.window.WWebJS = { compareWwebVersions: () => true };
    page.window.Debug = { VERSION: "2.3000.1" };
    const result = await sandbox.deleteCore(ORIGINAL_ID, {
      message: page.original,
      reason: "unapproved_general_message",
      groupId: GROUP,
      policyAction: "general_unapproved_message",
      [GENERAL_PERMIT]: true,
    });
    assert.equal(result.ok, false, "a vanished message with no revoked stub is not a confirmed deletion");
    const final = sandbox.audits.find((entry) => entry.action === "whatsapp.message_deletion");
    assert.equal(final.details.outcome, "failure");
    assert.equal(final.details.revokeStubEvidence.found, false);
  }
  console.log("test_message_revoke_stub_confirmation: ok");
})().catch((error) => { console.error(error); process.exit(1); });
