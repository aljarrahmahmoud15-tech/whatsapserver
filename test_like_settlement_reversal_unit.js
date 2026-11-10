"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { cancelSettledOrderAndReverse } = require("./order-cancellation");

const root = __dirname;
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const reactionStart = server.indexOf("async function handleMessageReaction(");
const reactionEnd = server.indexOf("async function reconcileStoredThumbReaction(", reactionStart);
assert.ok(reactionStart >= 0 && reactionEnd > reactionStart, "مسار التفاعل موجود");
const reactionSource = server.slice(reactionStart, reactionEnd);

function reversalFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, wallet_cents INTEGER NOT NULL, updated_at TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no INTEGER NOT NULL, status TEXT NOT NULL, settlement_state TEXT NOT NULL, producer_user_id INTEGER, group_id TEXT, updated_at TEXT);
    CREATE TABLE order_settlements (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, status TEXT NOT NULL, idempotency_key TEXT,
      producer_user_id INTEGER, captain_user_id INTEGER, charged_user_id INTEGER,
      company_cents INTEGER, producer_cents INTEGER, captain_fee_cents INTEGER, details_json TEXT
    );
    CREATE TABLE wallet_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, order_id INTEGER,
      type TEXT NOT NULL, amount_cents INTEGER NOT NULL, balance_after_cents INTEGER NOT NULL,
      reference TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, details_json TEXT, idempotency_key TEXT UNIQUE
    );
  `);
  db.prepare("INSERT INTO users(id,role,wallet_cents) VALUES(1,'company',50),(2,'captain',250),(3,'captain',4700)").run();
  db.prepare("INSERT INTO orders(id,order_no,status,settlement_state,producer_user_id,group_id) VALUES(10,77,'accepted','settled',2,'official@g.us')").run();
  db.prepare("INSERT INTO order_settlements(id,order_id,status,idempotency_key,producer_user_id,captain_user_id,charged_user_id,company_cents,producer_cents,captain_fee_cents,details_json) VALUES(20,10,'applied','ORDER-77-10',2,3,3,50,250,300,'{}')").run();
  return db;
}

test("لا يحدث تثبيت أو تسوية عند رسالة تم وحدها", () => {
  assert.match(reactionSource, /findPendingAcceptanceByMessage\(target\.from, messageId\)/);
  assert.match(reactionSource, /const result = settlePendingOrder\(/);
  assert.match(reactionSource, /if \(targetIsOrderSource\) return;/);
  assert.match(reactionSource, /if \(!approverPhone\)/);
});

test("إعجاب الكابتن الأول يثبت مرة واحدة وإزالة الإعجاب تستدعي العكس", () => {
  assert.match(reactionSource, /reactionValue !== "👍"/);
  assert.match(reactionSource, /const producerAuthorized = Boolean\(/);
  assert.match(reactionSource, /settlePendingOrder\(pending\.candidate_id, pending\.acceptance_message_id, settlementConfirmerPhone\)/);
  assert.match(reactionSource, /if \(removedThumb\)/);
  assert.match(reactionSource, /cancelOrderForReactionRemoval\(/);
  assert.match(reactionSource, /enforceCaptainWalletThresholds\(/);
});

test("الدورة المعزولة تتحقق من التسوية مرة واحدة والعكس مرة واحدة", () => {
  const output = execFileSync(process.execPath, [path.join(root, "test_unified_order_lifecycle_isolated.js")], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.match(output, /unified order lifecycle race, identity, debt, idempotency, and archive guards verified/);
});

test("عكس الإعجاب يعيد الحركات المالية ولا يكررها عند الإزالة الثانية", () => {
  const db = reversalFixture();
  const audits = [];
  const input = {
    orderId: 10,
    now: () => "2026-11-10T07:00:00.000Z",
    audit: (...args) => audits.push(args),
    reason: "إزالة إعجاب الكابتن الأول",
    idempotencyKey: "LIKE-REMOVE-77",
    actor: "producer_reaction",
  };

  const first = cancelSettledOrderAndReverse(db, input);
  assert.equal(first.state, "cancelled");
  assert.deepEqual(db.prepare("SELECT id,wallet_cents FROM users ORDER BY id").all(), [
    { id: 1, wallet_cents: 0 },
    { id: 2, wallet_cents: 0 },
    { id: 3, wallet_cents: 5000 },
  ]);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id=10").get().status, "cancelled");
  assert.equal(db.prepare("SELECT status FROM order_settlements WHERE order_id=10").get().status, "reversed");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count, 3);
  assert.equal(audits.length, 1);

  const second = cancelSettledOrderAndReverse(db, { ...input, idempotencyKey: "LIKE-REMOVE-77-RETRY" });
  assert.equal(second.state, "already_reversed");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count, 3);
  assert.equal(audits.length, 1);
});

console.log("like settlement and reversal unit tests defined");
