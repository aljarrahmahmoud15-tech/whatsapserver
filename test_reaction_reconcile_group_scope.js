const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const start = source.indexOf("async function reconcileStoredThumbReaction(");
const end = source.indexOf("async function retryFailedBookingConfirmations(", start);
assert(start >= 0 && end > start, "مسار مصالحة التفاعل موجود مرة واحدة وبنهاية واضحة");
const reconcileSource = source.slice(start, end);

assert.match(
  reconcileSource,
  /const targetGroupId = String\(target\.from \|\| target\._data\?\.from \|\| ""\)\.trim\(\);/,
  "مسار المصالحة يستخرج معرف القروب من الرسالة المسترجعة"
);
assert.match(
  reconcileSource,
  /if \(!targetGroupId\.endsWith\("@g\.us"\) \|\| !isConfiguredGroup\(targetGroupId\)\) \{[\s\S]*?return;/,
  "مسار المصالحة يتوقف للقروب غير الجماعي أو غير المعتمد قبل قراءة التفاعلات"
);

const guardEnd = reconcileSource.indexOf("let reactions = await");
assert(guardEnd > 0, "قراءة التفاعلات موجودة بعد الحارس");
const beforeReactionRead = reconcileSource.slice(0, guardEnd);
assert(
  beforeReactionRead.indexOf("reaction_scan_ignored_unconfigured_group") >= 0,
  "يتم تسجيل تجاهل مسح القروب غير المعتمد"
);
assert(
  beforeReactionRead.indexOf("isConfiguredGroup(targetGroupId)") >= 0,
  "فحص القروب المعتمد يسبق استدعاء getReactions"
);

console.log("reaction reconcile approved-group scope guard verified");
