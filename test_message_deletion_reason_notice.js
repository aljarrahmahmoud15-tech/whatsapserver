"use strict";
// Owner-approved 2026-11-24 option (ب) («عند حذف الرساله اذهار ما سبب الحذف» ثم «اختر الخيار (ب) ونفذ
// التعديل المقترح الآن»). This proves, without booting the server:
//  1. the delete-for-me guard: whatsapp-web.js Message.delete(true) silently falls back to
//     Cmd.sendDeleteMsgs (bot-only deletion) when WhatsApp Web's own revoke capability is false for the
//     id it is given. The central path must now probe that capability first and never call delete(true)
//     when it would only delete for the bot, so the page revoke path can still revoke for everyone;
//  2. verification is NOT relaxed: absence is still never treated as a confirmed deletion;
//  3. the official-group reason notice is sent only after a confirmed revoke, only to the configured
//     official group, once per message, at most once per sender and reason per minute, never with a
//     phone number, and its text can never be parsed as an order or as an acceptance;
//  4. the owner toggle exists in the server definitions and in the owner panel.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const source = fs.readFileSync("server.js", "utf8");
const admin = fs.readFileSync("admin.html", "utf8");
const slice = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

// ---------- static guardrails ----------
assert.match(source, /messageDeletionReasons: \{ key: "notification_message_deletion_reasons", label: "سبب حذف الرسائل داخل القروب الرسمي", defaultValue: true \}/);
assert.doesNotMatch(source, /if \(!matching\.length\) return \{ verified: true, reason: "absent_from_chat_history" \}/,
  "absence must never become a verified deletion");
assert.match(source, /verified: false,\s*reason: sawMessage \? "message_still_present" : lastReason/s);
const coreSource = slice("async function deleteWhatsAppMessageForEveryone(messageId, context = {})", "\nasync function collectRejectedAcceptanceDeletionCandidates");
const deleteCalls = coreSource.match(/\.delete\(true\)/g) || [];
assert.equal(deleteCalls.length, 3, "the central path has exactly three delete(true) call sites");
for (const [call, guard] of [
  ["originalMessage.delete(true)", "if (!revokeCapability.canRevoke) {"],
  ["candidate.delete(true), 15000, false);\n          const verification = await verifyWhatsAppMessageDeletion(candidate, messageId)", "if (!candidateCapability.canRevoke) {"],
  ["searchCapability.canRevoke\n          ? await withTimeout(candidate.delete(true)", "const searchCapability = await whatsappMessageRevokeCapability(candidate);"],
]) {
  const callIndex = coreSource.indexOf(call);
  const guardIndex = coreSource.lastIndexOf(guard, callIndex);
  assert.ok(callIndex > 0 && guardIndex > 0 && callIndex - guardIndex < 1200, `delete(true) must be guarded by the revoke capability probe: ${guard}`);
}
assert.doesNotMatch(coreSource, /sendDeleteMsgs/, "the central path never calls the bot-only delete command itself");
assert.match(admin, /<input id="notificationMessageDeletionReasons" type="checkbox">/);
assert.match(admin, /\['notificationMessageDeletionReasons','messageDeletionReasons'\]/);
assert.match(admin, /messageDeletionReasons:\$\('notificationMessageDeletionReasons'\)\.checked/);

// ---------- 1+2. behaviour of the central deletion path with a simulated WhatsApp Web ----------
const OFFICIAL = "official-test@g.us";
// Symbolic fixtures only: sender keys are labels, phone-like display names are built at runtime.
const SENDER_A = "sender-a";
const SENDER_B = "sender-b";
const SENDER_C = "sender-c";
const PHONE_LIKE_NAME = "07" + "9".repeat(8);
const INTL_PHONE_LIKE = "962" + "7".repeat(9);
const LIVE_ID = "false_official-test@g.us_AAA111_222@lid";
const DETACHED_ID = "false_official-test@g.us_AAA111_detached-sender@c.us";
function makeWorld({ detachedCapability = false, liveCapability = true, probeThrows = false } = {}) {
  const calls = { deleteTrue: 0, deleteForMe: 0, revokeCommands: 0 };
  const store = new Map();
  const liveModel = { id: { _serialized: LIVE_ID, remote: OFFICIAL, fromMe: false }, type: "chat", body: "hello" };
  store.set(LIVE_ID, liveModel);
  const capabilityFor = (msg) => (msg === liveModel ? liveCapability : detachedCapability);
  const window = {
    require(name) {
      if (name === "WAWebCollections") {
        return {
          Msg: {
            get: (id) => store.get(id),
            getMessagesById: async (ids) => {
              if (probeThrows) throw new Error("probe exploded");
              const found = ids.map((id) => store.get(id) || (id === DETACHED_ID && store.has(LIVE_ID) ? { id: { _serialized: DETACHED_ID, remote: OFFICIAL }, type: "chat", detached: true } : null)).filter(Boolean);
              return { messages: found };
            },
          },
          Chat: { get: () => ({ id: OFFICIAL }), find: async () => ({ id: OFFICIAL }) },
        };
      }
      if (name === "WAWebMsgActionCapability") {
        return { canSenderRevokeMsg: () => false, canAdminRevokeMsg: (msg) => capabilityFor(msg) };
      }
      if (name === "WAWebCmd") {
        return { Cmd: { sendRevokeMsgs: async (_chat, payload) => { calls.revokeCommands += 1; const msg = payload.list ? payload.list[0] : payload[0]; if (capabilityFor(msg) && store.get(msg.id._serialized)) store.get(msg.id._serialized).type = "revoked"; } } };
      }
      throw new Error(`unexpected module ${name}`);
    },
    WWebJS: { compareWwebVersions: () => true },
    Debug: { VERSION: "2.3000.1" },
  };
  // Mirrors whatsapp-web.js 1.34.8 Message.delete(everyone): revoke only when the capability passes
  // for the exact id it holds, otherwise the silent bot-only fallback that removes the store entry.
  const originalMessage = {
    id: { _serialized: DETACHED_ID },
    body: "hello",
    async delete(everyone) {
      calls.deleteTrue += 1;
      const msg = store.get(DETACHED_ID) || { id: { _serialized: DETACHED_ID }, detached: true };
      if (everyone && capabilityFor(msg)) { calls.revokeCommands += 1; if (store.get(LIVE_ID)) store.get(LIVE_ID).type = "revoked"; return; }
      calls.deleteForMe += 1;
      store.delete(LIVE_ID);
    },
    async reload() { const live = store.get(LIVE_ID); return live ? { type: live.type } : null; },
    async getChat() { return { fetchMessages: async () => [] }; },
  };
  return { calls, store, window, originalMessage, liveModel };
}
const VOICE_PERMIT = Symbol("voice");
function makeCoreSandbox(world) {
  const sandbox = {
    window: world.window,
    console: { log() {}, warn() {} },
    setTimeout: (fn) => setImmediate(fn),
    client: { pupPage: { evaluate: async (fn, arg) => fn(arg) } },
    withTimeout: async (promise, _ms, fallback) => { try { return await promise; } catch (error) { if (fallback === undefined) throw error; return fallback; } },
    LOW_BALANCE_ACCEPTANCE_DELETE_PERMIT: Symbol("low"),
    GENERAL_UNAPPROVED_MESSAGE_DELETE_PERMIT: Symbol("general"),
    VOICE_MESSAGE_DELETE_PERMIT: VOICE_PERMIT,
    configuredRuntimeGroupId: () => OFFICIAL,
    isConfiguredGroup: (groupId) => groupId === OFFICIAL,
    generalMessageDeletionEnabled: () => true,
    generalMessageDeletionEmergencyStopped: () => false,
    voiceMessageDeletionEnabled: () => true,
    voiceMessageDeletionEmergencyStopped: () => false,
    orderTraceKey: (value) => String(value || "").slice(-6),
    audits: [],
    audit(action, _type, _id, details) { sandbox.audits.push({ action, details }); },
    getPersistedWhatsAppMessageReceipt: () => null,
    getCachedIncomingWhatsAppMessage: () => null,
    messageIdLookupVariants: (value) => (value ? [String(value), LIVE_ID] : []),
    getWhatsAppMessageByIdVariants: async () => null,
    messageIdCandidates: (message) => [message?.id?._serialized].filter(Boolean),
    serializedMessageId: (message) => message?.id?._serialized || null,
    sourceMessageIdsEqual: (a, b) => String(a) === String(b),
    resolveMessageSenderPhone: async () => "",
    directJordanPhoneFromWhatsappValue: () => "",
    phoneWithCountry: (value) => String(value || ""),
    resolveGroupChatId: () => OFFICIAL,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${slice("async function whatsappMessageRevokeCapability(message)", "\nasync function collectRejectedAcceptanceDeletionCandidates")}
this.deleteCore = deleteWhatsAppMessageForEveryone; this.probe = whatsappMessageRevokeCapability;`, sandbox);
  return sandbox;
}
const voiceContext = (world) => ({ message: world.originalMessage, reason: "unapproved_audio_message", groupId: OFFICIAL, policyAction: "voice_message", [VOICE_PERMIT]: true });

(async () => {
  // The live failure signature: detached id -> capability false -> old code deleted for the bot only.
  {
    const world = makeWorld({ detachedCapability: false, liveCapability: true });
    const sandbox = makeCoreSandbox(world);
    const result = await sandbox.deleteCore(DETACHED_ID, voiceContext(world));
    assert.equal(world.calls.deleteTrue, 0, "delete(true) must not run when it would only delete for the bot");
    assert.equal(world.calls.deleteForMe, 0, "no bot-only deletion");
    assert.equal(world.liveModel.type, "revoked", "the page path revoked the live message for everyone");
    assert.equal(result.ok, true);
    assert.equal(result.revoked, true);
    const final = sandbox.audits.find((entry) => entry.action === "whatsapp.message_deletion");
    assert.equal(final.details.outcome, "success");
    assert.equal(final.details.directRevokeProbe.canRevoke, false);
    assert.equal(final.details.directRevokeProbe.found, true);
  }
  // Capability present for the held id: the direct path revokes and verification confirms it.
  {
    const world = makeWorld({ detachedCapability: true, liveCapability: true });
    const sandbox = makeCoreSandbox(world);
    const result = await sandbox.deleteCore(DETACHED_ID, voiceContext(world));
    assert.equal(world.calls.deleteTrue, 1);
    assert.equal(world.calls.deleteForMe, 0);
    assert.equal(result.ok, true);
    assert.equal(result.method, "message.delete");
    assert.equal(result.acknowledgement, "revoked_after_reload");
  }
  // A probe that cannot answer fails closed: no delete(true), and nothing is reported as deleted
  // unless a real revoke was observed.
  {
    const world = makeWorld({ detachedCapability: false, liveCapability: false, probeThrows: true });
    const sandbox = makeCoreSandbox(world);
    const probe = await sandbox.probe(world.originalMessage);
    assert.equal(probe.canRevoke, false);
    const result = await sandbox.deleteCore(DETACHED_ID, voiceContext(world));
    assert.equal(world.calls.deleteTrue, 0);
    assert.equal(world.calls.deleteForMe, 0);
    assert.notEqual(result.ok, true, "no confirmed deletion without a real revoke");
  }
  // Neither id may be revoked (bot not admin): nothing is deleted, failure is explicit.
  {
    const world = makeWorld({ detachedCapability: false, liveCapability: false });
    const sandbox = makeCoreSandbox(world);
    const result = await sandbox.deleteCore(DETACHED_ID, voiceContext(world));
    assert.equal(world.calls.deleteTrue, 0);
    assert.equal(world.calls.deleteForMe, 0);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "revoke_not_permitted");
    assert.equal(world.liveModel.type, "chat", "the message is untouched");
  }
  // Probe edge cases.
  {
    const world = makeWorld();
    const sandbox = makeCoreSandbox(world);
    assert.equal((await sandbox.probe({})).canRevoke, false, "missing id");
    sandbox.client = null;
    assert.equal((await sandbox.probe(world.originalMessage)).reason, "page_unavailable");
  }

  // ---------- 3. reason notice ----------
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deletion-reason-"));
  const db = new Database(path.join(tempDir, "test.sqlite"));
  db.exec(`CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_phone TEXT NOT NULL, recipient_role TEXT NOT NULL, event TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'pending', message_id TEXT, source_message_id TEXT, idempotency_key TEXT, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(idempotency_key);`);
  const sent = [];
  let toggle = true;
  const noticeSandbox = {
    db,
    console,
    Date,
    notificationEnabled: (name) => name === "messageDeletionReasons" && toggle,
    configuredRuntimeGroupId: () => OFFICIAL,
    isOfficialGroupTarget: (target) => target === OFFICIAL,
    isServer2OutboundTargetAllowed: (target) => target === OFFICIAL,
    messageIdCore: (value) => String(value || "").split("_").slice(-2, -1)[0] || "",
    phoneWithCountry: (value) => String(value || ""),
    findCaptainByPhone: (phone) => (phone === SENDER_A ? { registration_name: "أبو أحمد" } : phone === SENDER_B ? { name: PHONE_LIKE_NAME } : null),
    client: { sendMessage() {} },
    isReady: true,
    now: () => "2026-11-24T17:00:00.000Z",
    audits: [],
    audit(action, _type, _id, details) { noticeSandbox.audits.push({ action, details }); },
    async sendWhatsAppAtMostOnce(to, content) { sent.push({ to, content }); return { status: "sent", message: { id: { _serialized: `sent-${sent.length}` } } }; },
  };
  vm.createContext(noticeSandbox);
  vm.runInContext(`${slice("const MESSAGE_DELETION_REASON_TEXTS = Object.freeze({", "\nasync function handleIncomingVoiceMessagePolicy")}
this.notify = notifyOfficialGroupMessageDeletionReason; this.text = messageDeletionReasonNoticeText; this.senderName = messageDeletionReasonSenderName; this.label = messageDeletionReasonSenderLabel; this.recent = messageDeletionReasonRecentSender;`, noticeSandbox);
  const confirmed = { ok: true, requested: true, revoked: true, method: "message.delete" };
  const base = { groupId: OFFICIAL, reason: "unapproved_audio_message", deletion: confirmed, senderName: "أبو أحمد", senderPhone: SENDER_A };

  toggle = false;
  assert.equal((await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p" })).reason, "owner_notification_setting_disabled");
  toggle = true;
  assert.equal((await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p", deletion: { ok: false, reason: "message_not_found" } })).status, "not_confirmed");
  assert.equal((await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p", deletion: { ok: true, revoked: false } })).status, "not_confirmed");
  assert.equal((await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p", deletion: { ...confirmed, paused: true } })).status, "not_confirmed");
  assert.equal((await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p", groupId: "other@g.us" })).status, "blocked");
  assert.equal((await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p", reason: "insufficient_balance_acceptance" })).reason, "unsupported_deletion_reason");
  assert.equal(sent.length, 0, "nothing is sent unless the deletion is confirmed and targeted at the official group");

  const first = await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p" });
  assert.equal(first.status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OFFICIAL);
  assert.equal(sent[0].content, "🗑️ حُذفت رسالة صوتية من أبو أحمد.\nالسبب: الرسائل الصوتية غير مسموحة في قروب وصلني الآن، يُرجى كتابة الطلب نصًّا.");
  const burst = await noticeSandbox.notify({ ...base, messageId: "false_x_M2_p" });
  assert.equal(burst.reason, "sender_notice_cooldown", "a burst from one sender yields one notice per minute");
  assert.equal(sent.length, 1);
  noticeSandbox.recent.clear();
  const duplicate = await noticeSandbox.notify({ ...base, messageId: "false_x_M1_p" });
  assert.equal(duplicate.duplicate, true, "the same deleted message never produces a second notice, even after the cooldown");
  assert.equal(sent.length, 1);
  const general = await noticeSandbox.notify({ ...base, messageId: "false_x_M3_p", reason: "unapproved_general_message", senderName: PHONE_LIKE_NAME, senderPhone: SENDER_B });
  assert.equal(general.status, "sent");
  assert.equal(sent[1].content, "🗑️ حُذفت رسالة من أحد الكباتن.\nالسبب: القروب مخصص لطلبات الرحلات والردود المعتمدة عليها فقط، وهذه الرسالة ليست منها.");
  const receipts = db.prepare("SELECT event,delivery_status,recipient_role FROM notifications ORDER BY id").all();
  assert.deepEqual(receipts.map((row) => [row.event, row.delivery_status, row.recipient_role]), [
    ["group.message_deletion.reason", "sent", "group"],
    ["group.message_deletion.reason", "sent", "group"],
  ]);
  assert.ok(noticeSandbox.audits.every((entry) => entry.details.financialMutation === false && entry.details.orderMutation === false));

  // Names that are really phone numbers are never published.
  for (const raw of [INTL_PHONE_LIKE, "+962 79 000 0000", PHONE_LIKE_NAME, "كابتن " + PHONE_LIKE_NAME, "", null]) {
    assert.equal(noticeSandbox.label(raw), "أحد الكباتن", `phone-like name hidden: ${raw}`);
  }
  assert.equal(noticeSandbox.label("أبو أحمد"), "أبو أحمد");
  assert.equal(noticeSandbox.senderName({ _data: { notifyName: "Sami" } }, SENDER_C), "Sami");
  assert.equal(noticeSandbox.senderName({ _data: { notifyName: "Sami" } }, SENDER_A), "أبو أحمد", "registered name wins");

  // The notice text can never become an order or an acceptance when the bot's own message is parsed.
  const parserSandbox = {};
  vm.createContext(parserSandbox);
  vm.runInContext(`${slice("function parseOrder(text)", "\nfunction ")}\n${slice("function isCaptainAcceptance(text)", "\nfunction ")}
this.parseOrder = parseOrder; this.isCaptainAcceptance = isCaptainAcceptance;`, parserSandbox);
  for (const reason of ["unapproved_audio_message", "unapproved_general_message"]) {
    for (const name of ["أبو أحمد", "أحد الكباتن", "خمسة عشر"]) {
      const text = noticeSandbox.text(reason, name);
      assert.ok(text && text.startsWith("🗑️ حُذفت"), text);
      assert.doesNotMatch(text, /[0-9٠-٩]/, "no digits in the notice");
      assert.equal(parserSandbox.parseOrder(text).isOrder, false, `notice must not parse as an order: ${text}`);
      assert.equal(parserSandbox.isCaptainAcceptance(text), false, "notice must not parse as an acceptance");
    }
  }
  // Sanity: the same parser does recognise a real order, so the check above is meaningful.
  assert.equal(parserSandbox.parseOrder("السعر 5 من اربد الى عمان").isOrder, true);

  // ---------- handler wiring ----------
  for (const [handlerName, endMarker, reason, message] of [
    ["async function handleIncomingVoiceMessagePolicy(message, { groupId, senderPhone })", "\nfunction messageTextForPolicy(message)", "unapproved_audio_message", { id: { _serialized: "false_x_V1_p" }, type: "ptt", fromMe: false }],
    ["async function handleIncomingGeneralMessageDeletionPolicy(message, { groupId, senderPhone })", "\nfunction snapshotFromGroupChat", "unapproved_general_message", { id: { _serialized: "false_x_G1_p" }, type: "chat", body: "مرحبا يا شباب", fromMe: false }],
  ]) {
    for (const deletion of [{ ok: true, requested: true, revoked: true }, { ok: false, reason: "message_not_found" }]) {
      const notices = [];
      const handlerSandbox = {
        isIncomingVoiceMessage: (msg) => msg?.type === "ptt",
        voiceMessageDeletionEnabled: () => true,
        voiceMessageDeletionEmergencyStopped: () => false,
        generalMessageDeletionEnabled: () => true,
        generalMessageDeletionEmergencyStopped: () => false,
        configuredRuntimeGroupId: () => OFFICIAL,
        phoneWithCountry: (value) => String(value || ""),
        isGroupSetupOwner: () => false,
        isOfficialGroupAdminPhone: () => false,
        officialGroupAdminSnapshotReady: () => true,
        messageHasApprovedGeneralMarker: () => false,
        isCaptionedImageMessage: () => false,
        messageTextForPolicy: (msg) => String(msg?.body || "").trim(),
        serializedMessageId: (msg) => msg?.id?._serialized || null,
        messageIdCandidates: (msg) => [msg?.id?._serialized],
        VOICE_MESSAGE_DELETE_PERMIT: Symbol("v"),
        GENERAL_UNAPPROVED_MESSAGE_DELETE_PERMIT: Symbol("g"),
        audit() {},
        deleteWhatsAppMessageForEveryone: async () => deletion,
        messageDeletionReasonSenderName: () => "أبو أحمد",
        notifyOfficialGroupMessageDeletionReason: async (args) => { notices.push(args); return { status: "sent" }; },
      };
      vm.createContext(handlerSandbox);
      vm.runInContext(`${slice(handlerName, endMarker)}\nthis.handler = ${handlerName.match(/function (\w+)/)[1]};`, handlerSandbox);
      const outcome = await handlerSandbox.handler(message, { groupId: OFFICIAL, senderPhone: SENDER_A });
      await new Promise((resolve) => setImmediate(resolve));
      if (deletion.ok) {
        assert.equal(outcome.status, "deleted");
        assert.equal(notices.length, 1, `${reason}: one notice after a confirmed deletion`);
        assert.equal(notices[0].reason, reason);
        assert.equal(notices[0].groupId, OFFICIAL);
        assert.equal(notices[0].senderName, "أبو أحمد");
      } else {
        assert.equal(outcome.status, "failed");
        assert.equal(notices.length, 0, `${reason}: no notice when the deletion is not confirmed`);
      }
    }
  }
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("message deletion reason notice + delete-for-me guard: all isolated checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
