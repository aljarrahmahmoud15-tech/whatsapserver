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
const messageLookupSource = between("function messageIdCore(", "function orderTraceKey(");
const settleSource = between("function settlePendingOrder(", "function settleHistoricalConfirmedOrder(");
const reactionHandlerSource = between("async function handleMessageReaction(", "function parseCookies");

const candidate = {
  id: 10, source_message_id: "request-1", group_id: "test-group@g.us", raw_text: "السعر 2",
  status: "pending", pending_message_id: "captain-done-1", pending_captain_user_id: 3,
  producer_user_id: 2, price_cents: 2000, order_kind: "normal", created_at: "2026-01-01T00:00:00.000Z",
  origin: "إربد", destination: "عمّان", trip_time: null,
};
const acceptance = { id: 21, candidate_id: 10, captain_user_id: 3, acceptance_message_id: "captain-done-1", status: "pending", ...candidate };
const order = { id: 19, order_no: 7, status: "accepted" };
const users = {
  1: { id: 1, phone: "system-company", name: "شركة الجراح", role: "company", wallet_cents: 0 },
  2: { id: 2, phone: "962771111111", name: "المنتج", role: "captain", wallet_cents: 0, active: 1, account_status: "active" },
  3: { id: 3, phone: "962772222222", name: "الكابتن", role: "captain", wallet_cents: 400, active: 1, account_status: "active" },
};
const ledgers = [];
const messages = [];
let settlementRecord = null;

const db = {
  transaction(fn) { return () => fn(); },
  prepare(sql) {
    const normalized = sql.replace(/\s+/g, " ");
    return {
      get(...args) {
        if (normalized.startsWith("SELECT a.*,c.* FROM order_candidate_acceptances")) return args[1] === "captain-done-1" && candidate.status === "pending" ? { ...acceptance } : null;
        if (normalized.startsWith("SELECT * FROM order_candidate_acceptances WHERE candidate_id=? AND acceptance_message_id=?")) return args[0] === candidate.id && args[1] === acceptance.acceptance_message_id && ["pending", "selected"].includes(acceptance.status) ? { ...acceptance } : null;
        if (normalized.startsWith("SELECT * FROM order_candidate_acceptances WHERE id=?")) return acceptance.status === "pending" ? { ...acceptance } : null;
        if (normalized.startsWith("SELECT id,order_no,archive_state FROM orders WHERE source_message_id=?")) return null;
        if (normalized.startsWith("SELECT * FROM order_candidates WHERE group_id=?")) return candidate.group_id === args[0] && candidate.status === "pending" && candidate.pending_message_id === args[1] ? { ...candidate } : null;
        if (normalized.startsWith("SELECT * FROM order_candidates WHERE id=?")) return args[0] === candidate.id ? { ...candidate } : null;
        if (normalized.startsWith("SELECT * FROM users WHERE id=?")) return users[args[0]] ? { ...users[args[0]] } : null;
        if (normalized.startsWith("SELECT id,status FROM order_settlements WHERE order_id=?")) return settlementRecord;
        if (normalized.startsWith("SELECT COALESCE(MAX(order_no),0)+1")) return { next: 7 };
        if (normalized.startsWith("SELECT wallet_cents FROM users WHERE id=?")) return users[args[0]] ? { wallet_cents: users[args[0]].wallet_cents } : null;
        throw new Error(`Unexpected get query: ${normalized}`);
      },
      all() { return []; },
      run(...args) {
        if (normalized.startsWith("INSERT OR IGNORE INTO order_candidate_acceptances")) return { changes: 1 };
        if (normalized.startsWith("UPDATE order_candidates SET pending_captain_user_id")) { candidate.pending_captain_user_id = args[0]; candidate.pending_message_id = args[1]; return { changes: 1 }; }
        if (normalized.startsWith("UPDATE order_candidate_acceptances SET status='selected'")) { acceptance.status = "selected"; return { changes: 1 }; }
        if (normalized.startsWith("UPDATE order_candidate_acceptances SET status='rejected'")) return { changes: 1 };
        if (normalized.startsWith("UPDATE order_candidates SET lifecycle_stage")) return { changes: 1 };
        if (normalized.startsWith("INSERT INTO orders")) return { changes: 1, lastInsertRowid: order.id };
        if (normalized.startsWith("INSERT OR IGNORE INTO order_settlements")) {
          if (settlementRecord) return { changes: 0 };
          settlementRecord = { id: 1, status: "pending" };
          return { changes: 1 };
        }
        if (normalized.startsWith("UPDATE users SET wallet_cents=wallet_cents+?")) {
          const [amount, , userId] = args;
          users[userId].wallet_cents += amount;
          return { changes: 1 };
        }
        if (normalized.startsWith("UPDATE users SET wallet_cents=wallet_cents-?")) {
          const [amount, , userId] = args;
          users[userId].wallet_cents -= amount;
          return { changes: 1 };
        }
        if (normalized.startsWith("INSERT INTO wallet_ledger")) {
          ledgers.push(args);
          return { changes: 1 };
        }
        if (normalized.startsWith("UPDATE order_settlements SET status='applied'")) {
          settlementRecord.status = "applied";
          return { changes: 1 };
        }
        if (normalized.startsWith("INSERT OR IGNORE INTO order_confirmation_deliveries")) return { changes: 1 };
        if (normalized.startsWith("UPDATE order_candidates SET status='finalized'")) {
          candidate.status = "finalized";
          candidate.final_order_id = order.id;
          candidate.pending_message_id = null;
          candidate.pending_captain_user_id = null;
          return { changes: 1 };
        }
        throw new Error(`Unexpected run query: ${normalized}`);
      },
    };
  },
};

const context = {
  db,
  client: { async getMessageById(messageId) { return { from: "test-group@g.us", body: messageId === "captain-done-1" ? "تم" : "رسالة مختلفة", hasQuotedMsg: true, async getQuotedMessage() { return { id: { _serialized: "request-1" }, from: "test-group@g.us", body: "السعر 20" }; } }; } },
  isReady: true,
  withTimeout: async (value) => value,
  resolveReactionSenderPhone: async (reaction) => reaction.senderPhone,
  isConfiguredGroup: (groupId) => groupId === "test-group@g.us",
  isBlockedPhone: () => false,
  phoneWithCountry: (value) => String(value),
  isBotReactionSender,
  serializedMessageId: (message) => message?.id?._serialized || message?.id || null,
  parseOrder: (body) => ({ isOrder: /^السعر\s*\d+/i.test(String(body || "")) }),
  isCaptainAcceptance: (body) => String(body || "").trim() === "تم",
  findPendingAcceptanceByMessage: (groupId, messageId) => groupId === candidate.group_id && messageId === acceptance.acceptance_message_id && candidate.status === "pending" && ["pending", "selected"].includes(acceptance.status) ? { ...acceptance } : null,
  getQuotedMessageWithFallback: async (message) => typeof message?.getQuotedMessage === "function" ? message.getQuotedMessage() : null,
  updateOrderCandidateLifecycle: () => ({ changes: 1 }),
  notifyOrderLifecycleBlocker: () => {},
  logOrderTrace: () => {},
  connectedBotPhone: () => "0775696880",
  findActiveRegisteredUser: (phone) => Object.values(users).find((user) => user.phone === phone && user.active === 1 && user.account_status === "active") || null,
  getSetting: (_key, fallback) => fallback,
  PRODUCER_RATE_BPS: 1200,
  SPECIAL_ORDER_RATE_BPS: 1200,
  COMPANY_FROM_PRODUCER_RATE_BPS: 300,
  BOT_FINANCIAL_MODE: "company",
  CAPTAIN_MIN_BALANCE_CENTS: -300,
  calculateSettlement,
  companyUser: () => ({ ...users[1] }),
  now: () => "2026-01-01T00:00:00.000Z",
  audit: () => {},
  maskSettlementPhone: (value) => String(value || "").replace(/^(\d{4})\d+(\d{4})$/, "$1***$2"),
  logSettlementCompleted: () => {},
  money: (cents) => (Number(cents) / 100).toFixed(2),
  isBotPhone: () => false,
  sendFinalBookingConfirmation: async (groupId, details) => { messages.push({ groupId, text: `✅ تم تثبيت الطلب #${details.orderNo}` }); },
  finalBookingCancellationText: () => "❌ تم رفض أو إلغاء الطلب",
  sendBotText: async () => true,
  console,
};

vm.runInNewContext(`${messageLookupSource}\n${reactionIdSource}\n${settleSource}\n${reactionHandlerSource}\nthis.handleMessageReaction = handleMessageReaction;`, context);

assert.strictEqual(candidate.status, "pending");
assert.strictEqual(ledgers.length, 0, "لا توجد تسوية قبل أي لايك");

(async () => {
  await context.handleMessageReaction({ reaction: "👍", msgId: "captain-done-1", senderPhone: "0775696880" });
  assert.strictEqual(candidate.status, "finalized", "أي كابتن يضع 👍 على رد تم يثبت المرشح");
  assert.strictEqual(ledgers.length, 3, "تسجل الحركات الثلاث عند أول 👍");
  assert.strictEqual(messages.length, 1, "ترسل رسالة تأكيد واحدة عند أول 👍");

  await context.handleMessageReaction({ reaction: "👍", msgId: "other-message", senderPhone: users[2].phone });
  assert.strictEqual(candidate.status, "finalized", "لايك على رسالة مختلفة لا يغير الطلب المثبت");
  assert.strictEqual(ledgers.length, 3, "لا تتكرر التسوية عند لايك على رسالة مختلفة");

  await context.handleMessageReaction({ reaction: "👍", msgId: "captain-done-1", senderPhone: "962779999999" });
  assert.strictEqual(candidate.status, "finalized", "هوية صاحب التفاعل لا تمنع الطلب بعد اكتمال الشروط");
  assert.strictEqual(ledgers.length, 3, "لا تتكرر التسوية بسبب اختلاف صاحب التفاعل");

  await context.handleMessageReaction({ reaction: "👍", msgId: "captain-done-1", senderPhone: users[2].phone });
  assert.strictEqual(candidate.status, "finalized", "التفاعل المكرر يبقى idempotent");
  assert.strictEqual(ledgers.length, 3, "تسجل الحركات الثلاث فقط بعد التثبيت");
  assert.strictEqual(users[3].wallet_cents, 100, "يُخصم 15% من محفظة الكابتن المنفذ");
  assert.strictEqual(users[2].wallet_cents, 240, "تضاف 12% لمحفظة كابتن تنزيل الطلب");
  assert.strictEqual(users[1].wallet_cents, 60, "تضاف 3% لمحفظة الشركة");
  assert.strictEqual(messages.length, 1, "ترسل رسالة تأكيد واحدة بعد التثبيت");
  assert.equal(messages[0].text, "✅ تم تثبيت الطلب #7");
  console.log("isolated hidden-candidate confirmation flow verified");
})().catch((error) => { console.error(error); process.exitCode = 1; });
