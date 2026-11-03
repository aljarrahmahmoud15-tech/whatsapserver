const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

assert.match(source, /GENERAL_MESSAGE_DELETION_SETTING_KEY/);
assert.match(source, /GENERAL_MESSAGE_DELETION_EMERGENCY_STOP_KEY/);
assert.match(source, /app\.patch\("\/api\/admin\/settings\/general-message-deletion", requireOwnerAdmin/);
assert.match(source, /official_group_only/);
assert.match(source, /messageHasApprovedGeneralMarker/);
assert.match(source, /unapproved_general_message/);
assert.match(source, /isOfficialGroupAdminPhone\(normalizedPhone\)/);
assert.match(source, /isGroupSetupOwner\(normalizedPhone\)/);
assert.match(source, /image_visual_price_unverified/);
assert.match(source, /financialMutation: false/);
assert.match(source, /orderMutation: false/);
assert.match(source, /if \(\["deleted", "failed"\]\.includes\(generalDeletionResult\?\.status\)\) return;/);

const policyStart = source.indexOf('function messageHasApprovedGeneralMarker');
const policyEnd = source.indexOf('function isCaptionedImageMessage');
assert.ok(policyStart >= 0 && policyEnd > policyStart);
const markerSource = source.slice(policyStart, policyEnd);
assert.match(markerSource, /تم/);
assert.match(markerSource, /راكب/);
assert.match(markerSource, /أوردر/);
assert.match(markerSource, /https\?:/);
assert.match(markerSource, /دينار/);

console.log('general message deletion policy guardrail tests passed');
