const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
assert.match(server, /const WHATSAPP_SEND_TIMEOUT = Symbol\("whatsapp_send_timeout"\);/);
assert.match(server, /async function sendWhatsAppAtMostOnce\(/);
assert.match(server, /status: "uncertain"/);
assert.match(server, /send_timeout_no_retry/);
assert.match(server, /no text fallback will be attempted/);
assert.match(server, /event === "captain\.approval_notification\.test"/);

const statusStart = server.indexOf('async function sendCaptainStatusText');
const statusEnd = server.indexOf('async function retryCaptainStatusNotifications');
const statusBody = server.slice(statusStart, statusEnd);
assert.match(statusBody, /const candidates = \[\.\.\.new Set\(\[resolved, `\$\{recipientPhone\}@c\.us`\]/);
assert.match(statusBody, /attemptedRecipientTypes/);
assert.match(statusBody, /sendWhatsAppAtMostOnce\(recipient, message\)/);
assert.match(statusBody, /if \(result\.status === "uncertain"\)/);
assert.match(statusBody, /if \(!\['failed', 'blocked'\]\.includes\(result\.status\)\) break;/);
assert.match(statusBody, /deliveryError/);

console.log('WhatsApp at-most-once send guardrails verified');
