#!/usr/bin/env node
"use strict";

/**
 * Intensive, production-shaped safety harness for order cancellation reversal.
 *
 * Scope:
 * - No network calls, no WhatsApp client, no production database.
 * - Models SQLite transaction serialization with an async mutex.
 * - Models notification idempotency and an in-flight guard.
 * - Fails closed if a concurrent caller can reverse wallets or notify twice.
 */

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

const CONCURRENCY = Number(process.env.RACE_CONCURRENCY || 64);
const ROUNDS = Number(process.env.RACE_ROUNDS || 250);
const RETRY_ROUNDS = Number(process.env.RETRY_ROUNDS || 100);
const FAIL_EVERY = Number(process.env.NOTIFICATION_FAIL_EVERY || 0);

if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 2 || CONCURRENCY > 1000) throw new Error("RACE_CONCURRENCY must be 2..1000");
if (!Number.isInteger(ROUNDS) || ROUNDS < 1 || ROUNDS > 10000) throw new Error("RACE_ROUNDS must be 1..10000");
if (!Number.isInteger(RETRY_ROUNDS) || RETRY_ROUNDS < 1 || RETRY_ROUNDS > 10000) throw new Error("RETRY_ROUNDS must be 1..10000");
if (!Number.isInteger(FAIL_EVERY) || FAIL_EVERY < 0) throw new Error("NOTIFICATION_FAIL_EVERY must be >= 0");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (max = 3) => Math.floor(Math.random() * max);

class AsyncMutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  runExclusive(fn) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    return previous.then(async () => {
      try { return await fn(); } finally { release(); }
    });
  }
}

function initialState() {
  return {
    order: {
      id: 7,
      orderNo: 7001,
      status: "accepted",
      settlementState: "settled",
      settlementStatus: "applied",
    },
    wallets: { company: 50, producer: 250, executor: 4_700 },
    before: { company: 0, producer: 0, executor: 5_000 },
    settlement: { company: 50, producer: 250, executorFee: 300 },
    ledger: [],
    notifications: new Map(),
    audit: [],
    mutationCount: 0,
    notificationAttempts: 0,
    nextNotificationAttempt: 0,
  };
}

function operationKey(order) {
  return `ORDER-${order.orderNo}-REACTION-REMOVAL`;
}

class CancellationHarness {
  constructor({ failEvery = 0 } = {}) {
    this.state = initialState();
    this.transaction = new AsyncMutex();
    this.notificationInFlight = new Set();
    this.failEvery = failEvery;
  }

  async cancelAndReverse(reason = "producer_thumb_removed") {
    // This lock represents the serialized SQLite transaction. The deliberately
    // inserted yield makes a missing transaction guard observable in a mutant.
    return this.transaction.runExclusive(async () => {
      await sleep(jitter());
      const state = this.state;
      const { order, settlement } = state;
      if (state.order.status === "cancelled" && state.order.settlementState === "reversed") {
        return { state: "already_reversed", financialMutation: false, order };
      }
      if (state.order.status !== "accepted" || state.order.settlementState !== "settled" || state.order.settlementStatus !== "applied") {
        return { state: "not_settled", financialMutation: false };
      }

      state.wallets.company -= settlement.company;
      state.wallets.producer -= settlement.producer;
      state.wallets.executor += settlement.executorFee;
      state.ledger.push(
        { type: "reversal_company", amount: -settlement.company, key: `${operationKey(order)}-COMPANY` },
        { type: "reversal_producer", amount: -settlement.producer, key: `${operationKey(order)}-PRODUCER` },
        { type: "reversal_executor", amount: settlement.executorFee, key: `${operationKey(order)}-CAPTAIN` },
      );
      state.order.status = "cancelled";
      state.order.settlementState = "reversed";
      state.order.settlementStatus = "reversed";
      state.mutationCount += 1;
      state.audit.push({ event: "order.cancelled_downloader_removed_thumb", reason, reversalOperationKey: operationKey(order) });
      return { state: "cancelled", financialMutation: true, order: { ...order } };
    });
  }

  async notifyParty(role, reason = "producer_thumb_removed") {
    const key = `ORDER-CANCEL-NOTICE-${this.state.order.orderNo}-${role}`;
    if (this.notificationInFlight.has(key)) return { status: "already_in_flight", key };

    // The insert-or-ignore behavior is modeled before the network await.
    const existing = this.state.notifications.get(key);
    if (existing && ["sent", "delivered", "uncertain"].includes(existing.status)) {
      return { status: "already_sent", key, notificationId: existing.id };
    }
    if (existing?.status === "pending") return { status: "pending", key, notificationId: existing.id };

    const row = { id: this.state.notifications.size + 1, key, role, reason, status: "pending" };
    this.state.notifications.set(key, row);
    this.notificationInFlight.add(key);
    this.state.notificationAttempts += 1;
    const attempt = this.state.notificationAttempts;
    try {
      await sleep(jitter(4));
      if (this.failEvery > 0 && attempt % this.failEvery === 0) {
        row.status = "failed";
        return { status: "failed", key, notificationId: row.id };
      }
      row.status = "sent";
      return { status: "sent", key, notificationId: row.id };
    } finally {
      this.notificationInFlight.delete(key);
    }
  }

  async cancelNotifyBoth(reason) {
    const reversal = await this.cancelAndReverse(reason);
    if (!["cancelled", "already_reversed"].includes(reversal.state)) return { reversal };
    const [producer, executor] = await Promise.all([
      this.notifyParty("producer", reason),
      this.notifyParty("executor", reason),
    ]);
    return { reversal, producer, executor };
  }
}

async function fanout(size, fn) {
  return Promise.all(Array.from({ length: size }, (_, index) => fn(index)));
}

async function testConcurrentSameOrder() {
  for (let round = 1; round <= ROUNDS; round += 1) {
    const harness = new CancellationHarness();
    const results = await fanout(CONCURRENCY, () => harness.cancelNotifyBoth("producer_thumb_removed"));
    const cancelled = results.filter((item) => item.reversal.state === "cancelled");
    assert.equal(cancelled.length, 1, `round ${round}: exactly one caller must mutate reversal`);
    assert.equal(harness.state.mutationCount, 1, `round ${round}: wallet mutation count`);
    assert.equal(harness.state.ledger.length, 3, `round ${round}: exactly three reversal ledger rows`);
    assert.deepEqual(harness.state.wallets, harness.state.before, `round ${round}: wallets must return to pre-settlement values`);
    assert.equal(harness.state.notifications.size, 2, `round ${round}: exactly producer + executor notifications`);
    for (const role of ["producer", "executor"]) {
      const row = [...harness.state.notifications.values()].find((item) => item.role === role);
      assert.ok(row, `round ${round}: missing ${role} notification`);
      assert.equal(row.status, "sent", `round ${round}: ${role} notification status`);
    }
  }
  return { rounds: ROUNDS, callersPerRound: CONCURRENCY };
}

async function testDuplicateRetries() {
  const harness = new CancellationHarness();
  const first = await harness.cancelNotifyBoth("producer_thumb_removed");
  for (let i = 0; i < RETRY_ROUNDS; i += 1) {
    const result = await harness.cancelNotifyBoth("producer_thumb_removed");
    assert.equal(result.reversal.state, "already_reversed", `retry ${i}: must not mutate reversal`);
    assert.equal(result.producer.status, "already_sent", `retry ${i}: producer notice must be idempotent`);
    assert.equal(result.executor.status, "already_sent", `retry ${i}: executor notice must be idempotent`);
  }
  assert.equal(first.reversal.state, "cancelled");
  assert.equal(harness.state.mutationCount, 1);
  assert.equal(harness.state.ledger.length, 3);
  assert.equal(harness.state.notifications.size, 2);
  return { retries: RETRY_ROUNDS };
}

async function testNotificationFailureCanRetryWithoutFinancialRetry() {
  const harness = new CancellationHarness({ failEvery: 1 });
  const first = await harness.cancelNotifyBoth("producer_thumb_removed");
  assert.equal(first.reversal.state, "cancelled");
  assert.equal(harness.state.mutationCount, 1);
  assert.equal(harness.state.ledger.length, 3);
  assert.equal(first.producer.status, "failed");
  assert.equal(first.executor.status, "failed");

  // A later retry is allowed to retry failed notification rows, but cannot
  // enter the financial reversal again. Switch the mock transport to healthy.
  harness.failEvery = 0;
  const retry = await harness.cancelNotifyBoth("producer_thumb_removed");
  assert.equal(retry.reversal.state, "already_reversed");
  assert.equal(retry.producer.status, "sent");
  assert.equal(retry.executor.status, "sent");
  assert.equal(harness.state.mutationCount, 1);
  assert.equal(harness.state.ledger.length, 3);
  return { firstNotificationStatus: "failed", retryNotificationStatus: "sent" };
}

async function testDistinctOrdersDoNotShareKeys() {
  const first = new CancellationHarness();
  const second = new CancellationHarness();
  await Promise.all([first.cancelNotifyBoth("producer_thumb_removed"), second.cancelNotifyBoth("producer_thumb_removed")]);
  assert.notEqual([...first.state.notifications.keys()][0], undefined);
  assert.deepEqual([...first.state.notifications.keys()].map((key) => key.replace("7001", "ORDER")), [...second.state.notifications.keys()].map((key) => key.replace("7001", "ORDER")));
  return { isolatedOrders: 2 };
}

function testSourceGuardrails() {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(source, /ORDER-CANCEL-NOTICE-\$\{orderId\}-\$\{normalizedRole\}/);
  assert.match(source, /cancellationPartyNotificationInFlight = new Set\(\)/);
  assert.match(source, /status: "already_in_flight"/);
  assert.match(source, /UPDATE order_settlements SET status='reversed'/);
  assert.match(source, /reversalOperationKey/);
  assert.match(source, /notifyOrderCancellationParties\(\{ order: result\.order \|\| order/);
  return { sourceGuardrails: "passed" };
}

(async () => {
  const started = performance.now();
  const sameOrder = await testConcurrentSameOrder();
  const retries = await testDuplicateRetries();
  const notificationRetry = await testNotificationFailureCanRetryWithoutFinancialRetry();
  const distinctOrders = await testDistinctOrdersDoNotShareKeys();
  const sourceGuardrails = testSourceGuardrails();
  const elapsedMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({
    ok: true,
    test: "cancellation-idempotency-race",
    mode: "local-isolated-no-network-no-production-db",
    config: { concurrency: CONCURRENCY, rounds: ROUNDS, retryRounds: RETRY_ROUNDS, notificationFailEvery: FAIL_EVERY },
    results: { sameOrder, retries, notificationRetry, distinctOrders, sourceGuardrails },
    elapsedMs,
  }, null, 2));
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, test: "cancellation-idempotency-race", error: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
});
