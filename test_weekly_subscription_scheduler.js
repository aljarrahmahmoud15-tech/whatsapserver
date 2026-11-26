'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { localParts, nextFridayOccurrence, dueSlot, businessWeekPeriod,
  createWeeklySubscriptionScheduler } = require('./weekly-subscription-scheduler');
const source = fs.readFileSync('server.js', 'utf8');
const schedulerSource = fs.readFileSync('weekly-subscription-scheduler.js', 'utf8');
const NOW = '2026-10-16T12:00:00.000Z';
const FRIDAY = '2026-10-23T11:00:00.000Z';
const GROUP = 'approved-group@g.us';
const OTHER_GROUP = 'unapproved-group@g.us';
const DEFAULT_POLICY_START = '2026-09-18T00:00:00.000Z';

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
    CREATE TABLE orders(id INTEGER PRIMARY KEY,order_no INTEGER UNIQUE,source_message_id TEXT UNIQUE,
      group_id TEXT NOT NULL,raw_text TEXT NOT NULL,price_cents INTEGER NOT NULL,producer_user_id INTEGER,
      status TEXT,captain_user_id INTEGER,accepted_message_id TEXT,accepted_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE order_candidates(id INTEGER PRIMARY KEY AUTOINCREMENT,source_message_id TEXT UNIQUE,
      group_id TEXT NOT NULL,raw_text TEXT NOT NULL,price_cents INTEGER NOT NULL,producer_user_id INTEGER NOT NULL,
      status TEXT,final_order_id INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE order_settlements(id INTEGER PRIMARY KEY,order_id INTEGER UNIQUE,status TEXT);`);
  for (const table of ['wallet_ledger', 'captain_subscription_charges']) {
    const sql = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(sql, `production ${table} schema exists`);
    db.exec(sql[0]);
  }
  let current = options.now || NOW;
  const defaultActivityAt = options.activityAt || '2026-10-19T12:00:00.000Z';
  let auditFailUser = null;
  const getSetting = (key, fallback) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? fallback;
  const setSetting = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  if (options.policyStart === undefined) setSetting('captain_weekly_activity_policy_start_v1', DEFAULT_POLICY_START);
  else if (options.policyStart !== null) setSetting('captain_weekly_activity_policy_start_v1', options.policyStart);
  const configuredGroup = options.officialGroupId === undefined ? GROUP : options.officialGroupId;
  const groupEnabled = options.groupConfigured !== false;
  const audit = (event, _type, id) => {
    if (event === 'captain.subscription.charged' && Number(id) === auditFailUser) throw new Error('simulated ledger audit failure');
  };
  const context = vm.createContext({ db, businessWeekPeriod, getSetting, setSetting, audit,
    isOfficialGroupAdminPhone: (phone) => Boolean(options.adminPhones?.includes(phone)),
    configuredRuntimeGroupId: () => groupEnabled ? configuredGroup : '',
    isConfiguredGroup: (id) => groupEnabled && Boolean(configuredGroup) && id === configuredGroup,
    WHATSAPP_GROUP_ID: '', console: { error() {} }, Intl, Date,
    CAPTAIN_SUBSCRIPTION_START: '2026-09-18T00:00:00.000Z', CAPTAIN_SUBSCRIPTION_PERIOD_DAYS: 7,
    CAPTAIN_SUBSCRIPTION_CENTS: 100, CAPTAIN_MIN_BALANCE_CENTS: 0, now: () => current });
  for (const name of ['ensureCaptainSubscriptionActivityPolicyStart', 'currentCaptainSubscriptionPeriod',
    'ammanDateKey', 'weeklyChargeEligibleCaptains', 'manualWeeklyChargeEligibleCaptains', 'applyManualWeeklyCaptainCharges']) {
    vm.runInContext(functionSource(name), context);
  }
  const dependencies = { db, getSetting, setSetting,
    execute: (stamp, args) => context.applyManualWeeklyCaptainCharges(stamp, args), audit,
    clock: () => current, logger: { info() {}, error() {} }, ...options };
  const scheduler = createWeeklySubscriptionScheduler(dependencies);

  function insertCaptain(id, patch = {}) {
    const row = { id, phone: `fixture-captain-${id}`, name: `Captain ${id}`, ...patch };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO users(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row));
  }

  function seedAccepted(id, activity = {}) {
    const orderId = activity.orderId || 10000 + id;
    const sourceMessageId = activity.sourceMessageId || `SOURCE-${id}`;
    const producerUserId = activity.producerUserId ?? 90000 + id;
    const groupId = activity.groupId || GROUP;
    const status = activity.status || 'completed';
    const candidateStatus = activity.candidateStatus || (status === 'cancelled' ? 'cancelled' : 'finalized');
    const finalOrderId = Object.hasOwn(activity, 'finalOrderId') ? activity.finalOrderId : (candidateStatus === 'finalized' ? orderId : null);
    const acceptedMessageId = Object.hasOwn(activity, 'acceptedMessageId') ? activity.acceptedMessageId : `ACCEPT-${id}`;
    const acceptedAt = activity.acceptedAt || defaultActivityAt;
    const rawText = Object.hasOwn(activity, 'rawText') ? activity.rawText : 'valid fixture ride';
    const priceCents = Object.hasOwn(activity, 'priceCents') ? activity.priceCents : 500;
    db.prepare(`INSERT INTO orders(id,order_no,source_message_id,group_id,raw_text,price_cents,producer_user_id,
      status,captain_user_id,accepted_message_id,accepted_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderId, orderId, sourceMessageId, groupId, rawText, priceCents,
      producerUserId, status, id, acceptedMessageId, acceptedAt, acceptedAt, acceptedAt);
    db.prepare(`INSERT INTO order_candidates(source_message_id,group_id,raw_text,price_cents,producer_user_id,
      status,final_order_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(sourceMessageId, groupId, rawText, priceCents, producerUserId, candidateStatus, finalOrderId, acceptedAt, acceptedAt);
    const settlementStatus = activity.settlementStatus === undefined ? 'applied' : activity.settlementStatus;
    if (settlementStatus) {
      db.prepare('INSERT INTO order_settlements(order_id,status) VALUES(?,?)').run(orderId, settlementStatus);
    }
  }

  function seedPost(id, post = {}) {
    const sourceMessageId = post.sourceMessageId || `POST-${id}`;
    const createdAt = post.createdAt || defaultActivityAt;
    db.prepare(`INSERT INTO order_candidates(source_message_id,group_id,raw_text,price_cents,producer_user_id,
      status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(sourceMessageId, post.groupId || GROUP,
        Object.hasOwn(post, 'rawText') ? post.rawText : 'valid fixture ride',
        Object.hasOwn(post, 'priceCents') ? post.priceCents : 500,
        id, post.status || 'candidate', createdAt, createdAt);
  }

  function seed(id, patch = {}) {
    const { activity = true, ...userPatch } = patch;
    insertCaptain(id, userPatch);
    if (activity) seedAccepted(id, typeof activity === 'object' ? activity : {});
  }

  const balance = (id) => db.prepare('SELECT wallet_cents FROM users WHERE id=?').get(id).wallet_cents;
  return { db, scheduler, dependencies, context, seed, seedPost, seedAccepted, balance,
    setNow: (stamp) => { current = stamp; }, failAudit: (id) => { auditFailUser = id; } };
}

function activate(f, hour = 14, minute = 0) {
  return f.scheduler.configure({ enabled: true, hour, minute });
}

test('2pm Friday is 11:00 UTC and next occurrence is Oct 23 after the current slot', () => {
  assert.equal(nextFridayOccurrence(NOW), FRIDAY);
  assert.deepEqual(localParts(FRIDAY), { dateKey: '2026-10-23', hour: 14, minute: 0, weekday: 5 });
  assert.equal(nextFridayOccurrence(FRIDAY), '2026-10-30T11:00:00.000Z');
  assert.equal(nextFridayOccurrence('2026-12-31T20:00:00.000Z'), '2027-01-01T11:00:00.000Z');
});

test('activation changes only settings; scheduler defaults disabled', () => {
  const f = fixture(); f.seed(1);
  assert.equal(f.scheduler.status().enabled, false);
  assert.equal(f.scheduler.tick(FRIDAY).status, 'not_due');
  const c = activate(f);
  assert.equal(c.firstRunAt, FRIDAY);
  assert.equal(c.nextRunAt, FRIDAY);
  assert.equal(f.balance(1), 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 0);
  assert.equal(f.scheduler.tick(NOW).status, 'not_due');
});

test('no run before 14:00, Saturday, or a missed previous week', () => {
  const config = { enabled: true, firstRunAt: FRIDAY, hour: 14, minute: 0 };
  assert.equal(dueSlot(config, '2026-10-23T10:59:59.000Z'), null);
  assert.equal(dueSlot(config, '2026-10-24T10:00:00.000Z'), null);
  assert.equal(dueSlot(config, '2026-10-24T11:00:00.000Z'), null);
  assert.equal(dueSlot(config, '2026-10-23T11:45:00.000Z').key, 'FRIDAY-2026-10-23');
});

test('charges only active non-archived captains with valid activity and preserves the zero floor', () => {
  const f = fixture();
  f.seed(1); f.seed(2, { wallet_cents: 100 });
  f.seed(3, { wallet_cents: 0 });
  f.seed(4, { activity: false });
  f.seed(5, { wallet_cents: -50 });
  f.seed(6, { active: 0 }); f.seed(7, { account_status: 'suspended' });
  f.seed(8, { archived_at: NOW }); f.seed(9, { is_bot: 1 });
  f.seed(10, { role: 'company' }); f.seed(11, { account_status: 'merged' });
  f.seed(12, { created_at: 'bad-date' }); f.seed(13, { created_at: '2026-10-23T00:00:00.000Z' });
  f.seed(14, { activity: { status: 'open', settlementStatus: 'pending', candidateStatus: 'pending', finalOrderId: null, acceptedMessageId: null } });
  f.seed(15, { activity: { status: 'cancelled', settlementStatus: 'reversed', candidateStatus: 'cancelled', finalOrderId: null } });
  activate(f);
  const r = f.scheduler.tick(FRIDAY);
  assert.deepEqual(r, { status: 'completed', scheduleKey: 'FRIDAY-2026-10-23', appliedCount: 4, totalCents: 400 });
  assert.equal(f.balance(1), 400); assert.equal(f.balance(2), 0); assert.equal(f.balance(3), 0); assert.equal(f.balance(4), 500); assert.equal(f.balance(5), -50);
  assert.equal(f.db.prepare('SELECT active FROM users WHERE id=2').get().active, 1);
  for (const id of [6,7,8,9,10,11,14,15]) assert.equal(f.balance(id), 500);
  assert.equal(f.balance(12), 400); assert.equal(f.balance(13), 400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 4);
  const details = JSON.parse(f.db.prepare('SELECT details_json FROM wallet_ledger WHERE user_id=1').get().details_json);
  assert.equal(details.scheduled, true); assert.equal(details.manual, false);
  assert.equal(details.activityScope, 'official_group_valid_post_or_final_settled_acceptance');
});

test('publisher and final settled accepter qualify once; wrong-group, unlinked, unfinished, or unsettled activity does not', () => {
  const f = fixture();
  for (const id of [1,2,3,4,5,6,7,8,9]) f.seed(id, { activity: false });
  f.seedPost(1, { sourceMessageId: 'POST-1-A' });
  f.seedPost(1, { sourceMessageId: 'POST-1-B' });
  f.seedAccepted(1, { orderId: 11001, sourceMessageId: 'ACCEPTED-1' });
  f.seedAccepted(2, { status: 'accepted', settlementStatus: 'applied' });
  f.seedPost(3, { groupId: OTHER_GROUP });
  f.seedAccepted(4, { status: 'open', candidateStatus: 'pending', finalOrderId: null, acceptedMessageId: null, settlementStatus: 'pending' });
  f.seedAccepted(5, { status: 'completed', settlementStatus: 'pending' });
  f.seedAccepted(6, { status: 'completed', settlementStatus: 'applied', candidateStatus: 'pending', finalOrderId: null });
  f.seedAccepted(7, { status: 'completed', settlementStatus: 'applied', acceptedMessageId: null });
  f.seedPost(8, { status: 'cancelled' });
  f.seedPost(9, { priceCents: 0 });
  activate(f);
  assert.deepEqual(f.context.weeklyChargeEligibleCaptains(FRIDAY).map((row) => Number(row.id)), [1,2]);
  const result = f.scheduler.tick(FRIDAY);
  assert.equal(result.appliedCount, 2);
  assert.equal(f.balance(1), 400); assert.equal(f.balance(2), 400);
  for (const id of [3,4,5,6,7,8,9]) assert.equal(f.balance(id), 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM captain_subscription_charges').get().n, 2);
});

test('official group must resolve and pass the group allowlist before any captain qualifies', () => {
  const f = fixture({ groupConfigured: false });
  f.seed(1, { activity: false }); f.seedPost(1);
  activate(f);
  assert.equal(f.context.weeklyChargeEligibleCaptains(FRIDAY).length, 0);
  assert.equal(f.scheduler.tick(FRIDAY).appliedCount, 0);
  assert.equal(f.balance(1), 500);
});

test('completed Amman week uses inclusive start and exclusive end boundaries', () => {
  const f = fixture();
  for (const id of [1,2,3,4]) f.seed(id, { activity: false });
  f.seedPost(1, { createdAt: '2026-10-14T21:00:00.000Z' });
  f.seedPost(2, { createdAt: '2026-10-21T21:00:00.000Z' });
  f.seedPost(3, { createdAt: '2026-10-21T20:59:59.999Z' });
  f.seedPost(4, { createdAt: '2026-10-14T20:59:59.999Z' });
  const period = f.context.currentCaptainSubscriptionPeriod(FRIDAY);
  assert.equal(period.start, '2026-10-14T21:00:00.000Z');
  assert.equal(period.end, '2026-10-21T21:00:00.000Z');
  assert.deepEqual(f.context.weeklyChargeEligibleCaptains(FRIDAY, period).map((row) => Number(row.id)), [1,3]);
  activate(f);
  assert.equal(f.scheduler.tick(FRIDAY).appliedCount, 2);
  assert.equal(f.balance(1), 400); assert.equal(f.balance(3), 400);
  assert.equal(f.balance(2), 500); assert.equal(f.balance(4), 500);
});

test('completed schedule is never rerun after restart or later top-up', () => {
  const f = fixture(); f.seed(1); f.seed(2, { wallet_cents: 50 }); activate(f);
  f.scheduler.tick(FRIDAY);
  f.db.prepare('UPDATE users SET wallet_cents=500 WHERE id=2').run();
  const restarted = createWeeklySubscriptionScheduler(f.dependencies);
  assert.equal(restarted.tick('2026-10-23T20:30:00.000Z').status, 'already_completed');
  assert.equal(f.balance(1), 400); assert.equal(f.balance(2), 500);
  assert.equal(restarted.status(FRIDAY).lastRun.appliedCount, 1);
  assert.equal(restarted.status(FRIDAY).nextRunAt, '2026-10-30T11:00:00.000Z');
});

test('manual and scheduled operations share idempotency within the same Amman week', () => {
  const f = fixture({ activityAt: '2026-10-19T12:00:00.000Z' }); f.seed(1); activate(f);
  f.context.applyManualWeeklyCaptainCharges(FRIDAY);
  assert.equal(f.balance(1), 400);
  const second = f.context.applyManualWeeklyCaptainCharges('2026-10-23T13:00:00.000Z');
  assert.equal(second.applied.length, 0); assert.equal(f.balance(1), 400);
  assert.equal(f.scheduler.tick(FRIDAY).appliedCount, 0);
  assert.equal(f.balance(1), 400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 1);
});

test('the next Friday charges only captains with fresh activity in that completed Amman week', () => {
  const f = fixture(); f.seed(1); f.seed(2, { activity: { acceptedAt: '2026-10-24T12:00:00.000Z' } }); activate(f);
  assert.equal(f.scheduler.tick(FRIDAY).appliedCount, 1);
  assert.equal(f.scheduler.tick('2026-10-30T11:00:00.000Z').appliedCount, 1);
  assert.equal(f.balance(1), 400); assert.equal(f.balance(2), 400);
});

test('batch failure rolls back all wallets and ledgers; retry is bounded and idempotent', () => {
  const f = fixture(); f.seed(1); f.seed(2); activate(f); f.failAudit(2);
  assert.equal(f.scheduler.tick(FRIDAY).status, 'failed');
  assert.equal(f.balance(1), 500); assert.equal(f.balance(2), 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM captain_subscription_charges').get().n, 0);
  assert.equal(f.scheduler.tick('2026-10-23T11:01:00.000Z').status, 'retry_wait');
  f.failAudit(null);
  const retry = f.scheduler.tick('2026-10-23T11:05:00.000Z');
  assert.equal(retry.appliedCount, 2); assert.equal(f.balance(1), 400);
  assert.equal(f.scheduler.status('2026-10-23T20:06:00.000Z').lastRun.attemptCount, 2);
  assert.equal(f.scheduler.tick('2026-10-23T11:10:00.000Z').status, 'already_completed');
});

test('completed weekly run is not repeated and never catches up on Saturday', () => {
  const f = fixture(); f.seed(1); activate(f);
  assert.equal(f.scheduler.tick(FRIDAY).status, 'completed');
  assert.equal(f.scheduler.tick('2026-10-23T20:05:00.000Z').status, 'already_completed');
  assert.equal(f.scheduler.tick('2026-10-23T20:10:00.000Z').status, 'already_completed');
  assert.equal(f.scheduler.tick('2026-10-24T11:00:00.000Z').status, 'not_due');
  assert.equal(f.balance(1), 400);
});

test('startup catches a missed time on the same Friday, with only one timer', () => {
  let timerCount = 0; let clearCount = 0;
  const f = fixture({ setIntervalFn: () => { timerCount += 1; return { unref() {} }; }, clearIntervalFn: () => { clearCount += 1; } });
  f.seed(1); activate(f); f.setNow('2026-10-23T11:20:00.000Z');
  f.scheduler.start(); f.scheduler.start();
  assert.equal(timerCount, 1); assert.equal(f.balance(1), 400);
  f.scheduler.stop(); assert.equal(clearCount, 1); assert.equal(f.scheduler.status().timerRunning, false);
});

test('disable changes no wallet; invalid time and corrupted settings fail closed', () => {
  const f = fixture(); f.seed(1); activate(f);
  assert.throws(() => f.scheduler.configure({ enabled: true, hour: 24, minute: 0 }));
  assert.throws(() => f.scheduler.configure({ enabled: 'true', hour: 14, minute: 0 }));
  f.scheduler.configure({ enabled: false, hour: 14, minute: 0 });
  assert.equal(f.scheduler.tick(FRIDAY).status, 'not_due'); assert.equal(f.balance(1), 500);
  f.dependencies.setSetting('captain_weekly_schedule_v1', '{not-json');
  assert.equal(f.scheduler.status().enabled, false);
});

test('policy activation timestamp is recorded once and never advances on restart', () => {
  const activation = '2026-11-26T20:06:00.000Z';
  const f = fixture({ now: activation, policyStart: null });
  assert.equal(f.db.prepare('SELECT value FROM settings WHERE key=?').get('captain_weekly_activity_policy_start_v1'), undefined);
  const first = f.context.ensureCaptainSubscriptionActivityPolicyStart();
  assert.equal(first, activation);
  f.setNow('2026-12-01T12:00:00.000Z');
  assert.equal(f.context.ensureCaptainSubscriptionActivityPolicyStart(), activation);
  assert.equal(f.db.prepare('SELECT value FROM settings WHERE key=?').get('captain_weekly_activity_policy_start_v1').value, activation);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 0);
});

test('policy prevents the next run from charging pre-activation activity; later eligible period can charge once', () => {
  const activation = '2026-11-26T20:06:00.000Z';
  const f = fixture({ now: activation, policyStart: null, activityAt: '2026-11-20T12:00:00.000Z' });
  const savedStart = f.context.ensureCaptainSubscriptionActivityPolicyStart();
  assert.equal(savedStart, activation);
  f.seed(1, { activity: false });
  f.seedPost(1, { sourceMessageId: 'POST-BEFORE-ACTIVATION', createdAt: '2026-11-20T12:00:00.000Z' });
  activate(f, 23, 0);
  const firstRun = f.scheduler.tick('2026-11-27T20:00:00.000Z');
  assert.equal(firstRun.appliedCount, 0);
  assert.equal(f.balance(1), 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get().n, 0);
  f.seedPost(1, { sourceMessageId: 'POST-AFTER-ACTIVATION', createdAt: '2026-11-27T12:00:00.000Z' });
  const laterRun = f.scheduler.tick('2026-12-04T20:00:00.000Z');
  assert.equal(laterRun.appliedCount, 1);
  assert.equal(f.balance(1), 400);
  const charge = f.db.prepare('SELECT period_start,period_end,amount_cents FROM captain_subscription_charges WHERE user_id=1').get();
  assert.equal(charge.period_start, '2026-11-25T21:00:00.000Z');
  assert.equal(charge.period_end, '2026-12-02T21:00:00.000Z');
  assert.equal(charge.amount_cents, 100);
});

test('Amman business-week boundary and owner-only schedule endpoint contract', () => {
  assert.deepEqual(businessWeekPeriod('2026-10-23T11:00:00.000Z'), {
    start: '2026-10-21T21:00:00.000Z', end: '2026-10-28T21:00:00.000Z',
  });
  assert.match(source, /app\.get\("\/api\/admin\/captain-subscriptions\/schedule", requireBotWalletOwner/);
  assert.match(source, /app\.post\("\/api\/admin\/captain-subscriptions\/schedule", requireBotWalletOwner/);
  assert.match(source, /ENABLE_\$\{weekdayName \|\| "WEEKLY"\}_WEEKLY_CAPTAIN_CHARGE/);
  assert.match(source, /financialMutation: false/);
  assert.match(source, /CAPTAIN_DAILY_CHARGE_ENABLED = false/);
  assert.match(source, /CAPTAIN_SUBSCRIPTION_CHARGES_ENABLED = false/);
  assert.match(schedulerSource, /activityPolicyStartsAt: getSetting\('captain_weekly_activity_policy_start_v1'/);
  assert.match(schedulerSource, /activityPeriod: 'previous_completed_Thursday_00_to_Thursday_00_Asia_Amman'/);
});

test('legacy manual fee remains visible and blocks a second fee in the Amman week', () => {
  const f = fixture({ activityAt: '2026-10-12T12:00:00.000Z' }); f.seed(1, { wallet_cents: 400 });
  const legacyReference = 'SUB-2026-10-07-1';
  const legacyStamp = '2026-10-12T23:50:28.740Z';
  const ledger = f.db.prepare(`INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,created_at,idempotency_key)
    VALUES(1,'subscription_fee',-100,400,?,?,?)`).run(legacyReference, legacyStamp, legacyReference);
  f.db.prepare(`INSERT INTO captain_subscription_charges(user_id,period_start,period_end,amount_cents,status,ledger_id,reference,created_at,applied_at)
    VALUES(1,'2026-10-07T21:00:00.000Z','2026-10-14T21:00:00.000Z',100,'applied',?,?,?,?)`)
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
  assert.equal(report.periodStart, '2026-10-07T21:00:00.000Z');
  assert.equal(report.appliedCount, 1); assert.equal(report.total, '1.00');
  assert.equal(report.users[0].reference, legacyReference);
  assert.equal(report.users[0].balanceBeforeSubscriptionCents, 500);
  assert.equal(report.users[0].balanceAfterSubscriptionCents, 400);
  handler({ query: { compact: '1', periodStart: '2026-10-07T21:00:00.000Z' } }, res);
  assert.equal(report.periodStart, '2026-10-07T21:00:00.000Z');
  assert.equal(report.appliedCount, 1); assert.equal(report.total, '1.00');
  assert.equal(f.db.prepare('SELECT period_start FROM captain_subscription_charges').get().period_start, '2026-10-07T21:00:00.000Z');
});
