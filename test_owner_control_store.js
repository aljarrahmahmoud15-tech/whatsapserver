const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOwnerControlStore, ownerCommandPayloadContainsCode } = require("./owner-control-store");

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
assert.deepEqual(store.allowedCommands, [
  "status.snapshot",
  "official-group.snapshot",
  "data.summary",
  "bot.restart",
  "session.refresh",
  "group.broadcast",
]);
for (const command of ["bot.restart", "session.refresh", "group.broadcast"]) {
  assert.equal(store.recordCommand(command, "accepted", { mutation: "test-only" }).status, "accepted");
}
assert.throws(() => store.recordCommand("eval", "accepted"), /allow-listed/);
assert.equal(ownerCommandPayloadContainsCode({ command: "group.broadcast", message: "eval(process.env)" }), true);
assert.equal(ownerCommandPayloadContainsCode({ command: "group.broadcast", message: "إعلان تشغيلي عادي" }), false);
assert.equal(ownerCommandPayloadContainsCode({ command: "group.broadcast", code: "return 1" }), true);

store.close();
const dbPath = path.join(tempDir, "owner-control.sqlite");
assert.ok(fs.existsSync(dbPath));
assert.equal(fs.statSync(dbPath).mode & 0o077, 0, "owner-control database must not be group/world accessible");
fs.rmSync(tempDir, { recursive: true, force: true });

const server = fs.readFileSync("./server.js", "utf8");
assert.match(server, /owner-control-store/);
assert.match(server, /app\.get\("\/api\/admin\/owner-control", requireBotWalletOwner/);
assert.match(server, /ownerControlStore\.allowedCommands/);
assert.match(server, /bot\.restart/);
assert.match(server, /session\.refresh/);
assert.match(server, /group\.broadcast/);
assert.match(server, /official_group_exact_match_required/);
assert.match(server, /executable_code_payload_rejected/);
assert.match(server, /ownerBroadcastMessageIsOperational/);
assert.match(server, /productionDatabaseUntouched: true/);
assert.doesNotMatch(server, /owner-control\/command[\s\S]{0,240}eval\(/, "owner control must not evaluate arbitrary code");
assert.doesNotMatch(server, /owner-control\/command[\s\S]{0,240}new Function\(/, "owner control must not construct arbitrary functions");
assert.doesNotMatch(server, /owner-control\/command[\s\S]{0,240}child_process/, "owner control must not execute child processes from input");
assert.match(server, /LocalAuth\(\{ clientId: WHATSAPP_CLIENT_ID, dataPath: AUTH_PATH \}\)/);
assert.match(server, /recordOwnerControlCheckpoint\("whatsapp\.ready"/);
assert.match(server, /ownerControlStore\.close\(\)/);

console.log("owner control store regression: PASS");
