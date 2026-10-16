const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /app\.get\("\/api\/admin\/captains\/archived", requireAdmin/);
const archivedStart = server.indexOf('app.get("/api/admin/captains/archived"');
const archivedEnd = server.indexOf('app.post("/api/admin/group/sync-captains"', archivedStart);
assert.ok(archivedStart >= 0 && archivedEnd > archivedStart, 'archived route boundaries must exist');
const archivedRoute = server.slice(archivedStart, archivedEnd);
assert.match(archivedRoute, /u\.archived_at IS NOT NULL/);
assert.match(archivedRoute, /archived: true/);
assert.match(archivedRoute, /Cache-Control/);
assert.doesNotMatch(archivedRoute, /sendMessage|sendCaptainAppLink|addCaptainToConfiguredGroup|https?:\/\//i);

assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/restore", requireAdmin/);
const restoreStart = server.indexOf('app.post("/api/admin/captains/:id/restore"');
const restoreEnd = server.indexOf('app.get("/api/admin/captains/:id/merge-preview"', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'restore route boundaries must exist');
const restoreRoute = server.slice(restoreStart, restoreEnd);
assert.match(restoreRoute, /RESTORE_ARCHIVED_CAPTAIN/);
assert.match(restoreRoute, /archived_at=NULL/);
assert.match(restoreRoute, /account_status='active'/);
assert.match(restoreRoute, /financialMutation: false/);
assert.match(restoreRoute, /settlementMutation: false/);
assert.match(restoreRoute, /groupMembershipChanged: false/);
assert.match(restoreRoute, /whatsappMessageSent: false/);
assert.doesNotMatch(restoreRoute, /wallet_cents\s*=|INSERT INTO wallet_ledger|UPDATE wallet_ledger|sendMessage|sendCaptainAppLink|addCaptainToConfiguredGroup|https?:\/\//i);
assert.doesNotMatch(`${archivedRoute}\n${restoreRoute}`, /external-service|legacy-bot|unapproved-channel/i);

console.log('official route-only port guardrails verified');
