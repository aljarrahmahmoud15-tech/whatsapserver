const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { calculateSettlement } = require("./finance");
const { isBotGeneratedMessage } = require("./message_guardrails");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const helperStart = source.indexOf("function createOrderRecord(");
const helperEnd = source.indexOf("function brandedMessage(", helperStart);
const incomingStart = source.indexOf("async function handleIncomingMessage(");
const incomingEnd = source.indexOf("function reactionId(", incomingStart);
const reactionStart = source.indexOf("async function handleMessageReaction(");
const reactionEnd = source.indexOf("async function reconcileStoredThumbReaction(", reactionStart);
const settleStart = source.indexOf("function settlePendingOrder(");
const settleEnd = source.indexOf("function settleHistoricalConfirmedOrder(", settleStart);
const cancelStart = source.indexOf("function cancelPendingOrderForProducerReaction(");
const cancelEnd = source.indexOf("async function hasVisibleThumbReaction(", cancelStart);
assert(helperStart >= 0 && helperEnd > helperStart);
assert(incomingStart >= 0 && incomingEnd > incomingStart);
assert(reactionStart >= 0 && reactionEnd > reactionStart);
assert(settleStart >= 0 && settleEnd > settleStart);
assert(cancelStart >= 0 && cancelEnd > cancelStart);

const GROUP = "test-group@g.us";
const PRODUCER = "962771111111";
const EXECUTOR = "962772222222";
const BOT = "962779110123";
const users = {
  producer: { id: 2, phone: PRODUCER, name: "المنتج", role: "captain", wallet_cents: 0, active: 1, account_status: "active", is_bot: 0 },
  executor: { id: 3, phone: EXECUTOR, name: "المنفذ", role: "captain", wallet_cents: 5000, active: 1, account_status: "active", is_bot: 0 },
  company: { id: 1, phone: "system-company", name: "وصلني الآن", role: "company", wallet_cents: 0, active: 1, account_status: "active", is_bot: 0 },
};

const state = {
  candidate: null,
  acceptance: null,
  order: null,
  settlement: null,
  archivedOrder: null,
  ledgers: [],
  messages: new Set(),
  confirmations: [],
  cancellations: [],
  reactionSender: PRODUCER,
  lifecycle: [],
};

function reset({ archived = false, executorBalance = 5000 } = {}) {
  state.candidate = null;
  state.acceptance = null;
  state.order = null;
  state.settlement = null;
  state.archivedOrder = archived ? { id: 77, order_no: 77, source_message_id: "price-archived", archive_state: "archived" } : null;
  state.ledgers = [];
  state.messages = new Set();
  state.confirmations = [];
  state.cancellations = [];
  state.reactionSender = PRODUCER;
  state.lifecycle = [];
  users.producer.wallet_cents = 0;
  users.executor.wallet_cents = executorBalance;
  users.company.wallet_cents = 0;
}

function normalize(sql) { return sql.replace(/\s+/g, " ").trim(); }
function userById(id) { return Object.values(users).find((user) => user.id === Number(id)) || null; }

const db = {
  transaction(fn) { return () => fn(); },
  prepare(sql) {
    const query = normalize(sql);
    return {
      get(...args) {
        if (query.startsWith("SELECT * FROM order_candidates WHERE source_message_id=?")) return state.candidate && state.candidate.source_message_id === args[0] ? { ...state.candidate } : null;
        if (query.startsWith("SELECT * FROM orders WHERE source_message_id=?")) return state.archivedOrder && state.archivedOrder.source_message_id === args[0] ? { ...state.archivedOrder } : (state.order && state.order.source_message_id === args[0] ? { ...state.order } : null);
        if (query.startsWith("SELECT * FROM order_candidates WHERE group_id=? AND producer_user_id=?")) return null;
        if (query.startsWith("SELECT * FROM order_candidates WHERE id=?")) return state.candidate && state.candidate.id === Number(args[0]) ? { ...state.candidate } : null;
        if (query.startsWith("SELECT * FROM order_candidates WHERE group_id=? AND source_message_id=?")) return state.candidate && state.candidate.group_id === args[0] && state.candidate.source_message_id === args[1] && ["candidate", "pending"].includes(state.candidate.status) ? { ...state.candidate } : null;
        if (query.startsWith("SELECT * FROM order_candidates WHERE group_id=? AND status='pending' AND pending_message_id=?")) return state.candidate && state.candidate.group_id === args[0] && state.candidate.status === "pending" && state.candidate.pending_message_id === args[1] ? { ...state.candidate } : null;
        if (query.startsWith("SELECT a.*,c.* FROM order_candidate_acceptances")) {
          return state.acceptance && state.candidate?.status === "pending" && state.acceptance.acceptance_message_id === args[1] && ["pending", "selected"].includes(state.acceptance.status)
            ? { ...state.acceptance, ...state.candidate }
            : null;
        }
        if (query.startsWith("SELECT * FROM order_candidate_acceptances WHERE candidate_id=? AND acceptance_message_id=?")) {
          return state.acceptance && state.acceptance.candidate_id === Number(args[0]) && state.acceptance.acceptance_message_id === args[1] && ["pending", "selected"].includes(state.acceptance.status) ? { ...state.acceptance } : null;
        }
        if (query.startsWith("SELECT * FROM order_candidate_acceptances WHERE id=?")) return state.acceptance && state.acceptance.id === Number(args[0]) && ["pending", "selected"].includes(state.acceptance.status) ? { ...state.acceptance } : null;
        if (query.startsWith("SELECT id,order_no,archive_state FROM orders WHERE source_message_id=?")) return state.archivedOrder && state.archivedOrder.source_message_id === args[0] ? { ...state.archivedOrder } : null;
        if (query.startsWith("SELECT * FROM users WHERE id=?")) return userById(args[0]) ? { ...userById(args[0]) } : null;
        if (query.startsWith("SELECT COALESCE(MAX(order_no),0)+1")) return { next: state.order ? state.order.order_no + 1 : 1 };
        if (query.startsWith("SELECT wallet_cents FROM users WHERE id=?")) return userById(args[0]) ? { wallet_cents: userById(args[0]).wallet_cents } : null;
        if (query.startsWith("SELECT id,status FROM order_settlements WHERE order_id=?")) return state.settlement ? { id: 1, status: state.settlement.status } : null;
        if (query.startsWith("SELECT id FROM notifications WHERE event=?")) return null;
        if (query.startsWith("SELECT id,price_cents,group_id,source_message_id FROM order_candidates WHERE id=?")) return state.candidate ? { id: state.candidate.id, price_cents: state.candidate.price_cents, group_id: state.candidate.group_id, source_message_id: state.candidate.source_message_id } : null;
        if (query.startsWith("SELECT * FROM orders WHERE group_id=?")) return state.order && state.order.accepted_message_id === args[1] ? { ...state.order } : null;
        throw new Error(`Unexpected get query: ${query}`);
      },
      run(...args) {
        if (query.startsWith("INSERT OR IGNORE INTO messages")) {
          const id = String(args[0]);
          if (state.messages.has(id)) return { changes: 0 };
          state.messages.add(id);
          return { changes: 1 };
        }
        if (query.startsWith("INSERT INTO order_candidates")) {
          state.candidate = { id: 1, source_message_id: args[0], group_id: args[1], raw_text: args[2], price_cents: args[3], origin: args[4], destination: args[5], trip_time: args[6], order_kind: args[7], producer_user_id: args[8], status: "candidate", pending_captain_user_id: null, pending_message_id: null, lifecycle_stage: "candidate_created", lifecycle_blocker: null };
          return { changes: 1, lastInsertRowid: 1 };
        }
        if (query.startsWith("UPDATE order_candidates SET lifecycle_stage='candidate_created'")) { state.candidate.lifecycle_stage = "candidate_created"; return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidates SET lifecycle_stage=?")) { state.candidate.lifecycle_stage = args[0]; state.candidate.lifecycle_blocker = args[1]; state.lifecycle.push({ stage: args[0], blocker: args[1] }); return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidates SET lifecycle_stage='acceptance_pending'")) { state.candidate.lifecycle_stage = "acceptance_pending"; state.candidate.lifecycle_blocker = "awaiting_authorized_thumb"; return { changes: 1 }; }
        if (query.startsWith("INSERT OR IGNORE INTO order_candidate_acceptances")) {
          if (state.acceptance) return { changes: 0 };
          state.acceptance = { id: 10, candidate_id: args[0], captain_user_id: args[1], acceptance_message_id: args[2], status: "pending" };
          return { changes: 1 };
        }
        if (query.startsWith("UPDATE order_candidates SET status='pending'")) { state.candidate.status = "pending"; state.candidate.pending_captain_user_id = args[0]; state.candidate.pending_message_id = args[1]; state.candidate.lifecycle_stage = "acceptance_pending"; state.candidate.lifecycle_blocker = "awaiting_authorized_thumb"; return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidates SET lifecycle_stage='debt_limit'")) { state.candidate.lifecycle_stage = "debt_limit"; state.candidate.lifecycle_blocker = "debt_limit"; return { changes: 1 }; }
        if (query.startsWith("INSERT INTO orders")) { state.order = { id: 20, order_no: 1, source_message_id: state.candidate.source_message_id, price_cents: state.candidate.price_cents, status: "accepted", settlement_state: "settled" }; return { changes: 1, lastInsertRowid: 20 }; }
        if (query.startsWith("INSERT OR IGNORE INTO order_settlements")) { if (state.settlement) return { changes: 0 }; state.settlement = { status: "pending" }; return { changes: 1 }; }
        if (query.startsWith("UPDATE users SET wallet_cents=wallet_cents+?")) { userById(args[2]).wallet_cents += Number(args[0]); return { changes: 1 }; }
        if (query.startsWith("UPDATE users SET wallet_cents=wallet_cents-?")) { userById(args[2]).wallet_cents -= Number(args[0]); return { changes: 1 }; }
        if (query.startsWith("INSERT INTO wallet_ledger")) { state.ledgers.push(args); return { changes: 1 }; }
        if (query.startsWith("UPDATE order_settlements SET status='applied'")) { state.settlement.status = "applied"; return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidates SET pending_captain_user_id")) { state.candidate.pending_captain_user_id = args[0]; state.candidate.pending_message_id = args[1]; return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidate_acceptances SET status='selected'")) { state.acceptance.status = "selected"; return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidate_acceptances SET status='cancelled'")) { state.acceptance.status = "cancelled"; return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidate_acceptances SET status='rejected'")) return { changes: 1 };
        if (query.startsWith("INSERT OR IGNORE INTO order_confirmation_deliveries")) return { changes: 1 };
        if (query.startsWith("UPDATE order_candidates SET status='finalized'")) { state.candidate.status = "finalized"; state.candidate.lifecycle_stage = "settled"; state.candidate.lifecycle_blocker = null; state.candidate.pending_message_id = null; return { changes: 1 }; }
        if (query.startsWith("UPDATE order_candidates SET status='cancelled'")) { state.candidate.status = "cancelled"; state.candidate.lifecycle_stage = "cancelled"; state.candidate.lifecycle_blocker = "producer_cancelled"; state.candidate.pending_message_id = null; return { changes: 1 }; }
        throw new Error(`Unexpected run query: ${query}`);
      },
    };
  },
};

function message(id, body, sender, quoted = null) {
  return {
    from: GROUP,
    fromMe: false,
    body,
    type: "text",
    timestamp: 1,
    id: { _serialized: id },
    author: `${sender}@c.us`,
    hasQuotedMsg: Boolean(quoted),
    getContact: async () => ({ number: sender, pushname: sender === PRODUCER ? "المنتج" : "المنفذ" }),
    getQuotedMessage: quoted ? async () => quoted : undefined,
  };
}

const context = {
  db,
  client: { async getMessageById(id) { return state.targets?.[id] || message(id, id.startsWith("done") ? "تم" : "رسالة أخرى", EXECUTOR, message("price-1", "السعر 20", PRODUCER)); } },
  isReady: true,
  withTimeout: async (value) => value,
  resolveReactionSenderPhone: async () => state.reactionSender,
  reactionSenderValues: () => [],
  resolveMessageSenderPhone: async (msg) => msg?.fromMe ? BOT : (msg?.__senderPhone || msg?.author?.split("@")[0] || (msg?.getContact ? (await msg.getContact()).number : "")),
  resolveGroupChatId: (msg) => msg?.from || GROUP,
  isConfiguredGroup: (groupId) => groupId === GROUP,
  isQuotedOrderRecoveryCommand: () => false,
  isBotGeneratedMessage,
  isCaptainAcceptance: (body) => /^تم(?:$|[\s،,:؛.!؟؟\-–—])/u.test(String(body || "").trim()),
  parseOrder: (body) => ({ isOrder: /^السعر\s*\d+/u.test(String(body || "")), price: 20, priceMin: 20, priceMax: 20, origin: null, destination: null, tripTime: null, orderKind: "normal" }),
  connectedBotPhone: () => BOT,
  phoneWithCountry: (value) => String(value || "").replace(/[^0-9]/g, "").replace(/^0/, "962"),
  isValidJordanPhone: (value) => /^9627\d{8}$/.test(String(value)),
  isBlockedPhone: () => false,
  companyUser: () => ({ ...users.company }),
  botEmployeeUser: () => ({ ...users.company, is_bot: 1, role: "producer", phone: BOT }),
  ensureProducerUser: () => ({ ...users.producer }),
  ensureCaptainUser: (phone, name) => phone === EXECUTOR ? { ...users.executor, name: name || users.executor.name } : null,
  findActiveRegisteredUser: (phone) => Object.values(users).find((user) => user.phone === phone && user.active === 1 && user.account_status === "active") || null,
  isBotPhone: () => false,
  isBotGeneratedMessage,
  cents: (value) => Math.round(Number(value) * 100),
  now: () => "2026-01-01T00:00:00.000Z",
  audit: () => {},
  logOrderTrace: () => {},
  logSettlementCompleted: () => {},
  orderTraceKey: (value) => `trace:${String(value)}`,
  maskSettlementPhone: (value) => String(value || ""),
  money: (value) => (Number(value || 0) / 100).toFixed(2),
  calculateSettlement,
  PRODUCER_RATE_BPS: 1200,
  SPECIAL_ORDER_RATE_BPS: 1200,
  SPECIAL_ORDER_PRODUCER_RATE_BPS: 1200,
  COMPANY_FROM_PRODUCER_RATE_BPS: 300,
  SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS: 300,
  BOT_FINANCIAL_MODE: "company",
  CAPTAIN_MIN_BALANCE_CENTS: -200,
  serializedMessageId: (msg) => msg?.id?._serialized || msg?.id || null,
  reactionId: (value) => typeof value === "string" ? value : value?._serialized || value?.id || null,
  serializedWhatsappUserId: (value) => typeof value === "string" ? value : value?._serialized || value?.id || "",
  persistWhatsappIdentity: () => null,
  displayPhone: (phone) => String(phone || "غير معروف"),
  getQuotedMessageWithFallback: async (msg) => msg?.hasQuotedMsg && typeof msg.getQuotedMessage === "function" ? msg.getQuotedMessage() : (msg?.__quoted || msg?.quotedMsg || null),
  updateOrderCandidateLifecycle: () => ({ changes: 1 }),
  notifyOrderLifecycleBlocker: () => {},
  notifyOperations: () => Promise.resolve([]),
  sendFinalBookingConfirmation: async (_groupId, details) => { state.confirmations.push(details); return { id: { _serialized: `confirmation-${details.orderNo}` } }; },
  sendFinalBookingCancellation: async () => { state.cancellations.push(true); return { id: { _serialized: "cancellation-1" } }; },
  findPendingAcceptanceByMessage: null,
};

vm.runInNewContext(`${source.slice(helperStart, helperEnd)}\n${source.slice(incomingStart, incomingEnd)}\n${source.slice(reactionStart, reactionEnd)}\n${source.slice(settleStart, settleEnd)}\n${source.slice(cancelStart, cancelEnd)}\nthis.handleIncomingMessage=handleIncomingMessage;this.handleMessageReaction=handleMessageReaction;this.cancelPendingOrderForProducerReaction=cancelPendingOrderForProducerReaction;`, context);

async function ingestPrice(sourceId = "price-1") {
  const price = message(sourceId, "السعر 20", PRODUCER);
  await context.handleIncomingMessage(price);
  assert.ok(state.candidate, "السعر ينشئ مرشحًا خاصًا");
}
async function ingestAcceptance(doneId = "done-1") {
  const quoted = message("price-1", "السعر 20", PRODUCER);
  await context.handleIncomingMessage(message(doneId, "تم جاهز الآن", EXECUTOR, quoted));
  assert.equal(state.acceptance?.acceptance_message_id, doneId, "تم المقتبسة تسجل قبولًا واحدًا");
}
async function approve(doneId = "done-1") {
  state.targets = { [doneId]: message(doneId, "تم جاهز الآن", EXECUTOR, message("price-1", "السعر 20", PRODUCER)) };
  state.reactionSender = PRODUCER;
  await context.handleMessageReaction({ reaction: "👍", msgId: doneId });
}

(async () => {
  reset();
  await ingestPrice();
  await ingestAcceptance();
  await approve();
  assert.equal(state.candidate.status, "finalized");
  assert.equal(state.ledgers.length, 3, "التسوية الذرية تسجل 3 حركات فقط");
  assert.equal(users.producer.wallet_cents, 240, "يُضاف 12% للمنتج");
  assert.equal(users.company.wallet_cents, 60, "يُضاف 3% للشركة");
  assert.equal(users.executor.wallet_cents, 4700, "يُخصم 15% من المنفذ");
  await approve();
  assert.equal(state.ledgers.length, 3, "التفاعل المكرر لا يكرر التسوية");
  assert.equal(state.confirmations.length, 1, "بطاقة واحدة فقط");

  reset();
  await ingestPrice();
  await approve("done-race");
  assert.equal(state.candidate.status, "finalized", "التفاعل قبل وصول حدث تم يعيد بناء القبول من الاقتباس");
  assert.equal(state.ledgers.length, 3);

  reset();
  await ingestPrice();
  await ingestAcceptance("done-replay");
  await context.handleIncomingMessage(message("done-replay", "تم", EXECUTOR, message("price-1", "السعر 20", PRODUCER)));
  await approve("done-replay");
  assert.equal(state.ledgers.length, 3, "إعادة تشغيل تم لا تنشئ قبولًا أو تسوية ثانية");

  reset();
  await ingestPrice();
  await ingestAcceptance("done-lid");
  state.targets = { "done-lid": message("done-lid", "تم", EXECUTOR, message("price-1", "السعر 20", PRODUCER)) };
  state.reactionSender = "";
  await context.handleMessageReaction({ reaction: "👍", msgId: "done-lid" });
  assert.equal(state.candidate.status, "pending", "هوية LID غير المحلولة تبقي الطلب معلقًا");
  assert.equal(state.ledgers.length, 0);
  assert.equal(state.candidate.lifecycle_stage, "identity_unresolved");

  reset({ executorBalance: -199 });
  await ingestPrice();
  await ingestAcceptance("done-debt");
  await approve("done-debt");
  assert.equal(state.candidate.status, "pending", "حد الدين يمنع التسوية");
  assert.equal(state.ledgers.length, 0);
  assert.equal(state.candidate.lifecycle_stage, "debt_limit");

  reset({ archived: true });
  await context.handleIncomingMessage(message("price-archived", "السعر 20", PRODUCER));
  assert.equal(state.candidate, null, "الطلب المؤرشف لا يعود إلى المرشحات");

  reset();
  await ingestPrice();
  const botAcceptance = message("done-bot", "تم", BOT, message("price-1", "السعر 20", PRODUCER));
  botAcceptance.fromMe = true;
  state.targets = { "done-bot": botAcceptance };
  state.reactionSender = PRODUCER;
  await context.handleMessageReaction({ reaction: "👍", msgId: "done-bot" });
  assert.equal(state.candidate.status, "candidate", "رد تم الصادر عن البوت لا ينشئ قبولًا");
  assert.equal(state.ledgers.length, 0);

  reset();
  await ingestPrice();
  await ingestAcceptance("done-cancel");
  state.targets = { "done-cancel": message("done-cancel", "تم جاهز الآن", EXECUTOR, message("price-1", "السعر 20", PRODUCER)) };
  state.reactionSender = PRODUCER;
  await context.handleMessageReaction({ reaction: "❌", msgId: "done-cancel" });
  assert.equal(state.candidate.status, "cancelled", "X من صاحب السعر يلغي الطلب المعلق");
  assert.equal(state.ledgers.length, 0, "الإلغاء قبل التسوية لا ينشئ حركات مالية");
  assert.equal(state.cancellations.length, 1, "الإلغاء يرسل بطاقة واحدة");

  console.log("unified order lifecycle race, identity, debt, idempotency, and archive guards verified");
})().catch((error) => { console.error(error); process.exitCode = 1; });
