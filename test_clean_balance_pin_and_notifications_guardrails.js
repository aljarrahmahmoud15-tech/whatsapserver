const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

// --- owner policy: an order is always pinned, even with a negative balance -----------------
assert.match(server, /return \{ allowed: true, state: "negative_balance_allowed", walletOwner, balanceCents, requiredCents, projectedBalanceCents: balanceCents - requiredCents \};/);
assert.match(server, /orders_are_pinned_regardless_of_balance/);
assert.match(server, /audit\("order\.acceptance_negative_balance_allowed"/);
assert.match(server, /return \{ allowed: true, state: "ok", walletOwner, balanceCents, requiredCents \};/);
// The manual-debit / subscription debt limit must stay untouched.
assert.match(server, /const CAPTAIN_MIN_BALANCE_CENTS = Number\(process\.env\.CAPTAIN_MIN_BALANCE_CENTS \|\| -300\);/);
assert.match(server, /if \(direction === "debit" && nextBalance < CAPTAIN_MIN_BALANCE_CENTS\) return res\.status\(409\)/);

// --- branded group card naming the captain on a negative-balance pin ------------------------
assert.match(server, /async function notifyOfficialGroupNegativeBalanceAcceptance\(/);
assert.match(server, /GROUP-ACCEPTANCE-NEGATIVE-BALANCE-\$\{sourceKey\}/);
assert.match(server, /order\.acceptance\.negative_balance_notice/);
assert.match(server, /const title = "⚠️ تثبيت حجز برصيد غير كافٍ";/);
assert.match(server, /`الكابتن: \$\{captainName\}`/);
assert.match(server, /تم تثبيت الحجز حسب سياسة التشغيل، ولم يُرفض الرد\./);
assert.match(server, /void notifyOfficialGroupNegativeBalanceAcceptance\(\{/);

// --- deleting a discarded «تم» reply with a visible confirmation in the group --------------
assert.match(server, /async function discardAcceptanceMessageWithConfirmation\(/);
assert.match(server, /async function verifyWhatsAppMessageDeleted\(messageId, timeoutMs = 4000\)/);
assert.match(server, /const deletionVerified = deletionStatus === "deleted" \? await verifyWhatsAppMessageDeleted\(messageId\) : false;/);
assert.match(server, /order\.acceptance\.discarded_message/);
assert.match(server, /إلغاء صاحب الطلب للحجز \(❌\) وإعادة فتحه/);
assert.match(server, /const reasonLine = String\(reasonLabel \|\| ""\)\.trim\(\)/);
assert.match(server, /void discardAcceptanceMessageWithConfirmation\(\{/);

// --- notifications: delivered to real group members only, never to outsiders ---------------
assert.match(server, /const CLEAN_GROUP_MEMBER_CACHE_MS = Math\.max\(15000, Number\(process\.env\.CLEAN_GROUP_MEMBER_CACHE_MS \|\| 120000\)\);/);
assert.match(server, /function storedConfiguredGroupParticipantPhones\(groupId\)/);
assert.match(server, /SELECT DISTINCT sender_phone FROM messages WHERE group_id=\?/);
assert.match(server, /async function readCleanGroupMemberPhones\(\{ force = false \} = \{\}\)/);
assert.match(server, /const cache = await readCleanGroupMemberPhones\(\);/);
assert.match(server, /if \(!cache\.phones\.size\) return false;/);
assert.match(server, /if \(CLEAN_INSTANCE && !\(await isCleanConfiguredGroupMemberAllowed\(`\$\{expectedPhone\}@c\.us`\)\)\)/);
assert.match(server, /captain\.pin_notice\.blocked_not_group_member/);
// The guard still sits on the single outbound funnel for direct messages.
assert.match(server, /targetAllowed = await isCleanConfiguredGroupMemberAllowed\(to\);/);

console.log('clean balance-pin policy, deletion confirmation, and notification membership guardrails: OK');
