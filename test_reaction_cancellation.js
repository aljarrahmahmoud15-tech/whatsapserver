const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

assert.match(server, /const removedThumb = reactionValue === ""/);
assert.match(server, /status IN \('open','accepted'\)/);
assert.match(server, /phoneWithCountry\(producer\.phone\) !== phoneWithCountry\(approverPhone\)/);
assert.match(server, /cancelOrderForReactionRemoval\(candidate\.id, messageId, approverPhone\)/);
assert.match(server, /status='cancelled',settlement_state='cancelled'/);
assert.match(server, /status='cancelled',settlement_state='reversed'/);
assert.match(server, /UPDATE order_settlements SET status='reversed'/);
assert.match(server, /reversal_company/);
assert.match(server, /reversal_producer/);
assert.match(server, /reversal_captain_fee/);
assert.match(server, /sendFinalBookingCard\(target\.from, result\.producer\?\.name, result\.captain\?\.name\)/);
assert.doesNotMatch(server, /client\.sendMessage\(target\.from, `تم تثبيت الطلب:/);
assert.doesNotMatch(server, /client\.sendMessage\(target\.from, `تم إلغاء الطلب:/);

console.log("reaction cancellation and short confirmation guardrails verified");
