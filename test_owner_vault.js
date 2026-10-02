const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createOwnerVault, ALLOWED_OWNER_VAULT_DECISIONS } = require("./owner-vault");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "waslni-owner-vault-"));
const vault = createOwnerVault({ dataDir, secret: "test-only-owner-vault-secret", clock: () => "2026-10-02T00:00:00.000Z" });
assert.deepEqual(ALLOWED_OWNER_VAULT_DECISIONS, ["owner.decision.note"]);
assert.equal(vault.status().encrypted, true);
assert.equal(vault.status().keySource, "environment");
assert.equal(fs.statSync(vault.databasePath).mode & 0o777, 0o600);
assert.equal(fs.existsSync(vault.keyPath), false);

const note = "قرار مالك اختباري لا يجب أن يظهر خارج الخزنة";
const first = vault.recordDecision({ command: "owner.decision.note", payload: { note }, result: { executed: false, mutation: "none" } });
const second = vault.recordDecision({ command: "owner.decision.note", payload: { note }, result: { executed: false, mutation: "none" } });
assert.equal(first.encrypted, true);
assert.equal(first.payloadIncluded, false);
assert.equal(second.alreadyRecorded, true);
assert.equal(vault.listRecent(10).length, 1);
assert.equal(vault.listRecent(10)[0].payloadIncluded, false);
assert.deepEqual(vault.readDecrypted(first.id), { payload: { note }, result: { executed: false, mutation: "none" } });

const db = new Database(vault.databasePath, { readonly: true });
const row = db.prepare("SELECT payload_ciphertext, result_ciphertext FROM owner_vault_decisions WHERE id=?").get(first.id);
assert.ok(row.payload_ciphertext);
assert.ok(!row.payload_ciphertext.includes(note));
assert.ok(!row.result_ciphertext.includes("executed"));
db.close();
assert.throws(() => vault.recordDecision({ command: "eval", payload: { code: "process.env" } }), /allow-listed/);
vault.close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("owner vault encryption and allow-list guard: PASS");
