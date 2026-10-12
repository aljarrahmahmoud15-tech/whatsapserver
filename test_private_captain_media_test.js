'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /app\.post\("\/api\/admin\/captains\/:phone\/private-media-test", requireAdmin/);
assert.match(source, /PRIVATE_CAPTAIN_MEDIA_TEST_CONFIRMATION/);
assert.match(source, /req\.body\?\.test !== true/);
assert.match(source, /X-Idempotency-Key/);
assert.match(source, /captain\.private_media_test/);
assert.match(source, /resolveWhatsAppRecipientId\(phone\)/);
assert.match(source, /renderOperationsMessageMedia\(title/);
assert.match(source, /sendWhatsAppAtMostOnce\(recipient, media, \{ caption: message \}, 30000\)/);
assert.match(source, /mutation: "none", walletChanged: false/);
const route = source.slice(source.indexOf('app.post("/api/admin/captains/:phone/private-media-test"'), source.indexOf('app.post("/api/captain/login"'));
assert.doesNotMatch(route, /wallet_ledger|wallet_cents\s*=|topup_cards/);
assert.match(route, /delivery_status/);
assert.match(route, /messageId/);
console.log('private captain media test route guardrails verified');
