const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
assert(source.includes("function finalBookingConfirmationText"), "يوجد مسار مستقل لتأكيد التثبيت النصي");
assert(source.includes("async function sendFinalBookingConfirmation"), "إرسال التأكيد النصي بمهلة آمنة");
assert(source.includes("✅ تم قبول الطلب وتثبيته"), "التأكيد يحمل عنوان القبول والتثبيت");
assert(source.includes("شامل العمولة"), "التأكيد يوضح أن السعر شامل العمولة");
assert(source.includes("مقبول ومعتمد"), "التأكيد يوضح الحالة المعتمدة");
assert(source.includes("رقم الرحلة:"), "التأكيد يحمل رقم الرحلة");
assert(source.includes("صاحب الطلب:"), "التأكيد يضم اسم صاحب الطلب");
assert(source.includes("الكابتن المنفذ:"), "التأكيد يضم اسم الكابتن المنفذ");
assert(source.includes("function finalBookingCancellationText"), "يوجد نص مستقل للرفض أو الإلغاء");
assert(source.includes("Image booking cards are disabled"), "بطاقات الصور معطلة");
assert(!source.includes("sendFinalBookingCard("), "لا يوجد إرسال لبطاقة صورة عند تثبيت الطلب");
assert(!source.includes('client.sendMessage(target.from, `تم تثبيت الطلب:'), "لا توجد رسالة مطولة خارج التأكيد المختصر");
assert(!source.includes('sendGroupBrandedMessage(groupId, "تم تسجيل الطلب"'), "لا يوجد رد عند تنزيل الطلب");
assert(!source.includes('sendGroupBrandedMessage(groupId, "بانتظار اعتماد كابتن تنزيل الطلب"'), "لا يوجد رد عند كتابة تم");
console.log("silent intermediate replies and named Waslni Now booking confirmation guardrails verified");
