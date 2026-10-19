const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("./server.js", "utf8");

const reopenedLookupStart = source.indexOf("function findReopenedCandidateByMessage(groupId, messageId) {");
const reopenedLookupEnd = source.indexOf("function findUnquotedAcceptanceCandidate(", reopenedLookupStart);
assert.ok(reopenedLookupStart >= 0 && reopenedLookupEnd > reopenedLookupStart, "reopened-notice candidate lookup exists");
const reopenedLookup = source.slice(reopenedLookupStart, reopenedLookupEnd);
assert.match(reopenedLookup, /event LIKE 'order\.acceptance\.reopened\.%'/, "lookup is restricted to reopen notifications");
assert.match(reopenedLookup, /ORDER-REOPEN-INSUFFICIENT-BALANCE-\(\\d\+\)/, "candidate id is recovered from the idempotency key");
assert.match(reopenedLookup, /status='candidate' AND pending_message_id IS NULL AND final_order_id IS NULL/, "only an active, unaccepted candidate can be reopened");

const unquotedStart = source.indexOf("function findUnquotedAcceptanceCandidate(");
const unquotedEnd = source.indexOf("function findUnquotedOrderMessage(", unquotedStart);
const unquoted = source.slice(unquotedStart, unquotedEnd);
assert.match(unquoted, /CASE WHEN c\.lifecycle_stage='candidate_reopened' THEN c\.updated_at ELSE c\.created_at END/, "reopened candidates use their reopen time for matching");

const recoveryStart = source.indexOf("async function recoverPendingAcceptanceMessages(groupId) {");
const recoveryEnd = source.indexOf("function startBackgroundOrderRecovery(groupId) {", recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "acceptance-recovery function exists");
const recovery = source.slice(recoveryStart, recoveryEnd);
assert.match(recovery, /findReopenedCandidateByMessage\(groupId, sourceId\)/, "historical scan resolves quoted reopen notices");
assert.match(recovery, /if \(!matchingPendingSourceId && !reopenedCandidate\) continue;/, "reopen notice can pass the source-order quote filter");
assert.match(recovery, /handleIncomingMessage\(acceptance, \{ allowSelf: true \}\)/, "recovered quote is replayed through the normal acceptance handler");

const handlerStart = source.indexOf("async function handleIncomingMessage(msg, { allowSelf = false } = {}) {");
assert.ok(handlerStart >= 0, "incoming-message handler exists");
const handler = source.slice(handlerStart, handlerStart + 18000);
assert.match(handler, /findReopenedCandidateByMessage\(groupId, serializedMessageId\(quoted\)\)/, "live acceptance resolves a quoted reopen notice");

console.log("reopened-order acceptance lookup and recovery guardrails verified");
