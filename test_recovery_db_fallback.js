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
assert.match(server, /messages = buildStoredRecoveryMessagesByIds\(groupId, sourceMessageId, acceptanceMessageId\);[\s\S]*if \(messages\.length < 2\) messages = await fetchExactGroupEvidenceMessages\(groupId, sourceMessageId, acceptanceMessageId\);/);
assert.match(server, /const authorizedThumb = botProducer \? true : Boolean\(reactionPresentOnAcceptance\)/);
assert.match(server, /if \(!groupId \|\| !isConfiguredGroup\(groupId\)\) return res\.status\(409\)\.json\(\{ error: "No configured production group" \}\)/);
assert.match(server, /res\.json\(\{ success: true, groupId, hours, scanned: messages\.length, acceptanceMessages: acceptanceMessages\.length, matches, filters: expected, source: historySource, mutation: "none" \}\)/);

console.log('recovery DB fallback and bot-owned preview guardrails passed');
