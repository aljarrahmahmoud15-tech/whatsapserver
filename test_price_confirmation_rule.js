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
assert.equal(context.parseOrder("تم السعر 35").isOrder, false, "السعر لا يُقبل إذا لم يكن بداية الرسالة");
assert.equal(context.parseOrder("من إربد إلى عمّان السعر 35").isOrder, false, "السعر داخل النص لا ينشئ طلبًا");
assert.equal(context.parseOrder("تم").isOrder, false, "تم ليست طلب سعر");

const acceptanceStart = source.indexOf("function isCaptainAcceptance(");
const acceptanceEnd = source.indexOf("function latestOpenOrder(", acceptanceStart);
assert(acceptanceStart >= 0 && acceptanceEnd > acceptanceStart, "isCaptainAcceptance must remain available");
const acceptanceContext = {};
vm.runInNewContext(`${source.slice(acceptanceStart, acceptanceEnd)}\nthis.isCaptainAcceptance = isCaptainAcceptance;`, acceptanceContext);
assert.equal(acceptanceContext.isCaptainAcceptance("تم"), true, "تم وحدها قبول صحيح");
assert.equal(acceptanceContext.isCaptainAcceptance("تم جاهز الآن"), true, "تم مع كلام لاحق قبول صحيح");
assert.equal(acceptanceContext.isCaptainAcceptance("تمم"), false, "تمم ليست قبولاً");

const handlerStart = source.indexOf("async function handleIncomingMessage(");
const handlerEnd = source.indexOf("function reactionId(", handlerStart);
const handler = source.slice(handlerStart, handlerEnd);
assert.match(handler, /const candidate = quoted \? findOrderByQuotedMessage\(groupId, quoted\) : null/);
assert.doesNotMatch(handler, /: findLatestStandaloneAcceptanceCandidate\(groupId\)/, "تم غير المقتبس لا يجوز ربطه بآخر طلب");
assert.match(handler, /const quoted = await getQuotedMessageWithFallback\(msg\)/);

console.log("price confirmation rule verified");
