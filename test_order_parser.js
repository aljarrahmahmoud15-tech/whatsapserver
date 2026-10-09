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

assert.strictEqual(context.parseOrder("وصلني الآن\nالسعر 5\nمن إربد إلى عمّان").isOrder, false, "السعر يجب أن يكون بداية الرسالة");
assert.strictEqual(context.parseOrder("السعر 5\nراكب بنت\nمن إربد إلى عمّان").isOrder, true, "تُسجل الصيغة الطبيعية ذات السعر والمسار");
assert.strictEqual(context.parseOrder("راكب\nالسعر 5 دنانير").isOrder, false, "السعر يجب أن يكون أول كلمة");
assert.strictEqual(context.parseOrder("السعر 35\nراكبة\nمن إربد إلى عمّان").isOrder, true, "تُسجل صيغة راكبة مع السعر والمسار");
assert.strictEqual(context.parseOrder("السعر 40\nسيارة كاملة\nمن إربد إلى عمّان").isOrder, true, "تُسجل صيغة سيارة كاملة مع السعر والمسار");
assert.strictEqual(context.parseOrder("السعر 25\nاستقبال مطار\nمن عمّان إلى المطار").isOrder, true, "تُسجل صيغة استقبال مطار مع السعر والمسار");
const abbreviatedRoute = context.parseOrder("السعر 5\nراكب شب من دير يوسف لشفا بدران\nجاهز");
assert.strictEqual(abbreviatedRoute.isOrder, true, "تُسجل صيغة المسار المختصرة باستخدام ل");
assert.strictEqual(abbreviatedRoute.origin, "دير يوسف", "يُستخرج مبدأ المسار من الصيغة المختصرة");
assert.strictEqual(abbreviatedRoute.destination, "شفا بدران", "تُستخرج وجهة المسار من الصيغة المختصرة");
const compactJordanianFare = context.parseOrder("10 أردني\nركاب عدد 2\nمن الرمثا إلى عمان\nالان");
assert.strictEqual(compactJordanianFare.isOrder, false, "لا تُسجل الصيغ التي لا تحتوي على كلمة السعر");
assert.strictEqual(compactJordanianFare.price, null, "لا تُستخرج قيمة من صيغة لا تحتوي على كلمة السعر");
assert.strictEqual(compactJordanianFare.requestKind, "ركاب", "يُتعرف على صيغة ركاب");
assert.strictEqual(compactJordanianFare.origin, "الرمثا", "يُستخرج منشأ الطلب المختصر");
assert.strictEqual(compactJordanianFare.destination, "عمان", "تُستخرج وجهة الطلب المختصر");
assert.strictEqual(context.parseOrder("السعر 5").isOrder, true, "السعر مع الرقم وحده يشكل طلبًا");
assert.strictEqual(context.parseOrder("هل السعر ٥ مناسب من إربد إلى عمّان؟").isOrder, false, "السعر داخل السؤال لا ينشئ طلبًا");
assert.strictEqual(context.parseOrder("السعر ٥٫٥").price, 5.5, "تُحوّل الأرقام العربية والفاصلة العشرية إلى قيمة رقمية");
assert.strictEqual(context.parseOrder("السعر 15 دنانير").price, 15, "تُحتسب قيمة 15 من صيغة دنانير");
assert.strictEqual(context.parseOrder("السعر 5دنانير").price, 5, "تُحتسب قيمة 5 من الصيغة المتصلة دنانير");
assert.strictEqual(context.parseOrder("السعر: 15 دينار").price, 15, "تُقبل النقطتان بعد كلمة السعر");
const westernRange = context.parseOrder("السعر من 10 إلى 15");
assert.strictEqual(westernRange.isOrder, true, "يُقبل نطاق السعر الغربي");
assert.strictEqual(westernRange.priceMin, 10, "يُحفظ الحد الأدنى للنطاق");
assert.strictEqual(westernRange.priceMax, 15, "يُحفظ الحد الأعلى للنطاق");
assert.strictEqual(westernRange.price, 12.5, "يُستخدم متوسط النطاق كسعر محاسبي");
const arabicRange = context.parseOrder("السعر ١٠ إلى ١٥ دنانير");
assert.strictEqual(arabicRange.price, 12.5, "يُحسب متوسط النطاق بالأرقام العربية");
assert.strictEqual(context.parseOrder("السعر 10-15").price, 12.5, "يُقبل النطاق بالشرطة");
assert.strictEqual(context.parseOrder("السعر 10.5 إلى 15.5").price, 13, "يُحسب متوسط النطاق العشري");
assert.strictEqual(context.parseOrder("السعر من 15 إلى 10").isOrder, false, "يُرفض النطاق المعكوس");

console.log("order parser verified");
