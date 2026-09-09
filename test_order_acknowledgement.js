const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
assert(source.includes("function formatOrderCreated(order)"), "صيغة رد تسجيل الطلب موجودة");
assert(source.includes('"تم تسجيل الطلب"'), "الرد يوضح نجاح تسجيل الطلب");
assert(source.includes("🆔 رقم الطلب"), "الرد يحتوي رقم الطلب");
assert(source.includes("await client.sendMessage(groupId, formatOrderCreated"), "البوت يرسل الرد إلى القروب");
assert(source.includes('if (typeof client !== "undefined" && client && isReady)'), "الإرسال محمي من عدم جاهزية الاتصال");
console.log("order acknowledgement guardrails verified");
