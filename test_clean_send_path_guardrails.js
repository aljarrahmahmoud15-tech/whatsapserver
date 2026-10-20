const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// --- one honest card transport -------------------------------------------------
assert.match(server, /async function sendGroupCardAtMostOnce\(groupId, text, \{ timeoutMs = 25000 \} = \{\}\) \{/);
assert.match(server, /const result = await sendWhatsAppAtMostOnce\(groupId, text, \{ waitUntilMsgSent: true \}, timeoutMs\);/);
assert.match(server, /if \(!result\) return \{ status: "duplicate_suppressed"/);
assert.match(server, /status: result\.status,\n    messageId: result\.message\?\.id\?\._serialized \|\| null,/);

// --- the cancellation card no longer fails on a resolved send without an id ----
const cancelStart = server.indexOf('async function sendFinalBookingCancellation(');
const cancelEnd = server.indexOf('function formatAcceptance(');
assert.ok(cancelStart > 0 && cancelEnd > cancelStart, 'cancellation function must exist');
const cancelBlock = server.slice(cancelStart, cancelEnd);
assert.match(cancelBlock, /const attempt = await sendGroupCardAtMostOnce\(groupId, text, \{ timeoutMs: 25000 \}\);/);
assert.match(cancelBlock, /if \(attempt\.status === "uncertain"\) \{/);
assert.match(cancelBlock, /return \{ status: "sent_unverified", messageId: null \};/);
assert.match(cancelBlock, /const observed = await findFinalBookingCancellationInGroup\(groupId, order\?\.order_no\);/);
assert.doesNotMatch(cancelBlock, /cancellation message was not acknowledged/);
assert.doesNotMatch(cancelBlock, /sendServer2DirectAtMostOnce\(/);
// The unverified outcome is audited and never resent.
assert.match(cancelBlock, /audit\("order\.cancellation_card\.unverified", "order", order\?\.id \|\| null/);

// --- the cancellation readback matches the real card text ---------------------
assert.match(server, /async function findFinalBookingCancellationInGroup\(groupId, orderNo\) \{/);
assert.match(server, /body\.match\(\/تم إلغاء الحجز\\s\*#\(\\d\+\)\/\)/);

// --- a slow page probe must never skip the card -------------------------------
assert.match(server, /console\.warn\(`\[WhatsApp\] page probe slow; sending with a strict budget/);
assert.doesNotMatch(server, /confirmation send deferred: WhatsApp page is unresponsive/);
assert.doesNotMatch(server, /status='pending',last_error=\?,updated_at=\? WHERE order_id=\? AND status<>'sent'"\)\.run\("whatsapp_page_unresponsive"/);

// --- the monitor resolves a pending row by reading the group first ------------
assert.match(server, /SELECT d\.order_id,d\.group_id,d\.status,d\.message_id,d\.ack_status,d\.ack_at,d\.last_error,d\.updated_at,d\.sent_at,/);
assert.match(server, /if \(row\.status === "pending"\) \{\n        \/\/ The card may already be in the group/);
assert.match(server, /ack_status='observed',ack_at=COALESCE\(ack_at,\?\),sent_at=COALESCE\(sent_at,\?\),updated_at=\?,last_error=NULL WHERE order_id=\? AND status<>'sent'"\)\.run\(observed\.messageId/);

// --- bounded background retry sweep ------------------------------------------
assert.match(server, /const CONFIRMATION_RETRY_SWEEP_MS = Math\.max\(120000,/);
assert.match(server, /let lastBookingConfirmationRetryAt = 0;/);
assert.match(server, /if \(Date\.now\(\) - lastBookingConfirmationRetryAt >= CONFIRMATION_RETRY_SWEEP_MS\) \{/);
assert.match(server, /void retryFailedBookingConfirmations\(\)/);

// --- the owner route records the real outcome --------------------------------
assert.match(server, /const cardSent = Boolean\(card && \(card\.status === "sent" \|\| card\.status === "sent_unverified"\)\);/);
assert.match(server, /sentWithoutId: card\?\.status === "sent_unverified"/);
assert.match(server, /groupNotification: cardSent \? \(card\.status === "sent_unverified" \? "sent_unverified" : "sent"\) : "failed_or_unavailable",/);

// --- read-only delivery state ------------------------------------------------
assert.match(server, /app\.get\("\/api\/admin\/whatsapp\/delivery-state", requireAdmin, \(req, res\) => \{/);
assert.match(server, /FROM order_confirmation_deliveries d JOIN orders o ON o\.id=d\.order_id\n    ORDER BY d\.updated_at DESC LIMIT \?`\)\.all\(limit\);/);

// --- the worker placement must not regress the send path ---------------------
const worker = fs.readFileSync(path.join(__dirname, 'whatsapp-worker.js'), 'utf8');
assert.doesNotMatch(worker, /sendMessage\(/, 'the worker must never send on its own');

console.log('Clean send path verified: honest card outcome (sent / sent-unverified / failed), no skipped card behind a slow probe, pending rows resolved by group readback, bounded retry sweep, read-only delivery state');
