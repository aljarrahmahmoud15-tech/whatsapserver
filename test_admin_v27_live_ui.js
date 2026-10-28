const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('./public/admin-v27.html', 'utf8');
const css = fs.readFileSync('./public/assets/v27-command.css', 'utf8');
const server = fs.readFileSync('./server.js', 'utf8');
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

assert.match(page, /<title>وصلني الآن · Owner Control V27<\/title>/);
assert.match(page, /href="\/assets\/v27-command\.css"/);
assert.doesNotMatch(page, /NEXORA|brand\/nexora/);
assert.match(page, /class="hero-signal"/);
assert.match(page, /class="v27-quickbar"/);
assert.match(page, /id="decisionCabinet"/);
assert.match(page, /id="v27ReadinessPanel"/);
assert.match(page, /function renderV27Readiness\(\)/);
assert.match(page, /session=state\.bot\?\.session\|\|\{\}/);
assert.match(page, /session\.authPathWritable/);
assert.match(page, /id="v27DiagnosticsRefresh"/);
assert.match(page, /function openInlineQr\(\)/);
assert.match(page, /function refreshInlineQr\(\)/);
assert.match(page, /id="v27QrImage"/);
assert.match(page, /id="v27QrStatus"/);
assert.match(page, /qr-temporary-link/);
assert.doesNotMatch(page, /window\.open\('about:blank'/);
assert.match(page, /class="v27-signal-mark"[^>]*>V27<\/span>/);

for (const decision of ['invites', 'finance', 'cards', 'wallet', 'subscriptions', 'orders', 'captains', 'staff', 'advanced']) {
  assert.match(page, new RegExp(`data-decision-open="${decision}"`));
}
for (const action of ['invites', 'cards', 'leads', 'finance', 'weekly-charge']) {
  assert.match(page, new RegExp(`data-admin-action="${action}"`));
}

// Live reads come from the protected current bot, control-plane, and service APIs.
for (const endpoint of [
  '/status',
  '/api/admin/bot/status',
  '/api/admin/system/health',
  '/api/admin/owner-control',
  '/api/admin/whatsapp/send-diagnostics',
  '/api/admin/captains',
  '/api/admin/orders',
  '/api/admin/orders/open?summary=1',
  '/api/admin/unconfirmed-bookings?limit=300',
  '/api/admin/settlements?limit=300',
  '/api/admin/company-wallet',
  '/api/admin/subscriptions?compact=1',
  '/api/admin/captain-invites',
  '/api/admin/cards?limit=100',
  '/api/admin/leads',
  '/api/admin/support-tickets',
  '/api/admin/group/summary',
]) {
  assert.match(page, new RegExp(escaped(endpoint)));
}

// Membership decisions include the captain invitation link and approval/rejection.
for (const marker of [
  'function inviteRows(items)',
  'function createCaptainInvite(send)',
  'v27IssueInvite',
  'v27SendInvite',
  'data-invite-decision="approve"',
  'data-invite-decision="reject"',
  '/api/admin/captain-invites/send',
  "/api/admin/captain-invites/'+encodeURIComponent(id)+'/decision",
]) assert.match(page, new RegExp(escaped(marker)));

// Real owner decision surfaces and their protected mutation contracts.
for (const marker of [
  'function renderFinanceDecision',
  'function renderWalletDecision',
  'function renderTopupDecision',
  'function renderSubscriptionDecision',
  'function renderOrdersDecision',
  'function renderCaptainsDecision',
  'function renderStaffDecision',
  'function renderAdvancedDecision',
  'function openWalletLedger',
  'function openOrderCancelModal',
  'function openBookingApprovalModal',
  'function openOrderRejectModal',
  'function openSystemIdentityDecision',
  'function openQrDecision',
  'function openSupportDecision',
  'function openV27Decision',
  '/api/admin/captains/${encodeURIComponent(captainId)}/direct-credit',
  '/api/admin/captains/${encodeURIComponent(captainId)}/wallet-adjustment',
  '/api/admin/cards',
  '/api/admin/cards/${encodeURIComponent(id)}/send-text',
  '/api/admin/cards/${encodeURIComponent(id)}/void',
  '/api/admin/wallet/${encodeURIComponent(phone)}',
  '/api/admin/captain-subscriptions/schedule',
  '/api/admin/captain-subscriptions/preview',
  '/api/admin/captain-subscriptions/execute',
  '/api/admin/unconfirmed-bookings/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/reject',
  "/api/admin/support-tickets/'+encodeURIComponent(id)+'/fulfill-topup",
  "/api/admin/support-tickets/'+encodeURIComponent(id)",
]) assert.match(page, new RegExp(escaped(marker)));

assert.match(page, /المالك · القرار الأول والأخير/);
assert.match(page, /لا يُضاف الرصيد عند الإصدار/);
assert.match(page, /لا تنفيذ خفي/);
assert.match(page, /رقم البوت المتصل/);
assert.match(page, /رابط الدعوة/);
assert.match(page, /confirmation:'V26_CANCEL_ORDER'/);
assert.match(page, /X-Idempotency-Key/);
assert.doesNotMatch(page, /OWNER_VAULT_SECRET|owner-vault\.key|owner-vault|خزنة المالك/);
assert.match(page, /المركبة/);
assert.match(page, /v27-command\.css/);

assert.match(server, /app\.get\("\/v27", v27PageLimiter, \(req, res\) =>/);
assert.match(server, /app\.get\("\/v27\.html", v27PageLimiter, \(req, res\) =>/);
assert.match(server, /const v27PageLimiter = rateLimit/);
// The requested legacy owner dashboard remains available; V27 is enabled through its explicit routes.
assert.match(server, /app\.get\("\/admin", \(req, res\) =>/);
assert.match(server, /app\.get\("\/admin-v27\.html", \(req, res\) =>/);
assert.match(server, /app\.get\("\/admin-v26\.html", \(req, res\) =>/);
assert.match(server, /app\.get\("\/v27", v27PageLimiter, \(req, res\) =>[\s\S]{0,260}res\.sendFile\(path\.join\(__dirname, "public", "admin-v27\.html"\)\)/);
assert.match(server, /app\.get\("\/v27\.html", v27PageLimiter, \(req, res\) =>[\s\S]{0,260}res\.sendFile\(path\.join\(__dirname, "public", "admin-v27\.html"\)\)/);
const adminRoute = server.slice(server.indexOf('app.get("/admin.html"'), server.indexOf('app.get("/admin-v26.html"'));
assert.match(adminRoute, /path\.join\(__dirname, "admin\.html"\)/);
assert.match(fs.readFileSync('./admin.html', 'utf8'), /id="captainApprovalCard"/);
assert.doesNotMatch(adminRoute, /admin-v27\.html/);
const activeV27Route = server.slice(server.indexOf('app.get("/admin-v27.html"'), server.indexOf('app.get("/owner-direct"'));
assert.match(activeV27Route, /res\.sendFile\(path\.join\(__dirname, "public", "admin-v27\.html"\)\)/);

for (const marker of ['backdrop-filter', 'prefers-reduced-motion', '.decision-grid', '.v27-qr-shell', '.v27-qr-frame', '.decision-detail', '.decision-kpi-grid', '.v27-readiness-grid', '.v27-feed']) {
  assert.match(css, new RegExp(escaped(marker)));
}
assert.ok(scripts.length > 0, 'V27 inline JavaScript exists');
assert.doesNotThrow(() => new vm.Script(scripts.at(-1), { filename: 'public/admin-v27.html#script' }));

console.log('current V27 owner decision center, readiness, invitation, support, and route guardrails: PASS');
