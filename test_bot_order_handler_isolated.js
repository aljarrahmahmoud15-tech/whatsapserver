const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const { isBotGeneratedMessage } = require("./message_guardrails");

const source = fs.readFileSync("./server.js", "utf8");
const start = source.indexOf("async function handleIncomingMessage(");
const end = source.indexOf("function reactionId(", start);
assert(start >= 0 && end > start);

const writes = [];
const candidateInsert = [];
const db = {
  prepare(sql) {
    return {
      get(...args) {
        if (sql.includes("SELECT * FROM order_candidates WHERE source_message_id=?")) return null;
        if (sql.includes("SELECT * FROM order_candidates WHERE group_id=?")) return null;
        throw new Error(`unexpected get: ${sql}`);
      },
      run(...args) {
        if (sql.includes("INSERT OR IGNORE INTO messages")) writes.push({ type: "message", args });
        else throw new Error(`unexpected run: ${sql}`);
        return { changes: 1, lastInsertRowid: 19 };
      },
    };
  },
};

const context = {
  resolveGroupChatId: () => "test-group@g.us",
  isConfiguredGroup: () => true,
  isQuotedOrderRecoveryCommand: () => false,
  isBotGeneratedMessage,
  parseOrder: () => ({ isOrder: true, price: 5, origin: "إربد", destination: "عمّان", tripTime: null, orderKind: "normal" }),
  connectedBotPhone: () => "962775696880",
  phoneWithCountry: (value) => String(value).replace(/^0/, "962"),
  isValidJordanPhone: (value) => /^9627\d{8}$/.test(String(value)),
  isBlockedPhone: () => false,
  companyUser: () => ({ id: 1, phone: "system-company", name: "شركة الجراح", role: "company", wallet_cents: 0 }),
  botEmployeeUser: () => ({ id: 2, phone: "962775696880", name: "منتج موظف — بوت شركة الجراح", role: "producer", wallet_cents: 0, is_bot: 1 }),
  BOT_FINANCIAL_MODE: "company",
  cents: (value) => Math.round(Number(value) * 100),
  now: () => "2026-08-27T00:00:00.000Z",
  audit: () => {},
  createOrderCandidate: (args) => { candidateInsert.push(args); return { id: 19, status: "candidate" }; },
  db,
  console,
};

vm.runInNewContext(`${source.slice(start, end)}\nthis.handleIncomingMessage = handleIncomingMessage;`, context);

(async () => {
  await context.handleIncomingMessage({
    fromMe: true,
    from: "test-group@g.us",
    body: "السعر 5 من إربد إلى عمّان",
    type: "text",
    timestamp: 1,
    id: { _serialized: "bot-order-1" },
    hasQuotedMsg: false,
  }, { allowSelf: true });

  assert.equal(writes.length, 1, "يُحفظ سجل الرسالة المنسقة مرة واحدة");
  assert.equal(candidateInsert.length, 1, "رسالة السعر تنشئ مرشحًا خاصًا مرة واحدة");
  assert.equal(candidateInsert[0].producer.id, 1, "producer_user_id هو حساب الشركة في المرشح");
  assert.equal(candidateInsert[0].parsed.orderKind, "normal");
  assert.equal(candidateInsert[0].producer.phone.includes("962775696880"), false, "رقم البوت لا يُخزّن كمنتج مالي");
  console.log("bot order handler private candidate assignment verified");
})().catch((error) => { console.error(error); process.exitCode = 1; });
