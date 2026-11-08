const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createNegativeBalanceSettlementService } = require('./negative-balance-settlement');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, phone TEXT, name TEXT, registration_name TEXT, wallet_cents INTEGER, role TEXT, active INTEGER, is_bot INTEGER, account_status TEXT, updated_at TEXT);
    CREATE TABLE wallet_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount_cents INTEGER, balance_after_cents INTEGER, reference TEXT, note TEXT, created_at TEXT, details_json TEXT, idempotency_key TEXT UNIQUE);`);
  db.prepare("INSERT INTO users VALUES (1,'962790000001','سالب نشط','سالب نشط',-276,'captain',1,0,'active','old')").run();
  db.prepare("INSERT INTO users VALUES (2,'962790000002','موجب','موجب',100,'captain',1,0,'active','old')").run();
  db.prepare("INSERT INTO users VALUES (3,'962790000003','سالب مؤرشف','سالب مؤرشف',-100,'captain',0,0,'archived','old')").run();
  return db;
}
function service(db) { return createNegativeBalanceSettlementService({ db, money: (c) => (c / 100).toFixed(2), now: () => '2026-11-08T19:00:00Z', audit: () => {} }); }

test('preview selects only active human negative captains', () => {
  const db = fixture();
  const result = service(db).preview();
  assert.equal(result.summary.count, 1);
  assert.equal(result.summary.totalCents, 276);
  assert.equal(result.rows[0].targetBalance, '0.00');
  assert.equal(db.prepare('SELECT wallet_cents FROM users WHERE id=1').get().wallet_cents, -276);
});

test('apply zeroes balance, records ledger, and is idempotent', () => {
  const db = fixture();
  const svc = service(db);
  const preview = svc.preview();
  const first = svc.apply({ previewId: preview.previewId, expectedCount: 1, expectedTotalCents: 276, confirmation: 'APPLY_NEGATIVE_BALANCE_ZERO_FLOOR_V1' });
  const second = svc.apply({ previewId: preview.previewId, expectedCount: 1, expectedTotalCents: 276, confirmation: 'APPLY_NEGATIVE_BALANCE_ZERO_FLOOR_V1' });
  assert.equal(first.applied[0].balanceAfter, '0.00');
  assert.equal(second.applied[0].alreadyApplied, true);
  assert.equal(db.prepare('SELECT wallet_cents FROM users WHERE id=1').get().wallet_cents, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM wallet_ledger').get().count, 1);
});
