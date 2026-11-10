const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  COMPANY_COMMISSION_BPS,
  PRODUCER_COMMISSION_BPS,
  TOTAL_COMMISSION_BPS,
  buildIdempotencyKey,
  evaluateBalance,
  isDoneMessage,
  requiredCommissionCents,
} = require("./insufficient-balance-cleanup");

assert.equal(PRODUCER_COMMISSION_BPS + COMPANY_COMMISSION_BPS, TOTAL_COMMISSION_BPS);
assert.equal(requiredCommissionCents(1_000), 160);
assert.equal(requiredCommissionCents(10_000), 1_600);
assert.deepEqual(evaluateBalance({ balanceCents: 100, requiredCents: 160 }), {
  allowed: false,
  state: "insufficient_balance",
  balanceCents: 100,
  requiredCents: 160,
  projectedBalanceCents: -60,
});
assert.equal(evaluateBalance({ balanceCents: 160, requiredCents: 160 }).allowed, true);
assert.equal(evaluateBalance({ balanceCents: 0, requiredCents: 1, minimumBalanceCents: -100 }).allowed, true);
assert.equal(isDoneMessage(" تم "), true);
assert.equal(isDoneMessage("تم جاهز الآن"), true);
assert.equal(isDoneMessage("السعر 10"), false);
assert.equal(buildIdempotencyKey({ orderId: 12, captainId: 7 }), "INSUFFICIENT-HOME-12-CAPTAIN-7");
assert.equal(buildIdempotencyKey({ orderId: 12, captainId: 7, sourceMessageId: "abc" }), "INSUFFICIENT-HOME-12-CAPTAIN-7-SOURCE-abc");

const server = fs.readFileSync("server.js", "utf8");
assert.match(server, /require\("\.\/insufficient-balance-cleanup"\)/);
assert.match(server, /evaluateBalance\(\{/);
assert.match(server, /if \(!balanceGuard\.allowed\)/);
assert.match(server, /deleteAcceptanceMessagesForInsufficientBalance\(/);
assert.match(server, /financialMutation: false/);
assert.doesNotMatch(server, /execFileSync\([^\n]*insufficient_balance_cleanup\.py/);

console.log("Node insufficient-balance policy and server integration verified");
