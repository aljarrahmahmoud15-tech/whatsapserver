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
assert.strictEqual(context.parseOrder("راكب\nالسعر 5 دنانير").isOrder, true, "تُسجل صيغة راكب السعر التي يعتمدها القروب");
assert.strictEqual(context.parseOrder("السعر 35\nراكبة\nمن إربد إلى عمّان").isOrder, true, "تُسجل صيغة راكبة مع السعر والمسار");
assert.strictEqual(context.parseOrder("السعر 40\nسيارة كاملة\nمن إربد إلى عمّان").isOrder, true, "تُسجل صيغة سيارة كاملة مع السعر والمسار");
assert.strictEqual(context.parseOrder("السعر 25\nاستقبال مطار\nمن عمّان إلى المطار").isOrder, true, "تُسجل صيغة استقبال مطار مع السعر والمسار");
assert.strictEqual(context.parseOrder("السعر 5").isOrder, false, "لا يُسجل السعر وحده كطلب");
assert.strictEqual(context.parseOrder("هل سعر 5 مناسب من إربد إلى عمّان؟").isOrder, false, "لا يُسجل الاستفسار العادي الذي يذكر سعرًا ومسارًا كطلب");

console.log("order parser verified");
