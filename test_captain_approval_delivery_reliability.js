const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

assert.match(server, /const captainStatusRetryAttempts = new Map\(\);/);
assert.match(server, /const CAPTAIN_STATUS_RETRY_INTERVAL_MS = 60 \* 1000;/);
assert.match(server, /const CAPTAIN_STATUS_RETRY_MAX_ATTEMPTS = 3;/);
assert.match(server, /function startCaptainStatusNotificationRetryScheduler\(\)/);
assert.match(server, /captainStatusRetryTimer = setInterval\(/);
assert.match(server, /captainStatusRetryTimer\.unref\?\.\(\);/);
assert.match(server, /startCaptainStatusNotificationRetryScheduler\(\);/);

const retryStart = server.indexOf('async function retryCaptainStatusNotifications');
const retryEnd = server.indexOf('function startCaptainStatusNotificationRetryScheduler', retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart, 'bounded retry function exists');
const retry = server.slice(retryStart, retryEnd);
assert.match(retry, /delivery_status IN \('pending','failed'\)/);
assert.match(retry, /attempts >= CAPTAIN_STATUS_RETRY_MAX_ATTEMPTS/);
assert.match(retry, /captainStatusRetryAttempts\.set\(key, attempts \+ 1\)/);
assert.match(retry, /captainStatusRetryAttempts\.delete\(key\)/);
assert.match(retry, /return \{ attempted, scanned: rows\.length \};/);

const statusStart = server.indexOf('async function sendCaptainStatusText');
const statusEnd = server.indexOf('async function retryCaptainStatusNotifications', statusStart);
const status = server.slice(statusStart, statusEnd);
assert.match(status, /deliveryError = "whatsapp_not_ready"/);
assert.match(status, /deliveryError = "recipient_unresolved"/);
assert.match(status, /attemptedRecipientTypes/);
assert.match(status, /deliveryError,/);
assert.match(status, /if \(result\.status === "uncertain"\)/);
assert.match(status, /if \(!\['failed', 'blocked'\]\.includes\(result\.status\)\) break;/);

console.log('captain approval delivery reliability guardrails verified');
