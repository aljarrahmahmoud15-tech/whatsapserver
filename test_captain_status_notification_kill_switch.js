const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
assert.match(server, /const CAPTAIN_STATUS_NOTIFICATIONS_ENABLED = true;/);
assert.match(server, /const CAPTAIN_STATUS_TEST_ALLOWLIST = new Set\(\);/);
assert.match(server, /const CAPTAIN_STATUS_TEST_CONFIRMATION = "SEND-ONE-CAPTAIN-NOTIFICATION";/);
assert.match(server, /!notificationEnabled\("captainStatus"\)/);
assert.match(server, /reason = !notificationEnabled\("captainStatus"\) \? "owner_notification_setting_disabled"/);
assert.match(server, /!CAPTAIN_STATUS_NOTIFICATIONS_ENABLED \|\| !notificationEnabled\("captainStatus"\) \|\| !client \|\| !isReady/);
assert.match(server, /CAPTAIN_STATUS_TEST_NOT_ALLOWED/);
assert.match(server, /walletChanged: false/);

const suppressionStart = server.indexOf('if ((!CAPTAIN_STATUS_NOTIFICATIONS_ENABLED || !notificationEnabled("captainStatus")) && !allowPausedTest) {');
const sendStart = server.indexOf('const captainStatusNotificationInFlight');
assert.ok(suppressionStart > sendStart, 'suppression guard must be inside the status notification sender');

console.log('captain status notification emergency kill switch: ok');
