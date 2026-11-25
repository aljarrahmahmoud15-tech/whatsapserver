"use strict";

// Behavioural coverage for the QR root-cause fix: archiving a wedged WhatsApp session profile
// must RENAME (never delete) the active profile when the owner explicitly asks for it, and must
// keep the historical no-option behaviour byte-for-byte identical (active profile preserved).

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");

function slice(marker, endMarker) {
  const start = source.indexOf(marker);
  const end = source.indexOf(endMarker, start + marker.length);
  assert.ok(start >= 0 && end > start, `helper boundaries missing: ${marker}`);
  return source.slice(start, end);
}

const helper = slice("function archiveWhatsAppSessionDirectories(", "async function stopAndArchiveOldWhatsAppSession(");

assert.ok(!/rmSync\(|unlinkSync\(|rmdirSync\(|fs\.rm\(|rimraf/.test(helper), "archive helper must never delete anything");
assert.match(source, /async function stopAndArchiveOldWhatsAppSession\(options = \{\}\)/);
assert.match(source, /const result = archiveWhatsAppSessionDirectories\(options\);/);

function loadHelper({ authPath, clientId }) {
  const context = vm.createContext({ fs, path, crypto, AUTH_PATH: authPath, WHATSAPP_CLIENT_ID: clientId });
  vm.runInContext(`${helper}\nglobalThis.exported = archiveWhatsAppSessionDirectories;`, context);
  return context.exported;
}

function tempAuthPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wwebjs-auth-test-"));
}

function seedProfile(root, name, files) {
  const dir = path.join(root, name);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return dir;
}

function readTree(dir) {
  const out = {};
  const walk = (current, prefix = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const key = prefix + entry.name;
      if (entry.isDirectory()) walk(full, `${key}/`);
      else out[key] = fs.readFileSync(full).toString("base64");
    }
  };
  walk(dir);
  return out;
}

const CLIENT_ID = "aljarah-test-scope";
const ACTIVE = `session-${CLIENT_ID}`;

// 1) Legacy behaviour (no options): old profiles renamed, the active profile is left untouched.
{
  const root = tempAuthPath();
  try {
    seedProfile(root, ACTIVE, { "Session/Current Session": "active-bytes" });
    seedProfile(root, "session-aljarah-other", { "Session/Current Session": "stale-bytes" });
    fs.writeFileSync(path.join(root, "keep.txt"), "not a session");
    const archive = loadHelper({ authPath: root, clientId: CLIENT_ID });
    const report = archive();
    assert.equal(report.activeProfile, ACTIVE);
    assert.equal(report.activeProfileArchived, false, "default call must not touch the active profile");
    assert.deepEqual([...report.skipped], [ACTIVE]);
    assert.deepEqual([...report.archived].map((item) => item.name), ["session-aljarah-other"]);
    assert.ok(fs.existsSync(path.join(root, ACTIVE)), "active profile must still exist in place");
    assert.equal(fs.readdirSync(root).includes("keep.txt"), true, "non-session files must be ignored");
    assert.ok(report.archiveRoot.endsWith(path.join(".archived-sessions")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 2) includeActiveProfile: the wedged active profile is renamed aside into a restorable archive.
{
  const root = tempAuthPath();
  try {
    seedProfile(root, ACTIVE, { "Session/Current Session": "wedged-bytes", "Default/lockfile": "lock" });
    seedProfile(root, "session-aljarah-other", { "Session/Current Session": "stale-bytes" });
    const archive = loadHelper({ authPath: root, clientId: CLIENT_ID });
    const report = archive({ includeActiveProfile: true });

    assert.equal(report.activeProfileArchived, true);
    assert.deepEqual([...report.skipped], []);
    assert.equal(report.archived.length, 2);

    assert.ok(!fs.existsSync(path.join(root, ACTIVE)), "active profile must no longer be present");
    assert.deepEqual(fs.readdirSync(root).filter((name) => /^session(?:-.+)?$/.test(name)), [],
      "no session directory may remain for LocalAuth to reuse");

    const archivedActive = report.archived.find((item) => item.name === ACTIVE);
    assert.match(archivedActive.archive, new RegExp(`^${ACTIVE}-\\d{13,}-[0-9a-f]{8}$`));
    assert.equal(archivedActive.restoreTo, path.join(root, ACTIVE));

    const archivedPath = path.join(report.archiveRoot, archivedActive.archive);
    assert.deepEqual(readTree(archivedPath), {
      "Default/lockfile": Buffer.from("lock").toString("base64"),
      "Session/Current Session": Buffer.from("wedged-bytes").toString("base64"),
    }, "renaming must preserve every byte of the session");

    // Restorable: rename back exactly as the report instructs.
    fs.renameSync(archivedPath, archivedActive.restoreTo);
    assert.deepEqual(readTree(path.join(root, ACTIVE))["Session/Current Session"],
      Buffer.from("wedged-bytes").toString("base64"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 3) includeActiveProfile:false (explicit) must behave like the legacy default.
{
  const root = tempAuthPath();
  try {
    seedProfile(root, ACTIVE, { "Session/Current Session": "keep-me" });
    const report = loadHelper({ authPath: root, clientId: CLIENT_ID })({ includeActiveProfile: false });
    assert.equal(report.activeProfileArchived, false);
    assert.deepEqual([...report.archived], []);
    assert.deepEqual([...report.skipped], [ACTIVE]);
    assert.ok(fs.existsSync(path.join(root, ACTIVE)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 4) Missing AUTH_PATH returns a harmless report instead of throwing.
{
  const missing = path.join(os.tmpdir(), `no-such-auth-${crypto.randomBytes(4).toString("hex")}`);
  const report = loadHelper({ authPath: missing, clientId: CLIENT_ID })({ includeActiveProfile: true });
  assert.equal(report.archived.length, 0);
  assert.equal(report.activeProfileArchived, false);
  assert.equal(report.activeProfile, ACTIVE);
  assert.equal(fs.existsSync(missing), false, "a missing auth path must not be created when nothing can be archived");
}

// 5) Only session* directories are archived: Chromium locks and unrelated folders stay put.
{
  const root = tempAuthPath();
  try {
    fs.mkdirSync(path.join(root, ".wwebjs_auth-lock"), { recursive: true });
    fs.mkdirSync(path.join(root, "logs"), { recursive: true });
    seedProfile(root, ACTIVE, { "Session/Current Session": "wedged" });
    const report = loadHelper({ authPath: root, clientId: CLIENT_ID })({ includeActiveProfile: true });
    assert.deepEqual([...report.archived].map((item) => item.name), [ACTIVE]);
    assert.ok(fs.existsSync(path.join(root, "logs")));
    assert.ok(fs.existsSync(path.join(root, ".wwebjs_auth-lock")));
    assert.ok(fs.existsSync(path.join(report.archiveRoot)), "archive root must exist for the owner to inspect");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("WhatsApp session archive: rename-only, active profile gated by an explicit flag, fully restorable");
