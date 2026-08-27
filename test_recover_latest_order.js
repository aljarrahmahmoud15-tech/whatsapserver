const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const parseStart = source.indexOf("function parseOrder(");
const parseEnd = source.indexOf("function isCaptainAcceptance(", parseStart);
const recoverStart = source.indexOf("function latestEligibleGroupOrderMessage(");
const recoverEnd = source.indexOf("function isCaptainAcceptance(", recoverStart);
assert(parseStart >= 0 && parseEnd > parseStart, "محلل الطلب موجود داخل الخادم");
assert(recoverStart >= 0 && recoverEnd > recoverStart, "منتقي استرداد الطلب موجود داخل الخادم");

const context = {};
vm.runInNewContext(`${source.slice(parseStart, parseEnd)}\n${source.slice(recoverStart, recoverEnd)}\nthis.latestEligibleGroupOrderMessage = latestEligibleGroupOrderMessage;`, context);

const groupId = "120363430275024633@g.us";
const messages = [
  { from: groupId, fromMe: false, body: "تم", timestamp: 300 },
  { from: groupId, fromMe: false, body: "هل سعر 5 مناسب من إربد إلى عمّان؟", timestamp: 250 },
  { from: groupId, fromMe: false, body: "السعر 5\nراكب بنت\nمن إربد إلى عمّان", timestamp: 200, id: { _serialized: "order-message" } },
  { from: "other-group@g.us", fromMe: false, body: "السعر 7\nحمولة\nمن إربد إلى عمّان", timestamp: 400 },
  { from: groupId, fromMe: true, body: "السعر 9\nراكب\nمن إربد إلى عمّان", timestamp: 500 },
];

const selected = context.latestEligibleGroupOrderMessage(messages, groupId);
assert(selected, "يُعثر على طلب مؤهل");
assert.strictEqual(selected.id._serialized, "order-message", "يختار الطلب المؤهل داخل القروب فقط ويتجاهل تم والاستفسار والرسائل الذاتية");
assert.strictEqual(context.latestEligibleGroupOrderMessage([{ from: groupId, fromMe: false, body: "تم", timestamp: 1 }], groupId), null, "لا يُسترد رد تم كطلب");

console.log("latest order recovery selection verified");
