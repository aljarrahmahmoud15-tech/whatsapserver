const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");

assert.match(source, /CREATE TABLE IF NOT EXISTS whatsapp_group_discovery_candidates/);
assert.match(source, /status TEXT NOT NULL DEFAULT 'pending'/);
assert.match(source, /const GROUP_DISCOVERY_COMMAND = "#SERVER2-GROUP-ID"/);
assert.ok(source.includes('if (!/^\\d+@g\\.us$/i.test(groupId))'), "group id must be validated as a WhatsApp group");
assert.ok(source.includes('if (WHATSAPP_GROUP_ID && groupId === WHATSAPP_GROUP_ID) return { status: "ignored", reason: "official_group" }'), "official group must not become a candidate");
assert.match(source, /saveGroupDiscoveryCandidate\.run\(groupId, groupName, discoveredBy, messageId, timestamp, timestamp\)/);
assert.match(source, /activation: "none"/);
assert.match(source, /financialMutation: false/);
assert.match(source, /void captureGroupDiscoveryCandidate\(msg\)/);

const handlerStart = source.indexOf('instance.on("message", async (msg) =>');
const handlerEnd = source.indexOf('instance.on("message_reaction"', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "message handler must exist");
const handler = source.slice(handlerStart, handlerEnd);
assert.ok(handler.indexOf("captureGroupDiscoveryCandidate(msg)") < handler.indexOf("handleIncomingMessage"), "discovery must run before normal message handling");

console.log("group discovery candidate guardrails passed");
