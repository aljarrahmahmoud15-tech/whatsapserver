const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const cleanupStart = server.indexOf('app.get("/api/admin/captains/cleanup-preview"');
const cleanupEnd = server.indexOf('app.get("/api/admin/group/live-messages"', cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'cleanup preview and execution routes exist');
const cleanup = server.slice(cleanupStart, cleanupEnd);
assert.match(cleanup, /\(!inGroup \|\| CLEAN_INSTANCE\)/, 'Clean cleanup can process auto-imported accounts still in the group');
assert.match(cleanup, /cleanInstance: CLEAN_INSTANCE/, 'preview declares Clean-specific scope');
assert.match(cleanup, /if \(!CLEAN_INSTANCE\) void notifyOperations/, 'Clean cleanup never sends an owner message');
assert.match(cleanup, /await db\.backup\(backupPath\)/, 'cleanup takes a database backup before mutation');
assert.match(cleanup, /suspend_preserve_history|account_status='suspended'/, 'linked history is preserved by suspension');

const groupImportStart = server.indexOf('app.post("/api/admin/group/register-members"');
const groupImportEnd = server.indexOf('app.post("/api/admin/captains"', groupImportStart);
assert.ok(groupImportStart >= 0 && groupImportEnd > groupImportStart, 'group-import route exists');
assert.match(server.slice(groupImportStart, groupImportEnd), /if \(CLEAN_INSTANCE\) return res\.status\(409\)/, 'Clean refuses direct group-member import');

const directCaptainStart = server.indexOf('app.post("/api/admin/captains",');
const directCaptainEnd = server.indexOf('\n', directCaptainStart);
assert.ok(directCaptainStart >= 0 && directCaptainEnd > directCaptainStart, 'direct captain creation route exists');
assert.match(server.slice(directCaptainStart, directCaptainStart + 300), /if \(CLEAN_INSTANCE\) return res\.status\(409\)/, 'Clean only allows captain creation through invitation approval');

console.log('Clean reset, invitation-only registration, backup, and no-message guardrails verified');
