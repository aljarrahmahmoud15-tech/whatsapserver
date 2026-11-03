const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const panel = fs.readFileSync(require.resolve('./public/admin-v27.html'), 'utf8');

assert(server.includes('official_group_voice_message_deletion_enabled'));
assert(server.includes('official_group_voice_message_deletion_emergency_stop'));
assert(server.includes('groupId !== configuredRuntimeGroupId()'));
assert(server.includes('isGroupSetupOwner(normalizedPhone) || isOfficialGroupAdminPhone(normalizedPhone)'));
assert(server.includes('admin_snapshot_unavailable'));
assert(server.includes('owner_emergency_stop'));
assert(server.includes('reason: "unapproved_audio_message"'));
assert(server.includes('app.patch("/api/admin/settings/voice-message-deletion", requireOwnerAdmin'));
assert(server.includes('financialMutation: false, orderMutation: false'));
assert(panel.includes('ownerVoiceDeletionEnabled'));
assert(panel.includes('ownerVoiceDeletionEmergencyStop'));
assert(panel.includes('/api/admin/settings/voice-message-deletion'));

console.log('voice message deletion policy static guardrails: PASS');
