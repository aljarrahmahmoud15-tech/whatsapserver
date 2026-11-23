"use strict";
// Owner instruction 2026-11-24 00:25 +03: «أي captain خارج group الـ WhatsApp … احذفه بالكامل».
// Two things must be provable before anything is allowed to run: the plan only trusts a COMPLETE participant
// snapshot (a partial list would delete active in-group captains), and money history is never destroyed -
// accounts with references are unlinked while wallet_ledger / order_settlements / audit_logs stay untouched.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("server.js", "utf8");

const pureStart = source.indexOf("function outsideGroupRemovalTrust(");
const pureEnd = source.indexOf("function buildOutsideGroupCaptainRemovalPlan(");
assert.ok(pureStart >= 0 && pureEnd > pureStart, "trust and classification helpers must exist and stay adjacent");
const sandbox = {};
vm.runInNewContext(`${source.slice(pureStart, pureEnd)}\nthis.trust = outsideGroupRemovalTrust;\nthis.classify = classifyOutsideGroupCaptains;`, sandbox);

const IN = "962790000111";
const OUT_EMPTY = "962790000222";
const OUT_HISTORY = "962790000333";
const OUT_WALLET = "962790000444";
const OUT_NO_PHONE = "";
const PROTECTED = "962770000000";

// --- snapshot trust -------------------------------------------------------------
const BOT = "962779110123";
const phonesFrom = (list) => new Set(list.map((item) => String(item.id).replace(/@c\.us$/i, "").split(":")[0]));
const memberPhones = new Set([IN, PROTECTED, "962779110123"]);
assert.equal(sandbox.trust({ participants: [], memberPhones: new Set(), unresolvedParticipants: 0, botPhone: "" }).trusted, false);
assert.equal(sandbox.trust({ participants: [], memberPhones: new Set(), unresolvedParticipants: 0, botPhone: "" }).reason, "participant_snapshot_empty");
const partial = [{ id: IN }, { id: "120363256484925871@lid" }];
assert.equal(sandbox.trust({ participants: partial, memberPhones: phonesFrom([{ id: IN }]), unresolvedParticipants: 1, botPhone: BOT }).reason, "participant_phone_unresolved",
  "a participant whose phone cannot be resolved must block removal instead of guessing");
const noBot = [{ id: IN }, { id: PROTECTED }];
assert.equal(sandbox.trust({ participants: noBot, memberPhones: phonesFrom(noBot), unresolvedParticipants: 0, botPhone: BOT }).reason, "bot_missing_from_participants",
  "the bot must be inside its own group list before that list is trusted");
const complete = [{ id: IN }, { id: PROTECTED }, { id: `${BOT}@c.us` }];
assert.equal(sandbox.trust({ participants: complete, memberPhones: phonesFrom(complete), unresolvedParticipants: 0, botPhone: BOT }).trusted, true);
assert.equal(sandbox.trust({ participants: complete, memberPhones: phonesFrom(complete), unresolvedParticipants: 0, botPhone: BOT }).participantCount, 3);

// --- classification -------------------------------------------------------------
const captains = [
  { id: 1, phone: IN, wallet_cents: 2500, active: 1, account_status: "active" },
  { id: 2, phone: OUT_EMPTY, wallet_cents: 0, active: 1, account_status: "active" },
  { id: 3, phone: OUT_HISTORY, wallet_cents: 0, active: 1, account_status: "active" },
  { id: 4, phone: OUT_WALLET, wallet_cents: 500, active: 1, account_status: "active" },
  { id: 5, phone: OUT_NO_PHONE, wallet_cents: 0, active: 1, account_status: "active" },
  { id: 6, phone: PROTECTED, wallet_cents: 0, active: 1, account_status: "active" },
];
const referenceCounts = new Map([[1, 4], [3, 7], [4, 0]]);
const isProtectedIdentity = (phone) => phone === PROTECTED;
const buckets = sandbox.classify({ captains, memberPhones, referenceCounts, isProtectedIdentity });

assert.deepEqual([...buckets.keep.map((item) => item.id)], [1], "in-group captains are never touched");
assert.deepEqual([...buckets.delete.map((item) => item.id)], [2], "only a reference-free, wallet-free outside account is deleted");
assert.deepEqual([...buckets.unlink.map((item) => item.id)], [3, 4], "outside accounts with history or money are unlinked, not deleted");
assert.equal(buckets.unlink.find((item) => item.id === 3).reason, "financial_or_order_history");
assert.equal(buckets.unlink.find((item) => item.id === 4).reason, "non_zero_wallet");
assert.deepEqual([...buckets.hold.map((item) => item.id)], [5], "an unresolvable phone is held instead of removed");
assert.equal(buckets.hold[0].reason, "captain_phone_unresolved");
assert.deepEqual([...buckets.protectedKeep.map((item) => item.id)], [6], "owner identities are protected before membership is even read");
assert.equal(buckets.keep.length + buckets.delete.length + buckets.unlink.length + buckets.hold.length + buckets.protectedKeep.length, captains.length,
  "every captain lands in exactly one bucket");

const mutated = [...buckets.delete, ...buckets.unlink].map((item) => item.id).sort();
assert.deepEqual(mutated, [2, 3, 4], "only reference-resolved outside accounts reach a mutation");

// --- access artifacts must not block a deletion ---------------------------------
// An account that only ever received an invite card or a login link has no financial connection at all, so
// it belongs in the delete bucket; a money table must never be treated the same way.
const slicePure = (name) => {
  const start = source.indexOf(`const ${name} = new Set(`);
  assert.ok(start >= 0, `${name} must exist`);
  return start;
};
slicePure("OUTSIDE_GROUP_ACCESS_CHILD_TABLES");
const accessSetStart = source.indexOf("const OUTSIDE_GROUP_ACCESS_CHILD_TABLES = new Set(");
const accessSetLine = source.slice(accessSetStart, source.indexOf(";", accessSetStart) + 1);
assert.ok(accessSetLine.includes('"captain_login_links"') && accessSetLine.includes('"captain_invites"'), "login links and invites are access artifacts");
for (const moneyTable of ["wallet_ledger", "order_settlements", "orders", "topup_cards", "audit_logs", "captain_subscription_charges", "captain_daily_charges", "captain_withdrawal_requests"]) {
  assert.equal(accessSetLine.includes(`"${moneyTable}"`), false, `${moneyTable} must stay a blocking reference`);
}
const accessBuckets = sandbox.classify({
  captains: [
    { id: 7, phone: "962790000777", wallet_cents: 0, active: 1, account_status: "active" },
    { id: 8, phone: "962790000888", wallet_cents: 0, active: 1, account_status: "active" },
  ],
  memberPhones: new Set([IN, BOT]),
  referenceCounts: new Map([[7, 0], [8, 0]]),
  accessCounts: new Map([[7, 3], [8, 0]]),
  isProtectedIdentity: () => false,
});
assert.deepEqual([...accessBuckets.delete.map((item) => item.id)], [7, 8], "links and invites alone must not keep an account alive");
assert.equal(accessBuckets.delete.find((item) => item.id === 7).access, 3);

// --- the deployed shape of the owner route --------------------------------------
const blockStart = source.indexOf('const OUTSIDE_GROUP_CAPTAIN_REMOVAL_CONFIRMATION = "REMOVE_CAPTAINS_OUTSIDE_OFFICIAL_GROUP";');
const blockEndAnchor = source.indexOf('app.get("/api/admin/group/live-messages"');
assert.ok(blockStart >= 0 && blockEndAnchor > blockStart, "the removal block must exist and end before the group live-messages route");
assert.ok(blockStart > source.indexOf('app.post("/api/admin/captains/cleanup-execute"'), "the removal block must sit after the paused cleanup route, never inside it");
const block = source.slice(blockStart, blockEndAnchor);

assert.ok(block.includes('app.get("/api/admin/captains/outside-group-preview", requireOwnerAdmin'), "the preview must be owner-only");
assert.ok(block.includes('app.post("/api/admin/captains/remove-outside-group", requireOwnerAdmin'), "the execution must be owner-only");
assert.ok(block.includes("adminMutationLimiter"), "the mutation route must keep the admin mutation limiter");
assert.ok(block.includes('if (req.body?.execute !== true)'), "execution needs an explicit execute switch");
assert.ok(block.includes("await db.backup("), "a database backup must be taken before any removal");
assert.ok(block.includes("if (!plan.trust.trusted)"), "an untrusted participant snapshot must refuse the run");
assert.ok(block.includes("JSON.stringify(plan.counts) !== JSON.stringify(expected)"), "live counts must still match the preview counts");

// Money safety inside this block: no ledger, settlement, order or audit row is ever removed, and the only
// user-row deletion is guarded to role='captain' AND is_bot=0 AND not merged.
for (const forbidden of ["DELETE FROM wallet_ledger", "DELETE FROM order_settlements", "DELETE FROM orders", "DELETE FROM audit_logs",
  "DELETE FROM topup_cards", "DELETE FROM captain_subscription_charges", "UPDATE wallet_ledger", "UPDATE order_settlements",
  "UPDATE users SET wallet_cents", "purgeExperimentalCaptains", "rejectCaptainRemovalWhilePaused"]) {
  assert.equal(block.includes(forbidden), false, `the removal block must never contain ${forbidden}`);
}
assert.equal(block.split("DELETE FROM users").length - 1, 1, "exactly one user-row deletion statement");
assert.ok(block.includes("DELETE FROM users WHERE id=? AND role='captain' AND is_bot=0 AND account_status<>'merged'"));
assert.ok(block.includes('DELETE FROM captain_login_links WHERE captain_user_id=?'), "login links must be cleared before a ghost account is deleted");
assert.ok(block.includes("UPDATE captain_invites SET approved_user_id=NULL"), "approved invite rows must be detached, never destroyed");
assert.ok(block.includes("account_status='deleted'"), "unlinked accounts must be marked deleted so login and panels stop showing them");
assert.ok(block.includes("archived_at=?") && block.includes("archive_reason=?"), "unlinked accounts keep a recorded owner reason");
assert.ok(block.includes("ledgerRowsPreserved: true"), "the audit entry must state that money rows were preserved");
assert.ok(block.includes("ownersOnly: true"), "the confirmation notice goes to the owner only");

// The expensive per-captain count loop that froze the instance must not come back.
assert.equal(block.includes("FROM orders WHERE producer_user_id=? OR captain_user_id=?"), false,
  "no per-captain prepared count loop is allowed in this path");
assert.ok(block.includes("GROUP BY uid"), "references must be gathered with grouped aggregates");

// --- bounded batches ------------------------------------------------------------
// The first live run on 2026-11-24 01:09 +03 kept the single-CPU instance busy past the edge timeout and the
// restart rolled the whole transaction back, so a batch now writes a bounded number of accounts per request.
// None of the original guards were relaxed to get there.
assert.ok(block.includes("account_status<>'merged' AND account_status<>'deleted'"),
  "accounts this path already tombstoned must leave the plan so each batch sees a smaller list");
assert.ok(block.includes("const deleteTargets = batchSize > 0"), "each request must bound how many accounts it writes");
assert.ok(block.includes("if (!Number.isInteger(batchSize) || batchSize < 0 || batchSize > 500)"),
  "the batch size needs a hard upper bound");
assert.ok(block.includes("const prior = fs.readdirSync(backupDir)"),
  "a later batch may reuse an existing removal backup instead of copying the database again");
assert.ok(block.includes("if (!prior.length)"),
  "skipping the backup when no removal backup exists must refuse before any write");
assert.ok(block.includes("nextExpected: recount.counts"),
  "the response must report the counts the next batch has to confirm, so no preview is skipped");
assert.ok(block.includes("completed: recount.counts.deleteCount === 0 && recount.counts.unlinkCount === 0"),
  "the run must state when nothing is left to remove");
console.log("outside-group captain removal plan and owner route shape: passed");
