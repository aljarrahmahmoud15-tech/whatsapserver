const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { createCaptainBalanceImportService } = require("./captain-balance-import");

function fixture({ balance = 800, active = 1 } = {}) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,phone TEXT,name TEXT,wallet_cents INTEGER,role TEXT,active INTEGER,is_bot INTEGER,account_status TEXT,updated_at TEXT);
    CREATE TABLE wallet_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,type TEXT,amount_cents INTEGER,balance_after_cents INTEGER,reference TEXT,note TEXT,created_at TEXT,details_json TEXT,idempotency_key TEXT UNIQUE);`);
  db.prepare("INSERT INTO users VALUES (1, ?, 'كابتن اختبار', ?, 'captain', ?, 0, 'active', 'x')").run("+962790000001", balance, active);
  return db;
}
function service(db, manualDebitsEnabled = false, acceptAnyPhone = false) {
  return createCaptainBalanceImportService({
    db,
    normalizePhone: (value) => value,
    validPhone: (value) => acceptAnyPhone || value === "+962790000001",
    money: (cents) => (cents / 100).toFixed(2),
    now: () => "2026-11-05T15:00:00Z",
    audit: () => {},
    manualDebitsEnabled,
  });
}

test("preview matches an existing captain and calculates only the difference", () => {
  const db = fixture();
  const result = service(db).preview([{ phone: "+962790000001", name: "كابتن اختبار", target_balance_jod: "12.50", source_reference: "TEST-001", note: "اختبار", create_if_missing: "no" }], { sourceReference: "TEST-001", expectedRows: 1 });
  assert.equal(result.summary.matched, 1);
  assert.equal(result.rows[0].currentBalance, "8.00");
  assert.equal(result.rows[0].difference, "4.50");
  assert.equal(db.prepare("SELECT wallet_cents FROM users WHERE id=1").get().wallet_cents, 800);
});

test("missing captain is review-only and cannot be applied", () => {
  const db = fixture();
  const svc = service(db, false, true);
  const result = svc.preview([{ phone: "+962790000099", name: "غير موجود", target_balance_jod: "5.00", source_reference: "TEST-002", note: "", create_if_missing: "no" }], { sourceReference: "TEST-002", expectedRows: 1 });
  assert.equal(result.summary.review, 1);
  assert.equal(result.rows[0].status, "not_found");
  assert.throws(() => svc.apply(result.previewId, result.fileHash, "APPLY_CAPTAIN_BALANCE_DIFFERENCES_V1"), /صفوف المراجعة/);
});

test("apply is idempotent and records a ledger movement", () => {
  const db = fixture();
  const svc = service(db, true);
  const result = svc.preview([{ phone: "+962790000001", name: "كابتن اختبار", target_balance_jod: "12.50", source_reference: "TEST-003", note: "اختبار", create_if_missing: "no" }], { sourceReference: "TEST-003", expectedRows: 1 });
  const first = svc.apply(result.previewId, result.fileHash, "APPLY_CAPTAIN_BALANCE_DIFFERENCES_V1");
  const second = svc.apply(result.previewId, result.fileHash, "APPLY_CAPTAIN_BALANCE_DIFFERENCES_V1");
  assert.equal(first.applied.length, 1);
  assert.equal(second.applied[0].alreadyApplied, true);
  assert.equal(db.prepare("SELECT wallet_cents FROM users WHERE id=1").get().wallet_cents, 1250);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count, 1);
});
