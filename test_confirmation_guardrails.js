const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

assert.match(server, /function formatPendingConfirmation\(order, captain\)/);
assert.match(server, /لا توجد تسوية مالية قبل اعتماد المنتج/);
assert.match(server, /if \(!reaction \|\| reaction\.reaction !== "👍"\) return;/);
assert.match(server, /if \(!isConfiguredGroup\(target\.from\)\) return;/);
assert.match(server, /phoneWithCountry\(producer\.phone\) !== phoneWithCountry\(producerPhone\)/);
assert.match(server, /pending_message_id/);
assert.match(server, /order\.accepted/);

console.log("confirmation guardrails verified");
