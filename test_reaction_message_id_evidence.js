const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /CREATE TABLE IF NOT EXISTS reaction_evidence/);
assert.match(source, /UNIQUE\(message_id, emoji, sender_key\)/);
assert.match(source, /function reactionEvidenceMessageKey\(messageId\)/);
assert.match(source, /return messageIdCore\(normalized\) \|\| normalized/);
assert.match(source, /function recordReactionEvidence\(\{ messageId, groupId, emoji, reaction, senderPhone = "", source = "live-message-reaction" \}\)/);
assert.match(source, /function deactivateReactionEvidence\(messageId, groupId, emoji = "👍"\)/);
assert.match(source, /function storedReactionEvidence\(messageId, emoji = "👍"\)/);
assert.match(source, /recordReactionEvidence\(\{\n      messageId,\n      groupId: target\.from/);
assert.match(source, /deactivateReactionEvidence\(messageId, target\.from, "👍"\)/);
assert.match(source, /const persistedReactionRows = storedReactionEvidence\(acceptanceMessageId, "👍"\)/);
assert.match(source, /reactionEvidenceMessageId: acceptanceMessageId/);

console.log('reaction message-id evidence guardrails verified');
