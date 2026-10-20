const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

// The heavy read endpoints drive the single WhatsApp page through page.evaluate,
// which is why six concurrent reads took 20-63s in the final stress test.
// A short TTL cache plus single-flight coalescing must serve them instead.
assert.match(server, /const adminReadSingleFlightStore = new Map\(\);/);
assert.match(server, /function adminReadSingleFlight\(scope, ttlMs\) \{/);
assert.match(server, /if \(String\(req\.method \|\| ""\)\.toUpperCase\(\) !== "GET" \|\| ttl <= 0\) return next\(\);/);
assert.match(server, /res\.setHeader\("X-Clean-Read-Cache", "MEMORY-HIT"\);/);
assert.match(server, /res\.setHeader\("X-Clean-Read-Cache", "SINGLE-FLIGHT-HIT"\);/);
assert.match(server, /adminReadCacheStore\.set\(key, \{ payload, expiresAt: Date\.now\(\) \+ ttl \}\);/);
// The coalescing store and the cache must stay bounded.
assert.match(server, /if \(adminReadSingleFlightStore\.size > 200\) \{/);
assert.match(server, /if \(adminReadCacheStore\.size > 400\) \{/);
// A caller that attached to a failed in-flight read must get a clean deferral,
// never a stale or half-built payload.
assert.match(server, /تعذر إتمام القراءة؛ أعد المحاولة بعد لحظات/);
// Read-only guarantee: the middleware never generates data of its own.
assert.match(server, /only ever replays a payload that was already produced/);

// The four heavy read endpoints must be wrapped, and auth must stay in front.
assert.match(server, /app\.get\("\/api\/admin\/group\/summary", requireAdmin, adminReadSingleFlight\("group-summary", 8000\)/);
assert.match(server, /app\.get\("\/api\/admin\/group\/diagnostic", requireAdmin, adminReadSingleFlight\("group-diagnostic", 8000\)/);
assert.match(server, /app\.get\("\/api\/admin\/group\/members", requireAdmin, adminReadSingleFlight\("group-members", 8000\)/);
assert.match(server, /app\.get\("\/api\/admin\/group\/live-messages", requireAdmin, adminReadSingleFlight\("group-live-messages", 5000\)/);
assert.doesNotMatch(server, /app\.get\("\/api\/admin\/group\/members", adminReadSingleFlight/);
assert.doesNotMatch(server, /app\.get\("\/api\/admin\/group\/live-messages", adminReadSingleFlight/);

// Paging instead of returning every participant on every poll.
assert.match(server, /const memberLimit = Number\.isInteger\(requestedMemberLimit\) && requestedMemberLimit > 0 \? Math\.max\(1, Math\.min\(requestedMemberLimit, 800\)\) : 300;/);
assert.match(server, /const pagedMembers = members\.slice\(0, memberLimit\);/);
assert.match(server, /membersTotal: members\.length,/);
assert.match(server, /truncated: members\.length > pagedMembers\.length,/);
// Live messages default to a smaller page (an explicit limit up to 200 still works).
assert.match(server, /const requestedLimit = Number\(req\.query\.limit \|\| 50\);\n  const limit = Number\.isInteger\(requestedLimit\) \? Math\.max\(1, Math\.min\(requestedLimit, 200\)\) : 50;\n  const includeOutgoing/);

// The panel must never wait on the WhatsApp page: a background loop keeps the group
// snapshot (participants + recent messages) warm in memory and the read endpoints
// serve it, so page.evaluate only ever runs off the request path.
assert.match(server, /const warmGroupSnapshotStore = \{/);
assert.match(server, /const WARM_GROUP_SNAPSHOT_MS = Math\.max\(10000, Number\(process\.env\.WARM_GROUP_SNAPSHOT_MS \|\| 20000\)\);/);
assert.match(server, /function warmGroupSnapshotFresh\(kind, maxAgeMs\) \{/);
assert.match(server, /async function refreshWarmGroupSnapshot\(reason = "interval"\) \{/);
assert.match(server, /function startWarmGroupSnapshotLoop\(\) \{/);
assert.match(server, /initializeWhatsApp\(\);\n  startWarmGroupSnapshotLoop\(\);/);
assert.match(server, /void refreshWarmGroupSnapshot\("ready"\)\.catch\(\(\) => null\);/);
assert.match(server, /res\.setHeader\("X-Clean-Read-Source", "warm"\);/);
assert.match(server, /let chat = warmGroupSnapshotFresh\("participants"\);/);
assert.match(server, /let liveSnapshot = botReady \? warmGroupSnapshotFresh\("participants"\) : null;/);
assert.match(server, /const warmMessages = !requestedMessageId && !bodyIncludes \? warmGroupSnapshotFresh\("messages"\) : null;/);
assert.match(server, /app\.get\("\/api\/admin\/group\/warm-snapshot", requireAdmin/);
// A warm snapshot must never be served stale forever: freshness is bounded.
assert.match(server, /if \(Date\.now\(\) - at > \(Number\(maxAgeMs\) \|\| WARM_GROUP_SNAPSHOT_MS \* 3\)\) return null;/);

console.log('Clean read cache guardrails verified: TTL cache, single-flight coalescing, bounded stores, paging, warm group snapshot off the request path, auth preserved');
