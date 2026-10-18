const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('./server.js', 'utf8');
const page = fs.readFileSync('./public/admin-v27.html', 'utf8');
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] || '';

assert.match(server, /app\.get\("\/api\/admin\/captains\/:id\/commission-withdrawal-preview", requireOwnerAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/commission-withdrawal", requireOwnerAdmin/);
assert.match(server, /confirmation !== "OWNER_COMMISSION_WITHDRAWAL"/);
assert.match(server, /run\(id, "commission_withdrawal", -amountCents/);
assert.match(server, /idempotencyKey/);
assert.match(server, /expectedBalanceCents/);
assert.match(server, /delivery: "wallet_only"/);
assert.match(server, /whatsappSent: false/);
assert.match(server, /UPDATE users SET wallet_cents=\?,updated_at=\? WHERE id=\? AND role='captain' AND is_bot=0 AND wallet_cents=\?/);
assert.match(server, /Math\.max\(0, currentBalanceCents\)/);
assert.doesNotMatch(server.slice(server.indexOf('app.post("/api/admin/captains/:id/commission-withdrawal"'), server.indexOf('app.post("/api/admin/users/:id/direct-credit"')), /sendServer2DirectAtMostOnce|notifyCaptain|renderTopupCardMedia/);

assert.match(page, /data-safe-action="withdraw"/);
assert.match(page, /commission-withdrawal-preview/);
assert.match(page, /commission-withdrawal/);
assert.match(page, /OWNER_COMMISSION_WITHDRAWAL/);
assert.match(page, /سحب العمولة/);
assert.match(page, /موافقة المالك وتسجيل السحب/);
assert.match(page, /لا تُنشأ بطاقة ولا تُرسل رسالة WhatsApp/);
assert.doesNotThrow(() => new vm.Script(script, { filename: 'public/admin-v27.html#script' }));

console.log('owner-only commission withdrawal route, idempotency, balance floor, and V27 modal guards: PASS');
