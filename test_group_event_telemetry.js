const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const start = source.indexOf("function recordGroupMessageTelemetry(");
const end = source.indexOf("function baileysJidPhone(", start);
assert(start >= 0 && end > start, "مسجل أحداث القروب موجود داخل الخادم");
const telemetry = source.slice(start, end);

assert(telemetry.includes("event"), "يسجل نوع الحدث فقط");
assert(telemetry.includes("fromMe"), "يسجل جهة الرسالة دون رقم أو نص");
assert(telemetry.includes("configured"), "يسجل ما إذا كان القروب مهيأً");
assert(!telemetry.includes("msg.body"), "لا يحفظ نص رسالة القروب في القياس التشخيصي");
assert(!telemetry.includes("_serialized"), "لا يحفظ معرّف رسالة القروب في القياس التشخيصي");

console.log("group event telemetry privacy guardrails verified");
