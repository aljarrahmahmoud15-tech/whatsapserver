const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
const scanStart = source.indexOf('async function scanPendingAcceptanceReactions()');
const scanEnd = source.indexOf('const recentMessageEventKeys', scanStart);
assert.ok(scanStart >= 0 && scanEnd > scanStart, 'reaction scanner must exist');
const scanner = source.slice(scanStart, scanEnd);
const rowsIndex = scanner.indexOf('SELECT DISTINCT a.acceptance_message_id');
const retryIndex = scanner.indexOf('await retryFailedBookingConfirmations(groupId);');
const backgroundIndex = scanner.indexOf('startBackgroundOrderRecovery(groupId);');
assert.ok(rowsIndex >= 0, 'scanner reads pending acceptance rows');
assert.ok(retryIndex > rowsIndex, 'confirmation retries run after reaction rows are selected');
assert.ok(backgroundIndex > retryIndex, 'slow order recovery starts after reaction reconciliation');
assert.match(source, /let whatsappRecoveryBackgroundRunning = false;/);
assert.match(source, /function startBackgroundOrderRecovery\(groupId\)/);
console.log('reaction scan priority and bounded background recovery guardrails verified');
