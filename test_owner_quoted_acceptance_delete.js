const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("./server.js", "utf8");
const start = server.indexOf("async function handleIncomingMessage(");
const end = server.indexOf("function reactionId(", start);
assert.ok(start >= 0 && end > start, "message handler must exist");
const handler = server.slice(start, end);

assert.match(handler, /body === "هذه"/, "owner reply command is exact");
assert.match(handler, /isGroupSetupOwner\(senderPhone\)/, "only the configured owner may trigger deletion");
assert.match(handler, /const quotedMessageId = serializedMessageId\(quotedForRecovery\)/, "deletion uses the quoted message id");
assert.match(handler, /!quotedForRecovery\?\.fromMe && isCaptainAcceptance\(quotedBody\)/, "only an incoming captain acceptance is eligible");
assert.match(handler, /deleteWhatsAppMessageForEveryone\(quotedMessageId, \{/, "the quoted message is deleted through the guarded helper");
assert.match(handler, /financialMutation: false/, "the automatic deletion cannot mutate finances");
assert.match(handler, /owner_requested_quoted_acceptance_skipped/, "ambiguous or invalid quotes are skipped");

console.log("owner quoted acceptance deletion guardrails verified");
