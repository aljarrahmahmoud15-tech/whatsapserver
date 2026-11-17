"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const server = fs.readFileSync("server.js", "utf8");

assert.match(server, /const WHATSAPP_GROUP_CHAT_DELETION_DISABLED = true/);
assert.match(server, /const LOW_BALANCE_ACCEPTANCE_DELETE_PERMIT = Symbol\(/);
assert.match(server, /\[LOW_BALANCE_ACCEPTANCE_DELETE_PERMIT\]: true/);
assert.match(server, /policyAction: "low_balance_acceptance"/);

const permitStart = server.indexOf("function lowBalanceAcceptanceDeletePermitValid(context, groupId)");
const permitEnd = server.indexOf("\nasync function deleteWhatsAppMessageForEveryone", permitStart);
assert.ok(permitStart >= 0 && permitEnd > permitStart, "low-balance permit validator exists");
const permitSource = server.slice(permitStart, permitEnd);
const permitSymbol = Symbol("test_low_balance_permit");
const sandbox = {
  LOW_BALANCE_ACCEPTANCE_DELETE_PERMIT: permitSymbol,
  configuredRuntimeGroupId: () => "official-test@g.us",
  isConfiguredGroup: (groupId) => groupId === "official-test@g.us",
};
vm.runInNewContext(`${permitSource}\nthis.validatePermit = lowBalanceAcceptanceDeletePermitValid;`, sandbox);
const valid = {
  [permitSymbol]: true,
  policyAction: "low_balance_acceptance",
  reason: "insufficient_balance_acceptance",
  candidateId: 71,
  captainId: 9,
  balanceCents: 100,
  requiredCents: 160,
};
assert.equal(sandbox.validatePermit(valid, "official-test@g.us"), true);
assert.equal(sandbox.validatePermit({ ...valid, [permitSymbol]: false }, "official-test@g.us"), false);
assert.equal(sandbox.validatePermit({ ...valid, reason: "unapproved_general_message" }, "official-test@g.us"), false);
assert.equal(sandbox.validatePermit({ ...valid, candidateId: 0 }, "official-test@g.us"), false);
assert.equal(sandbox.validatePermit({ ...valid, captainId: 0 }, "official-test@g.us"), false);
assert.equal(sandbox.validatePermit({ ...valid, balanceCents: 160 }, "official-test@g.us"), false);
assert.equal(sandbox.validatePermit({ ...valid, requiredCents: 100 }, "official-test@g.us"), false);
assert.equal(sandbox.validatePermit(valid, "other-group@g.us"), false);

const deletionStart = server.indexOf("async function deleteWhatsAppMessageForEveryone(messageId, context = {})");
const policyCheck = server.indexOf("if (!lowBalanceAcceptanceDeletePermitValid(context, deletionContext.groupId))", deletionStart);
const firstLookup = server.indexOf("const persistedReceipt = getPersistedWhatsAppMessageReceipt(messageId)", deletionStart);
assert.ok(deletionStart >= 0 && policyCheck > deletionStart && firstLookup > policyCheck,
  "central policy check must run before message lookup or deletion");
const deletionRoute = server.slice(deletionStart, firstLookup);
assert.match(deletionRoute, /requested: false/);
assert.match(deletionRoute, /owner_policy_low_balance_acceptance_only/);
assert.match(deletionRoute, /whatsapp\.message_deletion\.blocked_by_low_balance_only_policy/);

const groupDeleteRoute = server.indexOf('app.get("/api/admin/group/delete-unapproved"');
const groupDeleteGuard = server.indexOf("if (WHATSAPP_GROUP_CHAT_DELETION_DISABLED)", groupDeleteRoute);
const chatDelete = server.indexOf("chat.delete()", groupDeleteRoute);
assert.ok(groupDeleteRoute >= 0 && groupDeleteGuard > groupDeleteRoute && chatDelete > groupDeleteGuard,
  "group chat delete route must be rejected before chat.delete");

const resetRoute = server.indexOf('app.post("/api/admin/group/reset-recreate"');
const resetGuard = server.indexOf("if (WHATSAPP_GROUP_CHAT_DELETION_DISABLED)", resetRoute);
assert.ok(resetRoute >= 0 && resetGuard > resetRoute, "group reset route must be disabled");
const resetRouteEnd = server.indexOf('app.post("/api/admin/group/finalize-created"', resetRoute);
const resetHandler = server.slice(resetRoute, resetRouteEnd);
assert.match(server, /const GROUP_RESET_CONFIRMATION = "RESET_GROUP_AND_PURGE_ALL_HISTORY"/);
assert.match(resetHandler, /requireOwnerAdmin/);
assert.match(resetHandler, /req\.body\?\.confirmation !== GROUP_RESET_CONFIRMATION/);
const mainHtml = fs.readFileSync("public/index.html", "utf8");
assert.doesNotMatch(mainHtml, /get\('reset'\)==='execute'/, "a URL must never trigger a destructive group reset");
assert.doesNotMatch(mainHtml, /api\('\/api\/admin\/group\/reset-recreate'/, "the main page must not invoke the bulk-purge reset route");
assert.doesNotMatch(mainHtml, /ops-reset-group/, "the destructive reset control must not appear on the main page");
assert.match(mainHtml, /resendCaptainPhone&&window\.confirm/);
assert.match(mainHtml, /relinkRequested&&params\.get\('invite'\)[\s\S]*?window\.confirm/);
assert.match(mainHtml, /registrationRequested[\s\S]*?window\.confirm/);
assert.match(mainHtml, /sendGuides[\s\S]*?window\.confirm/);
assert.match(server, /function purgeExperimentalCaptains\(\) \{\s*if \(WHATSAPP_GROUP_CHAT_DELETION_DISABLED\)/);
assert.doesNotMatch(server, /previous\.delete\(true\)/,
  "re-sending a captain access card must not delete prior private chat messages");
assert.match(server, /previousCardDeletionSuppressed: previousCardDeletionRequested/);

console.log("WhatsApp deletion allowlist: only verified low-balance captain acceptance on the configured group can be deleted");
