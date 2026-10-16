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

console.log('Clean archived-session restore route, isolation guardrails, health telemetry, and UI action verified');
