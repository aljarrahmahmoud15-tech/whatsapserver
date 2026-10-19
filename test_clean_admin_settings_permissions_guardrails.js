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

// 6) no Server 2 identity leaked into clean
["whatsapserver-2.onrender.com", "12036342660456061", "0779039586"].forEach((needle) => {
  assert.ok(!server.includes(needle), `clean must not contain Server 2 identity: ${needle}`);
});

console.log("clean admin settings/permissions guardrails: OK");