'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { localParts, nextThursdayOccurrence, dueSlot, businessWeekPeriod,
  createWeeklySubscriptionScheduler } = require('./weekly-subscription-scheduler');
const source = fs.readFileSync('server.js', 'utf8');
const NOW = '2026-10-16T00:00:00.000Z';
const THURSDAY = '2026-10-22T20:00:00.000Z';

function memoryDb() {
  const raw = new DatabaseSync(':memory:');
  let depth = 0;
  let counter = 0;
  return {
    raw, exec: (sql) => raw.exec(sql), prepare: (sql) => raw.prepare(sql),
    transaction(fn) {
      return (...args) => {
        const outer = depth === 0;
        const savepoint = `test_savepoint_${++counter}`;
        raw.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
        depth += 1;
        try {
          const result = fn(...args);
          raw.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
          throw error;
        } finally { depth -= 1; }
      };
    },
  };
}

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(end > start, `${name} boundary exists`);
  return source.slice(start, end);
}

function fixture(options = {}) {
  const db = memoryDb();
  db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users(id INTEGER PRIMARY KEY,phone TEXT,name TEXT,registration_name TEXT,
      role TEXT DEFAULT 'captain',wallet_cents INTEGER DEFAULT 500,active INTEGER DEFAULT 1,
      is_bot INTEGER DEFAULT 0,account_status TEXT DEFAULT 'active',archived_at TEXT,
      created_at TEXT DEFAULT '2026-10-01T00:00:00.000Z',updated_at TEXT);
    CREATE TABLE orders(id INTEGER PRIMARY KEY,producer_user_id INTEGER,captain_user_id INTEGER,status TEXT,settlement_state TEXT,updated_at TEXT,created_at TEXT);
    CREATE TABLE order_settlements(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);`);
  for (const table of ['wallet_ledger', 'captain_subscription_charges']) {
    const sql = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(sql, `production ${table} schema exists`);
    db.exec(sql[0]);
  }
  let current = NOW;
  let auditFailUser = null;
  const audit = (event, _type, id) => {
    if (event === 'captain.subscription.charged' && Number(id) === auditFailUser) throw new Error('simulated ledger audit failure');
  };
  const context = vm.createContext({ db, businessWeekPeriod, audit, isOfficialGroupAdminPhone: () => false, WHATSAPP_GROUP_ID: "", console: { error() {} },
    Intl, Date, CAPTAIN_SUBSCRIPTION_START: '2026-09-18T00:00:00.000Z',
    CAPTAIN_SUBSCRIPTION_PERIOD_DAYS: 7, CAPTAIN_SUBSCRIPTION_CENTS: 100, now: () => current });
  for (const name of ['currentCaptainSubscriptionPeriod', 'ammanDateKey',
    'manualWeeklyChargeEligibleCaptains', 'applyManualWeeklyCaptainCharges']) {
    vm.runInContext(functionSource(name), context);
  }
  const dependencies = { db,
    getSetting: (key, fallback) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? fallback,
    setSetting: (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value),
    execute: (stamp, args) => context.applyManualWeeklyCaptainCharges(stamp, args), audit,
    clock: () => current, logger: { info() {}, error() {} }, ...options };
  const scheduler = createWeeklySubscriptionScheduler(dependencies);
  function seed(id, patch = {}) {
    const { activity = true, ...userPatch } = patch;
    const row = { id, phone: `9627${String(id).padStart(8, '0')}`, name: `Captain ${id}`, ...userPatch };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO users(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row));
    if (activity) {
      const orderId = 10000 + id;
      db.prepare(`INSERT INTO orders(id,producer_user_id,captain_user_id,status,settlement_state,updated_at,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(orderId, id, null, 'completed', 'settled', row.updated_at || NOW, row.created_at || NOW);
      db.prepare(`INSERT INTO order_settlements(order_id,status) VALUES(?, 'applied')`).run(orderId);
    }
  }
  const balance = (id) => db.prepare('SELECT wallet_cents FROM users WHERE id=?').get(id).wallet_cents;
  return { db, scheduler, dependencies, context, seed, balance,
    setNow: (stamp) => { current = stamp; }, failAudit: (id) => { auditFailUser = id; } };
}

function activate(f) {
  return f.scheduler.configure({ enabled: true, hour: 23, minute: 0 });
}

test('11pm Thursday is 20:00 UTC and first occurrence is Oct 22, not now', () => {
  assert.equal(nextThursdayOccurrence(NOW), THURSDAY);
  assert.deepEqual(localParts(THURSDAY), { dateKey: '2026-10-22', hour: 23, minute: 0, weekday: 4 });
  assert.equal(nextThursdayOccurrence(THURSDAY), '2026-10-29T20:00:00.000Z');
  assert.equal(nextThursdayOccurrence('2026-12-31T20:00:00.000Z'), '2027-01-07T20:00:00.000Z');
});

test('activation changes only settings; scheduler defaults disabled', () => {
  const f = fixture(); f.seed(1);
  assert.equal(f.scheduler.status().enabled, false);
  assert.equal(f.scheduler.tick(THURSDAY).status, 'not_due');
  const c = activate(f);
  assert.equal(c.firstRunAt, THURSDAY);
  assert.equal(c.nextRunAt, THURSDAY);
  assert.equal(f.balance(1), 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 0);
  assert.equal(f.scheduler.tick(NOW).status, 'not_due');
});

test('no run before 23:00, Friday, or a missed previous week', () => {
  const config = { enabled: true, firstRunAt: THURSDAY, hour: 23, minute: 0 };
  assert.equal(dueSlot(config, '2026-10-22T19:59:59.000Z'), null);
  assert.equal(dueSlot(config, '2026-10-22T21:00:00.000Z'), null);
  assert.equal(dueSlot(config, '2026-10-23T20:00:00.000Z'), null);
  assert.equal(dueSlot(config, '2026-10-22T20:45:00.000Z').key, 'THURSDAY-2026-10-22');
});

test('charges active captains only; exact 1 JOD becomes zero and remains active', () => {
  const f = fixture();
  f.seed(1); f.seed(2, { wallet_cents: 100 });
  f.seed(3, { wallet_cents: 99 });
  f.seed(4, { created_at: '2026-10-22T01:00:00.000Z' });
  f.seed(5, { created_at: '2026-10-21T22:00:00.000Z' }); // Today in Amman, yesterday UTC.
  f.seed(6, { active: 0 }); f.seed(7, { account_status: 'suspended' });
  f.seed(8, { archived_at: NOW }); f.seed(9, { is_bot: 1 });
  f.seed(10, { role: 'company' }); f.seed(11, { account_status: 'merged' });
  f.seed(12, { created_at: 'bad-date' }); f.seed(13, { created_at: '2026-10-23T00:00:00.000Z' });
  activate(f);
  const r = f.scheduler.tick(THURSDAY);
  assert.deepEqual(r, { status: 'completed', scheduleKey: 'THURSDAY-2026-10-22', appliedCount: 2, totalCents: 200 });
  assert.equal(f.balance(1), 400); assert.equal(f.balance(2), 0);
  assert.equal(f.db.prepare('SELECT active FROM users WHERE id=2').get().active, 1);
  for (const id of [3,4,5,6,7,8,9,10,11,12,13]) assert.equal(f.balance(id), id === 3 ? 99 : 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 2);
  const details = JSON.parse(f.db.prepare('SELECT details_json FROM wallet_ledger WHERE user_id=1').get().details_json);
  assert.equal(details.scheduled, true); assert.equal(details.manual, false);
});

test('completed schedule is never rerun after restart or later top-up', () => {
  const f = fixture(); f.seed(1); f.seed(2, { wallet_cents: 50 }); activate(f);
  f.scheduler.tick(THURSDAY);
  f.db.prepare('UPDATE users SET wallet_cents=500 WHERE id=2').run();
  const restarted = createWeeklySubscriptionScheduler(f.dependencies);
  assert.equal(restarted.tick('2026-10-22T20:30:00.000Z').status, 'already_completed');
  assert.equal(f.balance(1), 400); assert.equal(f.balance(2), 500);
  assert.equal(restarted.status(THURSDAY).lastRun.appliedCount, 1);
  assert.equal(restarted.status(THURSDAY).nextRunAt, '2026-10-29T20:00:00.000Z');
});

test('manual and automatic operations share idempotency across legacy UTC boundary', () => {
  const f = fixture(); f.seed(1);
  f.context.applyManualWeeklyCaptainCharges('2026-10-16T00:00:00.000Z');
  assert.equal(f.balance(1), 400);
  const second = f.context.applyManualWeeklyCaptainCharges('2026-10-16T01:00:00.000Z');
  assert.equal(second.applied.length, 0); assert.equal(f.balance(1), 400);
  activate(f); assert.equal(f.scheduler.tick(THURSDAY).appliedCount, 1);
  assert.equal(f.balance(1), 300);
  const friday = f.context.applyManualWeeklyCaptainCharges('2026-10-23T01:00:00.000Z');
  assert.equal(friday.applied.length, 0); assert.equal(f.balance(1), 300);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 2);
});

test('the next Thursday can charge once again, and skipped new captains qualify then', () => {
  const f = fixture(); f.seed(1); f.seed(2, { created_at: '2026-10-22T01:00:00.000Z' }); activate(f);
  assert.equal(f.scheduler.tick(THURSDAY).appliedCount, 1);
  assert.equal(f.scheduler.tick('2026-10-29T20:00:00.000Z').appliedCount, 2);
  assert.equal(f.balance(1), 300); assert.equal(f.balance(2), 400);
});

test('batch failure rolls back all wallets and ledgers; retry is bounded and idempotent', () => {
  const f = fixture(); f.seed(1); f.seed(2); activate(f); f.failAudit(2);
  assert.equal(f.scheduler.tick(THURSDAY).status, 'failed');
  assert.equal(f.balance(1), 500); assert.equal(f.balance(2), 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM captain_subscription_charges').get().n, 0);
  assert.equal(f.scheduler.tick('2026-10-22T20:01:00.000Z').status, 'retry_wait');
  f.failAudit(null);
  const retry = f.scheduler.tick('2026-10-22T20:05:00.000Z');
  assert.equal(retry.appliedCount, 2); assert.equal(f.balance(1), 400);
  assert.equal(f.scheduler.status('2026-10-22T20:06:00.000Z').lastRun.attemptCount, 2);
  assert.equal(f.scheduler.tick('2026-10-22T20:10:00.000Z').status, 'already_completed');
});

test('persistent failures stop after three attempts and never catch up on Friday', () => {
  const f = fixture(); f.seed(1); activate(f); f.failAudit(1);
  for (const stamp of [THURSDAY, '2026-10-22T20:05:00.000Z', '2026-10-22T20:10:00.000Z']) assert.equal(f.scheduler.tick(stamp).status, 'failed');
  assert.equal(f.scheduler.tick('2026-10-22T20:15:00.000Z').status, 'attempt_limit');
  assert.equal(f.scheduler.tick('2026-10-22T21:00:00.000Z').status, 'not_due');
  assert.equal(f.balance(1), 500);
});

test('startup catches a missed time on the same Thursday, with only one timer', () => {
  let timerCount = 0; let clearCount = 0;
  const f = fixture({ setIntervalFn: () => { timerCount += 1; return { unref() {} }; }, clearIntervalFn: () => { clearCount += 1; } });
  f.seed(1); activate(f); f.setNow('2026-10-22T20:20:00.000Z');
  f.scheduler.start(); f.scheduler.start();
  assert.equal(timerCount, 1); assert.equal(f.balance(1), 400);
  f.scheduler.stop(); assert.equal(clearCount, 1); assert.equal(f.scheduler.status().timerRunning, false);
});

test('disable changes no wallet; invalid time and corrupted settings fail closed', () => {
  const f = fixture(); f.seed(1); activate(f);
  assert.throws(() => f.scheduler.configure({ enabled: true, hour: 24, minute: 0 }));
  assert.throws(() => f.scheduler.configure({ enabled: 'true', hour: 23, minute: 0 }));
  f.scheduler.configure({ enabled: false, hour: 23, minute: 0 });
  assert.equal(f.scheduler.tick(THURSDAY).status, 'not_due'); assert.equal(f.balance(1), 500);
  f.dependencies.setSetting('captain_weekly_schedule_v1', '{not-json');
  assert.equal(f.scheduler.status().enabled, false);
});

test('Amman business-week boundary and owner-only schedule endpoint contract', () => {
  assert.deepEqual(businessWeekPeriod('2026-10-22T20:00:00.000Z'), {
    start: '2026-10-21T21:00:00.000Z', end: '2026-10-28T21:00:00.000Z',
  });
  assert.match(source, /app\.get\("\/api\/admin\/captain-subscriptions\/schedule", requireBotWalletOwner/);
  assert.match(source, /app\.post\("\/api\/admin\/captain-subscriptions\/schedule", requireBotWalletOwner/);
  assert.match(source, /ENABLE_THURSDAY_WEEKLY_CAPTAIN_CHARGE/);
  assert.match(source, /financialMutation: false/);
  assert.match(source, /CAPTAIN_DAILY_CHARGE_ENABLED = false/);
  assert.match(source, /CAPTAIN_SUBSCRIPTION_CHARGES_ENABLED = false/);
});

test('legacy manual fee remains visible and blocks a second fee in the Amman week', () => {
  const f = fixture(); f.seed(1, { wallet_cents: 400 });
  const legacyReference = 'SUB-2026-10-09-1';
  const legacyStamp = '2026-10-15T23:50:28.740Z';
  const ledger = f.db.prepare(`INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,created_at,idempotency_key)
    VALUES(1,'subscription_fee',-100,400,?,?,?)`).run(legacyReference, legacyStamp, legacyReference);
  f.db.prepare(`INSERT INTO captain_subscription_charges(user_id,period_start,period_end,amount_cents,status,ledger_id,reference,created_at,applied_at)
    VALUES(1,'2026-10-09T00:00:00.000Z','2026-10-16T00:00:00.000Z',100,'applied',?,?,?,?)`)
    .run(ledger.lastInsertRowid, legacyReference, legacyStamp, legacyStamp);
  assert.equal(f.context.applyManualWeeklyCaptainCharges(NOW).applied.length, 0);
  assert.equal(f.balance(1), 400);
  const start = source.indexOf('app.get("/api/admin/subscriptions",');
  const end = source.indexOf('\napp.', start + 1);
  assert.ok(start > 0 && end > start);
  let handler;
  f.context.app = { get(_path, ...handlers) { handler = handlers.at(-1); } };
  f.context.requireAdmin = () => {};
  f.context.adminReadLimiter = () => {};
  f.context.v27AdminReadCache = () => (req, res, next) => next();
  f.context.money = (cents) => (Number(cents) / 100).toFixed(2);
  f.context.captainDisplayName = (name) => name;
  vm.runInContext(source.slice(start, end), f.context);
  let report;
  const res = { setHeader() {}, json(value) { report = value; } };
  handler({ query: { compact: '1' } }, res);
  assert.equal(report.periodStart, '2026-10-14T21:00:00.000Z');
  assert.equal(report.appliedCount, 1); assert.equal(report.total, '1.00');
  assert.equal(report.users[0].reference, legacyReference);
  assert.equal(report.users[0].balanceBeforeSubscriptionCents, 500);
  assert.equal(report.users[0].balanceAfterSubscriptionCents, 400);
  handler({ query: { compact: '1', periodStart: '2026-10-09T00:00:00.000Z' } }, res);
  assert.equal(report.periodStart, '2026-10-09T00:00:00.000Z');
  assert.equal(report.appliedCount, 1); assert.equal(report.total, '1.00');
  assert.equal(f.db.prepare('SELECT period_start FROM captain_subscription_charges').get().period_start, '2026-10-09T00:00:00.000Z');
});
