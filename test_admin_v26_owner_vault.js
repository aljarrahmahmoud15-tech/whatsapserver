const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const server = fs.readFileSync("./server.js", "utf8");
const vaultSource = fs.readFileSync("./owner-vault.js", "utf8");
const page = fs.readFileSync("./public/admin-v26.html", "utf8");
assert.match(server, /createOwnerVault/);
assert.match(server, /app\.get\("\/api\/admin\/owner-vault", requireBotWalletOwner/);
assert.match(server, /app\.post\("\/api\/admin\/owner-vault\/decision", requireBotWalletOwner/);
assert.match(server, /owner\.decision\.note/);
assert.match(server, /mutation: "none"/);
const vaultRouteStart = server.indexOf('app.get("/api/admin/owner-vault"');
const vaultRouteEnd = server.indexOf('app.post("/api/admin/owner-control/command"', vaultRouteStart);
assert.ok(vaultRouteStart >= 0 && vaultRouteEnd > vaultRouteStart);
assert.doesNotMatch(server.slice(vaultRouteStart, vaultRouteEnd), /owner-vault\/execute|eval\(/);
assert.doesNotMatch(vaultSource, /eval\(|Function\(/);
for (const marker of [
  "خزنة المالك V26",
  'data-admin-action="vault"',
  "/api/admin/owner-vault",
  "owner.decision.note",
  "مشفر",
  "لا تنفيذ آلي",
]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
assert.doesNotMatch(page, /OWNER_VAULT_SECRET/);
assert.doesNotMatch(page, /owner-vault\.key/);
assert.doesNotMatch(page, /\/api\/admin\/owner-vault\/execute/);
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0);
new vm.Script(scripts.at(-1));
console.log("V26 owner vault UI and route guard: PASS");
