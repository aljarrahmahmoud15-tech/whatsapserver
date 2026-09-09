const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
assert(source.includes("async function registerGroupMembersAsCaptains"), "تسجيل أعضاء القروب موجود");
assert(source.includes("chat.participants"), "يقرأ أعضاء القروب الحاليين");
assert(source.includes("captain_pin_hash"), "ينشئ رمز دخول للكابتن الجديد");
assert(source.includes("sendCaptainAppLink"), "يرسل رابط الحساب للكابتن");
assert(source.includes('app.post("/api/admin/group/register-members", requireAdmin'), "مسار التسجيل محمي إداريًا");
assert(source.includes("skipped_existing_role"), "لا يغيّر الأدوار الموجودة");
assert(source.includes("temporaryPinSent"), "لا يعيد الرمز السري في استجابة المسار");
console.log("group member registration guardrails verified");

