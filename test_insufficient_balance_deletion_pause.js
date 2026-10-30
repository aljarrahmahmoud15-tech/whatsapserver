const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /const INSUFFICIENT_BALANCE_ACCEPTANCE_DELETION_PAUSED = true/);
assert.match(server, /insufficientBalanceAcceptanceDeletionPaused: INSUFFICIENT_BALANCE_ACCEPTANCE_DELETION_PAUSED/);

const helperStart = server.indexOf('async function deleteAcceptanceOnlyAfterGroupAlert(');
const helperEnd = server.indexOf('\nasync function notifyOfficialGroupOrderReopened', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'the low-balance deletion helper must exist');
const helper = server.slice(helperStart, helperEnd);
const pauseIndex = helper.indexOf('if (INSUFFICIENT_BALANCE_ACCEPTANCE_DELETION_PAUSED)');
const correctionIndex = helper.indexOf('notifyOfficialGroupInsufficientAcceptanceDeletionFailure({');
const deleteIndex = helper.indexOf('deleteWhatsAppMessageForEveryone(messageId, {');
assert.ok(pauseIndex >= 0 && pauseIndex < correctionIndex && correctionIndex < deleteIndex, 'the pause must return before group-delete correction or deletion');
assert.match(helper, /deletionStatus: "paused"/);
assert.match(helper, /requested: false/);
assert.match(helper, /revoked: false/);
assert.match(helper, /reason: "insufficient_balance_acceptance_deletion_paused"/);
assert.match(helper, /order\.acceptance\.message_deletion_paused_insufficient_balance/);

const reopenStart = server.indexOf('async function reopenOrderAfterInsufficientBalance(');
const reopenEnd = server.indexOf('\nasync function mediaFromRemoteVideoUrl', reopenStart);
assert.ok(reopenStart >= 0 && reopenEnd > reopenStart, 'the low-balance order reopen path must exist');
const reopen = server.slice(reopenStart, reopenEnd);
assert.match(reopen, /!\["deleted", "paused"\]\.includes\(deletionStatus\)/);
assert.match(reopen, /messageDeletionPaused: deletionStatus === "paused"/);
assert.match(server, /سيبقى ردك ظاهرًا مؤقتًا ولن يُعتمد الحجز/);
assert.match(server, /الحجز متاح من جديد/);

const ownerDeleteStart = server.indexOf('if (body === "هذه"');
const ownerDeleteEnd = server.indexOf('\n  }', ownerDeleteStart);
assert.ok(ownerDeleteStart >= 0 && ownerDeleteEnd > ownerDeleteStart);
assert.match(server.slice(ownerDeleteStart, ownerDeleteEnd), /deleteWhatsAppMessageForEveryone\(quotedMessageId/);

console.log('insufficient-balance acceptance deletion pause: ok; unrelated owner deletion remains enabled');
