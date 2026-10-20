const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const ui = fs.readFileSync('./public/index.html', 'utf8');

assert.match(server, /function archivedWhatsAppSessionDirectories\(\)/);
assert.match(server, /\.archived-sessions/);
assert.match(server, /function restoreLatestArchivedWhatsAppSession\(\)/);
assert.match(server, /if \(!CLEAN_INSTANCE\) throw new Error/);
assert.match(server, /ACTIVE_WHATSAPP_PROFILE_EXISTS/);
assert.match(server, /NO_ARCHIVED_WHATSAPP_SESSION/);
assert.match(server, /app\.post\("\/api\/admin\/whatsapp\/restore-last-session", requireAdmin/);
assert.match(server, /req\.body\?\.confirm !== true/);
assert.match(server, /session_restore_scheduled/);
assert.match(server, /archivedSessionCount/);
assert.match(ui, /ops-restore-last-session/);
assert.match(ui, /\/api\/admin\/whatsapp\/restore-last-session/);
assert.match(ui, /confirm:true/);
assert.match(ui, /CLEAN_IDENTITY_CACHE_KEY/);
assert.match(ui, /Promise\.allSettled/);
assert.match(ui, /ops-bot-phone/);
assert.match(ui, /ops-main-group-url/);
assert.match(server, /CLEAN_GROUP_INVITE_URL/);
assert.match(server, /official_group_invite_url/);
assert.match(server, /pinnedToClean/);
assert.match(ui, /ops-session-state/);
assert.match(ui, /main-group-invite-url/);
assert.match(ui, /main-group-invite-copy/);
assert.match(ui, /clean-identity-panel/);
assert.match(ui, /main-clean-bot-phone/);
assert.match(ui, /main-clean-group-id/);
assert.match(ui, /main-clean-group-invite/);
assert.match(ui, /refreshCleanIdentity/);
assert.match(ui, /main-clean-qr/);
assert.match(ui, /openCleanMainQr/);
assert.match(ui, /\/api\/admin\/qr-main-link/);
assert.match(ui, /ليس للقروب/);
assert.doesNotMatch(ui, /data:image\/png;base64,/);

// Pinned clean identity: the owner-approved number, its international form, and the
// operational group must be the clean-only defaults so no clean path can drift to an
// identity inherited from another service.
assert.match(server, /const CLEAN_BOT_PHONE = "0797907580";/);
assert.match(server, /const CLEAN_BOT_PHONE_INTL = "962797907580";/);
assert.match(server, /const CLEAN_GROUP_ID = "120363430477331505@g\.us";/);
assert.match(server, /process\.env\.BOT_PHONE\?\.trim\(\) \|\| \(CLEAN_INSTANCE \? CLEAN_BOT_PHONE : "0779110123"\)/);
assert.match(server, /process\.env\.WHATSAPP_GROUP_ID\?\.trim\(\) \|\| \(CLEAN_INSTANCE \? CLEAN_GROUP_ID : ""\)/);
// Clean must never adopt a session namespace inherited from another Render service.
assert.match(server, /ignoring inherited WHATSAPP_CLIENT_ID/);
assert.match(server, /const cleanWhatsAppClientId = `aljarah-clean-\$\{WHATSAPP_IDENTITY_SCOPE\}`;/);
assert.match(server, /const WHATSAPP_CLIENT_ID = CLEAN_INSTANCE\n  \? cleanWhatsAppClientId/);
// Relinking archives the active profile and keeps previously archived sessions intact.
assert.match(server, /async function clearWhatsAppSessionForRelink\(\)/);
assert.match(server, /if \(entry\.name === "\.archived-sessions"\) continue;/);
assert.match(server, /fs\.renameSync\(activeProfile, path\.join\(archiveRoot, archivedSession\)\)/);
assert.match(server, /app\.get\("\/api\/admin\/whatsapp\/clear-session", requireAdmin/);
assert.match(server, /String\(req\.query\.format \|\| ""\) === "json"/);
assert.match(ui, /ops-clear-session/);
assert.match(ui, /\/api\/admin\/whatsapp\/clear-session\?execute=1&format=json/);
assert.match(ui, /حذف الجلسة غير المطابقة/);
assert.match(ui, /wrong_account/);

console.log('Clean archived-session restore route, identity panel, protected main QR, isolation guardrails, and health telemetry verified');

// A deploy can kill the browser mid-session and make WhatsApp reject a profile that is
// not empty. The service must then try the newest snapshot once before asking for a QR,
// and must keep a fresh snapshot of every healthy session.
assert.match(server, /function restoreSessionSnapshotFromScratch\(reason = "self_heal"\) \{/);
assert.match(server, /if \(!sessionSelfHealAttempted\) \{\n      sessionSelfHealAttempted = true;/);
assert.match(server, /if \(restoreSessionSnapshotFromScratch\("qr_rejected_profile"\)\) \{/);
assert.match(server, /void restartWhatsApp\("session snapshot self-heal after QR"\)/);
assert.match(server, /sessionSelfHealAttempted = false;\n    setTimeout\(\(\) => \{\n      if \(Date\.now\(\) - lastSessionSnapshotAt < SESSION_SNAPSHOT_MIN_INTERVAL_MS\) return;/);
assert.doesNotMatch(server, /if \(process\.env\.CLEAN_SESSION_SNAPSHOTS === "true"\) \{ try \{ snapshotWhatsAppSession\("ready"\); \}/);
console.log('session snapshot self-heal guardrails verified');
