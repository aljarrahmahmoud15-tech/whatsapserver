"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const root = __dirname;
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

const targetStart = serverSource.indexOf("function buildSettledOrderAcceptanceTarget(");
const targetEnd = serverSource.indexOf("function reactionEvidenceSenderKey(", targetStart);
assert.ok(targetStart >= 0, "دالة buildSettledOrderAcceptanceTarget موجودة في المصدر");
assert.ok(targetEnd > targetStart, "حد استخراج دوال حل الهدف موجود");
const resolutionSource = serverSource.slice(targetStart, targetEnd);

const FIXTURE_GROUP = "approved-group@g.us";
const FIXTURE_OTHER_GROUP = "other-group@g.us";
const FIXTURE_ACCEPTANCE_MESSAGE_ID = "false_" + FIXTURE_GROUP + "_ACCEPTCORE_16346880422036@lid";
const FIXTURE_SOURCE_MESSAGE_ID = "false_" + FIXTURE_GROUP + "_SOURCECORE_221625093984457@lid";
const FIXTURE_PRODUCER_ID = 227;
const FIXTURE_EXECUTOR_ID = 1368;
const FIXTURE_PRODUCER_PHONE = "fixture-producer-contact";
const FIXTURE_EXECUTOR_PHONE = "fixture-executor-contact";

function createFixtureDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      group_id TEXT,
      status TEXT,
      settlement_state TEXT,
      producer_user_id INTEGER,
      captain_user_id INTEGER,
      accepted_message_id TEXT,
      source_message_id TEXT,
      accepted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE messages (
      message_id TEXT,
      group_id TEXT,
      body TEXT,
      sent_at TEXT
    );
    CREATE TABLE order_candidate_acceptances (
      id INTEGER PRIMARY KEY,
      acceptance_message_id TEXT,
      acceptance_mode TEXT
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY, phone TEXT);
  `);
  db.prepare("INSERT INTO users (id,phone) VALUES (?,?)").run(FIXTURE_PRODUCER_ID, FIXTURE_PRODUCER_PHONE);
  db.prepare("INSERT INTO users (id,phone) VALUES (?,?)").run(FIXTURE_EXECUTOR_ID, FIXTURE_EXECUTOR_PHONE);
  db.prepare(`INSERT INTO orders (id,group_id,status,settlement_state,producer_user_id,captain_user_id,accepted_message_id,source_message_id,accepted_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    510, FIXTURE_GROUP, "accepted", "settled", FIXTURE_PRODUCER_ID, FIXTURE_EXECUTOR_ID,
    FIXTURE_ACCEPTANCE_MESSAGE_ID, FIXTURE_SOURCE_MESSAGE_ID, "2026-11-13T23:43:46.215Z", "2026-11-13T23:43:46.218Z",
  );
  db.prepare("INSERT INTO messages (message_id,group_id,body,sent_at) VALUES (?,?,?,?)").run(
    FIXTURE_ACCEPTANCE_MESSAGE_ID, FIXTURE_GROUP, "تم", "2026-11-13T23:38:33.000Z",
  );
  db.prepare("INSERT INTO messages (message_id,group_id,body,sent_at) VALUES (?,?,?,?)").run(
    FIXTURE_SOURCE_MESSAGE_ID, FIXTURE_GROUP, "السعر 1\nنقطة أ ← نقطة ب", "2026-11-13T23:38:30.000Z",
  );
  db.prepare("INSERT INTO order_candidate_acceptances (id,acceptance_message_id,acceptance_mode) VALUES (?,?,?)").run(
    842, FIXTURE_ACCEPTANCE_MESSAGE_ID, "quoted",
  );
  return db;
}

// The handler only ever compares the reaction message id against stored ids, so the
// fixture equality helper mirrors the production core-matching without any identity.
function makeContext({ db, configuredGroups = [FIXTURE_GROUP], pendingTarget = null, liveMessage = null, liveCalls = [] }) {
  const context = {
    db,
    isConfiguredGroup: (groupId) => configuredGroups.includes(String(groupId || "").trim()),
    sourceMessageIdsEqual(a, b) {
      const core = (value) => {
        const match = String(value || "").match(/^(?:true|false)_([^_]+@g\.us)_([^_]+)/i);
        return match ? match[2] : String(value || "");
      };
      return Boolean(core(a) && core(b)) && core(a) === core(b);
    },
    orderTraceKey: (value) => "trace:" + String(value).slice(-6),
    console,
    buildStoredAcceptanceMessageById: () => pendingTarget,
    getWhatsAppMessageByIdVariants: async (messageId) => {
      liveCalls.push(messageId);
      return liveMessage;
    },
  };
  return context;
}

function loadResolution(context) {
  return vm.runInNewContext(`${resolutionSource}\n;({ buildSettledOrderAcceptanceTarget, resolveReactionTarget, resolveStoredReactionTarget, resolveReconcileReactionTarget })`, context, {
    filename: path.join(root, "server.js"),
  });
}

test("الحجز المكتمل يُحلّ هدف رسالة «تم» من دليل الطلب نفسه", () => {
  const db = createFixtureDb();
  const { buildSettledOrderAcceptanceTarget } = loadResolution(makeContext({ db }));
  const target = buildSettledOrderAcceptanceTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.ok(target, "يجب أن يُحل الهدف دون انتظار جلب واتساب");
  assert.equal(target.from, FIXTURE_GROUP, "المجموعة من صف الحجز");
  assert.equal(String(target.from).endsWith("@g.us"), true, "الهدف مجموعة صالحة");
  assert.equal(target.body, "تم", "نص رسالة القبول من جدول الرسائل");
  assert.equal(target.fromMe, false, "رسالة القبول ليست من البوت");
  assert.equal(target.__authorPhone, FIXTURE_EXECUTOR_PHONE, "هاتف المنفذ من صف الحجز");
  assert.equal(target.__acceptanceMode, "quoted", "وضع القبول محفوظ");
  assert.equal(target.__settledOrderId, 510, "معرّف الحجز المكتمل متاح للتتبع");
  assert.equal(target.__storedRecovery, true, "الهدف مبني على دليل محلي");
  assert.equal(target.__quotedMessageId, FIXTURE_SOURCE_MESSAGE_ID, "مصدر الطلب المرتبط محفوظ");
  const handlerStyle = db.prepare("SELECT id FROM orders WHERE group_id=? AND status IN ('accepted','completed') AND accepted_message_id=? ORDER BY id DESC LIMIT 1")
    .get(target.from, target.__serializedId);
  assert.equal(handlerStyle && handlerStyle.id, 510, "استعلام المعالج يطابق الهدف المُحل");
  db.close();
});

test("نص القبول الافتراضي يبقى «تم» عند غياب صف الرسالة", () => {
  const db = createFixtureDb();
  db.prepare("DELETE FROM messages WHERE message_id=?").run(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  const { buildSettledOrderAcceptanceTarget } = loadResolution(makeContext({ db }));
  const target = buildSettledOrderAcceptanceTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.equal(target.body, "تم", "_FALLBACK نص القبول");
  db.close();
});

test("المطابقة تقبل صيغ معرّف الرسالة المختلفة عبر جوهر المعرّف", () => {
  const db = createFixtureDb();
  db.prepare("UPDATE orders SET accepted_message_id=? WHERE id=510").run("true_" + FIXTURE_GROUP + "_ACCEPTCORE_999@lid");
  const { buildSettledOrderAcceptanceTarget } = loadResolution(makeContext({ db }));
  const target = buildSettledOrderAcceptanceTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.ok(target, "المطابقة غير المباشرة تنجح");
  assert.equal(target.__settledOrderId, 510, "نفس الحجز");
  db.close();
});

test("الحجز الملغى أو غير المسوّى لا يعطي هدفًا يمنع العكس المكرر", () => {
  for (const [status, settlementState] of [["cancelled", "reversed"], ["accepted", "unlinked"], ["completed", "none"]]) {
    const db = createFixtureDb();
    db.prepare("UPDATE orders SET status=?,settlement_state=? WHERE id=510").run(status, settlementState);
    const { buildSettledOrderAcceptanceTarget } = loadResolution(makeContext({ db }));
    assert.equal(buildSettledOrderAcceptanceTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID), null,
      `الحالة ${status}/${settlementState} يجب ألا تُحل`);
    db.close();
  }
});

test("مجموعة خارج النطاق لا تُحل أبدًا", () => {
  const db = createFixtureDb();
  db.prepare("UPDATE orders SET group_id=? WHERE id=510").run(FIXTURE_OTHER_GROUP);
  const { buildSettledOrderAcceptanceTarget } = loadResolution(makeContext({ db }));
  assert.equal(buildSettledOrderAcceptanceTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID), null, "عزل المجموعة محفوظ");
  db.close();
});

test("معرّف فارغ يرجع بلا هدف", () => {
  const db = createFixtureDb();
  const { buildSettledOrderAcceptanceTarget } = loadResolution(makeContext({ db }));
  assert.equal(buildSettledOrderAcceptanceTarget(""), null, "لا استعلام بمعرف فارغ");
  db.close();
});

test("ترتيب الحل: دليل المرشح المعلّق أولًا ثم الحجز المكتمل ثم الجلب الحي", async () => {
  const db = createFixtureDb();
  const pendingTarget = { from: FIXTURE_GROUP, body: "تم", __storedPending: true };
  const liveMessage = { from: FIXTURE_GROUP, body: "تم", __live: true };
  const liveCalls = [];
  const first = loadResolution(makeContext({ db, pendingTarget, liveMessage, liveCalls }));
  const resolvedPending = await first.resolveReactionTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.equal(resolvedPending.source, "stored_pending_acceptance", "المرشح المعلّق له الأسبقية");
  assert.equal(resolvedPending.target.__storedPending, true, "الهدف هو المخزّن المعلّق");
  assert.deepEqual(liveCalls, [], "لا استدعاء شبكة عند وجود دليل محلي");

  const second = loadResolution(makeContext({ db, pendingTarget: null, liveMessage, liveCalls }));
  const resolvedSettled = await second.resolveReactionTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.equal(resolvedSettled.source, "stored_settled_order", "الحجز المكتمل يحل قبل الشبكة");
  assert.equal(resolvedSettled.target.__settledOrderId, 510, "هدف الحجز المكتمل");
  assert.equal(resolvedSettled.target.from, FIXTURE_GROUP, "المجموعة صحيحة");
  assert.deepEqual(liveCalls, [], "المسار المكتمل لا يطلب واتساب");

  const unmatched = "false_" + FIXTURE_GROUP + "_UNKNOWNCORE_1@lid";
  const third = loadResolution(makeContext({ db, pendingTarget: null, liveMessage, liveCalls: [] }));
  const resolvedLive = await third.resolveReactionTarget(unmatched);
  assert.equal(resolvedLive.source, "live_message_fetch", "الجلب الحي هو الملاذ الأخير");
  assert.equal(resolvedLive.target.__live, true, "هدف الجلب الحي");

  const fourth = loadResolution(makeContext({ db, pendingTarget: null, liveMessage: null, liveCalls: [] }));
  const resolvedNone = await fourth.resolveReactionTarget(unmatched);
  assert.equal(resolvedNone.target, null, "لا هدف عندما تفشل كل المصادر");
  assert.equal(resolvedNone.source, null, "مصدر null يسمح بالتسجيل التشخيصي");
});

test("المعالج لم يعد يخرج بصمت عند إزالة الإعجاب", () => {
  const handlerStart = serverSource.indexOf("async function handleMessageReactionUnlocked(");
  assert.ok(handlerStart >= 0, "معالج التفاعل موجود");
  const handlerSource = serverSource.slice(handlerStart, serverSource.indexOf("\nfunction ", handlerStart + 10));
  assert.ok(handlerSource.includes("await resolveReactionTarget(messageId)"), "المعالج يستخدم حل الهدف الجديد");
  assert.ok(!handlerSource.includes("storedAcceptanceTarget || await getWhatsAppMessageByIdVariants"),
    "لا عودة إلى حل الهدف الصامت القديم");
  assert.ok(handlerSource.includes("reaction_removal_target_unresolved"), "الإزالة بلا هدف تُسجّل");
  assert.ok(handlerSource.includes("reaction_removal_no_settled_order"), "الإزالة بلا حجز مسوّى تُسجّل");
  assert.ok(handlerSource.includes('if (removedThumb) {'), "التسجيل مقيد بمسار الإزالة");
});

test("سطور التشخيص الجديدة لا تحمل أي هوية أو سر", () => {
  const callFor = (event) => {
    const match = serverSource.match(new RegExp(`logOrderTrace\\("${event}",\\s*\\{[\\s\\S]*?\\}\\);`));
    assert.ok(match, `سطر التشخيص ${event} موجود`);
    return match[0];
  };
  const unresolvedCall = callFor("reaction_removal_target_unresolved");
  const noSettledCall = callFor("reaction_removal_no_settled_order");
  const addedBlock = resolutionSource + unresolvedCall + noSettledCall;
  for (const forbidden of ["sender_phone", "approverPhone", "removalActorPhone", "qrCodeData", "ADMIN_TOKEN", "JWT_SECRET"]) {
    assert.ok(!addedBlock.includes(forbidden), `سطور التشخيص خالية من ${forbidden}`);
  }
  assert.ok(unresolvedCall.includes("orderTraceKey(messageId)"), "المعرّف مُقفَل قبل التسجيل");
  assert.ok(!/[0-9]{6,}/.test(unresolvedCall), "لا أرقام خام في سطر الإزالة");
  assert.ok(noSettledCall.includes("orderTraceKey(target.from)"), "مجموعة مُقفلة في التسجيل");
  assert.ok(noSettledCall.includes("resolvedReactionTarget.source"), "مصدر الحل مذكور للتشخيص");
  assert.ok(!/[0-9]{6,}/.test(noSettledCall), "لا أرقام خام في سطر غياب الحجز");
});

test("منطق التسوية والعكس نفسه لم يُمسّ", () => {
  for (const name of ["function cancelOrderForReactionRemoval(", "function settlePendingOrder(", "function currentSettlementPolicy(", "function calculateConfiguredSettlement("]) {
    assert.ok(serverSource.indexOf(name) >= 0, `${name} ما زالت موجودة`);
  }
  const reversalHead = serverSource.slice(
    serverSource.indexOf("function cancelOrderForReactionRemoval(orderId"),
    serverSource.indexOf("function cancelOrderForReactionRemoval(orderId") + 1400,
  );
  assert.ok(reversalHead.includes("ownerAuthorized"), "شرط تفويض المالك محفوظ");
  assert.ok(reversalHead.includes("reactingCaptain.is_bot === 1"), "رفض الحسابات الآلية محفوظ");
  assert.ok(reversalHead.includes("isBlockedPhone(producerPhone)"), "حظر الأرقام محفوظ");
});

test("مصالحة الخلفية تحترم الجلب الحي أولًا ولا تختلق حالة تفاعل", async () => {
  const db = createFixtureDb();
  const liveMessage = { from: FIXTURE_GROUP, body: "تم", __live: true, getReactions: async () => [] };
  const liveCalls = [];
  const ctx = loadResolution(makeContext({ db, pendingTarget: null, liveMessage, liveCalls }));
  const resolved = await ctx.resolveReconcileReactionTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.equal(resolved.source, "live_message_fetch", "الحالة الحيّة هي المصدر الأول في المصالحة");
  assert.equal(resolved.target.__live, true, "الهدف هو رسالة واتساب الحيّة");
  assert.deepEqual(liveCalls, [FIXTURE_ACCEPTANCE_MESSAGE_ID], "استدعاء حي واحد فقط");
  assert.equal(typeof ctx.resolveReconcileReactionTarget, "function", "حلّاد المصالحة مُصدَّر للاختبار المعزول");
  assert.equal(Object.getPrototypeOf(ctx.resolveReconcileReactionTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID)).constructor.name, "Promise", "المصالحة غير متزامنة");
  db.close();
});

test("مصالحة الخلفية تسقط إلى الدليل المحلي عند فشل واتساب فقط", async () => {
  const db = createFixtureDb();
  const calls = [];
  const ctx = loadResolution(makeContext({ db, pendingTarget: null, liveMessage: null, liveCalls: calls }));
  const settled = await ctx.resolveReconcileReactionTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.equal(settled.source, "stored_settled_order", "الدليل المحلي يحل عند تعذر القراءة الحيّة");
  assert.equal(settled.target.__settledOrderId, 510, "هدف الحجز المكتمل للمصالحة");
  assert.deepEqual(calls, [FIXTURE_ACCEPTANCE_MESSAGE_ID], "جربة حيّة واحدة ثم سقوط محلي");

  const pendingOnly = loadResolution(makeContext({ db, pendingTarget: { from: FIXTURE_GROUP, body: "تم", __storedPending: true }, liveMessage: null, liveCalls: [] }));
  const viaPending = await pendingOnly.resolveReconcileReactionTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.equal(viaPending.source, "stored_pending_acceptance", "المرشح المعلّق يسبق الحجز المكتمل");

  const unmatched = "false_" + FIXTURE_GROUP + "_UNKNOWNCORE_9@lid";
  const none = await ctx.resolveReconcileReactionTarget(unmatched);
  assert.equal(none.target, null, "بلا هدف عند فشل كل المصادر");
  assert.equal(none.source, "none", "المصدر none يفتح التسجيل التشخيصي");
  db.close();
});

test("المصالحة لم تعد تخرج بصمت وتُسجّل مصدر الحل", () => {
  const start = serverSource.indexOf("async function reconcileStoredThumbReactionUnlocked(");
  assert.ok(start >= 0, "دالة المصالحة موجودة");
  const body = serverSource.slice(start, serverSource.indexOf("\n}\n", start + 10));
  assert.ok(body.includes("await resolveReconcileReactionTarget(normalizedMessageId)"), "المصالحة تستخدم حلّاد المصالحة");
  assert.ok(!body.includes("|| buildStoredAcceptanceMessageById(normalizedMessageId)"),
    "لا عودة إلى التعبير الصامت القديم في المصالحة");
  assert.ok(body.includes("reaction_scan_target_unresolved"), "الخروج بلا هدف يُسجّل");
  const call = serverSource.match(/logOrderTrace\("reaction_scan_target_unresolved",\s*\{[\s\S]*?\}\);/);
  assert.ok(call, "سطر تشخيص المصالحة موجود");
  assert.ok(call[0].includes("orderTraceKey(normalizedMessageId)"), "المعرّف مُقفَل قبل التسجيل");
  assert.ok(!/[0-9]{6,}/.test(call[0]), "لا أرقام خام في سطر المصالحة");
  for (const forbidden of ["sender_phone", "approverPhone", "qrCodeData", "ADMIN_TOKEN", "JWT_SECRET"]) {
    assert.ok(!call[0].includes(forbidden), `سطر المصالحة خالٍ من ${forbidden}`);
  }
});

test("الحل المحلي لا يُستدعى مرتين ولا يطلب الشبكة عند وجود هدف", async () => {
  const db = createFixtureDb();
  const calls = [];
  const ctx = loadResolution(makeContext({ db, pendingTarget: null, liveMessage: null, liveCalls: calls }));
  const stored = await ctx.resolveStoredReactionTarget(FIXTURE_ACCEPTANCE_MESSAGE_ID);
  assert.equal(stored.source, "stored_settled_order", "الحل المحلي يعمل وحده");
  assert.deepEqual(calls, [], "الحل المحلي لا يلمس الشبكة إطلاقًا");
  db.close();
});
