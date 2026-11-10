const assert = require("node:assert/strict");
const fs = require("node:fs");
const server = fs.readFileSync("server.js", "utf8");

assert.doesNotMatch(server, /async function notifyOfficialGroupInsufficientAcceptanceBalance/);
assert.doesNotMatch(server, /GROUP-ACCEPTANCE-BALANCE-\$\{sourceKey\}/);
assert.doesNotMatch(server, /official_group\.acceptance\.insufficient_balance/);
assert.doesNotMatch(server, /sendWhatsAppAtMostOnce\(targetGroupId, message/);
assert.match(server, /const correction = \{ status: "not_sent", reason: "group_notification_disabled" \};/);
assert.match(server, /تم حذف رسالة «تم» من الكابتن لعدم كفاية الرصيد/);
assert.match(server, /async function notifyCaptainInsufficientAcceptanceBalance/);
assert.match(server, /financialMutation: false/);

console.log("official-group insufficient-balance notification is disabled; captain-only notice remains");
