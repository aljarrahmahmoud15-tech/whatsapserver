const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
assert(source.includes("async function addCaptainToConfiguredGroup(captain)"), "إضافة الكابتن إلى القروب موجودة");
assert(source.includes("async function syncActiveCaptainsToConfiguredGroup"), "مزامنة الكباتن موجودة");
assert(source.includes("WHERE role='captain' AND active=1"), "المزامنة تستهدف الكباتن النشطين فقط");
assert(source.includes('app.post("/api/admin/group/sync-captains", requireAdmin'), "مسار المزامنة محمي إداريًا");
assert(source.includes("captainAppUrl(baseUrl)"), "رابط حساب الكابتن يُرسل ضمن المزامنة");
assert(source.includes("addCaptainToConfiguredGroup(captain)"), "اعتماد الكابتن يطلق مزامنته مع القروب");
console.log("captain group sync guardrails verified");

