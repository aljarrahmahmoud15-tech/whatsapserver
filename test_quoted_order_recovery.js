const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const parseStart = source.indexOf("function parseOrder(");
const parseEnd = source.indexOf("function latestEligibleGroupOrderMessage(", parseStart);
const recoveryStart = source.indexOf("function isQuotedOrderRecoveryCommand(");
const recoveryEnd = source.indexOf("async function handleIncomingMessage(", recoveryStart);
assert(parseStart >= 0 && parseEnd > parseStart, "محلل الطلب موجود داخل الخادم");
assert(recoveryStart >= 0 && recoveryEnd > recoveryStart, "حارس استرداد الرد موجود داخل الخادم");

const context = {
  resolveGroupChatId: (message) => String((message && message.from) || ""),
};
vm.runInNewContext(`${source.slice(parseStart, parseEnd)}\n${source.slice(recoveryStart, recoveryEnd)}\nthis.isQuotedOrderRecoveryCommand = isQuotedOrderRecoveryCommand;`, context);

const groupId = "120363430275024633@g.us";
const validQuote = { from: groupId, fromMe: false, body: "السعر 5\nراكب بنت\nمن إربد إلى عمّان", id: { _serialized: "order-message" } };

assert.strictEqual(context.isQuotedOrderRecoveryCommand({ body: "#تسجيل الطلب", fromMe: true, groupId, quoted: validQuote }), true, "يسجل البوت الطلب المؤهل الذي يقتبسه فقط");
assert.strictEqual(context.isQuotedOrderRecoveryCommand({ body: "#تسجيل الطلب", fromMe: false, groupId, quoted: validQuote }), false, "لا يستطيع رقم آخر تشغيل الاسترداد");
assert.strictEqual(context.isQuotedOrderRecoveryCommand({ body: "#تسجيل الطلب", fromMe: true, groupId, quoted: { ...validQuote, body: "تم" } }), false, "لا يسترد رد تم كطلب");
assert.strictEqual(context.isQuotedOrderRecoveryCommand({ body: "تم", fromMe: true, groupId, quoted: validQuote }), false, "لا يتحول رد تم إلى أمر استرداد");

console.log("quoted order recovery guardrails verified");
