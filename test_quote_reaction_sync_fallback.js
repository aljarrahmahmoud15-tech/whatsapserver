const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /async function getQuotedMessageWithFallback\(message\)/);
assert.match(source, /WAWebQuotedMsgModelUtils/);
assert.match(source, /getQuotedMsgObj\(model\)/);
assert.match(source, /collections\.Msg\?\.getMessagesById/);
assert.match(source, /quotedMessageId: String\(message\?\.quotedStanzaID/);
assert.match(source, /lastAcceptanceRecovery\.quoteLookupAttempts/);
assert.match(source, /lastAcceptanceRecovery\.quoteFallbackMatches/);
assert.match(source, /const quoted = await getQuotedMessageWithFallback\(acceptance\)/);
assert.match(source, /acceptance\.__quoted = quoted/);
assert.match(source, /sourceMessageIdsEqual\(pendingSourceId, sourceId\)/);
assert.match(source, /rows\.find\(\(row\) => sourceMessageIdsEqual\(row\.acceptance_message_id, acceptanceMessageId\)\)/);
assert.match(source, /findPendingAcceptanceByMessage\(groupId, row\.id\)/);

// A reaction can arrive with a decorated WhatsApp ID while the original
// acceptance row was stored with its core ID. The lookup must normalize both.
assert.match(source, /function messageIdCore\(value\)/);
assert.match(source, /function sourceMessageIdsEqual\(left, right\)/);
assert.match(source, /function configuredRuntimeGroupId\(\)/);
assert.match(source, /const groupId = configuredRuntimeGroupId\(\);/);
assert.match(source, /ORDER BY updated_at DESC LIMIT 1/);

console.log('quote/reaction synchronization fallback verified');
