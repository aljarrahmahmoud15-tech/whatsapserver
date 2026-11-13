const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');

assert.match(server, /const ORDER_DELETION_DISABLED = true/);
assert.match(server, /const CAPTAIN_ORDER_VISIBILITY_CUTOFF_SETTING = "captain_order_visibility_cutoff_at_v1"/);
assert.match(server, /code: "ORDER_DELETION_DISABLED"/);
assert.match(server, /async function initializeCaptainOrderVisibilityCutoffOnce\(\)/);
assert.match(server, /pre-captain-order-visibility-cutoff-/);
assert.match(server, /captain\.order_visibility_cutoff\.initialized/);
assert.match(server, /financialMutation: false/);
assert.match(server, /orderStateMutation: false/);
assert.match(server, /datetime\(o\.created_at\)>=datetime\(\?\)/);
assert.doesNotMatch(server, /archivedTrips/);
assert.match(server, /ORDER_DELETION_DISABLED\s*\)\s*\{/);
assert.doesNotMatch(captain, /captain-compact-home/);
assert.doesNotMatch(captain, /captain-archive-panel|archived-trips|data\.archivedTrips/);
assert.match(captain, /id="captain-new-orders" class="panel"/);
assert.match(captain, /الطلبات الأقدم لا تظهر/);
const cutoffInitializer = server.match(/async function initializeCaptainOrderVisibilityCutoffOnce\(\) \{([\s\S]*?)\n\}/);
assert.ok(cutoffInitializer, 'one-time captain visibility cutoff initializer exists');
assert.doesNotMatch(cutoffInitializer[1], /UPDATE\s+(?:orders|order_candidates)/, 'cutoff must not mutate order rows');

console.log('order visual archive policy checks passed');
