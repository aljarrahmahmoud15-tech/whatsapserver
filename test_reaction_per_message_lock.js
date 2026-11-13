const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /const reactionMessageLocks = new Map\(\)/);
assert.match(source, /const reactionRetrySchedules = new Map\(\)/);
assert.match(source, /REACTION_MESSAGE_LOCK_TTL_MS/);
assert.match(source, /REACTION_MESSAGE_LOCK_MAX/);
assert.match(source, /function pruneReactionMessageState\(/);
assert.match(source, /async function withReactionMessageLock\(messageId, kind, task\)/);
assert.match(source, /return withReactionMessageLock\(messageId, "reaction", \(\) => handleMessageReactionUnlocked\(reaction\)\)/);
assert.match(source, /return withReactionMessageLock\(messageId, "reconcile", \(\) => reconcileStoredThumbReactionUnlocked\(messageId\)\)/);
assert.match(source, /function scheduleReactionRetry\(reaction, delays = \[1500, 5000\]\)/);
assert.match(source, /scheduleReactionRetry\(reaction, \[1500, 5000\]\)/);

const retryBlock = source.slice(source.indexOf('function scheduleReactionRetry'), source.indexOf('function shouldHandleMessageEvent'));
assert.match(retryBlock, /if \(reactionRetrySchedules\.has\(key\)\) return/);
assert.match(retryBlock, /\.unref\?\.\(\)/);

console.log('per-message reaction lock and bounded retry scheduling guardrails verified');
