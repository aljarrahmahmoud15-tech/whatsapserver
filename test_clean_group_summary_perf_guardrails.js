const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

// Returns the source of one route: from its declaration up to the next route declaration.
function routeSource(marker) {
  const start = server.indexOf(marker);
  assert.ok(start >= 0, `route not found: ${marker}`);
  const rest = server.slice(start + marker.length);
  const next = rest.search(/\napp\.(get|post|put|patch|delete)\(/);
  return server.slice(start, next >= 0 ? start + marker.length + next : server.length);
}

// --- group snapshot resilience -------------------------------------------------
// The dashboard must never wait ~30s and then fail: a fast public-API read runs first,
// the legacy in-page snapshot is time-boxed, and a database fallback always answers.
assert.match(server, /async function readGroupParticipantsQuick\(groupId, timeoutMs = 8000\)/);
assert.match(server, /participantSource: "whatsapp-web-js"/);
assert.match(server, /async function readGroupSnapshot\(groupId, timeoutMs = 30000\)/);
assert.match(server, /Math\.max\(2000, Number\(timeoutMs\) \|\| 30000\)/);
assert.match(server, /function readStoredGroupSummary\(groupId\)/);
assert.match(server, /registeredCaptains/);
assert.match(server, /await readGroupParticipantsQuick\(groupId, 2500\)/);
assert.match(server, /await readGroupSnapshot\(groupId, 2000\)/);

// The stored fallback must be explicitly labelled and must never be presented as live.
assert.match(server, /participantSource: "stored"/);
assert.match(server, /live: false/);
assert.match(server, /liveReadError:/);

// The route must not fail with 502/503 any more.
const summaryRoute = routeSource('app.get("/api/admin/group/summary"');
assert.doesNotMatch(summaryRoute, /status\(502\)/);
assert.doesNotMatch(summaryRoute, /status\(503\)/);
assert.doesNotMatch(summaryRoute, /participant snapshot unavailable/);
assert.match(summaryRoute, /success: true/);
assert.match(summaryRoute, /groupName: stored\.groupName/);

// --- large response performance -------------------------------------------------
// Bulk equivalent-order resolution replaces the per-row LIKE lookup (N+1) and the
// per-row settlement query inside /api/admin/unconfirmed-bookings.
const bookingsRoute = routeSource('app.get("/api/admin/unconfirmed-bookings"');
assert.doesNotMatch(bookingsRoute, /findEquivalentOrder\(row\.group_id/);
assert.doesNotMatch(bookingsRoute, /SELECT status FROM order_settlements WHERE order_id=\? ORDER BY id DESC LIMIT 1/);
assert.match(bookingsRoute, /equivalentOrdersByCore/);
assert.match(bookingsRoute, /latestSettlementStatusByOrder/);
assert.match(bookingsRoute, /ORDER BY c\.updated_at DESC,c\.id DESC LIMIT \? OFFSET \?/);

// Optional, backwards-compatible pagination on the heaviest read endpoints.
assert.match(server, /const orderLimit = Number\.isInteger\(requestedOrderLimit\) \? Math\.max\(1, Math\.min\(requestedOrderLimit, 1000\)\) : 200;/);
assert.match(server, /ORDER BY o\.id DESC LIMIT \? OFFSET \?`\)\.all\(orderLimit, orderOffset\)/);
assert.match(server, /const captainLimit = Number\.isInteger\(requestedCaptainLimit\)/);
assert.match(server, /ORDER BY u\.active DESC,u\.id DESC\$\{captainLimit \? " LIMIT \? OFFSET \?" : ""\}/);
assert.match(server, /const inviteLimit = Number\.isInteger\(requestedInviteLimit\)/);
assert.match(server, /FROM captain_invites ORDER BY id DESC LIMIT \? OFFSET \?/);

// Supporting indexes for the heavy aggregates (additive and idempotent).
for (const indexName of [
  'idx_order_settlements_captain_status',
  'idx_order_settlements_producer_status',
  'idx_order_settlements_order_desc',
  'idx_orders_group_status_updated',
  'idx_order_candidates_group_status_updated',
  'idx_messages_group_id_desc',
  'idx_subscription_charges_user_period',
  'idx_users_role_active_id',
]) {
  assert.match(server, new RegExp(`CREATE INDEX IF NOT EXISTS ${indexName}`));
}

// --- isolation ------------------------------------------------------------------
// The new group-summary and bookings code must stay identity-free: no phone number,
// no group id and no invite link may be hardcoded into these paths.
const addedCode = [
  summaryRoute,
  bookingsRoute,
  routeSource('async function readGroupParticipantsQuick'),
  routeSource('function readStoredGroupSummary'),
].join('\n');
assert.doesNotMatch(addedCode, /\b962\d{9}\b/);
assert.doesNotMatch(addedCode, /\b07\d{8}\b/);
assert.doesNotMatch(addedCode, /\d{15,}@g\.us/);
assert.doesNotMatch(addedCode, /chat\.whatsapp\.com\//);

console.log('clean group summary + performance guardrails: OK');
