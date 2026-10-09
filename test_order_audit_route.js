const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("./server.js", "utf8");
const start = server.indexOf('app.get("/api/admin/audit/order/:orderId"');
const end = server.indexOf('app.patch("/api/admin/captains/:id"', start);
assert.ok(start >= 0 && end > start, "audit route block should be present");
const route = server.slice(start, end);

assert.match(route, /app\.get\("\/api\/admin\/audit\/order\/:orderId", requireAdmin/);
assert.match(route, /readOnly: true/);
assert.match(route, /FROM audit_logs a LEFT JOIN users u/);
assert.match(route, /FROM reaction_evidence WHERE group_id=\? AND message_id IN/);
assert.match(route, /FROM wallet_ledger l LEFT JOIN users u/);
assert.doesNotMatch(route, /UPDATE audit_logs/);
assert.doesNotMatch(route, /DELETE FROM audit_logs/);

console.log("read-only order audit route guardrails verified");
