// The V26 QR button must render the code inside the panel, not rely on a popup window that a
// phone browser blocks. Guard the server route, the panel flow and the timer cleanup.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const v26 = fs.readFileSync(path.join(__dirname, 'public', 'admin-v26.html'), 'utf8');

// server: admin-only QR image route returning a PNG data URL and the live state
assert.match(server, /app\.get\("\/api\/admin\/qr-image", requireAdmin, async \(req, res\) => \{/, 'qr-image route must exist and be admin guarded');
assert.match(server, /const raw = qrCodeData \|\| baileysQrCodeData \|\| null;/, 'route must read the current QR payload');
assert.match(server, /payload\.dataUrl = await qrcode\.toDataURL\(raw\);/, 'route must render the QR to a data URL');
assert.match(server, /app\.get\("\/api\/admin\/qr-image", requireAdmin, async \(req, res\) => \{\s*res\.setHeader\("Cache-Control", "no-store, max-age=0"\);/, 'route must not be cached');

// panel: inline modal, auto refresh, manual refresh, external fallback, copy link
assert.match(v26, /async function refreshQrModal\(\)/, 'panel must fetch and render the QR inline');
assert.ok(v26.includes("api('/api/admin/qr-image')"), 'panel must call the inline QR route');
assert.match(v26, /qrModalTimer=setInterval\(refreshQrModal,20000\)/, 'panel must auto refresh the code');
assert.match(v26, /id="qrRefreshNow"/, 'panel must offer a manual refresh');
assert.match(v26, /id="qrOpenExternal"/, 'panel must keep an external-window fallback');
assert.match(v26, /id="qrCopyLink"/, 'panel must offer a copyable scan link');
assert.match(v26, /function closeModal\(\)\{stopQrModalTimer\(\);/, 'closing the modal must stop the refresh timer');
assert.match(v26, /d\.ready\)\{box\.innerHTML='<div class="notice">البوت متصل بالفعل/, 'panel must report an already-linked session');
// the old popup-only flow must be gone
assert.ok(!v26.includes("async function openQr(){const popup=window.open('about:blank'"), 'popup-only flow must be replaced');

console.log('QR inline guard verified: admin route + inline modal + auto refresh + timer cleanup');
