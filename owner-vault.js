const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const ALLOWED_OWNER_VAULT_DECISIONS = Object.freeze(["owner.decision.note"]);
const MAX_DECISION_BYTES = 64 * 1024;
const KEY_FILE_MODE = 0o600;
const DB_FILE_MODE = 0o600;
const KDF_SALT = Buffer.from("waslni-v26-owner-vault-key-v1", "utf8");

function isoNow() {
  return new Date().toISOString();
}

function tightenPermissions(filePath) {
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    try { fs.chmodSync(candidate, DB_FILE_MODE); } catch (_) {}
  }
}

function safeJson(value) {
  const text = JSON.stringify(value == null ? null : value);
  if (Buffer.byteLength(text, "utf8") > MAX_DECISION_BYTES) {
    throw new Error("owner vault decision is too large");
  }
  return text;
}

function loadMasterKey(dataDir, secret) {
  const keyPath = path.join(dataDir, "owner-vault.key");
  const supplied = String(secret || "");
  if (supplied) {
    return { key: crypto.scryptSync(supplied, KDF_SALT, 32), source: "environment" };
  }
  let key;
  try {
    key = fs.readFileSync(keyPath);
    if (key.length !== 32) throw new Error("invalid owner vault key length");
  } catch (_) {
    key = crypto.randomBytes(32);
    const descriptor = fs.openSync(keyPath, "w", KEY_FILE_MODE);
    try { fs.writeFileSync(descriptor, key); } finally { fs.closeSync(descriptor); }
  }
  try { fs.chmodSync(keyPath, KEY_FILE_MODE); } catch (_) {}
  return { key, source: "persistent-key-file" };
}

function seal(plaintext, key) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.createHash("sha256").update(Buffer.concat([key, salt])).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derived, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", salt.toString("base64url"), iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function open(sealed, key) {
  const [version, saltValue, ivValue, tagValue, ciphertextValue] = String(sealed || "").split(".");
  if (version !== "v1" || !saltValue || !ivValue || !tagValue || !ciphertextValue) throw new Error("owner vault ciphertext is invalid");
  const salt = Buffer.from(saltValue, "base64url");
  const derived = crypto.createHash("sha256").update(Buffer.concat([key, salt])).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", derived, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

function createOwnerVault({ dataDir, secret = "", clock = isoNow } = {}) {
  if (!dataDir) throw new Error("dataDir is required");
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, "owner-vault.sqlite");
  const { key, source: keySource } = loadMasterKey(dataDir, secret);
  const database = new Database(databasePath, { fileMustExist: false });
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS owner_vault_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_hash TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_ciphertext TEXT NOT NULL,
      result_ciphertext TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_owner_vault_decisions_created_at
      ON owner_vault_decisions(created_at DESC);
  `);
  tightenPermissions(databasePath);

  const insertDecision = database.prepare(`
    INSERT INTO owner_vault_decisions
      (decision_hash, command, status, created_at, payload_ciphertext, result_ciphertext)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(decision_hash) DO NOTHING
  `);
  const recentDecisions = database.prepare(`
    SELECT id, decision_hash, command, status, created_at
    FROM owner_vault_decisions ORDER BY id DESC LIMIT ?
  `);
  const countDecisions = database.prepare("SELECT COUNT(*) AS count FROM owner_vault_decisions");
  const readEncrypted = database.prepare("SELECT payload_ciphertext, result_ciphertext FROM owner_vault_decisions WHERE id=?");

  function metadata(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      decisionHash: row.decision_hash,
      command: row.command,
      status: row.status,
      createdAt: row.created_at,
      encrypted: true,
      payloadIncluded: false,
    };
  }

  return {
    databasePath,
    keyPath: path.join(dataDir, "owner-vault.key"),
    allowedDecisions: ALLOWED_OWNER_VAULT_DECISIONS,
    recordDecision({ command, payload, result = null, status = "recorded" } = {}) {
      const normalizedCommand = String(command || "").trim();
      if (!ALLOWED_OWNER_VAULT_DECISIONS.includes(normalizedCommand)) throw new Error("owner vault decision is not allow-listed");
      const payloadJson = safeJson(payload);
      const resultJson = result == null ? null : safeJson(result);
      const decisionHash = crypto.createHash("sha256").update(`${normalizedCommand}\0${payloadJson}`).digest("hex");
      const createdAt = clock();
      const insert = insertDecision.run(
        decisionHash,
        normalizedCommand,
        String(status || "recorded").slice(0, 40),
        createdAt,
        seal(payloadJson, key),
        resultJson == null ? null : seal(resultJson, key),
      );
      tightenPermissions(databasePath);
      const row = database.prepare("SELECT id, decision_hash, command, status, created_at FROM owner_vault_decisions WHERE decision_hash=?").get(decisionHash);
      return { ...metadata(row), alreadyRecorded: Number(insert.changes) === 0 };
    },
    listRecent(limit = 20) {
      const bounded = Math.max(1, Math.min(100, Number(limit) || 20));
      return recentDecisions.all(bounded).map(metadata);
    },
    status() {
      return {
        encrypted: true,
        keySource,
        databaseFile: "owner-vault.sqlite",
        keyFile: "owner-vault.key",
        decisionCount: Number(countDecisions.get().count),
      };
    },
    // Internal verification helper; never exposed through an HTTP response.
    readDecrypted(id) {
      const row = readEncrypted.get(Number(id));
      if (!row) return null;
      return {
        payload: JSON.parse(open(row.payload_ciphertext, key)),
        result: row.result_ciphertext ? JSON.parse(open(row.result_ciphertext, key)) : null,
      };
    },
    close() {
      if (database.open) database.close();
    },
  };
}

module.exports = {
  ALLOWED_OWNER_VAULT_DECISIONS,
  createOwnerVault,
  MAX_DECISION_BYTES,
};
