const fs = require("fs");
const assert = require("assert/strict");

const server = fs.readFileSync("server.js", "utf8");
const admin = fs.readFileSync("admin.html", "utf8");
const staff = fs.readFileSync("public/staff.html", "utf8");

assert.match(server, /CREATE TABLE IF NOT EXISTS staff_accounts/);
assert.match(server, /app\.post\("\/api\/auth\/staff-login"/);
assert.match(server, /function requireStaffRole\(\.\.\.roles\)/);
assert.match(server, /app\.get\("\/api\/staff\/wallets", requireStaffRole\("accountant"\)/);
assert.match(server, /app\.get\("\/api\/staff\/captains", requireStaffRole\("operations"\)/);
assert.match(server, /app\.get\("\/api\/admin\/staff", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/staff", requireAdmin/);
assert.match(server, /app\.delete\("\/api\/admin\/staff\/:id", requireAdmin/);
assert.match(admin, /حسابات المحاسب وموظفي التشغيل/);
assert.match(admin, /function createStaff\(\)/);
assert.match(staff, /api\('\/api\/auth\/staff-login'/);
assert.match(staff, /id="walletsCard"/);
assert.match(staff, /id="captainsCard"/);

console.log("staff role and permission guardrails verified");
