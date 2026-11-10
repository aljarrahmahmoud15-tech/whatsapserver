const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /const INSUFFICIENT_BALANCE_ACCEPTANCE_DELETION_SETTING_KEY = "insufficient_balance_acceptance_deletion_enabled"/);
assert.match(server, /function insufficientBalanceAcceptanceDeletionEnabled\(\)/);
assert.match(server, /async function deleteAcceptanceMessagesForInsufficientBalance/);
const helperStart = server.indexOf('async function deleteAcceptanceMessagesForInsufficientBalance(');
const helperEnd = server.indexOf('\nasync function reopenOrderAfterInsufficientBalance', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const helper = server.slice(helperStart, helperEnd);
assert.match(helper, /if \(!insufficientBalanceAcceptanceDeletionEnabled\(\)\)/);
assert.match(helper, /captainId/);
assert.match(helper, /deletedCount/);
assert.match(helper, /groupNotification: false/);
assert.match(server, /reopened_without_group_notification/);
assert.doesNotMatch(server, /await notifyOfficialGroupOrderReopened\(/);
console.log('insufficient-balance deletion gate remains guarded; group notification is disabled');
