const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');

assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/wallet-adjustment", requireAdmin, handleAdminWalletAdjustment\)/);
assert.match(server, /app\.post\("\/api\/dashboard\/captains\/\:id\/wallet-adjustment", requireDashboardApi, async/);
assert.match(server, /if \(direction === "credit"\) \{/);
assert.match(server, /source: "company_direct_transfer"/);
assert.match(server, /ADMIN-WALLET-\$\{idempotencyKey\}/);
assert.match(server, /WALLET-\$\{idempotencyKey\}/);
assert.match(server, /SUPPORT-TICKET-\$\{ticketId\}/);
assert.match(server, /تم إصدار بطاقة الرصيد لكن WhatsApp غير جاهز للإرسال حاليًا/);
assert.match(server, /يُضاف الرصيد عند إدخال رمز البطاقة/);
assert.match(server, /topup_card\.redeemed/);
assert.match(server, /const creditMode = String\(req.body\.creditMode \|\| "card"\)/);
assert.match(server, /if \(direction === "credit" && creditMode === "direct"\)/);
assert.match(server, /source: "company_direct"/);
assert.match(server, /actor: "owner"/);
assert.match(index, /r\.cardId\?'تم إصدار بطاقة الرصيد وإرسالها للكابتن/);

console.log('company wallet credits require an issued top-up card and idempotent delivery');
