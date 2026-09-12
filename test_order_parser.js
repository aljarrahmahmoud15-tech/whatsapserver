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
const abbreviatedRoute = context.parseOrder("السعر 5\nراكب شب من دير يوسف لشفا بدران\nجاهز");
assert.strictEqual(abbreviatedRoute.isOrder, true, "تُسجل صيغة المسار المختصرة باستخدام ل");
assert.strictEqual(abbreviatedRoute.origin, "دير يوسف", "يُستخرج مبدأ المسار من الصيغة المختصرة");
assert.strictEqual(abbreviatedRoute.destination, "شفا بدران", "تُستخرج وجهة المسار من الصيغة المختصرة");
const compactJordanianFare = context.parseOrder("10 أردني\nركاب عدد 2\nمن الرمثا إلى عمان\nالان");
assert.strictEqual(compactJordanianFare.isOrder, true, "تُسجل صيغة السعر الأردني المختصرة");
assert.strictEqual(compactJordanianFare.price, 10, "يُستخرج السعر من صيغة 10 أردني");
assert.strictEqual(compactJordanianFare.requestKind, "ركاب", "يُتعرف على صيغة ركاب");
assert.strictEqual(compactJordanianFare.origin, "الرمثا", "يُستخرج منشأ الطلب المختصر");
assert.strictEqual(compactJordanianFare.destination, "عمان", "تُستخرج وجهة الطلب المختصر");
assert.strictEqual(context.parseOrder("السعر 5").isOrder, true, "السعر مع الرقم وحده يشكل طلبًا");
assert.strictEqual(context.parseOrder("هل السعر ٥ مناسب من إربد إلى عمّان؟").isOrder, true, "أي رسالة تحتوي على السعر ورقم تُسجل كطلب");
assert.strictEqual(context.parseOrder("السعر ٥٫٥").price, 5.5, "تُحوّل الأرقام العربية والفاصلة العشرية إلى قيمة رقمية");

console.log("order parser verified");
