const fs = require('node:fs');
const assert = require('node:assert/strict');
const server = fs.readFileSync('server.js', 'utf8');
const ownerUi = fs.readFileSync('public/index.html', 'utf8');
const staffUi = fs.readFileSync('public/staff.html', 'utf8');
const legacyAdmin = fs.readFileSync('admin.html', 'utf8');

assert.match(server, /permissions_json TEXT NOT NULL DEFAULT '\[\]'/);
assert.match(server, /ALTER TABLE staff_accounts ADD COLUMN permissions_json/);
assert.match(server, /STAFF_PERMISSION_OPTIONS/);
assert.match(server, /function requireStaffPermission\(permission\)/);
for (const route of [
  ['/api/staff/orders', 'orders'],
  ['/api/staff/captains', 'captains'],
  ['/api/staff/wallets', 'wallets'],
  ['/api/staff/company-wallet', 'company_wallet'],
  ['/api/staff/settlements', 'settlements'],
  ['/api/staff/support-tickets', 'support'],
]) {
  assert.match(server, new RegExp(`app\\.get\\("${route[0].replaceAll('/', '\\/')}", requireStaffPermission\\("${route[1]}"\\)`));
}
assert.match(server, /staffPortalUrl\(req\)/);
assert.match(server, /portalUrl: staffPortalUrl\(req\)/);
assert.doesNotMatch(server, /app\.(post|patch|delete)\("\/api\/staff\//);
assert.match(ownerUi, /data-staff-permission/);
assert.match(ownerUi, /copyStaffPortal/);
assert.match(ownerUi, /permissions/);
assert.match(staffUi, /permissionNotice/);
assert.match(staffUi, /hasPermission\('orders'\)/);
assert.match(staffUi, /supportCard/);
assert.match(legacyAdmin, /الصلاحيات/);
console.log('staff permissions, portal link, and read-only guardrails verified');
