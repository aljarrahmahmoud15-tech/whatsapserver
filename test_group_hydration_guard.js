const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /async function readGroupSnapshot\(groupId\)/, 'group snapshot resolver must exist');
assert.match(source, /window\.WWebJS\?\.getChat\)\s*chat = await window\.WWebJS\.getChat\(requestedId, \{ getAsModel: false \}\)/, 'snapshot resolver must have a WWebJS chat fallback');
assert.match(source, /WAWebGroupQueryJob/, 'snapshot resolver must refresh group metadata when available');
assert.match(source, /group_participants_empty/, 'empty participant snapshots must be diagnosed explicitly');
assert.match(source, /group_snapshot_evaluation_timeout/, 'snapshot evaluation timeouts must be diagnosed explicitly');
assert.match(source, /lastGroupHydrationDiagnostic/, 'group hydration state must be exposed to runtime diagnostics');
assert.match(source, /groupHydration: \{ \.\.\.lastGroupHydrationDiagnostic \}/, 'public/V27 status must expose group hydration state');
assert.match(source, /WHATSAPP_REACTION_SEND_TIMEOUT/, 'reaction send timeout must be distinguishable from readback failure');
assert.match(source, /reaction_send_timeout/, 'reaction send timeout must be logged distinctly');
assert.match(source, /reaction_sent_visibility_unconfirmed/, 'reaction readback failure must be logged distinctly');
console.log('group hydration and reaction diagnostic guardrails verified');
