const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

// 1) The browser that belongs to the live client, and any in-flight
//    initialization/restart, must never be killed by the orphan cleanup.
//    Killing it mid-initialize destroyed the page context and left the stored
//    WhatsApp session unusable, which is what produced the QR loop.
assert.match(server, /function liveClientBrowserPids\(\)/);
assert.match(server, /const browserProcess = getChromiumBrowserProcess\(client\);/);
assert.match(server, /async function cleanupOwnedChromiumProcesses\(label = "orphan cleanup"\) \{/);
assert.match(server, /if \(initializing \|\| whatsappRestartInFlight\) \{/);
assert.match(server, /skipped: client initialization\/restart in flight/);
assert.match(server, /const protectedPids = new Set\(liveClientBrowserPids\(\)\);/);
assert.match(server, /const ownedPids = listOwnedChromiumPids\(\)\.filter\(\(pid\) => !protectedPids\.has\(pid\)\);/);

// 2) A hung WhatsApp Web page must be detected before a confirmation card is
//    sent, instead of waiting for the 20s timeout and leaving the card pending.
assert.match(server, /async function whatsappPageResponsive\(timeoutMs = 5000\) \{/);
assert.match(server, /const page = client && \(client\.pupPage \|\| client\.page\);/);
assert.match(server, /await withTimeoutStrict\(page\.evaluate\(\(\) => 1 \+ 1\), timeoutMs, probeTimeoutMarker\)/);
assert.match(server, /if \(!\(await whatsappPageResponsive\(\)\)\) \{/);
assert.match(server, /confirmation send deferred: WhatsApp page is unresponsive/);
assert.match(server, /"whatsapp_page_unresponsive"/);
assert.match(server, /void restartWhatsApp\("confirmation send found an unresponsive WhatsApp page"\)/);

// 3) If a send still times out, self-heal the client so the delivery monitor can
//    resend once the page is healthy again.
assert.match(server, /confirmation send timed out with an unresponsive page; rebuilding the client/);

// 4) Duplicate protection must stay intact: one delivery row per order, an
//    in-flight lock, a queue de-duplicator, a group readback before resending,
//    and the guarded admin resend route.
assert.match(server, /const confirmationDeliveryInFlight = new Set\(\);/);
assert.match(server, /if \(orderId && confirmationDeliveryInFlight\.has\(orderId\)\) return null;/);
assert.match(server, /confirmationQueuedOrderIds/);
assert.match(server, /async function findFinalBookingConfirmationInGroup\(groupId, orderNo\) \{/);
assert.match(server, /app\.post\("\/api\/admin\/orders\/:id\/resend-confirmation", requireAdmin/);
assert.match(server, /if \(delivery && delivery\.status === "sent" && delivery\.message_id\) \{/);
assert.match(server, /state: "already_sent"/);

// 5) The confirmation send must stay bound to the configured clean group only.
assert.match(server, /async function sendFinalBookingConfirmationDirect\(groupId, message\) \{/);
assert.match(server, /if \(!isServer2OutboundTargetAllowed\(groupId\)\) throw new Error\("server2_group_target_not_allowed"\);/);

console.log('Clean bridge liveness guardrails verified: protected live browser, page probe before send, timeout self-heal, duplicate protection, group binding');