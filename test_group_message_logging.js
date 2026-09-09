const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("./server.js", "utf8");
const handlerStart = source.indexOf("async function handleIncomingMessage(msg, { allowSelf = false } = {})");
const handlerEnd = source.indexOf("async function handleIncomingMessage(msg, options = {})", handlerStart);
assert(handlerStart >= 0 && handlerEnd > handlerStart, "معالج رسائل القروب موجود");
const handler = source.slice(handlerStart, handlerEnd);
const logPosition = handler.indexOf("INSERT OR IGNORE INTO messages");
const botFilterPosition = handler.indexOf("if (botGenerated && !parseOrder(body).isOrder) return;");
assert(logPosition >= 0, "رسائل القروب تُحفظ في جدول messages");
assert(botFilterPosition >= 0 && botFilterPosition < logPosition, "رسائل البوت العادية تُستبعد قبل الحفظ");
assert(handler.includes("if (!insertedMessage.changes) return;"), "الرسائل المكررة لا تعاد معالجتها تشغيليًا");
assert(source.includes('app.get("/api/admin/group-messages", requireAdmin'), "واجهة قراءة السجل محمية إداريًا");
console.log("group message logging guardrails verified");
