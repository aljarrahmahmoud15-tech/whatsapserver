const assert = require('node:assert/strict');
const fs = require('node:fs');

const v26 = fs.readFileSync('public/admin-v26.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(v26, /<title>الشيخ للتوصيل · لوحة الإدارة V26<\/title>/);
assert.match(v26, /id="archivedCaptainsButton"/);
assert.match(v26, /\/api\/admin\/captains\/archived/);
assert.match(v26, /RESTORE_ARCHIVED_CAPTAIN/);
assert.match(v26, /state\.status\?\.groupId/);
assert.match(v26, /let OFFICIAL_GROUP_ID='';/);
assert.doesNotMatch(v26, /WASLNI NOW|وصلني الآن|الجراح|meta[-_ ]*bot|server.?2|whatsapp.?clean/i);
assert.doesNotMatch(v26, /\/api\/admin\/settings(?:\/|['"])/);
assert.doesNotMatch(v26, /120363426604560611@g\.us/);
assert.doesNotMatch(v26, /chat\.whatsapp\.com\/[A-Za-z0-9]/i);
assert.match(server, /app\.get\("\/api\/admin\/captains\/archived", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/restore", requireAdmin/);

console.log('latest V26 UI adapted to Sheikh Delivery isolation guardrails');
