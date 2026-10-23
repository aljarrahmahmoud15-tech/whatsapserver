const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { isBotGeneratedMessage, isBotReactionSender, isBotFinancialRole } = require("./message_guardrails");

assert.equal(isBotGeneratedMessage({ fromMe: true, body: "تم" }), true);
assert.equal(isBotGeneratedMessage({ fromMe: false, body: "تم" }), false);
assert.equal(isBotGeneratedMessage({ body: "السعر 5 من إربد إلى عمّان" }), false);

const BOT_LOCAL = "0777890596";
const BOT_INTL = "962777890596";
const UNKNOWN_PHONE = "0799999999";
assert.equal(isBotReactionSender(BOT_LOCAL, BOT_LOCAL), true);
assert.equal(isBotReactionSender(BOT_INTL, BOT_LOCAL), true);
assert.equal(isBotReactionSender(BOT_LOCAL, UNKNOWN_PHONE), false);
assert.equal(isBotFinancialRole(BOT_LOCAL, BOT_LOCAL, "producer"), true);
assert.equal(isBotFinancialRole(BOT_LOCAL, BOT_LOCAL, "captain"), true);
assert.equal(isBotFinancialRole(BOT_LOCAL, BOT_LOCAL, "company"), false);

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const messageGuard = server.indexOf("const botGenerated = isBotGeneratedMessage(msg);");
const messageInsert = server.indexOf("INSERT OR IGNORE INTO messages", server.indexOf("async function handleIncomingMessage("));
assert.ok(messageGuard > -1 && messageGuard < messageInsert, "bot message guard must run before message persistence");
assert.match(server, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(server, /const settlementConfirmerPhone = phoneWithCountry\(acceptanceCaptain\.phone\)/);
assert.match(server, /const producerApproved = Boolean\(/);
assert.match(server, /isBotFinancialRole\(normalized, BOT_PHONE, role\)/);

const handlerStart = server.indexOf("async function handleIncomingMessage(");
const handlerEnd = server.indexOf("function reactionId(", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const persistedWrites = [];
const handlerContext = {
  resolveGroupChatId: () => "test-group@g.us",
  isConfiguredGroup: () => true,
  isQuotedOrderRecoveryCommand: () => false,
  isBotGeneratedMessage,
  parseOrder: () => ({ isOrder: false }),
  connectedBotPhone: () => "962777890596",
  phoneWithCountry: (value) => String(value).replace(/^0/, "962"),
  isValidJordanPhone: (value) => /^9627\\d{8}$/.test(String(value)),
  db: { prepare() { persistedWrites.push("db.prepare"); throw new Error("database must not be touched"); } },
};
vm.runInNewContext(`${server.slice(handlerStart, handlerEnd)}\nthis.handleIncomingMessage = handleIncomingMessage;`, handlerContext);

(async () => {
  await handlerContext.handleIncomingMessage({
    fromMe: true,
    from: "test-group@g.us",
    body: "تم",
    hasQuotedMsg: false,
  }, { allowSelf: true });
  assert.deepStrictEqual(persistedWrites, [], "رسالة تشغيلية صادرة من البوت لا تلمس قاعدة البيانات");
  console.log("message guardrails behavioral checks verified");
})().catch((error) => { console.error(error); process.exitCode = 1; });
