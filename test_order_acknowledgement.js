const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
assert(source.includes("function finalBookingConfirmationText"), "يوجد مسار مستقل لتأكيد التثبيت النصي");
assert(source.includes("async function sendFinalBookingConfirmation"), "إرسال التأكيد النصي بمهلة آمنة");
assert(source.includes(".slice(0, 40)"), "التأكيد لا يتجاوز 40 حرفًا");
assert(source.includes("✓ تثبيت #"), "التأكيد يحمل علامة الصح ورقم الطلب");
assert(source.includes("labels = [\"م:\", \"س:\"]"), "التأكيد يضم المنفذ والمستهلك");
assert(source.includes("priceCents"), "التأكيد يضم قيمة الطلب");
assert(source.includes("Image booking cards are disabled"), "بطاقات الصور معطلة");
assert(!source.includes("sendFinalBookingCard("), "لا يوجد إرسال لبطاقة صورة عند تثبيت الطلب");
assert(!source.includes('client.sendMessage(target.from, `تم تثبيت الطلب:'), "لا توجد رسالة مطولة خارج التأكيد المختصر");
assert(!source.includes('sendGroupBrandedMessage(groupId, "تم تسجيل الطلب"'), "لا يوجد رد عند تنزيل الطلب");
assert(!source.includes('sendGroupBrandedMessage(groupId, "بانتظار اعتماد كابتن تنزيل الطلب"'), "لا يوجد رد عند كتابة تم");
console.log("silent intermediate replies and 40-character text confirmation guardrails verified");
