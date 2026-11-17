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
assert.ok(archive.indexOf("stopAndArchiveOldWhatsAppSession()") > archiveConfirmAt);
assert.ok(archive.indexOf("scheduleReconnect()") > archiveConfirmAt);

assert.match(readme, /`GET \/api\/admin\/whatsapp\/clear-session`[^\n]*405/);
assert.match(readme, /CLEAR_WHATSAPP_SESSION_AND_RECONNECT/);
assert.match(readme, /ARCHIVE_WHATSAPP_SESSION_AND_RECONNECT/);

console.log("WhatsApp session reset/archive routes: owner-only, exact-confirmation, GET side effects disabled");
