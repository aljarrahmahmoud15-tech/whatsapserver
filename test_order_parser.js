const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const start = source.indexOf("function parseOrder(");
const end = source.indexOf("function isCaptainAcceptance(", start);
assert(start >= 0 && end > start, "محلل الطلب موجود داخل الخادم");

const context = {};
vm.runInNewContext(`${source.slice(start, end)}\nthis.parseOrder = parseOrder;`, context);

assert.strictEqual(context.parseOrder("وصلني الآن\nالسعر 5\nمن إربد إلى عمّان").isOrder, true, "تبقى الصيغة القديمة صالحة");
assert.strictEqual(context.parseOrder("السعر 5\nراكب بنت\nمن إربد إلى عمّان").isOrder, true, "تُسجل الصيغة الطبيعية ذات السعر والمسار");
assert.strictEqual(context.parseOrder("السعر 5").isOrder, false, "لا يُسجل السعر وحده كطلب");

console.log("order parser verified");
