"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Database = require("better-sqlite3");

const root = __dirname;
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const cancellationStart = serverSource.indexOf("function cancelOrderForReactionRemoval(");
const cancellationEnd = serverSource.indexOf("function cancelPendingOrderForProducerReaction(", cancellationStart);
assert.ok(cancellationStart >= 0, "دالة cancelOrderForReactionRemoval موجودة");
assert.ok(cancellationEnd > cancellationStart, "حد استخراج الدالة موجود");
const cancellationSource = serverSource.slice(cancellationStart, cancellationEnd);

const FIXTURE_PRODUCER_PHONE = "fixture-producer-contact";
const FIXTURE_MESSAGE_ID = "fixture-accepted-message-1";
const FIXTURE_REACTION_ACTOR_ID = 3;
const FIXTURE_NOW = "2026-11-13T20:00:00.000Z";

function createFixture({ orderStatus = "accepted", acceptedMessageId = FIXTURE_MESSAGE_ID, approvalMethod = "reaction", approvalActorId = FIXTURE_REACTION_ACTOR_ID } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      wallet_cents INTEGER NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      order_no INTEGER NOT NULL,
      status TEXT NOT NULL,
      settlement_state TEXT NOT NULL,
      producer_user_id INTEGER,
      captain_user_id INTEGER,
      accepted_message_id TEXT,
      pending_captain_user_id INTEGER,
      pending_message_id TEXT,
      pending_at TEXT,
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

  db.prepare("INSERT INTO users(id,role,wallet_cents) VALUES(1,'company',50),(2,'producer',250),(3,'captain',4700)").run();
  db.prepare(`
    INSERT INTO orders(
      id,order_no,status,settlement_state,producer_user_id,captain_user_id,
      accepted_message_id,order_kind,archive_state
    ) VALUES(10,77,?,?,?,?,?,?, 'active')
  `).run(orderStatus, "settled", 2, 3, acceptedMessageId, "standard");
  db.prepare(`
    INSERT INTO order_settlements(
      id,order_id,status,idempotency_key,producer_user_id,captain_user_id,charged_user_id,
      company_cents,producer_cents,captain_fee_cents,approval_reaction_user_id,
      approval_method,details_json,applied_at
    ) VALUES(20,10,'applied','fixture-settlement-77',2,3,3,50,250,300,?,?,?,?)
  `).run(approvalActorId, approvalMethod, JSON.stringify({ policy: "fixture-standard" }), FIXTURE_NOW);
  return db;
}

function balances(db) {
  return db.prepare("SELECT id,wallet_cents FROM users ORDER BY id").all();
}

function ledgerCount(db) {
  return db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count;
}

function loadCancellation(db, audits) {
  const context = {
    db,
    findCaptainByPhone(phone, options) {
      if (phone !== FIXTURE_PRODUCER_PHONE || !options?.activeOnly) return null;
      return { id: FIXTURE_REACTION_ACTOR_ID, is_bot: 0, active: 1 };
    },
    companyUser() {
      return db.prepare("SELECT * FROM users WHERE role='company' LIMIT 1").get() || null;
    },
    settlementLedgerNotes(orderKind, policy) {
      return {
        reversalCompany: `fixture company reversal ${orderKind}:${policy}`,
        reversalProducer: `fixture producer reversal ${orderKind}:${policy}`,
        reversalCaptain: `fixture captain reversal ${orderKind}:${policy}`,
      };
    },
    settlementPolicyFromDetails(detailsJson) {
      try {
        return JSON.parse(detailsJson || "{}").policy || "fixture-default";
      } catch {
        return "fixture-default";
      }
    },
    isBlockedPhone() {
      return false;
    },
    now() {
      return FIXTURE_NOW;
    },
    audit(...args) {
      audits.push(args);
    },
  };
  return vm.runInNewContext(`${cancellationSource}\n;cancelOrderForReactionRemoval`, context, {
    filename: path.join(root, "server.js"),
  });
}

function runCancellation(fixtureOptions, callOptions = {}) {
  const db = createFixture(fixtureOptions);
  const audits = [];
  const cancelOrderForReactionRemoval = loadCancellation(db, audits);
  const result = cancelOrderForReactionRemoval(
    10,
    callOptions.expectedMessageId || FIXTURE_MESSAGE_ID,
    FIXTURE_PRODUCER_PHONE,
    false,
    callOptions.requiredReactionActorId === undefined ? FIXTURE_REACTION_ACTOR_ID : callOptions.requiredReactionActorId,
    FIXTURE_NOW,
  );
  return { db, audits, result };
}

function assertReversedFixture(db, audits) {
  assert.deepEqual(balances(db), [
    { id: 1, wallet_cents: 0 },
    { id: 2, wallet_cents: 0 },
    { id: 3, wallet_cents: 5000 },
  ]);
  assert.equal(ledgerCount(db), 3);
  assert.deepEqual(db.prepare("SELECT type,amount_cents FROM wallet_ledger ORDER BY id").all(), [
    { type: "reversal_company", amount_cents: -50 },
    { type: "reversal_producer", amount_cents: -250 },
    { type: "reversal_captain_fee", amount_cents: 300 },
  ]);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id=10").get().status, "cancelled");
  assert.equal(db.prepare("SELECT settlement_state FROM orders WHERE id=10").get().settlement_state, "reversed");
  assert.equal(db.prepare("SELECT status FROM order_settlements WHERE order_id=10").get().status, "reversed");
  assert.equal(audits.length, 1);
}

test("accepted يعكس ثلاث حركات ويعيد أرصدة ما قبل التسوية ولا يكرر المال", () => {
  const { db, audits, result } = runCancellation({ orderStatus: "accepted" });
  assert.equal(result.state, "cancelled");
  assert.equal(result.reversed, true);
  assertReversedFixture(db, audits);

  const retry = loadCancellation(db, audits)(
    10,
    FIXTURE_MESSAGE_ID,
    FIXTURE_PRODUCER_PHONE,
    false,
    FIXTURE_REACTION_ACTOR_ID,
    FIXTURE_NOW,
  );
  assert.equal(retry.state, "stale");
  assert.equal(ledgerCount(db), 3);
  assert.equal(audits.length, 1);
});

test("completed يعكس ثلاث حركات ويعيد أرصدة ما قبل التسوية ولا يكرر المال", () => {
  const { db, audits, result } = runCancellation({ orderStatus: "completed" });
  assert.equal(result.state, "cancelled");
  assert.equal(result.reversed, true);
  assertReversedFixture(db, audits);

  const retry = loadCancellation(db, audits)(
    10,
    FIXTURE_MESSAGE_ID,
    FIXTURE_PRODUCER_PHONE,
    false,
    FIXTURE_REACTION_ACTOR_ID,
    FIXTURE_NOW,
  );
  assert.equal(retry.state, "stale");
  assert.equal(ledgerCount(db), 3);
  assert.equal(audits.length, 1);
});

test("فقط requiredReactionActorId الأصلي مسموح به ولا ينشئ الفاعل الآخر أي ledger حتى مع completed", () => {
  for (const orderStatus of ["accepted", "completed"]) {
    const { db, audits, result } = runCancellation(
      { orderStatus },
      { requiredReactionActorId: FIXTURE_REACTION_ACTOR_ID + 100 },
    );
    assert.equal(result.state, "unauthorized");
    assert.equal(result.reason, "reaction_approver_mismatch");
    assert.equal(ledgerCount(db), 0);
    assert.deepEqual(balances(db), [
      { id: 1, wallet_cents: 50 },
      { id: 2, wallet_cents: 250 },
      { id: 3, wallet_cents: 4700 },
    ]);
    assert.equal(db.prepare("SELECT status FROM orders WHERE id=10").get().status, orderStatus);
    assert.equal(db.prepare("SELECT status FROM order_settlements WHERE order_id=10").get().status, "applied");
    assert.equal(audits.length, 0);
  }
});

test("تسوية non_reaction لا تعكس المال حتى مع actor مطابق", () => {
  const { db, audits, result } = runCancellation(
    { orderStatus: "completed", approvalMethod: "manual" },
    { requiredReactionActorId: FIXTURE_REACTION_ACTOR_ID },
  );
  assert.equal(result.state, "unauthorized");
  assert.equal(result.reason, "settlement_not_reaction_approved");
  assert.equal(ledgerCount(db), 0);
  assert.deepEqual(balances(db), [
    { id: 1, wallet_cents: 50 },
    { id: 2, wallet_cents: 250 },
    { id: 3, wallet_cents: 4700 },
  ]);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id=10").get().status, "completed");
  assert.equal(db.prepare("SELECT status FROM order_settlements WHERE order_id=10").get().status, "applied");
  assert.equal(audits.length, 0);
});

test("completed مع accepted_message_id مختلف مرفوض بلا حركة مالية", () => {
  const { db, audits, result } = runCancellation(
    { orderStatus: "completed", acceptedMessageId: "fixture-different-accepted-message" },
    { expectedMessageId: FIXTURE_MESSAGE_ID, requiredReactionActorId: FIXTURE_REACTION_ACTOR_ID },
  );
  assert.equal(result.state, "stale");
  assert.equal(ledgerCount(db), 0);
  assert.deepEqual(balances(db), [
    { id: 1, wallet_cents: 50 },
    { id: 2, wallet_cents: 250 },
    { id: 3, wallet_cents: 4700 },
  ]);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id=10").get().status, "completed");
  assert.equal(db.prepare("SELECT status FROM order_settlements WHERE order_id=10").get().status, "applied");
  assert.equal(audits.length, 0);
});

console.log("reaction completed reversal regression tests defined");
