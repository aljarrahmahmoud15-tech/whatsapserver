const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const ALLOWED_OWNER_COMMANDS = Object.freeze([
  "status.snapshot",
  "official-group.snapshot",
  "data.summary",
  "bot.restart",
  "session.refresh",
  "group.broadcast",
]);

const SENSITIVE_KEY = /token|secret|password|cookie|authorization|credential|pin|code|body|message/i;
const SENSITIVE_PATH_KEY = /session|auth/i;
const MAX_JSON_BYTES = 64 * 1024;
const OWNER_COMMAND_CODE_KEY = /^(?:code|script|source|eval|function|constructor|prototype|__proto__|child_process|exec|spawn|fork)$/i;
const OWNER_COMMAND_CODE_TEXT = /(?:\beval\s*\(|\bnew\s+Function\s*\(|\b(?:child_process|process\.(?:env|exit)|require|exec(?:File)?|spawn|fork)\s*\(|<\s*script\b|javascript\s*:)/i;

function ownerCommandPayloadContainsCode(value, key = "", depth = 0) {
  if (OWNER_COMMAND_CODE_KEY.test(String(key || ""))) return true;
  if (typeof value === "string") return OWNER_COMMAND_CODE_TEXT.test(value);
  if (value == null || typeof value !== "object" || depth > 6) return false;
  if (Array.isArray(value)) return value.some((item) => ownerCommandPayloadContainsCode(item, "", depth + 1));
  return Object.entries(value).some(([childKey, childValue]) => ownerCommandPayloadContainsCode(childValue, childKey, depth + 1));
}

function isoNow() {
  return new Date().toISOString();
}

function safeScalar(value) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  const text = (typeof value === "string" ? value : String(value)).slice(0, 1000);
  return text
    .replace(/(access|token|secret|password|authorization|credential)\s*[=:]\s*[^\s&]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");
}

function safeObject(value, depth = 0) {
  if (depth > 4) return "[depth-limited]";
  if (value == null || typeof value !== "object") return safeScalar(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeObject(item, depth + 1));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || (SENSITIVE_PATH_KEY.test(key) && key !== "sessionPersistence")) {
      output[key] = "[redacted]";
      continue;
    }
    output[String(key).slice(0, 100)] = safeObject(item, depth + 1);
  }
  return output;
}

function safeJson(value) {
  const serialized = JSON.stringify(safeObject(value));
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
    return JSON.stringify({ truncated: true });
  }
  return serialized;
}

function tightenFilePermissions(filePath) {
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    try { fs.chmodSync(candidate, 0o600); } catch (_) {}
  }
}

function createOwnerControlStore({ dataDir, clock = isoNow } = {}) {
  if (!dataDir) throw new Error("dataDir is required");
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, "owner-control.sqlite");
  const database = new Database(databasePath, { fileMustExist: false });
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS owner_control_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS owner_control_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('accepted','rejected')),
      created_at TEXT NOT NULL,
      completed_at TEXT,
      result_json TEXT
    );
    CREATE INDEX IF NOT EXISTS owner_control_checkpoints_recorded_at_idx
      ON owner_control_checkpoints(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS owner_control_commands_created_at_idx
      ON owner_control_commands(created_at DESC);
  `);
  tightenFilePermissions(databasePath);

  const insertCheckpoint = database.prepare(
    "INSERT INTO owner_control_checkpoints(recorded_at,reason,snapshot_json) VALUES(?,?,?)",
  );
  const insertCommand = database.prepare(
    "INSERT INTO owner_control_commands(command,status,created_at,completed_at,result_json) VALUES(?,?,?,?,?)",
  );
  const latestCheckpoint = database.prepare(
    "SELECT id,recorded_at,reason,snapshot_json FROM owner_control_checkpoints ORDER BY id DESC LIMIT 1",
  );
  const recentCommands = database.prepare(
    "SELECT id,command,status,created_at,completed_at,result_json FROM owner_control_commands ORDER BY id DESC LIMIT ?",
  );

  function parseRow(row) {
    if (!row) return null;
    let snapshot = null;
    try { snapshot = JSON.parse(row.snapshot_json || "null"); } catch (_) { snapshot = null; }
    return { id: row.id, recordedAt: row.recorded_at, reason: row.reason, snapshot };
  }

  function parseCommand(row) {
    if (!row) return null;
    let result = null;
    try { result = JSON.parse(row.result_json || "null"); } catch (_) { result = null; }
    return {
      id: row.id,
      command: row.command,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      result,
    };
  }

  return {
    databasePath,
    allowedCommands: ALLOWED_OWNER_COMMANDS,
    saveCheckpoint(reason, snapshot) {
      const safeReason = String(reason || "runtime").slice(0, 120);
      const result = insertCheckpoint.run(clock(), safeReason, safeJson(snapshot));
      tightenFilePermissions(databasePath);
      return { id: Number(result.lastInsertRowid), recordedAt: clock(), reason: safeReason };
    },
    getLatestCheckpoint() {
      return parseRow(latestCheckpoint.get());
    },
    recordCommand(command, status, result = null) {
      const normalizedCommand = String(command || "").trim();
      if (!ALLOWED_OWNER_COMMANDS.includes(normalizedCommand)) {
        throw new Error("owner command is not allow-listed");
      }
      const normalizedStatus = status === "rejected" ? "rejected" : "accepted";
      const timestamp = clock();
      const row = insertCommand.run(
        normalizedCommand,
        normalizedStatus,
        timestamp,
        normalizedStatus === "accepted" ? timestamp : null,
        result == null ? null : safeJson(result),
      );
      tightenFilePermissions(databasePath);
      return { id: Number(row.lastInsertRowid), command: normalizedCommand, status: normalizedStatus, createdAt: timestamp };
    },
    listRecentCommands(limit = 20) {
      const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      return recentCommands.all(boundedLimit).map(parseCommand);
    },
    close() {
      if (database.open) database.close();
    },
  };
}

module.exports = {
  ALLOWED_OWNER_COMMANDS,
  createOwnerControlStore,
  ownerCommandPayloadContainsCode,
  safeObject,
};
