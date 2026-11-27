const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

assert.match(server, /function buildStoredRecoveryMessages\(groupId, hours = 168, limit = 1000\)/);
assert.match(server, /FROM order_candidates c[\s\S]*JOIN order_candidate_acceptances a ON a\.candidate_id = c\.id/);
assert.match(server, /WHERE c\.group_id = \?[\s\S]*c\.status = 'pending'[\s\S]*a\.status IN \('pending','selected'\)/);
assert.match(server, /LEFT JOIN messages sm ON sm\.message_id = c\.source_message_id AND sm\.group_id = c\.group_id/);
assert.match(server, /LEFT JOIN messages am ON am\.message_id = a\.acceptance_message_id AND am\.group_id = c\.group_id/);
assert.match(server, /historySource = "database_candidates"/);
assert.match(server, /source: historySource, mutation: "none"/);
assert.match(server, /const storedRecovery = acceptance\.__storedRecovery === true/);
assert.ok(server.includes('if (!liveQuoted && !storedRecovery && client && typeof client.getMessageById === "function")'));
assert.match(server, /function buildStoredRecoveryMessagesByIds\(groupId, sourceMessageId, acceptanceMessageId\)/);
const storedStart = server.indexOf('function buildStoredRecoveryMessages(groupId, hours = 168, limit = 1000)');
const storedEnd = server.indexOf('\nfunction buildStoredRecoveryMessagesByIds', storedStart);
const storedBuilder = server.slice(storedStart, storedEnd);
assert.doesNotMatch(storedBuilder, /__quoted:\s*source|__candidateSource:\s*source/, 'database candidate associations cannot fabricate live quote evidence');
assert.match(server, /if \(storedRecovery\) return \{ match: false, reason: "stored_quote_requires_live_verification"/);

const confirmOneStart = server.indexOf('app.post("/api/admin/group/confirm-one"');
const confirmOneEnd = server.indexOf('\napp.post(', confirmOneStart + 1);
const confirmOneRoute = server.slice(confirmOneStart, confirmOneEnd);
assert.match(confirmOneRoute, /messages = await fetchExactGroupEvidenceMessages\(groupId, sourceMessageId, acceptanceMessageId\)/);
assert.doesNotMatch(confirmOneRoute, /buildStoredRecoveryMessagesByIds/, 'administrative exact confirmation must not trust a stored-only message link');
assert.match(confirmOneRoute, /live_evidence_unavailable/);
assert.match(server, /actualQuoteMessageId[\s\S]*!source \|\| !acceptance \|\| !isExactCaptainAcceptance\(acceptance\.body\)/);
assert.match(server, /reactionPhones\.some\(\(phone\) => recoveryPhoneMatches\(phone, producerPhone\)\)/);
assert.match(server, /if \(!groupId \|\| !isConfiguredGroup\(groupId\)\) return res\.status\(409\)\.json\(\{ error: "No configured production group" \}\)/);
assert.match(server, /res\.json\(\{ success: true, groupId, hours, scanned: messages\.length, acceptanceMessages: acceptanceMessages\.length, matches, filters: expected, source: historySource, mutation: "none" \}\)/);

console.log('database listing fallback stays read-only; exact confirmation requires live quote and producer reaction evidence');
