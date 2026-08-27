const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { isBotGeneratedMessage } = require("./message_guardrails");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const start = source.indexOf("async function handleIncomingMessage(");
const end = source.indexOf("function reactionId(", start);
assert(start >= 0 && end > start);

const writes = [];
const orderInsert = [];
const db = {
  prepare(sql) {
    return {
      get(...args) {
        if (sql.includes("SELECT COALESCE(MAX(order_no),0)+1")) return { next: 7 };
        throw new Error(`unexpected get: ${sql}`);
      },
      run(...args) {
        if (sql.includes("INSERT OR IGNORE INTO messages")) writes.push({ type: "message", args });
        else if (sql.includes("INSERT INTO orders")) orderInsert.push(args);
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
  assert.equal(orderInsert.length, 1, "طلب البوت المنسق يُنشأ مرة واحدة");
  assert.equal(orderInsert[0][9], 1, "producer_user_id هو حساب الشركة في المرحلة الثانية");
  assert.equal(orderInsert[0][8], "normal");
  assert.equal(orderInsert[0][10], "open");
  assert.equal(orderInsert[0].includes("962775696880"), false, "رقم البوت لا يُخزّن كمنتج مالي");
  console.log("bot order handler company assignment verified");
})().catch((error) => { console.error(error); process.exitCode = 1; });
