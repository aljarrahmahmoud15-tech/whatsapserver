const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("./server.js", "utf8");
const guardStart = source.indexOf("function isBotOutboundTarget");
const cardStart = source.indexOf("async function sendCompanyOperationsCard");
const notifyStart = source.indexOf("async function notifyOperations");
const guard = source.slice(guardStart, cardStart);
const card = source.slice(cardStart, notifyStart);

assert.match(guard, /whatsapp_identities WHERE whatsapp_lid=\? LIMIT 1/);
assert.match(guard, /isBotPhone\(phoneWithCountry\(mapped\.phone\)\)/);
assert.match(card, /isBotOutboundTarget\(to\)/);
assert.match(card, /blocked: "bot_identity"/);
assert.match(source, /notification\.\$\{event\}\.suppressed/);
assert.match(source, /reason: "bot_identity"/);

console.log("branded cards are guarded for direct bot recipients and stale/inactive bot LIDs");
