const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
assert(source.includes("function sendFinalBookingCard"), "يوجد مسار مستقل لبطاقة التثبيت النهائية");
assert(source.includes('client.sendMessage(groupId, media);'), "البطاقة النهائية ترسل دون caption أو شرح أسفلها");
assert(source.includes('"تم تثبيت الطلب"'), "بطاقة التثبيت تحمل عنوان التثبيت");
assert(source.includes("اسم كابتن التنزيل:"), "البطاقة تعرض اسم كابتن تنزيل الطلب فقط");
assert(source.includes("اسم الكابتن المنفذ:"), "البطاقة تعرض اسم كابتن التنفيذ فقط");
assert(source.includes("القيمة:"), "البطاقة تعرض قيمة الطلب فقط");
assert(!source.includes('sendGroupBrandedMessage(groupId, "تم تسجيل الطلب"'), "لا يوجد رد عند تنزيل الطلب");
assert(!source.includes('sendGroupBrandedMessage(groupId, "بانتظار اعتماد كابتن تنزيل الطلب"'), "لا يوجد رد عند كتابة تم");
assert(!source.includes('client.sendMessage(target.from, `تم تثبيت الطلب:'), "لا توجد رسالة نصية بعد التثبيت");
console.log("silent intermediate replies and final booking card guardrails verified");
