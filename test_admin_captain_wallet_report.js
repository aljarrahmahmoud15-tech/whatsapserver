const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('admin.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(html, /id="subscriptionReportCard"/);
assert.match(html, /أسماء الكباتن وأرصدة المحافظ/);
assert.match(html, /تنزيل CSV عربي/);
assert.match(html, /مزامنة الأسماء من WhatsApp/);
assert.match(html, /api\('\/api\/admin\/captains\/sync-names'/);
assert.match(html, /api\('\/api\/admin\/subscriptions\?compact=1'\)/);
assert.match(html, /all-captains-wallets-arabic-2026-09-18\.csv/);
assert.match(html, /u\.originalName\|\|u\.name/);
assert.match(html, /u\.balanceBeforeSubscription/);
assert.match(html, /u\.balanceAfterSubscription/);
assert.match(html, /data\.users/);
assert.match(server, /displayName: captainDisplayName\(row\.name\)/);
assert.match(server, /app\.get\("\/api\/admin\/subscriptions", requireAdmin/);
assert.match(server, /userCount: serializedUsers\.length/);
assert.match(server, /balanceBeforeSubscriptionCents/);
assert.match(server, /balanceAfterSubscriptionCents/);
assert.match(server, /WHERE u\.role='captain' AND u\.is_bot=0 AND u\.account_status<>'merged'/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/sync-names", requireAdmin/);
assert.match(server, /app\.get\("\/api\/admin\/captains\/sync-names\/run", requireAdmin/);
assert.match(server, /syncRegisteredCaptainNamesFromConfiguredGroup/);
assert.match(server, /كابتن بدون اسم/);
assert.match(server, /const contactName = String\(contact/);
assert.doesNotMatch(server, /const name = String\(contact && \(contact\.pushname \|\| contact\.name \|\| contact\.shortName\) \|\| displayPhone\(phone\)\)/);

console.log('Arabic captain names, wallet balances, and downloadable dashboard report verified');
