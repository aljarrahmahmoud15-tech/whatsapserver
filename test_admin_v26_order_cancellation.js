const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { cancelSettledOrderAndReverse } = require('./order-cancellation');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, wallet_cents INTEGER NOT NULL, updated_at TEXT);
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, order_no INTEGER NOT NULL, status TEXT NOT NULL,
      settlement_state TEXT NOT NULL, producer_user_id INTEGER, group_id TEXT,
      origin TEXT, destination TEXT, price_cents INTEGER, updated_at TEXT
    );
    CREATE TABLE order_settlements (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, status TEXT NOT NULL,
      idempotency_key TEXT, producer_user_id INTEGER, captain_user_id INTEGER,
      charged_user_id INTEGER, company_cents INTEGER, producer_cents INTEGER,
      captain_fee_cents INTEGER, details_json TEXT
    );
    CREATE TABLE wallet_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, order_id INTEGER,
      type TEXT NOT NULL, amount_cents INTEGER NOT NULL, balance_after_cents INTEGER NOT NULL,
      reference TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, details_json TEXT,
      idempotency_key TEXT UNIQUE
    );
  `);
  db.prepare("INSERT INTO users(id,role,wallet_cents) VALUES(1,'company',1000),(2,'producer',200),(3,'captain',500)").run();
  db.prepare("INSERT INTO orders(id,order_no,status,settlement_state,producer_user_id,group_id,price_cents) VALUES(10,214,'accepted','settled',2,'group@g.us',1000)").run();
  db.prepare("INSERT INTO order_settlements(id,order_id,status,idempotency_key,producer_user_id,captain_user_id,charged_user_id,company_cents,producer_cents,captain_fee_cents,details_json) VALUES(20,10,'applied','SETTLE-10',2,3,3,30,120,150,'{}')").run();
  return db;
}

test('V26 cancellation reverses each wallet exactly once and changes authoritative states', () => {
  const db = fixture();
  const audits = [];
  const result = cancelSettledOrderAndReverse(db, {
    orderId: 10,
    now: () => '2026-10-03T13:00:00.000Z',
    audit: (...args) => audits.push(args),
    reason: 'اختبار مالك',
    idempotencyKey: 'V26-CANCEL-ORDER-10-test',
  });

  assert.equal(result.state, 'cancelled');
  assert.deepEqual(db.prepare('SELECT id,wallet_cents FROM users ORDER BY id').all(), [
    { id: 1, wallet_cents: 970 },
    { id: 2, wallet_cents: 80 },
    { id: 3, wallet_cents: 650 },
  ]);
  assert.deepEqual(db.prepare('SELECT status FROM orders WHERE id=10').get(), { status: 'cancelled' });
  assert.deepEqual(db.prepare('SELECT status FROM order_settlements WHERE order_id=10').get(), { status: 'reversed' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM wallet_ledger').get().count, 3);
  assert.equal(audits.length, 1);
  assert.equal(audits[0][0], 'order.cancelled_owner_reversed');

  const retry = cancelSettledOrderAndReverse(db, {
    orderId: 10,
    now: () => '2026-10-03T13:01:00.000Z',
    audit: (...args) => audits.push(args),
    idempotencyKey: 'V26-CANCEL-ORDER-10-retry',
  });
  assert.equal(retry.state, 'already_reversed');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM wallet_ledger').get().count, 3);
  assert.equal(db.prepare('SELECT SUM(wallet_cents) AS total FROM users').get().total, 1700);
  assert.equal(audits.length, 1);
});

test('V26 cancellation refuses unsettled orders without mutation', () => {
  const db = fixture();
  db.prepare("UPDATE orders SET settlement_state='pending' WHERE id=10").run();
  const result = cancelSettledOrderAndReverse(db, {
    orderId: 10,
    now: () => '2026-10-03T13:00:00.000Z',
    audit: () => { throw new Error('audit must not run for a rejected mutation'); },
    idempotencyKey: 'V26-CANCEL-ORDER-10-pending',
  });
  assert.equal(result.state, 'not_settled');
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=10').get().status, 'accepted');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM wallet_ledger').get().count, 0);
});
