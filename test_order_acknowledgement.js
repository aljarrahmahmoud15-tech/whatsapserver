const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
assert(source.includes("function formatOrderCreated(order)"), "صيغة رد تسجيل الطلب موجودة");
assert(source.includes('"تم تسجيل الطلب"'), "الرد يوضح نجاح تسجيل الطلب");
assert(source.includes("🆔 رقم الطلب"), "الرد يحتوي رقم الطلب");
assert(source.includes("AL-JARAH OPERATIONS NETWORK"), "الرد يستخدم إطار بوابة التشغيل الرسمية");
assert(source.includes("نقل أسرع • تنظيم أدق • سجل موثّق"), "الرد يستخدم تذييل الهوية الموحد");
assert(source.includes("renderOperationsMessageMedia"), "رد القروب يولّد بطاقة شعار مرئية");
assert(source.includes('fill="#48d9d1"'), "بطاقة القروب تتضمن النقطة المضيئة الزرقاء");
assert(source.includes("await sendGroupBrandedMessage(groupId, \"تم تسجيل الطلب\""), "البوت يرسل البطاقة الرسمية إلى القروب");
assert(source.includes('if (typeof client !== "undefined" && client && isReady)'), "الإرسال محمي من عدم جاهزية الاتصال");
console.log("order acknowledgement guardrails verified");
