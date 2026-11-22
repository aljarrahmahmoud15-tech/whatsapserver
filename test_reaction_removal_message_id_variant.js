"use strict";

// Regression for the live incident: the owner removed the producer 👍 from the
// executor's «تم» message of settled booking 890. Every authorization guard passed
// (the 👍 evidence row went inactive), yet the booking stayed settled because the
// handler located the order with EXACT equality against `orders.accepted_message_id`
// while a reaction event may identify the same message by another variant. The
// resolver below must accept the variants and the reversal must receive the stored id.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const root = __dirname;
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

function sliceFunction(name, endMarker) {
  const start = serverSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `دالة ${name} موجودة في المصدر`);
  const end = serverSource.indexOf(endMarker, start);
  assert.ok(end > start, `حد استخراج ${name} موجود`);
  return serverSource.slice(start, end);
}

const resolverSource = sliceFunction("findSettledOrderByAcceptanceMessage", "function orderTraceKey(");
const coreSource = sliceFunction("messageIdCore", "function messageIdIdentityVariants(");
const equalitySource = sliceFunction("sourceMessageIdsEqual", "function buildStoredQuotedMessageById(");
const reversalSource = sliceFunction("cancelOrderForReactionRemoval", "function cancelPendingOrderForProducerReaction(");

const GROUP = "official-group@g.us";
const CORE = "AB12CD34EF56AB77CD88EF99AB01CD22";
const STORED_ACCEPTANCE_ID = `false_${GROUP}_${CORE}_962700000001@lid`;
const PRODUCER_PHONE = "962700000001";
const EXECUTOR_PHONE = "962700000002";
const NOW = "2026-11-22T06:25:55.000Z";

function createFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      phone TEXT,
      role TEXT NOT NULL,
      is_bot INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      account_status TEXT NOT NULL DEFAULT 'active',
      wallet_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      order_no INTEGER NOT NULL,
      group_id TEXT,
      status TEXT NOT NULL,
      settlement_state TEXT NOT NULL,
      producer_user_id INTEGER,
      captain_user_id INTEGER,
      accepted_message_id TEXT,
      accepted_at TEXT,
      order_kind TEXT,
      archive_state TEXT DEFAULT 'active',
      updated_at TEXT
    );
    CREATE TABLE order_settlements (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT,
      producer_user_id INTEGER,
      captain_user_id INTEGER,
      charged_user_id INTEGER,
      company_cents INTEGER NOT NULL,
      producer_cents INTEGER NOT NULL,
      captain_fee_cents INTEGER NOT NULL,
      approval_reaction_user_id INTEGER,
      approval_method TEXT,
      details_json TEXT,
      applied_at TEXT
    );
    CREATE TABLE wallet_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id INTEGER,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      reference TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      details_json TEXT,
      idempotency_key TEXT UNIQUE
    );
  `);
  db.prepare("INSERT INTO users(id,phone,role,wallet_cents) VALUES(1,?,'company',1000),(2,?,'captain',400),(3,?,'captain',2000)").run("962700000000", PRODUCER_PHONE, EXECUTOR_PHONE);
  db.prepare(`INSERT INTO orders(id,order_no,group_id,status,settlement_state,producer_user_id,captain_user_id,accepted_message_id,accepted_at,order_kind)
    VALUES(890,890,?, 'accepted','settled',2,3,?,?, 'standard')`).run(GROUP, STORED_ACCEPTANCE_ID, NOW);
  db.prepare(`INSERT INTO order_settlements(id,order_id,status,idempotency_key,producer_user_id,captain_user_id,charged_user_id,
      company_cents,producer_cents,captain_fee_cents,approval_reaction_user_id,approval_method,details_json,applied_at)
    VALUES(890,890,'applied','fixture-settlement-890',2,3,3,16,65,81,2,'reaction','{"policy":"fixture-standard"}',?)`).run(NOW);
  return db;
}

function makeContext(db, audits) {
  return {
    db,
    messageIdCore: undefined,
    sourceMessageIdsEqual: undefined,
    findCaptainByPhone(phone) {
      if (String(phone || "").replace(/\D/g, "") === PRODUCER_PHONE) return { id: 2, is_bot: 0, active: 1, account_status: "active", role: "captain" };
      if (String(phone || "").replace(/\D/g, "") === EXECUTOR_PHONE) return { id: 3, is_bot: 0, active: 1, account_status: "active", role: "captain" };
      return null;
    },
    companyUser: () => db.prepare("SELECT * FROM users WHERE role='company' LIMIT 1").get() || null,
    settlementLedgerNotes: (orderKind) => ({ reversalCompany: `fixture ${orderKind} company`, reversalProducer: `fixture ${orderKind} producer`, reversalCaptain: `fixture ${orderKind} captain` }),
    settlementPolicyFromDetails: () => "fixture-standard",
    isBlockedPhone: () => false,
    phoneWithCountry: (value) => String(value || "").replace(/[^0-9]/g, ""),
    now: () => "2026-11-22T06:26:03.000Z",
    audit: (...args) => audits.push(args),
  };
}

function load(db, audits = []) {
  const context = makeContext(db, audits);
  const wrapped = `${coreSource}${equalitySource}
${resolverSource}
${reversalSource}
;({ findSettledOrderByAcceptanceMessage: (g, m) => findSettledOrderByAcceptanceMessage(g, m), cancelOrderForReactionRemoval: (...args) => cancelOrderForReactionRemoval(...args) })`;
  return vm.runInNewContext(wrapped, context, { filename: path.join(root, "server.js") });
}

const variants = [
  { name: "المعرّف المخفوظ كما هو", messageId: STORED_ACCEPTANCE_ID },
  { name: "المعرّف المجرد بدون الزخرفة", messageId: CORE },
  { name: "نفس المتن مع هوية c.us", messageId: `false_${GROUP}_${CORE}_${PRODUCER_PHONE}@c.us` },
  { name: "نفس المتن بدون قطعة المرسل", messageId: `false_${GROUP}_${CORE}` },
  { name: "اتجاه معاكس من جهة البوت", messageId: STORED_ACCEPTANCE_ID.replace(/^false_/, "true_") },
];

for (const variant of variants) {
  test(`إزالة الإعجاب بصيغة معرّف «${variant.name}» تلغي الحجز وتعكس التسوية`, () => {
    const db = createFixture();
    const audits = [];
    const api = load(db, audits);
    const order = api.findSettledOrderByAcceptanceMessage(GROUP, variant.messageId);
    assert.ok(order, "يجب حل الحجز المسوّى من أي صيغة لصيغة الرسالة");
    assert.equal(order.id, 890, "نفس الحجز المقصود");
    assert.equal(order.accepted_message_id, STORED_ACCEPTANCE_ID, "المعرّف المستخدم هو المحفوظ");
    const result = api.cancelOrderForReactionRemoval(order.id, order.accepted_message_id, PRODUCER_PHONE, false, 2, NOW, false);
    assert.equal(result.state, "cancelled", "الإلغاء يُقبل لأن الفاعل هو صاحب الإعجاب الأصلي");
    assert.equal(result.reversed, true, "التسوية انعكست");
    const rows = db.prepare("SELECT type,amount_cents FROM wallet_ledger ORDER BY id").all();
    assert.deepEqual(rows.map((r) => [r.type, r.amount_cents]), [["reversal_company", -16], ["reversal_producer", -65], ["reversal_captain_fee", 81]]);
    assert.deepEqual(db.prepare("SELECT id,wallet_cents FROM users ORDER BY id").all(), [
      { id: 1, wallet_cents: 984 },
      { id: 2, wallet_cents: 335 },
      { id: 3, wallet_cents: 2081 },
    ]);
    assert.equal(db.prepare("SELECT status,settlement_state FROM orders WHERE id=890").get().status, "cancelled");
    assert.equal(db.prepare("SELECT status,settlement_state FROM orders WHERE id=890").get().settlement_state, "reversed");
    assert.equal(db.prepare("SELECT status FROM order_settlements WHERE order_id=890").get().status, "reversed");
    assert.equal(audits.length, 1, "سجل تدقيق واحد");
    assert.equal(audits[0][0], "order.cancelled_downloader_removed_thumb");
  });
}

test("رسالة تم لحجز آخر لا تُطابق الحجز المسوّى", () => {
  const db = createFixture();
  const api = load(db);
  assert.equal(api.findSettledOrderByAcceptanceMessage(GROUP, `false_${GROUP}_ZZ99YY88XX77WW66VV55UU44TT33SS_${PRODUCER_PHONE}@c.us`), null);
  assert.equal(api.findSettledOrderByAcceptanceMessage("other-group@g.us", CORE), null);
});

test("الفاعل غير المعتمد لا يعكس المال مهما كانت صيغة المعرّف", () => {
  for (const variant of variants) {
    const db = createFixture();
    const audits = [];
    const api = load(db, audits);
    const order = api.findSettledOrderByAcceptanceMessage(GROUP, variant.messageId);
    assert.ok(order, "الحجز يُحل");
    const result = api.cancelOrderForReactionRemoval(order.id, order.accepted_message_id, EXECUTOR_PHONE, false, 3, NOW, false);
    assert.equal(result.state, "unauthorized", "من رفع الإعجاب ليس المعتمد في التسوية");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count, 0, "لا حركة مالية");
    assert.equal(db.prepare("SELECT status FROM orders WHERE id=890").get().status, "accepted", "الحجز لم يُلغَ");
    assert.equal(audits.length, 0);
  }
});

test("الإزالة الثانية لنفس الحجز لا تعكس المال مرتين", () => {
  const db = createFixture();
  const audits = [];
  const api = load(db, audits);
  const first = api.cancelOrderForReactionRemoval(890, STORED_ACCEPTANCE_ID, PRODUCER_PHONE, false, 2, NOW, false);
  assert.equal(first.state, "cancelled");
  const second = api.cancelOrderForReactionRemoval(890, STORED_ACCEPTANCE_ID, PRODUCER_PHONE, false, 2, NOW, false);
  assert.equal(second.state, "stale", "الحجز لم يعد مسوّى");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count, 3);
  assert.equal(audits.length, 1);
});

test("المعالج يمرر المعرّف المحفوظ ولا يستخدم معرّف الحدث في الحارس", () => {
  const handlerStart = serverSource.indexOf("async function handleMessageReactionUnlocked(");
  const handlerEnd = serverSource.indexOf("async function reconcileStoredThumbReaction(", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "نص المعالج متاح");
  const handler = serverSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /const order = findSettledOrderByAcceptanceMessage\(target\.from, messageId\)/);
  assert.match(handler, /cancelOrderForReactionRemoval\(order\.id, order\.accepted_message_id,/);
  assert.doesNotMatch(handler, /cancelOrderForReactionRemoval\([^)]*\bmessageId,/);
  assert.match(handler, /reaction_removal_acceptance_id_variant_resolved/);
  assert.match(handler, /reaction_removal_stale/);
  assert.match(handler, /reaction_removal_actor_unauthorized/);
  assert.match(handler, /activeReactionEvidenceBySender\(messageId, target\.from, "👍", removalActorPhone\)/, "بوابة الفاعل الأصلي لم تُخفف");
  assert.match(handler, /if \(!actorAuthorized \|\| !ownsActiveReaction \|\| isBlockedPhone\(removalActorPhone\)\) \{/);
});

console.log("reaction removal message-id variant regression tests defined");
