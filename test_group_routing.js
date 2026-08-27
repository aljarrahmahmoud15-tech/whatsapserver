const assert = require("assert");
const { resolveGroupChatId } = require("./group-routing");

assert.strictEqual(
  resolveGroupChatId({ from: "120363000000000000@g.us", to: "962775696880@c.us" }),
  "120363000000000000@g.us",
  "تُقرأ رسالة القروب الواردة من حقل from"
);
assert.strictEqual(
  resolveGroupChatId({ from: "962775696880@c.us", to: "120363000000000000@g.us" }),
  "120363000000000000@g.us",
  "تُقرأ رسالة الاعتماد الصادرة من البوت من حقل to"
);
assert.strictEqual(
  resolveGroupChatId({ from: "962775696880@c.us", to: "962779110123@c.us" }),
  "",
  "لا تُعامل المحادثة الفردية كقروب"
);

console.log("group message routing verified");
