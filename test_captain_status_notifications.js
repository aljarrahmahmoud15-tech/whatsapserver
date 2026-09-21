const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("./server.js", "utf8");

assert.match(server, /CAPTAIN_STATUS_NOTICE_MAX_LENGTH\s*=\s*70/);
assert.match(server, /async function sendCaptainStatusText\(/);
assert.match(server, /const captainStatusNotificationInFlight = new Set\(\)/);
assert.match(server, /async function retryCaptainStatusNotifications\(/);
assert.match(server, /delivery_status IN \('pending','failed'\)/);
assert.match(server, /retryCaptainStatusNotifications\(\)/);
assert.match(server, /idempotency_key TEXT/);
assert.match(server, /source_message_id TEXT/);
assert.match(server, /idx_notifications_idempotency/);
assert.match(server, /instance\.on\("message_ack"/);
assert.match(server, /captain\.join\.received/);
assert.match(server, /captain\.approval/);
assert.match(server, /captain\.access_card\.sent/);
assert.match(server, /captain\.access_card\.delivered/);
assert.match(server, /تم استلام طلب تسجيلك، وبانتظار موافقة الشركة/);
assert.match(server, /تمت موافقة الشركة على الكابتن الجديد وتفعيل حسابك/);
assert.match(server, /تم إرسال بطاقة دخولك إلى واتساب/);
assert.match(server, /تم تسليم بطاقة الدخول إلى واتسابك/);
assert.match(server, /message\.length > CAPTAIN_STATUS_NOTICE_MAX_LENGTH/);
assert.match(server, /CAPTAIN-REQUEST-RECEIVED-\$\{invite\.id\}/);
assert.match(server, /CAPTAIN-APPROVAL-\$\{id\}/);
assert.match(server, /CAPTAIN-ACCESS-DELIVERED-\$\{cardNotice\.id\}/);

const shortTexts = [
  "تم استلام طلب تسجيلك، وبانتظار موافقة الشركة.",
  "تمت موافقة الشركة على الكابتن الجديد وتفعيل حسابك.",
  "تم إرسال بطاقة دخولك إلى واتساب.",
  "تم تسليم بطاقة الدخول إلى واتسابك.",
];
for (const text of shortTexts) assert.ok(text.length <= 70, `notice exceeds 70 chars: ${text}`);

console.log("captain status notification guardrails verified");
