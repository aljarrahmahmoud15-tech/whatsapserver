"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync("./server.js", "utf8");

function phoneWithCountry(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("0") ? `962${digits.slice(1)}` : digits;
}

function evaluatePolicy(clean) {
  const declaration = source.match(/^const BLOCKED_PHONES = .*;$/m);
  assert.ok(declaration, "explicit blocked-phone declaration exists");
  return vm.runInNewContext(`${declaration[0]}; [...BLOCKED_PHONES].map(phoneWithCountry)`, {
    CLEAN_INSTANCE: clean,
    phoneWithCountry,
  });
}

test("owner-approved phone is unblocked only in Clean", () => {
  const clean = evaluatePolicy(true);
  const server2 = evaluatePolicy(false);
  assert.equal(clean.includes("962779110123"), false);
  assert.equal(server2.includes("962779110123"), true);
  for (const phone of ["962792026321", "962792026320"]) {
    assert.equal(clean.includes(phone), true);
    assert.equal(server2.includes(phone), true);
  }
});

test("persisted block cleanup is phone-scoped, idempotent, and Clean-only", () => {
  const match = source.match(/function sanitizeApprovedCleanCaptainPhone\(\) \{[\s\S]*?\n\}/);
  assert.ok(match);
  const simulate = (clean) => {
    const blocked = new Set(["962779110123", "962792026321", "962792026320"]);
    const calls = [];
    const db = { prepare(sql) {
      assert.equal(sql, "DELETE FROM blocked_phones WHERE phone=?");
      return { run(phone) { calls.push(phone); return { changes: blocked.delete(phone) ? 1 : 0 }; } };
    } };
    vm.runInNewContext(`${match[0]}; sanitizeApprovedCleanCaptainPhone(); sanitizeApprovedCleanCaptainPhone();`, {
      CLEAN_INSTANCE: clean,
      LEGACY_BOT_PHONE: "0779110123",
      phoneWithCountry,
      db,
    });
    return { blocked, calls };
  };
  const clean = simulate(true);
  assert.equal(clean.blocked.has("962779110123"), false);
  assert.equal(clean.blocked.has("962792026321"), true);
  assert.equal(clean.blocked.has("962792026320"), true);
  assert.deepEqual(clean.calls, ["962779110123", "962779110123"]);
  const server2 = simulate(false);
  assert.equal(server2.blocked.has("962779110123"), true);
  assert.deepEqual(server2.calls, []);
  assert.match(source, /ensureBlockedPhones\(\);\s*sanitizeLegacyPhone\(\);\s*sanitizeApprovedCleanCaptainPhone\(\);\s*ensureSystemUsers\(\);/);
});

test("private sender guard follows phone policy, not the retired bot number", () => {
  assert.doesNotMatch(source, /CLEAN_IGNORED_DIRECT_BOT_PHONE/);
  const start = source.indexOf("async function handleIncomingMessage(");
  assert.ok(start >= 0);
  assert.match(source.slice(start, start + 550), /if \(isBlockedPhone\(directSenderPhone\)\) return;/);
});

test("unblocking does not create accounts, skip approval, or inherit Server 2 owner privileges", () => {
  const match = source.match(/function sanitizeApprovedCleanCaptainPhone\(\) \{[\s\S]*?\n\}/);
  assert.doesNotMatch(match[0], /INSERT INTO users|UPDATE users|captain_invites|sendMessage|sendBotText/);
  assert.match(source, /CLEAN_INSTANCE \? \[\] : \["\+962779110123"\]/);
  assert.match(source, /phone !== phoneWithCountry\(LEGACY_BOT_PHONE\)/);
  assert.match(source, /Clean accepts captains only through the official invitation flow/);
});
