const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const admin = fs.readFileSync('public/admin-v26.html', 'utf8');

assert.match(server, /app\.get\("\/admin\.html",[\s\S]{0,220}admin-v26\.html/);
assert.match(server, /function handleAdminDirectWalletCredit\(req, res\)/);
assert.match(server, /app\.post\(\"\/api\/admin\/users\/:id\/direct-credit\", requireBotWalletOwner, handleAdminDirectWalletCredit\)/);
assert.match(server, /app\.post\(\"\/api\/admin\/captains\/:id\/direct-credit\", requireBotWalletOwner, handleAdminDirectWalletCredit\)/);
assert.match(server, /delivery: \"wallet_only\"/);
assert.match(server, /source: \"company_direct\"/);
assert.match(server, /actor: \"owner\"/);
assert.match(server, /DIRECT_WALLET_LARGE_CREDIT_THRESHOLD_CENTS/);
assert.match(server, /captain\.wallet\.large_credit_alert/);
assert.match(server, /عتبة التنبيه/);
assert.match(server, /WHERE id=\? AND role='captain' AND is_bot=0 AND account_status='active'/);

const handlerStart = server.indexOf('function handleAdminDirectWalletCredit');
const handlerEnd = server.indexOf('app.post("/api/admin/captains/:id/wallet-adjustment"', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'direct-credit handler boundaries must exist');
const handler = server.slice(handlerStart, handlerEnd);
assert.doesNotMatch(handler, /topup_cards|sendMessage|cardDeliveryInFlight|renderTopupCardMedia/);
assert.match(handler, /wallet_ledger/);
assert.match(handler, /idempotency_key/);
assert.match(handler, /alreadyApplied/);

assert.match(admin, /data-safe-action="credit"/);
assert.match(admin, /function applyCaptainCredit\(id\)/);
assert.match(admin, /X-Idempotency-Key/);
assert.match(admin, /direct-credit/);
assert.match(admin, /دون بطاقة أو رسالة WhatsApp/);

console.log('V26 direct wallet credit button and wallet-only owner guardrails verified');
