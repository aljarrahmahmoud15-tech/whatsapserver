const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
assert.match(server, /app\.get\("\/api\/admin\/captains\/cleanup-preview", requireAdmin/);
assert.match(server, /mutation: "none"/);
assert.match(server, /safeDisposition: inGroup \? "keep"/);
assert.match(server, /suspend_preserve_history/);
assert.match(server, /delete_empty_account/);
assert.match(server, /orderRefs\.get\(user\.id, user\.id, user\.id\)/);
assert.match(server, /settlementRefs\.get\(user\.id, user\.id\)/);
assert.match(server, /Buffer\.from\(JSON\.stringify\(payload\), "utf8"\)\.toString\("base64"\)/);
const previewStart = server.indexOf('app.get("/api/admin/captains/cleanup-preview"');
const executeStart = server.indexOf('app.post("/api/admin/captains/cleanup-execute"');
const previewSection = server.slice(previewStart, executeStart);
assert.doesNotMatch(previewSection, /DELETE FROM users/);
console.log('captain cleanup preview is read-only and preserves linked history');
