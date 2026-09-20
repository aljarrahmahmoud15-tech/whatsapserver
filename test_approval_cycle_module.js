"use strict";
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { createApprovalCycle, parsePrice, normalizePhone } = require("./approval_cycle");

assert.equal(parsePrice("السعر 15\nمن إربد إلى عمان").priceCents, 1500);
assert.equal(parsePrice("السعر ١٠").priceCents, 1000);
assert.equal(parsePrice("15 السعر"), null);
assert.equal(normalizePhone("0771234567"), "962771234567");

class FakeClient {
  constructor() { this.handlers = new Map(); this.sent = []; }
  on(name, fn) { this.handlers.set(name, fn); }
  off(name, fn) { if (this.handlers.get(name) === fn) this.handlers.delete(name); }
  async sendMessage(groupId, text) { const sent = { id: { _serialized: `confirmation-${this.sent.length + 1}` }, from: groupId, body: text }; this.sent.push(sent); return sent; }
}

(async () => {
  const db = new Database(":memory:");
  const client = new FakeClient();
  let settlements = 0;
  const cycle = createApprovalCycle({
    client,
    db,
    groupId: "120@g.us",
    isCaptainEligible: async (phone) => ["962771111111", "962772222222"].includes(phone),
    settleOrder: async (details) => { settlements += 1; return { ledgerKey: details.idempotencyKey, applied: true }; },
  });

  const price = {
    id: { _serialized: "price-1" }, from: "120@g.us", author: "962771111111@c.us",
    body: "السعر 15\nمن إربد إلى عمان", hasQuotedMsg: false,
  };
  const done = {
    id: { _serialized: "done-1" }, from: "120@g.us", author: "962772222222@c.us",
    body: "تم", hasQuotedMsg: true, async getQuotedMessage() { return price; },
  };

  assert.deepEqual((await cycle.onMessage(price)).recorded, true);
  assert.deepEqual((await cycle.onMessage(done)).recorded, true);
  assert.equal((await cycle.onMessage(done)).duplicate, true);

  const wrongReaction = await cycle.onReaction({ reaction: "👍", msgId: "done-1", senderId: "962772222222@c.us" });
  assert.equal(wrongReaction.ignored, "reactor_not_producer");
  assert.equal(settlements, 0);

  const accepted = await cycle.onReaction({ reaction: "👍", msgId: "done-1", senderId: "962771111111@c.us" });
  assert.equal(accepted.settled, true);
  assert.equal(settlements, 1);
  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].body, /✅ تم قبول الطلب وتثبيته/);
  assert.match(client.sent[0].body, /شامل العمولة/);
  assert.match(client.sent[0].body, /تم تحويل الطلب للتسوية المالية حسب النظام/);
  assert.match(client.sent[0].body, /صاحب الطلب/);

  const repeated = await cycle.onReaction({ reaction: "👍", msgId: "done-1", senderId: "962771111111@c.us" });
  assert.equal(repeated.alreadySettled, true);
  assert.equal(settlements, 1);
  assert.equal(db.prepare("SELECT status FROM approval_orders").get().status, "settled");
  assert.equal(db.prepare("SELECT status FROM approval_sources").get().status, "settled");
  console.log("approval cycle module verified");
})().catch((error) => { console.error(error); process.exitCode = 1; });
