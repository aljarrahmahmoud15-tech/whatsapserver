const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const start = source.indexOf("function baileysJidPhone(");
const end = source.indexOf("async function handleBaileysUpsert(", start);
assert(start >= 0 && end > start, "محولات أحداث Baileys موجودة داخل الخادم");

const context = {
  phoneWithCountry: (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.startsWith("0") ? `962${digits.slice(1)}` : digits;
  },
};
vm.runInNewContext(`${source.slice(start, end)}\nthis.baileysJidPhone = baileysJidPhone; this.baileysMessageText = baileysMessageText;`, context);

assert.strictEqual(context.baileysJidPhone("962775696880:12@s.whatsapp.net"), "962775696880", "يُستخرج رقم المرسل دون رقم الجهاز");
assert.strictEqual(context.baileysMessageText({ message: { conversation: "السعر 5" } }), "السعر 5", "تُقرأ رسالة نصية عادية");
assert.strictEqual(context.baileysMessageText({ message: { extendedTextMessage: { text: "راكب من إربد إلى عمّان" } } }), "راكب من إربد إلى عمّان", "تُقرأ رسالة نصية موسعة");
assert.strictEqual(context.baileysMessageText({ message: {} }), "", "لا تُنشأ رسالة من محتوى فارغ");

console.log("baileys message bridge verified");
