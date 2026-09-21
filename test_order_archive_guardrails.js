const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");
const dashboard = fs.readFileSync("public/index.html", "utf8");
assert.match(source, /ALTER TABLE orders ADD COLUMN archive_state/);
assert.match(source, /ALTER TABLE orders ADD COLUMN archived_at/);
assert.match(source, /ALTER TABLE orders ADD COLUMN archive_reason/);
assert.match(source, /app\.post\("\/api\/admin\/orders\/archive-open", requireAdmin/);
assert.match(source, /financialMutation: false/);
assert.match(source, /audit\("order\.archived"/);
assert.match(source, /COALESCE\(o\.archive_state,'active'\)='active'/);
assert.match(source, /reason: "order_archived"/);
assert.match(dashboard, /value="archive-open"/);
assert.match(dashboard, /api\('\/api\/admin\/orders\/archive-open'/);
console.log("order archive guardrails verified");
