"use strict";
// Owner-approved bounded fix (2026-11-22): the two settled-order cancellation paths that fire when
// the downloader removes 👍 from the executor's «تم» message must post the DETAILED cancellation card
// (booking number, route, price, reversal line), not the generic 2-line text. The money behaviour is
// unchanged; only the argument passed to sendFinalBookingCancellation() changes.
// This file proves: (1) the two call sites pass an order, (2) the three pending-candidate sites stay
// generic on purpose (their cancel helper returns no order/settlement), (3) the notification guards
// are still present, (4) the rendered text is the 6-line detailed card for a real orders row.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");

// --- 1) The two settled-order reaction-removal sites pass the order object. ---
const detailedCalls = [
  'void sendFinalBookingCancellation(target.from, cancelled.order || acceptedOrder).catch(() => null)',
  'void sendFinalBookingCancellation(target.from, result.order || order).catch(() => null)',
];
for (const call of detailedCalls) {
  assert.equal(source.split(call).length - 1, 1, `detailed cancellation card call exists once: ${call.slice(0, 60)}`);
}
// Each new call must sit in the same branch that already notifies the parties with the same object,
// so the card can never reference a booking the reversal did not touch.
const branches = [
  ["notifyOrderCancellationParties({ order: cancelled.order || acceptedOrder", 'sendFinalBookingCancellation(target.from, cancelled.order || acceptedOrder)'],
  ["notifyOrderCancellationParties({ order: result.order || order", 'sendFinalBookingCancellation(target.from, result.order || order)'],
];
for (const [notify, card] of branches) {
  const notifyAt = source.indexOf(notify);
  const cardAt = source.indexOf(card);
  assert.ok(notifyAt >= 0 && cardAt > notifyAt && cardAt - notifyAt < 600, "card call follows its reversal branch with the same order object");
}

// --- 2) The pending-candidate sites stay generic deliberately (no order, no settlement exists). ---
const bareCalls = source.match(/void sendFinalBookingCancellation\(target\.from\)\.catch\(\(\) => null\)/g) || [];
assert.equal(bareCalls.length, 3, "exactly three pending-candidate sites keep the generic card");
const pendingHelperStart = source.indexOf("function cancelPendingOrderForProducerReaction");
const pendingHelperEnd = source.indexOf("\nfunction ", pendingHelperStart + 10);
assert.ok(pendingHelperStart >= 0 && pendingHelperEnd > pendingHelperStart, "pending cancel helper slice exists");
const pendingHelper = source.slice(pendingHelperStart, pendingHelperEnd);
assert.match(pendingHelper, /return \{ state: "cancelled", candidate: current, producer, acceptance \}/);
assert.doesNotMatch(pendingHelper, /return \{ state: "cancelled", order:/, "pending helper still returns no settled order");
// The settled-order helper is the one that carries an order, and it is untouched by this fix.
const settledHelperStart = source.indexOf("function cancelOrderForReactionRemoval");
const settledHelperEnd = source.indexOf("\nfunction ", settledHelperStart + 10);
const settledHelper = source.slice(settledHelperStart, settledHelperEnd);
assert.match(settledHelper, /return \{ state: "cancelled", order: current, producer, captain, reversed: true \}/);
assert.equal(settledHelper.includes("settlement"), true, "reversal helper keeps its settlement logic in view");

// --- 3) Guards inside the card sender must remain equal or stricter. ---
const senderStart = source.indexOf("async function sendFinalBookingCancellation");
const senderEnd = source.indexOf("\nfunction ", senderStart + 10);
const sender = source.slice(senderStart, senderEnd);
assert.match(sender, /notificationEnabled\("cancellationCards"\)/, "owner notification setting still gates the card");
assert.match(sender, /isOfficialGroupTarget\(groupId\)/, "official group target still required");
assert.match(sender, /sendServer2DirectAtMostOnce\(/, "at-most-once send idempotency still used");
assert.match(sender, /suppressed/, "suppression audit line still emitted");
assert.doesNotMatch(sender, /financialMutation: true/, "card sender performs no financial mutation");

// --- 4) Behaviour: real orders row renders the detailed 6-line card. ---
const textStart = source.indexOf("function finalBookingCancellationText");
const textEnd = source.indexOf("\nconst confirmationDeliveryInFlight", textStart);
assert.ok(textStart >= 0 && textEnd > textStart, "card text function slice exists");
const moneyLine = source.match(/^const money = .*$/m);
assert.ok(moneyLine, "money helper found");
const context = { module: { exports: {} } };
vm.createContext(context);
vm.runInContext(`${moneyLine[0]}\n${source.slice(textStart, textEnd)}\nthis.finalBookingCancellationText = finalBookingCancellationText;`, context);

// Shape mirrors `SELECT * FROM orders` for a settled booking (snapshots are written on settle).
const settledRow = {
  id: 905,
  order_no: 905,
  price_cents: 500,
  origin: "جبل عمان",
  destination: "كفر اسد",
  producer_name_snapshot: "Marwan M",
  captain_name_snapshot: "Alaa Khresat",
  status: "cancelled",
  accepted_message_id: "false_GROUP_HASH_259235636088891@lid",
};
const detailed = context.finalBookingCancellationText(settledRow).split("\n");
assert.equal(detailed.length, 6, "detailed card has six lines");
assert.equal(detailed[0], "🏠 المنزل: Marwan M");
assert.equal(detailed[1], "🚕 المنفذ: Alaa Khresat");
assert.equal(detailed[2], "🔴 إلغاء الحجز #905");
assert.equal(detailed[3], "📍 جبل عمان ← كفر اسد");
assert.equal(detailed[4], "💰 5.00 JOD");
assert.equal(detailed[5], "↩️ عُكست التسوية ولا توجد عمولة.");

// A row missing snapshots must still render safely, and never leak an identifier or a phone number.
const bareRow = { order_no: 906, price_cents: 700, accepted_message_id: "false_120363426604560611@g.us_ABCDEF_99@lid" };
const fallback = context.finalBookingCancellationText(bareRow);
assert.equal(fallback.split("\n").length, 6);
assert.match(fallback, /🔴 إلغاء الحجز #906/);
assert.match(fallback, /غير محدد/);
assert.doesNotMatch(fallback, /\d{7,}/, "card never prints a long digit run");
assert.doesNotMatch(fallback, /@lid|@g\.us/, "card never prints WhatsApp identifiers");

// The generic text is unchanged for candidate-only cancellations.
const generic = context.finalBookingCancellationText(null).split("\n");
assert.deepEqual(generic, ["🔴 رفض أو إلغاء الطلب", "📌 غير معتمد — لا توجد عمولة أو تسوية."]);

console.log("cancellation card order-context guard passed");
