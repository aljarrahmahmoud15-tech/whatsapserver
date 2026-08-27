const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { calculateSettlement } = require("./finance");
const { isBotReactionSender } = require("./message_guardrails");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing source block: ${start}`);
  return source.slice(from, to);
}

const reactionIdSource = between("function reactionId(", "async function resolveReactionSenderPhone");
const settleSource = between("function settlePendingOrder(", "async function handleMessageReaction");
const reactionHandlerSource = between("async function handleMessageReaction(", "function parseCookies");

const order = {
  id: 1, order_no: 1, group_id: "test-group@g.us", source_message_id: "request-1",
  status: "open", pending_message_id: "captain-done-1", pending_captain_user_id: 3,
  producer_user_id: 2, captain_user_id: null, price_cents: 2000, order_kind: "normal",
  company_cents: 0, producer_cents: 0, captain_cents: 0,
};
const users = {
  1: { id: 1, phone: "system-company", name: "شركة الجراح", role: "company", wallet_cents: 0 },
  2: { id: 2, phone: "962771111111", name: "المنتج", role: "producer", wallet_cents: 0 },
  3: { id: 3, phone: "962772222222", name: "الكابتن", role: "captain", wallet_cents: 1000 },
};
const ledgers = [];
const messages = [];

const db = {
  transaction(fn) { return () => fn(); },
  prepare(sql) {
    const normalized = sql.replace(/\s+/g, " ");
    return {
      get(...args) {
        if (normalized.startsWith("SELECT * FROM orders WHERE id=?")) return args[0] === order.id ? { ...order } : null;
        if (normalized.startsWith("SELECT * FROM users WHERE id=?")) return users[args[0]] ? { ...users[args[0]] } : null;
        if (normalized.startsWith("SELECT * FROM orders WHERE group_id=?")) {
          return order.group_id === args[0] && order.status === "open" && order.pending_message_id === args[1] ? { ...order } : null;
        }
        throw new Error(`Unexpected get query: ${normalized}`);
      },
      run(...args) {
        if (normalized.startsWith("UPDATE orders SET status='accepted'")) {
          const [captainId, acceptedMessageId, acceptedAt, companyCents, producerCents, captainCents, updatedAt, orderId, expectedMessageId] = args;
          if (order.id !== orderId || order.status !== "open" || order.pending_message_id !== expectedMessageId) return { changes: 0 };
          Object.assign(order, { status: "accepted", captain_user_id: captainId, accepted_message_id: acceptedMessageId, accepted_at: acceptedAt, company_cents: companyCents, producer_cents: producerCents, captain_cents: captainCents, pending_message_id: null, pending_captain_user_id: null, updated_at: updatedAt });
          return { changes: 1 };
        }
        if (normalized.startsWith("UPDATE users SET wallet_cents=?")) {
          const [balance, , userId] = args;
          users[userId].wallet_cents = balance;
          return { changes: 1 };
        }
        if (normalized.startsWith("INSERT INTO wallet_ledger")) {
          ledgers.push(args);
          return { changes: 1 };
        }
        throw new Error(`Unexpected run query: ${normalized}`);
      },
    };
  },
};

const context = {
  db,
  client: {
    async getMessageById() { return { from: "test-group@g.us" }; },
    async sendMessage(groupId, text) { messages.push({ groupId, text }); },
  },
  isReady: true,
  withTimeout: async (value) => value,
  resolveReactionSenderPhone: async (reaction) => reaction.senderPhone,
  isConfiguredGroup: (groupId) => groupId === "test-group@g.us",
  isBlockedPhone: () => false,
  phoneWithCountry: (value) => String(value),
  isBotReactionSender,
  connectedBotPhone: () => "0775696880",
  getSetting: (_key, fallback) => fallback,
  PRODUCER_RATE_BPS: 1500,
  SPECIAL_ORDER_RATE_BPS: 2000,
  COMPANY_FROM_PRODUCER_RATE_BPS: 1500,
  CAPTAIN_MIN_BALANCE_CENTS: 0,
  calculateSettlement,
  companyUser: () => ({ ...users[1] }),
  now: () => "2026-01-01T00:00:00.000Z",
  audit: () => {},
  money: (cents) => (Number(cents) / 100).toFixed(2),
  formatAcceptance: () => "confirmed",
  brandedMessage: () => "rejected",
  console,
};

vm.runInNewContext(`${reactionIdSource}\n${settleSource}\n${reactionHandlerSource}\nthis.handleMessageReaction = handleMessageReaction;`, context);

assert.strictEqual(order.status, "open");
assert.strictEqual(ledgers.length, 0, "لا توجد تسوية قبل أي لايك");

(async () => {
  await context.handleMessageReaction({ reaction: "👍", msgId: "captain-done-1", senderPhone: "0775696880" });
  assert.strictEqual(order.status, "open", "لايك البوت نفسه لا يوثق الطلب");
  assert.strictEqual(ledgers.length, 0, "لا توجد حركة مالية للايك الصادر من البوت");

  await context.handleMessageReaction({ reaction: "👍", msgId: "other-message", senderPhone: users[2].phone });
  assert.strictEqual(order.status, "open", "لايك على رسالة مختلفة لا يوثق الطلب");
  assert.strictEqual(ledgers.length, 0, "لا توجد حركة مالية للايك على رسالة مختلفة");

  await context.handleMessageReaction({ reaction: "👍", msgId: "captain-done-1", senderPhone: "962779999999" });
  assert.strictEqual(order.status, "open", "لايك من غير المنتج لا يوثق الطلب");
  assert.strictEqual(ledgers.length, 0, "لا توجد حركة مالية للايك من غير المنتج");

  await context.handleMessageReaction({ reaction: "👍", msgId: "captain-done-1", senderPhone: users[2].phone });
  assert.strictEqual(order.status, "accepted", "لايك المنتج على رسالة تم يوثق الطلب");
  assert.strictEqual(ledgers.length, 3, "تسجل الحركات الثلاث فقط بعد اعتماد المنتج");
  assert.strictEqual(users[3].wallet_cents, 700, "يخصم 15% من رصيد الكابتن للطلب العادي");
  assert.strictEqual(users[2].wallet_cents, 255, "يضاف صافي حصة المنتج بعد عمولة الشركة");
  assert.strictEqual(users[1].wallet_cents, 45, "تأخذ الشركة 15% من حصة المنتج فقط");
  assert.strictEqual(messages.length, 1, "ترسل رسالة تأكيد واحدة بعد التوثيق");
  console.log("isolated confirmation flow verified");
})().catch((error) => { console.error(error); process.exitCode = 1; });
