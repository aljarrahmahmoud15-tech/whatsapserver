const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOwnerControlStore } = require("./owner-control-store");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "waslni-owner-control-"));
const store = createOwnerControlStore({ dataDir: tempDir, clock: () => "2026-10-02T10:00:00.000Z" });

const checkpoint = store.saveCheckpoint("test", {
  whatsapp: { ready: true, qrAvailable: false, sessionPath: "/var/data/.wwebjs_auth" },
  officialGroup: { groupId: "120363426604560611@g.us", body: "should-not-be-stored" },
  credentials: { token: "raw-secret", password: "raw-password", pin: "12345" },
  accessUrl: "https://example.invalid/qr?access=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP",
});
assert.equal(checkpoint.id, 1);
const latest = store.getLatestCheckpoint();
assert.equal(latest.snapshot.whatsapp.ready, true);
assert.equal(latest.snapshot.credentials, "[redacted]");
assert.match(latest.snapshot.accessUrl, /access=\[redacted\]/);
assert.equal(latest.snapshot.officialGroup.body, "[redacted]");
assert.equal(latest.snapshot.officialGroup.groupId, "120363426604560611@g.us");

const accepted = store.recordCommand("official-group.snapshot", "accepted", { mutation: "none" });
assert.equal(accepted.status, "accepted");
assert.equal(store.listRecentCommands(10)[0].command, "official-group.snapshot");
assert.deepEqual(store.allowedCommands, ["status.snapshot", "official-group.snapshot", "data.summary"]);
assert.throws(() => store.recordCommand("eval", "accepted"), /allow-listed/);

store.close();
const dbPath = path.join(tempDir, "owner-control.sqlite");
assert.ok(fs.existsSync(dbPath));
assert.equal(fs.statSync(dbPath).mode & 0o077, 0, "owner-control database must not be group/world accessible");
fs.rmSync(tempDir, { recursive: true, force: true });

const server = fs.readFileSync("./server.js", "utf8");
assert.match(server, /owner-control-store/);
assert.match(server, /app\.get\("\/api\/admin\/owner-control", requireBotWalletOwner/);
assert.match(server, /ownerControlStore\.allowedCommands/);
assert.match(server, /productionDatabaseUntouched: true/);
assert.doesNotMatch(server, /owner-control\/command[\s\S]{0,240}eval\(/, "owner control must not evaluate arbitrary code");
assert.match(server, /LocalAuth\(\{ clientId: WHATSAPP_CLIENT_ID, dataPath: AUTH_PATH \}\)/);
assert.match(server, /recordOwnerControlCheckpoint\("whatsapp\.ready"/);
assert.match(server, /ownerControlStore\.close\(\)/);

console.log("owner control store regression: PASS");
