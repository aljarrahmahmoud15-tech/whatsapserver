"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { isBotGeneratedMessage } = require("./message_guardrails");

const source = fs.readFileSync("server.js", "utf8");
const slice = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};
const textBuilder = slice("function finalBookingConfirmationText(", "function finalBookingConfirmationOrderNo(");
const orderNumberParser = slice("function finalBookingConfirmationOrderNo(", "function finalBookingCancellationText(");
const orderParser = slice("function parseOrder(text)", "\nfunction ");
const acceptanceParser = slice("function isCaptainAcceptance(text)", "\nfunction ");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${textBuilder}\n${orderNumberParser}\n${orderParser}\n${acceptanceParser}\nthis.api = { finalBookingConfirmationText, finalBookingConfirmationOrderNo, parseOrder, isCaptainAcceptance };`, sandbox);

const message = sandbox.api.finalBookingConfirmationText({
  orderNo: 4,
  executorName: "منفذ تجريبي",
  downloaderName: "يجب ألا يظهر",
  consumerName: "يجب ألا يظهر",
  priceCents: 12345,
  origin: "مكان أ",
  destination: "مكان ب",
  tripTime: "وقت تجريبي",
});
assert.equal(message, "تم تثبيت الحجز\nاسم المنفذ: منفذ تجريبي\nرقم الرحلة: 4");
assert.equal(sandbox.api.finalBookingConfirmationOrderNo(message), 4);
assert.equal(sandbox.api.finalBookingConfirmationOrderNo("🟢 تثبيت الطلب #17"), 17, "الصيغة السابقة تبقى قابلة للتعرف");
assert.equal(sandbox.api.finalBookingConfirmationOrderNo("رقم الرحلة: #23"), 23, "الصيغة القديمة ذات # تبقى قابلة للتعرف");
assert.equal(sandbox.api.finalBookingConfirmationOrderNo("رسالة أخرى"), 0);
assert.equal(sandbox.api.parseOrder(message).isOrder, false, "إشعار التأكيد ليس طلب رحلة جديدًا");
assert.equal(isBotGeneratedMessage({ fromMe: true }), true, "رسالة التأكيد الصادرة تُعرف كرسالة بوت");
const botGeneratedIndex = source.indexOf("const botGenerated = isBotGeneratedMessage(msg);");
const botMessageGuardIndex = source.indexOf("if (botGenerated && !parseOrder(body).isOrder) return;", botGeneratedIndex);
const acceptanceParserIndex = source.indexOf("const captainAcceptance = isCaptainAcceptance(body);", botGeneratedIndex);
assert.ok(botGeneratedIndex >= 0 && botMessageGuardIndex > botGeneratedIndex && acceptanceParserIndex > botMessageGuardIndex,
  "رسائل البوت غير الطلبية تُوقف قبل محلل القبول");
console.log("final booking confirmation format, order tracking, and bot-message guard verified");
