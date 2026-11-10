const assert = require("node:assert/strict");
const fs = require("node:fs");
const server = fs.readFileSync("server.js", "utf8");

assert.match(server, /async function notifyOfficialGroupInsufficientAcceptanceBalance/);
assert.match(server, /GROUP-ACCEPTANCE-BALANCE-\$\{sourceKey\}/);
assert.match(server, /official_group\.acceptance\.insufficient_balance/);
assert.match(server, /sendWhatsAppAtMostOnce\(targetGroupId, message/);
assert.match(server, /if \(!\['deleted', 'partial'\]\.includes\(String\(deletionStatus \|\| ""\)\)\)/);
assert.match(server, /تم حذف رسالة تم من الكابتن لعدم كفاية الرصيد، وتم إلغاء الرحلة رقم \$\{tripNo\} فقط/);
assert.match(server, /const correction = await notifyOfficialGroupInsufficientAcceptanceBalance/);
assert.doesNotMatch(server, /const correction = \{ status: "not_sent", reason: "group_notification_disabled" \}/);
assert.match(server, /financialMutation: false/);

console.log("official-group insufficient-balance notification is enabled and idempotent");
