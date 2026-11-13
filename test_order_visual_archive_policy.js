const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');
const styles = fs.readFileSync('public/captain-designs.css', 'utf8');
const serviceWorker = fs.readFileSync('public/captain-sw.js', 'utf8');

assert.match(server, /const ORDER_DELETION_DISABLED = true/);
assert.match(server, /const CAPTAIN_ORDER_VISIBILITY_CUTOFF_SETTING = "captain_order_visibility_cutoff_at_v1"/);
assert.match(server, /code: "ORDER_DELETION_DISABLED"/);
assert.match(server, /async function initializeCaptainOrderVisibilityCutoffOnce\(\)/);
assert.match(server, /pre-captain-order-visibility-cutoff-/);
assert.match(server, /captain\.order_visibility_cutoff\.initialized/);
assert.match(server, /financialMutation: false/);
assert.match(server, /orderStateMutation: false/);
assert.match(server, /datetime\(o\.created_at\)>=datetime\(\?\)/);
assert.match(server, /FROM orders WHERE status='open' AND pending_captain_user_id=\?/);
assert.match(server, /FROM order_candidates WHERE status='pending' AND pending_captain_user_id=\?/);
assert.match(server, /activeOrders,/);
const tripQuery = server.match(/const tripRows = captainVisibilityCutoff \? db\.prepare\(`([\s\S]*?)`\)\.all/);
assert.ok(tripQuery, 'captain trip query exists');
assert.match(tripQuery[1], /o\.status IN \('accepted','completed'\)/);
assert.match(tripQuery[1], /s\.status='applied' OR o\.settlement_state='settled'/);
assert.doesNotMatch(tripQuery[1], /o\.status='open'/, 'open orders must not appear as settled trips');
assert.doesNotMatch(server, /archivedTrips/);
assert.match(server, /ORDER_DELETION_DISABLED\s*\)\s*\{/);
assert.doesNotMatch(captain, /captain-compact-home/);
assert.doesNotMatch(captain, /captain-archive-panel|archived-trips|data\.archivedTrips/);
assert.match(captain, /id="captain-new-orders" class="panel"/);
assert.match(captain, /الطلبات المكتملة الأقدم مؤرشفة ولا تُحذف/);
assert.match(captain, /id="captain-active-orders-panel"/);
assert.match(captain, /id="captain-design-gallery"/);
assert.match(captain, /api\('\/api\/captain\/ui-design'/);
assert.match(captain, /معرض التصاميم القديمة/);
assert.match(server, /app\.put\("\/api\/captain\/ui-design", requireCaptain, adminMutationLimiter/);
assert.match(server, /CAPTAIN_UI_DESIGN_IDS\.has\(design\)/);
assert.match(server, /captain\.ui_design\.updated/);
assert.match(server, /walletMutation: false, orderStateMutation: false/);
for (const design of ['classic', 'taj', 'red-white', 'rahlati', 'compact']) {
  assert.match(captain, new RegExp(`data-activate-captain-design="${design}"`));
  assert.match(styles, new RegExp(`data-design-preview="${design}"`));
  assert.ok(server.includes(`"${design}"`), `server allowlist includes ${design}`);
}
assert.match(serviceWorker, /captain-designs\.css\?v=1/);
const cutoffInitializer = server.match(/async function initializeCaptainOrderVisibilityCutoffOnce\(\) \{([\s\S]*?)\n\}/);
assert.ok(cutoffInitializer, 'one-time captain visibility cutoff initializer exists');
assert.doesNotMatch(cutoffInitializer[1], /UPDATE\s+(?:orders|order_candidates)/, 'cutoff must not mutate order rows');

console.log('order visual archive policy checks passed');
