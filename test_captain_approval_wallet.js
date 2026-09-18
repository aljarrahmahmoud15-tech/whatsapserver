const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const admin = fs.readFileSync('admin.html', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');

const applyStart = server.indexOf('app.post("/api/captain/invites/:token/apply"');
const applyEnd = server.indexOf('app.get("/api/admin/captain-invites"', applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, 'public invite application route exists');
const apply = server.slice(applyStart, applyEnd);
assert.match(apply, /status: "pending"/);
assert.match(apply, /accountCreated: false/);
assert.match(apply, /captain\.join\.requested/);
assert.doesNotMatch(apply, /captain\.join\.auto_approved/);
assert.doesNotMatch(apply, /INSERT INTO users/);
assert.doesNotMatch(apply, /addCaptainToConfiguredGroup/);
assert.doesNotMatch(apply, /sendCaptainOperationsCard/);

assert.match(server, /app\.post\("\/api\/admin\/captain-invites\/:id\/decision", requireAdmin/);
assert.match(server, /invite\.status !== "pending"/);
assert.match(server, /decision === "reject"/);
assert.match(server, /captain\.join\.approved/);
assert.match(server, /INSERT INTO users/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/\:id\/approval-notification-test", requireAdmin/);
assert.match(server, /captain\.approval_notification\.test/);
assert.match(server, /ولا تغيّر حالة حسابك أو رصيدك/);
assert.match(server, /X-Idempotency-Key/);

assert.match(server, /app\.post\("\/api\/admin\/users\/:id\/wallet-adjustment", requireAdmin, handleAdminWalletAdjustment\)/);
assert.match(server, /account_status<>'merged'/);
assert.match(server, /source: "company_direct_transfer"/);
assert.match(server, /issueIdempotencyKey = `ADMIN-WALLET-/);
assert.match(server, /topup_card\.issued/);
assert.match(server, /topup_card\.sent/);
assert.match(server, /يُضاف الرصيد عند استرداد البطاقة/);

assert.match(admin, /id="captainApprovalCard"/);
assert.match(admin, /موافقة وإنشاء الحساب/);
assert.match(admin, /decideCaptainInvite/);
assert.match(admin, /id="captainInvites"/);
assert.match(admin, /adjustUserWallet/);
assert.match(admin, /إضافة رصيد/);
assert.match(admin, /إرسال اختبار الموافقة/);
assert.match(admin, /approvalTestModal/);
assert.match(admin, /approval-notification-test/);
assert.match(admin, /\/api\/admin\/users\/\'\+id\+\'\/wallet-adjustment/);
assert.match(captain, /لا يمكن إنشاء الحساب أو الدخول أو استخدام النظام قبل موافقة المالك/);

console.log('captain approval gate and owner wallet controls verified');
