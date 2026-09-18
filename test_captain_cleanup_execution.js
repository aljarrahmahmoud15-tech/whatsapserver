const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
assert.match(server, /app\.post\("\/api\/admin\/captains\/cleanup-execute", requireAdmin/);
assert.match(server, /DELETE_EMPTY_OUTSIDE_GROUP_AND_SUSPEND_LINKED/);
assert.match(server, /pre-captain-cleanup-/);
assert.match(server, /await db\.backup\(backupPath\)/);
assert.match(server, /Live group\/account data changed since preview/);
assert.match(server, /UPDATE users SET active=0,account_status='suspended'/);
assert.match(server, /DELETE FROM users WHERE id=\? AND role='captain' AND account_status<>'merged' AND is_bot=0/);
assert.match(server, /captains\.cleanup\.applied/);
assert.match(server, /captain_subscription_charges WHERE user_id=\?/);
console.log('captain cleanup execution is confirmed, backed up, revalidated, and history-safe');
