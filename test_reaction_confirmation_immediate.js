const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("./server.js", "utf8");
const reactionStart = source.indexOf("async function handleMessageReaction(");
const reactionEnd = source.indexOf("async function reconcileStoredThumbReaction(", reactionStart);
const confirmationStart = source.indexOf("async function sendFinalBookingConfirmation(");
const confirmationEnd = source.indexOf("async function retryFailedBookingConfirmations", confirmationStart);
assert.ok(reactionStart >= 0 && reactionEnd > reactionStart, "reaction handler must exist");
assert.ok(confirmationStart >= 0 && confirmationEnd > confirmationStart, "confirmation sender must exist");

const reaction = source.slice(reactionStart, reactionEnd);
const confirmation = source.slice(confirmationStart, confirmationEnd);

assert.match(
  reaction,
  /await sendFinalBookingConfirmation\(target\.from, confirmationDetails, \{ deliveryMode: "direct", immediateReaction: true \}\)/,
  "the live 👍 path must await the direct confirmation send",
);
assert.doesNotMatch(
  reaction,
  /void sendFinalBookingConfirmation\(target\.from, confirmationDetails/,
  "the live 👍 path must not detach the confirmation send",
);
assert.match(
  confirmation,
  /const immediateReaction = options\.immediateReaction === true/,
  "the sender must recognize the immediate reaction path",
);
assert.match(
  confirmation,
  /!immediateReaction && deliveryAgeMs < CONFIRMATION_RETRY_BACKOFF_MS/,
  "a live 👍 may bypass only the retry backoff, not the sent/idempotency guard",
);

console.log("live 👍 confirmation is awaited and sent directly without retry-backoff delay");
