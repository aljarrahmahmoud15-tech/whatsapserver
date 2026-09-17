const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const parseStart = source.indexOf("function parseOrder(");
const parseEnd = source.indexOf("function isCaptainAcceptance(", parseStart);
assert(parseStart >= 0 && parseEnd > parseStart, "parseOrder must remain available");
const context = {};
vm.runInNewContext(`${source.slice(parseStart, parseEnd)}\nthis.parseOrder = parseOrder;`, context);

assert.equal(context.parseOrder("السعر 7").isOrder, true, "السعر مع رقم متغير يكفي لإنشاء الطلب");
assert.equal(context.parseOrder("السعر 12.5").price, 12.5, "السعر العشري مدعوم");
assert.equal(context.parseOrder("السعر 35 دينار").price, 35, "وحدة الدينار اختيارية");
assert.equal(context.parseOrder("تم").isOrder, false, "تم ليست طلب سعر");

const handlerStart = source.indexOf("async function handleIncomingMessage(");
const handlerEnd = source.indexOf("function reactionId(", handlerStart);
const handler = source.slice(handlerStart, handlerEnd);
assert.match(handler, /const candidate = quoted \? findOrderByQuotedMessage\(groupId, quoted\) : null/);
assert.doesNotMatch(handler, /: findLatestStandaloneAcceptanceCandidate\(groupId\)/, "تم غير المقتبس لا يجوز ربطه بآخر طلب");
assert.match(handler, /const quoted = msg\.hasQuotedMsg \? await withTimeout\(msg\.getQuotedMessage\(\), 8000, null\)/);

console.log("price confirmation rule verified");
