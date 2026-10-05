const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("./server.js", "utf8");
const directStart = source.indexOf("async function sendFinalBookingConfirmationDirect");
const directEnd = source.indexOf("async function sendFinalBookingConfirmationViaConfiguredChat", directStart);
assert.ok(directStart >= 0 && directEnd > directStart, "direct confirmation sender must exist");
const direct = source.slice(directStart, directEnd);
assert.match(direct, /isServer2OutboundTargetAllowed\(groupId\)/, "direct sender must keep the Server 2 target guard");
assert.match(direct, /!client \|\| !isReady \|\| typeof client\.sendMessage !== "function"/, "direct sender must require a ready WhatsApp client");
assert.match(direct, /return client\.sendMessage\(groupId, message\)/, "direct sender must use the configured group id directly");
assert.doesNotMatch(direct, /getChatById|getChats/, "direct sender must not perform chat discovery");

const senderStart = source.indexOf("async function sendFinalBookingConfirmation(groupId, details, options = {})");
const senderEnd = source.indexOf("async function retryFailedBookingConfirmations", senderStart);
assert.ok(senderStart >= 0 && senderEnd > senderStart, "confirmation sender must exist");
const sender = source.slice(senderStart, senderEnd);
assert.match(sender, /const deliveryMode = options\.deliveryMode === "fallback" \? "fallback" : "direct"/);
assert.match(sender, /deliveryMode === "fallback"\s*\?\s*sendFinalBookingConfirmationViaConfiguredChat\(groupId, message\)\s*:\s*sendFinalBookingConfirmationDirect\(groupId, message\)/s, "direct is the first path and configured-chat discovery is fallback-only");
assert.match(sender, /withTimeoutStrict\(sendPromise, ADMIN_SEND_TIMEOUT_MS, sendTimeoutMarker\)/);
assert.match(sender, /send_pending_waiting_message_create/);
assert.match(sender, /status='sent',message_id=/);
assert.match(sender, /status='failed',last_error=/);

const retryStart = source.indexOf("async function retryFailedBookingConfirmations");
const retryEnd = source.indexOf("async function findFinalBookingConfirmationInGroup", retryStart);
const retry = source.slice(retryStart, retryEnd);
assert.match(retry, /sendFinalBookingConfirmation\(row\.group_id[\s\S]*deliveryMode: "fallback"/s, "retry must use the old configured-chat path as fallback");
assert.match(retry, /findFinalBookingConfirmationInGroup\(row\.group_id, row\.order_no\)/, "fallback must check for an already delivered card before resending");
assert.doesNotMatch(retry, /settlePendingOrder|wallet_ledger|order_settlements/, "card retry must not settle or mutate wallets");

for (const caller of [
  /sendFinalBookingConfirmation\(groupId, confirmationDetails, \{ deliveryMode: "direct" \}\)/,
  /await sendFinalBookingConfirmation\(target\.from, confirmationDetails, \{ deliveryMode: "direct", immediateReaction: true \}\)/,
  /sendFinalBookingConfirmation\(verified\.groupId, confirmationDetails, \{ deliveryMode: "direct" \}\)/,
  /sendFinalBookingConfirmation\(candidate\.group_id, confirmationDetails, \{ deliveryMode: "direct" \}\)/,
]) {
  assert.match(source, caller, `automatic confirmation caller must use direct mode: ${caller}`);
}
assert.match(source, /await sendFinalBookingConfirmation\(target\.from, confirmationDetails/, "the live 👍 caller must wait for the confirmation send");

console.log("confirmation direct-first/fallback-only guardrails verified");
