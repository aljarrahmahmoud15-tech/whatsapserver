const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /const INSUFFICIENT_BALANCE_ACCEPTANCE_DELETION_SETTING_KEY = "insufficient_balance_acceptance_deletion_enabled"/);
assert.match(server, /insufficientBalanceAcceptanceDeletionPaused: !insufficientBalanceAcceptanceDeletionEnabled\(\)/);
assert.match(server, /function insufficientBalanceAcceptanceDeletionEnabled\(\)/);
assert.match(server, /app\.patch\("\/api\/admin\/settings\/acceptance-deletion", requireOwnerAdmin/);

const helperStart = server.indexOf('async function deleteAcceptanceOnlyAfterGroupAlert(');
const helperEnd = server.indexOf('\nasync function notifyOfficialGroupOrderReopened', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'the low-balance deletion helper must exist');
const helper = server.slice(helperStart, helperEnd);
const pauseIndex = helper.indexOf('if (!insufficientBalanceAcceptanceDeletionEnabled())');
const correctionIndex = helper.indexOf('notifyOfficialGroupInsufficientAcceptanceDeletionFailure({');
const deleteIndex = helper.indexOf('deleteWhatsAppMessageForEveryone(messageId, {');
assert.ok(pauseIndex >= 0 && correctionIndex > pauseIndex && deleteIndex > correctionIndex, 'the deletion gate and group-alert-before-delete order must remain explicit');
assert.match(helper, /deletionStatus: deletionResult\?\.ok \? "deleted" : "failed"/);
assert.match(helper, /deleteWhatsAppMessageForEveryone\(messageId/);

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

console.log('insufficient-balance acceptance deletion enabled; unrelated captain removal remains paused');
