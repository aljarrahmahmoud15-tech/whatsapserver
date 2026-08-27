const assert = require("assert");
const { isBotGeneratedMessage, isBotReactionSender } = require("./message_guardrails");

const state = { order: null, pending: false, settlements: 0 };
const owner = "0779110123";
const bot = "0775696880";
const captain = "0790000000";

function receiveMessage({ fromMe, sender, body }) {
  if (isBotGeneratedMessage({ fromMe })) return;
  if (/السعر/.test(body)) {
    state.order = { producer: sender, source: body, status: "open" };
    return;
  }
  if (/^تم$/.test(body) && sender === captain && state.order?.status === "open") state.pending = true;
}

function receiveLike({ sender }) {
  if (isBotReactionSender(sender, bot)) return;
  if (state.pending && sender === state.order?.producer) {
    state.order.status = "accepted";
    state.pending = false;
    state.settlements += 1;
  }
}

receiveMessage({ fromMe: false, sender: owner, body: "السعر 5 من إربد إلى عمّان" });
assert.equal(state.order?.producer, owner);

receiveMessage({ fromMe: true, sender: bot, body: "تم" });
receiveLike({ sender: owner });
assert.equal(state.order.status, "open", "تم ولايك البوت لا يفتحان اعتمادًا");
assert.equal(state.pending, false, "رسالة البوت لا تنشئ pending");
assert.equal(state.settlements, 0, "لا تسوية قبل تم بشري صحيح");

receiveMessage({ fromMe: false, sender: captain, body: "تم" });
assert.equal(state.pending, true, "تم البشري ينقل الطلب إلى انتظار اعتماد المنتج");
receiveLike({ sender: owner });
assert.equal(state.order.status, "accepted");
assert.equal(state.settlements, 1, "لايك المنتج الصحيح ينشئ تسوية واحدة فقط");

console.log("bot-owner sequence isolated verification passed");
