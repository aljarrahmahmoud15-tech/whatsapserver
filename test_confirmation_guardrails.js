const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

assert.match(server, /function formatPendingConfirmation\(order, captain\)/);
assert.match(server, /const removedThumb = reactionValue === ""/);
assert.match(server, /cancelOrderForReactionRemoval\(candidate\.id, messageId, approverPhone\)/);
assert.match(server, /function sendFinalBookingCard\(groupId, producerName, captainName\)/);
assert.match(server, /await sendFinalBookingCard\(target\.from, result\.producer\?\.name, result\.captain\?\.name\)/);
assert.doesNotMatch(server, /sendGroupBrandedMessage\(groupId, "تم تسجيل الطلب"/);
assert.doesNotMatch(server, /sendGroupBrandedMessage\(groupId, "بانتظار اعتماد كابتن تنزيل الطلب"/);
assert.doesNotMatch(server, /client\.sendMessage\(target\.from, `تم تثبيت الطلب:/);
assert.doesNotMatch(server, /client\.sendMessage\(target\.from, `تم إلغاء الطلب:/);
assert.match(server, /const requestKindMatch = normalized\.match\(\/\(\?:راكب/);
assert.match(server, /استقبال\\s\+مطار/);
assert.match(server, /ضع 👍 على رسالة «تم» نفسها/);
assert.match(server, /if \(!quoted\) return;/);
assert.match(server, /const order = findOrderByQuotedMessage\(groupId, quoted\)/);
assert.match(server, /if \(!isConfiguredGroup\(target\.from\)\) return;/);
assert.match(server, /رسائل البوت العادية ليست رسائل تشغيلية/);
assert.match(server, /isBotGeneratedMessage\(msg\)/);
assert.match(server, /isBotReactionSender\(approverPhone, connectedBotPhone\(\)\)/);
assert.match(server, /findActiveRegisteredUser\(approverPhone\)/);
assert.match(server, /phoneWithCountry\(producer\.phone\) !== phoneWithCountry\(approverPhone\)/);
assert.match(server, /confirmingCaptainFeeCents/);
assert.match(server, /pending_message_id/);
assert.match(server, /order\.accepted/);

console.log("confirmation guardrails verified");
