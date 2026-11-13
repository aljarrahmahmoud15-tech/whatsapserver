const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');

assert.match(server, /const ORDER_DELETION_DISABLED = true/);
assert.match(server, /const CAPTAIN_ORDER_VIEW_RESET_SETTING = "captain_order_view_reset_at_v1"/);
assert.match(server, /code: "ORDER_DELETION_DISABLED"/);
assert.match(server, /async function archiveExistingCaptainOrdersOnce\(\)/);
assert.match(server, /pre-captain-order-view-reset-/);
assert.match(server, /captain\.order_view\.reset/);
assert.match(server, /financialMutation: false/);
assert.match(server, /deletion: false/);
assert.match(server, /COALESCE\(o\.archive_state,'active'\)<>'archived'/);
assert.doesNotMatch(server, /archivedTrips/);
assert.match(server, /ORDER_DELETION_DISABLED\s*\)\s*\{/);
assert.doesNotMatch(captain, /captain-compact-home/);
assert.doesNotMatch(captain, /captain-archive-panel|archived-trips|data\.archivedTrips/);
assert.match(captain, /id="captain-tools"|class="captain-tools panel"/);

console.log('order visual archive policy checks passed');
