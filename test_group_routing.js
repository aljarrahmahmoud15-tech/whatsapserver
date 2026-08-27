const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const start = source.indexOf("function resolveGroupChatId(");
const end = source.indexOf("async function handleIncomingMessage(", start);
assert(start >= 0 && end > start, "معالج تحديد القروب موجود داخل الخادم");

const context = {};
vm.runInNewContext(`${source.slice(start, end)}\nthis.resolveGroupChatId = resolveGroupChatId;`, context);

assert.strictEqual(
  context.resolveGroupChatId({ from: "120363000000000000@g.us", to: "962775696880@c.us" }),
  "120363000000000000@g.us",
  "تُقرأ رسالة القروب الواردة من from"
);
assert.strictEqual(
  context.resolveGroupChatId({ from: "962775696880@c.us", to: "120363000000000000@g.us" }),
  "120363000000000000@g.us",
  "تُقرأ رسالة اعتماد البوت الصادرة من to"
);
assert.strictEqual(
  context.resolveGroupChatId({ from: "962775696880@c.us", to: "962779110123@c.us" }),
  "",
  "المحادثة الفردية لا تُعامل كقروب"
);

console.log("group message routing verified");
