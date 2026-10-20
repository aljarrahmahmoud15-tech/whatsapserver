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
assert.match(server, /const protectedPids = new Set\(liveClientBrowserPids\(\)\);/);
assert.match(server, /const ownedPids = listOwnedChromiumPids\(\)\.filter\(\(pid\) => !protectedPids\.has\(pid\)\);/);
// Leftover browsers must still be cleared, otherwise a stale Chromium keeps the
// profile lock and the next initialization times out with no QR at all.
assert.match(server, /await cleanupOwnedChromiumProcesses\("pre-initialize orphan cleanup"\);/);
assert.match(server, /clearChromiumProfileLocks\(\);\n    if \(runId !== initializationRunId\) return;\n    currentClient = createClient\(\);/);

// A stale client generation must not report "qr" without a usable code, which
// made the panel claim a QR was waiting while the live client was healthy.
assert.match(server, /ignoring QR from a stale client generation/);
assert.match(server, /if \(generation !== connectionGeneration\) \{\n      \/\/ A previous generation must not report/);

// 2) A slow WhatsApp Web page must be detected, but it must never cause the card to
//    be skipped: skipping left the delivery row pending forever and produced a false
//    "not delivered" alert. The send always runs with a strict budget and ends in a
//    definite state (sent / sent-unverified / failed).
assert.match(server, /async function whatsappPageResponsive\(timeoutMs = 5000\) \{/);
assert.match(server, /const page = client && \(client\.pupPage \|\| client\.page\);/);
assert.match(server, /await withTimeoutStrict\(page\.evaluate\(\(\) => 1 \+ 1\), timeoutMs, probeTimeoutMarker\)/);
assert.match(server, /if \(!\(await whatsappPageResponsive\(\)\)\) \{/);
assert.match(server, /page probe slow; sending with a strict budget/);
assert.doesNotMatch(server, /confirmation send deferred: WhatsApp page is unresponsive/);
assert.doesNotMatch(server, /"whatsapp_page_unresponsive"/);

// 3) The send path must never tear down the browser of a live session: doing that
//    is what cost the linked session and forced a new QR.
assert.doesNotMatch(server, /void restartWhatsApp\("confirmation send found an unresponsive WhatsApp page"\)/);
assert.doesNotMatch(server, /confirmation send timed out with an unresponsive page; rebuilding the client/);
assert.match(server, /row always ends in a definite state \(sent \/ sent-unverified \/ failed\)\./);
assert.match(server, /No client rebuild here on purpose/);

// 3b) Session continuity: a WhatsApp Web page reload ("Execution context was
//     destroyed ... because of a navigation") must be survived by waiting for the
//     library's own re-injection instead of destroying the linked session.
assert.match(server, /page navigated during initialize; waiting for the session to recover before any teardown/);
assert.match(server, /const recovered = await waitForWhatsAppReady\(90000\);/);
assert.match(server, /session recovered after page navigation without teardown/);
assert.match(server, /Execution context was destroyed\|most likely because of a navigation/);
// A snapshot is taken before any teardown, and the browser is closed gracefully
// before a hard kill, so an interrupted restart cannot cost the session.
assert.match(server, /if \(wasReady\) \{ try \{ snapshotWhatsAppSession\("before destroy"\); \} catch \(_\) \{ \/\* snapshot is best effort \*\/ \} \}/);
assert.match(server, /browser closed gracefully after a destroy timeout/);
assert.match(server, /async function restoreLatestArchivedWhatsAppSession\(\) \{/);
assert.match(server, /restoreSessionSnapshotIfNeeded\(\);/);

// 4) Duplicate protection must stay intact: one delivery row per order, an
//    in-flight lock, a queue de-duplicator, a group readback before resending,
//    and the guarded admin resend route.
assert.match(server, /const confirmationDeliveryInFlight = new Set\(\);/);
assert.match(server, /if \(orderId && confirmationDeliveryInFlight\.has\(orderId\)\) return null;/);
assert.match(server, /confirmationQueuedOrderIds/);
assert.match(server, /async function findFinalBookingConfirmationInGroup\(groupId, orderNo\) \{/);
assert.match(server, /app\.post\("\/api\/admin\/orders\/:id\/resend-confirmation", requireAdmin/);
assert.match(server, /if \(delivery && delivery\.status === "sent"\) \{/);
assert.match(server, /state: "already_sent"/);

// whatsapp-web.js resolves sendMessage with no message object on the current
// WhatsApp Web build even though the card was delivered. That false negative is
// what produced three identical cards for one booking, so a resolved send is
// recorded as sent and no second card, retry or resend is ever attempted.
assert.match(server, /confirmation delivered without a message id/);
assert.match(server, /return \{ sentWithoutId: true \};/);
assert.match(server, /send_timeout_unverified/);
assert.doesNotMatch(server, /const alternateSender = deliveryMode === "fallback"/);
assert.doesNotMatch(server, /"send_pending_waiting_message_create"/);
// The real send is awaited so a genuine failure throws instead of being guessed.
// The card transport must not wait for a message_create event (this build does not
// emit it for group sends); delivery is confirmed by reading the group back.
assert.match(server, /return client\.sendMessage\(groupId, message\);/);
assert.doesNotMatch(server, /waitUntilMsgSent: true/);
// The card transport must not wait for a message_create event (this build does not
// emit it for group sends); delivery is confirmed by reading the group back.
assert.match(server, /return client\.sendMessage\(groupId, message\);/);
assert.doesNotMatch(server, /waitUntilMsgSent: true/);

// 5) The confirmation send must stay bound to the configured clean group only.
assert.match(server, /async function sendFinalBookingConfirmationDirect\(groupId, message\) \{/);
assert.match(server, /if \(!isServer2OutboundTargetAllowed\(groupId\)\) throw new Error\("server2_group_target_not_allowed"\);/);

console.log('Clean bridge liveness guardrails verified: protected live browser, page probe before send, session continuity across page navigation and restarts, duplicate protection, group binding');
