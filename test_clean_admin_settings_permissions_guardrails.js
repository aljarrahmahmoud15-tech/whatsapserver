#!/usr/bin/env node
/*
 * Guardrails for the clean-only admin read helpers and the owner settings/permissions routes.
 * Asserts: no external cache/queue dependency, no Server 2 identity, owner-only guarding preserved.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

// 1) helpers exist and are in-memory only
assert.ok(/function adminReadLimiter\s*\(/.test(server), "adminReadLimiter helper must exist");
assert.ok(/function v27AdminReadCache\s*\(/.test(server), "v27AdminReadCache helper must exist");
assert.ok(/function requireOwnerAdmin\s*\(/.test(server), "requireOwnerAdmin helper must exist");
assert.ok(/function notificationSettingsResponse\s*\(/.test(server), "notificationSettingsResponse helper must exist");

// 2) no Redis / external cache client was dragged in from Server 2
assert.ok(!/require\(["']ioredis["']\)/.test(server), "clean must not require ioredis");
assert.ok(!/require\(["']redis["']\)/.test(server), "clean must not require redis");
assert.ok(!/REDIS_URL/.test(server), "clean must not depend on REDIS_URL");
assert.ok(!/X-V27-Read-Cache["'],\s*["']REDIS/.test(server), "no Redis cache-hit markers");

// 3) routes are owner-guarded and rate-limited
const settingsRoute = server.match(/app\.get\("\/api\/admin\/settings",\s*([^,]+),\s*([^,]+),\s*([^,]+),/);
assert.ok(settingsRoute, "/api/admin/settings route must exist");
assert.ok(settingsRoute[1].includes("requireOwnerAdmin"), "/api/admin/settings must be owner-only");
assert.ok(settingsRoute[2].includes("adminReadLimiter"), "/api/admin/settings must be rate limited");
assert.ok(settingsRoute[3].includes("v27AdminReadCache"), "/api/admin/settings must use the read cache");

const permRoute = server.match(/app\.get\("\/api\/admin\/group\/permissions",\s*([^,]+),\s*([^,]+),\s*([^,]+),/);
assert.ok(permRoute, "/api/admin/group/permissions route must exist");
assert.ok(permRoute[1].includes("requireOwnerAdmin"), "/api/admin/group/permissions must be owner-only");
assert.ok(permRoute[2].includes("adminReadLimiter"), "/api/admin/group/permissions must be rate limited");
assert.ok(permRoute[3].includes("v27AdminReadCache"), "/api/admin/group/permissions must use the read cache");

// 4) read-only contract: no mutation side effects in the new routes
const permBody = server.slice(server.indexOf("/api/admin/group/permissions"), server.indexOf("/api/admin/group/permissions") + 2000);
assert.ok(permBody.includes('mutation: "none"'), "permissions route must declare mutation none");
assert.ok(!/\.run\(|\.exec\(/.test(permBody), "permissions route must not write to the database");

const settingsBody = server.slice(server.indexOf('"/api/admin/settings"'), server.indexOf('"/api/admin/settings"') + 900);
assert.ok(settingsBody.includes('mutation: "none"'), "settings route must declare mutation none");

// 5) settlement policy is reused, not duplicated
assert.strictEqual((server.match(/function settlementPolicyResponse\s*\(/g) || []).length, 1, "settlementPolicyResponse must be defined exactly once");

// 6) Server 2 identity must never appear as an unconditional clean value
assert.ok(!server.includes("120363426604560611"), "clean must not contain the Server 2 group identity");
assert.ok(!server.includes("0779039586"), "clean must not contain the Server 2 bot phone");
server.split("\n").forEach((line, index) => {
  if (line.includes("whatsapserver-2.onrender.com")) {
    assert.ok(/CLEAN_INSTANCE/.test(line), `Server 2 URL must stay behind a CLEAN_INSTANCE guard (line ${index + 1})`);
  }
  if (line.includes("962779110123")) {
    const context = server.split("\n").slice(Math.max(0, index - 8), index + 1).join("\n");
    assert.ok(/CLEAN_INSTANCE|LEGACY_|BLOCKED_PHONES|DEFAULT_GROUP_SETUP_OWNER_PHONES|\?\s*\[/.test(context), `Server 2 phone must stay behind a CLEAN_INSTANCE guard (line ${index + 1})`);
  }
});

// 7) verified-booking recovery must rely on this service's own stored evidence
assert.ok(/Verification evidence is not present in this service message store/.test(server), "verified booking recovery must read evidence from the local store");
assert.ok(!/const verified = \{\s*\n\s*groupId: WHATSAPP_GROUP_ID,/.test(server), "verified booking recovery must not hardcode a fixture identity");

console.log("clean admin settings/permissions guardrails: OK");
