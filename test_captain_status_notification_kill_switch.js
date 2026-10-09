const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
assert.match(server, /const CAPTAIN_STATUS_NOTIFICATIONS_ENABLED = false;/);
assert.match(server, /const CAPTAIN_STATUS_TEST_ALLOWLIST = new Set\(\);/);
assert.match(server, /const CAPTAIN_STATUS_TEST_CONFIRMATION = "SEND-ONE-CAPTAIN-NOTIFICATION";/);
assert.match(server, /if \(!CAPTAIN_STATUS_NOTIFICATIONS_ENABLED && !allowPausedTest\)/);
assert.match(server, /reason: "captain_status_notifications_paused"/);
assert.match(server, /if \(!CAPTAIN_STATUS_NOTIFICATIONS_ENABLED \|\| !client \|\| !isReady\) return \{ attempted: 0/);
assert.match(server, /CAPTAIN_STATUS_TEST_NOT_ALLOWED/);
assert.match(server, /walletChanged: false/);

const suppressionStart = server.indexOf('if (!CAPTAIN_STATUS_NOTIFICATIONS_ENABLED && !allowPausedTest) {');
const sendStart = server.indexOf('const captainStatusNotificationInFlight');
assert.ok(suppressionStart > sendStart, 'suppression guard must be inside the status notification sender');

console.log('captain status notification emergency kill switch: ok');
