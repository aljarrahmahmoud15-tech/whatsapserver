const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("server.js", "utf8");
const admin = fs.readFileSync("admin.html", "utf8");

assert.match(server, /identity:\s*\{/);
assert.match(server, /botPhone:/);
assert.match(server, /groupId:/);
assert.match(server, /inviteUrl:\s*getSetting\("group_invite_url"/);
assert.match(server, /setSetting\("group_invite_url", String\(req\.body\.inviteLink/);
assert.match(admin, /id="serviceIdentityCard"/);
assert.match(admin, /id="serviceIdentityGrid"/);
assert.match(admin, /renderServiceIdentity\(bot\.identity\|\|\{\}\)/);
assert.match(admin, /chat.*whatsapp.*com/);

console.log("service identity admin UI guardrails verified");
