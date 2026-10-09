const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

const walletStart = server.indexOf('CREATE TABLE IF NOT EXISTS wallet_ledger');
const walletEnd = server.indexOf('CREATE TABLE IF NOT EXISTS topup_cards', walletStart);
assert.ok(walletStart >= 0 && walletEnd > walletStart, 'wallet_ledger schema boundaries must exist');
const walletSchema = server.slice(walletStart, walletEnd);
assert.match(walletSchema, /id INTEGER PRIMARY KEY AUTOINCREMENT/);
assert.match(walletSchema, /user_id INTEGER NOT NULL/);
assert.match(walletSchema, /amount_cents INTEGER NOT NULL/);
assert.match(walletSchema, /balance_after_cents INTEGER NOT NULL/);
assert.match(walletSchema, /details_json TEXT/);
assert.match(walletSchema, /idempotency_key TEXT/);
assert.match(walletSchema, /FOREIGN KEY\(user_id\) REFERENCES users\(id\)/);
assert.match(walletSchema, /FOREIGN KEY\(order_id\) REFERENCES orders\(id\)/);

const auditStart = server.indexOf('CREATE TABLE IF NOT EXISTS audit_logs');
const auditEnd = server.indexOf('CREATE TABLE IF NOT EXISTS settings', auditStart);
assert.ok(auditStart >= 0 && auditEnd > auditStart, 'audit_logs schema boundaries must exist');
const auditSchema = server.slice(auditStart, auditEnd);
assert.match(auditSchema, /id INTEGER PRIMARY KEY AUTOINCREMENT/);
assert.match(auditSchema, /actor_user_id INTEGER/);
assert.match(auditSchema, /action TEXT NOT NULL/);
assert.match(auditSchema, /details TEXT/);
assert.match(auditSchema, /created_at TEXT NOT NULL/);
assert.match(auditSchema, /FOREIGN KEY\(actor_user_id\) REFERENCES users\(id\)/);

assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_idempotency/);
assert.match(server, /CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created/);
assert.match(server, /CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created/);
assert.match(server, /db\.pragma\("journal_mode = WAL"\)/);
assert.match(server, /db\.pragma\("foreign_keys = ON"\)/);

console.log('wallet_ledger and audit_logs schema guardrails verified');
