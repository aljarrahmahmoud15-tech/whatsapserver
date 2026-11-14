const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
assert.match(source, /async function fetchInternalReactionRows\(messageId\)/);
assert.match(source, /WAWebCollections/);
assert.match(source, /collections\.Reactions\.find\(candidateId\)/);
assert.match(source, /const fullId = String\(targetId \|\| ""\)/);
assert.match(source, /const rawId = parts\.slice\(2\)\.join\("_"\)/);
assert.match(source, /const coreId = parts\[2\] \|\| ""/);
assert.match(source, /const participantId = parts\[parts\.length - 1\] \|\| ""/);
assert.match(source, /const messageIds = \[\.\.\.new Set\(\[fullId, rawId, coreId, participantId\]/);
assert.match(source, /function messageIdLookupVariants\(value\)/);
assert.match(source, /async function getWhatsAppMessageByIdVariants\(value, timeoutMs = 6000\)/);
assert.match(source, /getWhatsAppMessageByIdVariants\(messageId, 5000\)/);
assert.match(source, /reaction\.emoji \|\| reaction\?\._data\?\.emoji/);
assert.match(source, /if \(Array\.isArray\(value\)\) return value/);
assert.match(source, /if \(Array\.isArray\(value\.models\)\) return value\.models/);
assert.match(source, /collections\.Msg\?\.getMessagesById/);
assert.match(source, /const internalReactions =/);
assert.match(source, /internalReactions\.length && !archivedHasSenders/);
const reconcileStart = source.indexOf('async function reconcileStoredThumbReaction(');
const reconcileEnd = source.indexOf('function parseCookies(', reconcileStart);
assert.ok(reconcileStart >= 0 && reconcileEnd > reconcileStart, 'reconcile function must be present');
const reconcileSource = source.slice(reconcileStart, reconcileEnd);
assert.match(reconcileSource, /let reactions = typeof target\.getReactions === "function"/);
assert.match(reconcileSource, /const internalReactions = await fetchInternalReactionRows\(normalizedMessageId\)/);
assert.match(reconcileSource, /reactions = internalReactions/);
assert.match(source, /function buildStoredAcceptanceMessageById\(messageId\)/);
// Reconciliation must read the live message first and fall back to stored evidence
// only when WhatsApp cannot answer, so a real thumb removal is never masked.
assert.match(source, /async function resolveReconcileReactionTarget\(messageId\) \{\n\s*const fetched = await getWhatsAppMessageByIdVariants\(messageId, 5000\);\n\s*if \(fetched\) return \{ target: fetched, source: "live_message_fetch" \};\n\s*const stored = await resolveStoredReactionTarget\(messageId\);/);
assert.match(source, /const resolvedReconcileTarget = await resolveReconcileReactionTarget\(normalizedMessageId\);/);
assert.doesNotMatch(reconcileSource, /const target = await getWhatsAppMessageByIdVariants\(normalizedMessageId, 5000\) \|\| buildStoredAcceptanceMessageById\(normalizedMessageId\);/);
assert.match(reconcileSource, /reaction_scan_target_unresolved/);
assert.match(reconcileSource, /Array\.isArray\(target\.__reactions\) \? target\.__reactions : \[\]/);
console.log('internal reaction rows guard: ok');
