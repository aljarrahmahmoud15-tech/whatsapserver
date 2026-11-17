const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('./admin.html', 'utf8');
const refreshStart = page.indexOf('async function refresh(){');
const refreshEnd = page.indexOf('\nfunction renderNegativeWallets', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'dashboard refresh function is present');
const refreshSource = page.slice(refreshStart, refreshEnd);

assert.match(page, /async function runAdminRefreshLoaders\(loaders,maxConcurrency=3\)/, 'secondary dashboard reads use a bounded concurrency queue');
assert.match(refreshSource, /await runAdminRefreshLoaders\(\[/, 'refresh delegates section reads to the queue');
assert.doesNotMatch(refreshSource, /await loadV27Functions\(\);await loadCompanyWallet\(\)/, 'dashboard detail requests are no longer a serial waterfall');
for (const loader of ['loadV27Functions', 'loadCompanyWallet', 'loadUsers', 'loadStaff', 'loadUnconfirmedBookings', 'loadOrders', 'loadSettlements', 'loadSettlementPolicy', 'loadNotificationSettings', 'loadSubscriptionReport', 'loadCaptainInvites']) {
  assert.match(refreshSource, new RegExp(`\\(\\)=>${loader}\\(\\)`), `${loader} remains part of manual refresh`);
}
assert.doesNotMatch(refreshSource, /refreshQrInline\(\)/, 'a routine refresh does not issue a temporary QR-link POST');
assert.match(page, /const \[data,live\]=await Promise\.all\(/, 'V27 bootstrap and status are fetched concurrently');
assert.match(page, /startVisiblePanelPolling\('officialGroupSyncCard'/, 'group telemetry loads when its section is visible');
assert.match(page, /startVisiblePanelPolling\('financeV26Msg'/, 'finance summary loads when its section is visible');
assert.match(page, /if\(isVisible\(\)\)void loader\(\)/, 'offscreen polling does not issue periodic API requests');

console.log('admin dashboard bounded loading and visible-section polling guards verified');
