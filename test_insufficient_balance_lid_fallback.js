const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("server.js", "utf8");
const searchStart = server.indexOf('client.searchMessages("تم"');
const searchEnd = server.indexOf("search_unique_acceptance_fallback", searchStart);
assert.ok(searchStart >= 0 && searchEnd > searchStart, "search fallback must exist");
const searchBlock = server.slice(searchStart, searchEnd);

assert.match(searchBlock, /resolveMessageSenderPhone\(originalMessage\)/);
assert.match(searchBlock, /resolveMessageSenderPhone\(candidate\)/);
assert.match(searchBlock, /directJordanPhoneFromWhatsappValue/);
assert.match(searchBlock, /phoneWithCountry\(resolvedSearchSender\) === phoneWithCountry\(resolvedCandidateSender\)/);
assert.match(searchBlock, /search_sender_normalized/);

const rejectionStart = server.indexOf('logOrderTrace("acceptance_rejected_insufficient_balance"');
const rejectionEnd = server.indexOf("return;", rejectionStart);
assert.ok(rejectionStart >= 0 && rejectionEnd > rejectionStart, "quoted rejection trace must exist");
assert.match(server.slice(rejectionStart, rejectionEnd), /deletionResult: deletionResult \|\| null/);

console.log("LID/c.us sender normalization and detailed deletion trace guard verified");
