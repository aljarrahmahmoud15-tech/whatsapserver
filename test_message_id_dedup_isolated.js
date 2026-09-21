const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("./server.js", "utf8");
const start = source.indexOf("function serializedMessageId(");
const end = source.indexOf("function orderTraceKey(", start);
assert(start >= 0 && end > start);

const GROUP = "120363426604560611@g.us";
const CORE = "A5ED11D8D207646779F917C9B5BDD4D6";
const decorated = `false_${GROUP}_${CORE}_157063112052788@lid`;
const state = {
  candidate: { id: 641, group_id: GROUP, source_message_id: decorated, status: "candidate" },
  order: { id: 90, group_id: GROUP, source_message_id: decorated, status: "accepted" },
};

const db = {
  prepare(sql) {
    return {
      get(...args) {
        if (sql.includes("FROM order_candidates") && sql.includes("source_message_id=?")) return null;
        if (sql.includes("FROM orders") && sql.includes("source_message_id=?")) return null;
        throw new Error(`unexpected get: ${sql}`);
      },
      all(...args) {
        const pattern = String(args[1] || "");
        if (sql.includes("FROM order_candidates") && pattern.includes(CORE)) return [state.candidate];
        if (sql.includes("FROM orders") && pattern.includes(CORE)) return [state.order];
        return [];
      },
    };
  },
};

const context = { db };
vm.runInNewContext(`${source.slice(start, end)}\nthis.messageIdCore=messageIdCore;this.sourceMessageIdsEqual=sourceMessageIdsEqual;this.findEquivalentCandidate=findEquivalentCandidate;this.findEquivalentOrder=findEquivalentOrder;`, context);

assert.equal(context.messageIdCore(decorated), CORE);
assert.equal(context.messageIdCore(CORE), CORE);
assert.equal(context.sourceMessageIdsEqual(decorated, CORE), true);
assert.equal(context.findEquivalentCandidate(GROUP, CORE, ["candidate", "pending"]).id, 641);
assert.equal(context.findEquivalentOrder(GROUP, CORE).id, 90);
console.log("short and decorated WhatsApp message IDs deduplicate safely");
