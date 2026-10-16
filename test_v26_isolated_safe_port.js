const assert = require('node:assert/strict');
const fs = require('node:fs');

const v26 = fs.readFileSync('public/admin-v26.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(v26, /<title>تاج · عمليات V26<\/title>/);
assert.match(v26, /id="archivedCaptainsButton"/);
assert.match(v26, /\/api\/admin\/captains\/archived/);
assert.match(v26, /RESTORE_ARCHIVED_CAPTAIN/);
assert.match(v26, /state\.status\?\.groupId/);
assert.match(v26, /const OFFICIAL_GROUP_ID\s*=\s*'';/);
assert.match(v26, /TAJ|تاج/);
assert.doesNotMatch(v26, /meta[-_ ]*bot|server.?2|whatsapp.?clean/i);
assert.match(v26, /\/api\/admin\/settings/);
assert.doesNotMatch(v26, /test-group@g\.us/);
assert.doesNotMatch(v26, /chat\.whatsapp\.com\/[A-Za-z0-9]/i);
assert.match(server, /app\.get\("\/api\/admin\/captains\/archived", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/restore", requireAdmin/);

console.log('latest V26 UI adapted to Taj isolation guardrails');
