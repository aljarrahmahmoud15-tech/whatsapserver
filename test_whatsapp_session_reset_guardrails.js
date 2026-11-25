"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");
const readme = fs.readFileSync("README.md", "utf8");

function route(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `route boundaries missing: ${startMarker}`);
  return source.slice(start, end);
}

assert.match(source, /const WHATSAPP_SESSION_CLEAR_CONFIRMATION = "CLEAR_WHATSAPP_SESSION_AND_RECONNECT"/);
assert.match(source, /const WHATSAPP_SESSION_ARCHIVE_CONFIRMATION = "ARCHIVE_WHATSAPP_SESSION_AND_RECONNECT"/);

const logout = route('app.post("/api/admin/logout"', 'app.get("/api/admin/whatsapp/clear-session"');
assert.match(logout, /requireOwnerAdmin/);
const clearConfirmAt = logout.indexOf("req.body?.confirmation !== WHATSAPP_SESSION_CLEAR_CONFIRMATION");
assert.ok(clearConfirmAt >= 0, "session clearing must require exact owner confirmation");
for (const effect of ["destroyClient()", "fs.rmSync(AUTH_PATH", "scheduleReconnect()"])
  assert.ok(logout.indexOf(effect) > clearConfirmAt, `${effect} must happen only after owner confirmation`);

const clearGet = route('app.get("/api/admin/whatsapp/clear-session"', 'app.post("/api/admin/whatsapp/archive-session"');
assert.match(clearGet, /res\.status\(405\)/);
assert.match(clearGet, /mutation: "none"/);
for (const effect of ["destroyClient()", "fs.rmSync(", "scheduleReconnect()", "res.redirect("])
  assert.ok(!clearGet.includes(effect), `GET clear-session must not contain ${effect}`);

const archive = route('app.post("/api/admin/whatsapp/archive-session"', 'app.post("/api/admin/group/apply-identity"');
assert.match(archive, /requireOwnerAdmin/);
const archiveConfirmAt = archive.indexOf("req.body?.confirmation !== WHATSAPP_SESSION_ARCHIVE_CONFIRMATION");
assert.ok(archiveConfirmAt >= 0, "session archiving must require exact owner confirmation");
const archiveCallAt = archive.indexOf("stopAndArchiveOldWhatsAppSession(");
assert.ok(archiveCallAt > archiveConfirmAt, "session archiving must run only after owner confirmation");
assert.ok(archive.indexOf("scheduleReconnect()") > archiveCallAt, "reconnect must happen only after the archive");
assert.match(archive, /consumeRateLimit\(adminActionRate, clientAddress\(req\), 3\)/);
assert.ok(archive.indexOf("consumeRateLimit(") < archiveCallAt, "rate limit must be checked before any archive work");
assert.match(archive, /if \(isReady\) return res\.status\(409\)[\s\S]{0,200}WHATSAPP_SESSION_ARCHIVE_READY/);
assert.ok(archive.indexOf("isReady") < archiveCallAt, "a live session must be refused before anything is archived");
assert.match(archive, /includeActiveProfile: req\.body\?\.includeActiveProfile === true/);
for (const effect of ["rmSync(", "unlinkSync(", "rmdirSync(", "fs.rm("])
  assert.ok(!archive.includes(effect), `archive route must never delete (${effect})`);

const archiveHelper = route("function archiveWhatsAppSessionDirectories(", "async function stopAndArchiveOldWhatsAppSession(");
for (const effect of ["rmSync(", "unlinkSync(", "rmdirSync(", "fs.rm("])
  assert.ok(!archiveHelper.includes(effect), `archive helper must only rename, never delete (${effect})`);
assert.match(archiveHelper, /fs\.renameSync\(source, destination\)/);
assert.match(archiveHelper, /restoreTo: path\.join\(AUTH_PATH, entry\.name\)/);
assert.match(archiveHelper, /if \(entry\.name === activeProfile && !includeActiveProfile\)/);
assert.match(source, /console\.log\(`\[WhatsApp\] session archived: renamed=/);

assert.match(readme, /`GET \/api\/admin\/whatsapp\/clear-session`[^\n]*405/);
assert.match(readme, /CLEAR_WHATSAPP_SESSION_AND_RECONNECT/);
assert.match(readme, /ARCHIVE_WHATSAPP_SESSION_AND_RECONNECT/);

console.log("WhatsApp session reset/archive routes: owner-only, exact-confirmation, GET side effects disabled");
