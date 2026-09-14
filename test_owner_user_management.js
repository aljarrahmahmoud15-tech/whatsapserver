const fs = require("fs");
const assert = require("assert/strict");

const server = fs.readFileSync("server.js", "utf8");
const admin = fs.readFileSync("admin.html", "utf8");

assert.match(server, /app\.get\("\/api\/admin\/users", requireAdmin/);
assert.match(server, /app\.patch\("\/api\/admin\/users\/:id", requireAdmin/);
assert.match(server, /app\.delete\("\/api\/admin\/users\/:id", requireAdmin/);
assert.match(server, /admin\.user\.updated/);
assert.match(server, /admin\.user\.deleted/);
assert.match(server, /حساب النظام محمي ولا يمكن حذفه/);
assert.match(server, /لا يمكن حذف مستخدم مرتبط بطلبات أو محاسبة/);
assert.match(admin, /id="users"/);
assert.match(admin, /api\('\/api\/admin\/users'/);
assert.match(admin, /function editUser\(id\)/);
assert.match(admin, /function deleteUser\(id,name\)/);

console.log("owner all-user management guardrails verified");
