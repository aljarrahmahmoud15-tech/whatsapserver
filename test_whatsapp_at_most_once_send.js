const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
assert.match(server, /const WHATSAPP_SEND_TIMEOUT = Symbol\("whatsapp_send_timeout"\);/);
assert.match(server, /async function sendWhatsAppAtMostOnce\(/);
assert.match(server, /status: "uncertain"/);
assert.match(server, /send_timeout_no_retry/);
assert.match(server, /no text fallback will be attempted/);
assert.match(server, /const recipient = resolved \|\| `\$\{recipientPhone\}@c\.us`;/);
assert.match(server, /event === "captain\.approval_notification\.test"/);

const statusStart = server.indexOf('async function sendCaptainStatusText');
const statusEnd = server.indexOf('async function retryCaptainStatusNotifications');
const statusBody = server.slice(statusStart, statusEnd);
assert.doesNotMatch(statusBody, /for \(const recipient of recipients\)/);
assert.match(statusBody, /sendWhatsAppAtMostOnce\(recipient, message\)/);

console.log('WhatsApp at-most-once send guardrails verified');
