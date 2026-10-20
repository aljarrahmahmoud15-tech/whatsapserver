// Guardrails for the unrestricted booking pin path on the clean instance.
//   node test_clean_pin_unrestricted_guardrails.js
const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("server.js", "utf8");

// 1) An unregistered party must not block pinning any more.
assert.ok(
  !source.includes('reason: !captain ? "captain_not_registered" : "producer_not_registered"'),
  "the pin route must not refuse an unregistered producer"
);
assert.ok(
  source.includes("settleHistoricalConfirmedOrder({ orderId: order.id, captainId: captain?.id || null") &&
    source.includes("captainSnapshot, producerSnapshot });"),
  "the pin route must pass snapshot identities into the settlement"
);
assert.ok(
  /const producer = registeredProducer \|\| \(producerSnapshotPhone/.test(source),
  "the historical settlement must fall back to the producer phone snapshot"
);
assert.ok(
  /const producer = registeredProducer \|\| \(producerSnapshotPhone \? \{ id: null/.test(source),
  "the pending settlement must fall back to the producer phone snapshot"
);

// 1b) The executor identity may be recovered from the order row as well.
assert.ok(/if \(!captainPhone && order && order\.captain_phone_snapshot\)/.test(source), "the pin must reuse the captured executor phone");
assert.ok(/const rowCaptainName = order && order\.captain_name_snapshot/.test(source), "the pin must reuse the captured executor name");

// 2) No wallet mutation for a party without a wallet row.
assert.ok(
  /if \(producer\.id\) \{\s*\n\s*db\.prepare\("UPDATE users SET wallet_cents=wallet_cents\+\?/.test(source),
  "the producer credit must be skipped when the producer has no wallet row"
);
assert.ok(
  /if \(walletOwner\.id\) \{\s*\n\s*db\.prepare\("UPDATE users SET wallet_cents=wallet_cents-\?/.test(source),
  "the executor debit must be skipped when the executor has no wallet row"
);

// 3) The like must be authorized by the poster's snapshot phone.
assert.ok(
  /!producer && producerPhoneSnapshot && approverNormalizedPhone === producerPhoneSnapshot/.test(source),
  "the reaction gate must accept the poster snapshot phone"
);

// 4) The owner-authorized pin window is bounded and reports partial work.
assert.ok(source.includes("Math.min(Number.isFinite(requestedHours) ? requestedHours : 24, 168)"), "hours must stay clamped");
assert.ok(source.includes("Math.max(1, Math.min(requestedLimit, 200))"), "the store read must be bounded to 200 messages");
assert.ok(source.includes("const pinDeadline = Date.now() + 45000;"), "the pin route must carry a processing deadline");
assert.ok(source.includes("partial: pinPartial"), "the pin response must report partial processing");

// 5) Isolation: no sibling identity may appear in the changed path.
assert.ok(
  /PUBLIC_APP_URL = String\(process\.env\.PUBLIC_BASE_URL \|\| process\.env\.RENDER_EXTERNAL_URL \|\| \(CLEAN_INSTANCE \? "https:\/\/whatsapserver-clean\.onrender\.com"/.test(source),
  "the clean instance must keep its own public identity"
);
assert.ok(source.includes('const CLEAN_BOT_PHONE_INTL = "962797907580";'), "the clean bot phone must stay pinned");
assert.ok(source.includes('const CLEAN_GROUP_ID = "120363430477331505@g.us";'), "the clean group must stay pinned");
assert.ok(!source.includes("12036342660456061@g.us"), "the sibling group id must never appear in clean");
// Isolation inside the changed pin path only: no sibling identity may be used there.
const pinBlocks = [];
for (const marker of ["function settlePendingOrder", "function settleHistoricalConfirmedOrder"]) {
  const from = source.indexOf(marker);
  assert.ok(from > -1, `${marker} must exist`);
  pinBlocks.push(source.slice(from, source.indexOf("\n}\n", from) + 3));
}
{
  const from = source.indexOf('app.post("/api/admin/group/import-confirmed-orders"');
  assert.ok(from > -1, "the owner pin route must exist");
  pinBlocks.push(source.slice(from, from + 14000));
}
for (const block of pinBlocks) {
  for (const pattern of [/962779110123/, /0779110123/, /whatsapserver-2\.onrender\.com/, /12036342660456061@g\.us/]) {
    assert.ok(!pattern.test(block), `sibling identity inside the pin path: ${pattern}`);
  }
}

// 6) The configured-group and outbound guards stay in place.
assert.ok(source.includes("isConfiguredGroup(groupId)"), "the pin route must stay bound to the configured group");
assert.ok(source.includes("rejectCleanOutboundOperation"), "the outbound policy guard must stay in place");

console.log("pin guardrails OK");