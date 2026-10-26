const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('./server.js', 'utf8');
const page = fs.readFileSync('./public/admin-v26.html', 'utf8');
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] || '';

assert.equal((server.match(/balanceCents: Number\(row\.wallet_cents \|\| 0\)/g) || []).length, 2, 'captain list and archive expose authoritative balanceCents');
assert.match(page, /إصدار الواجهة 2026-10-26/, 'V26 exposes the deployed build marker');
assert.match(page, /function captainName\(c\)\{return c\?\.name\|\|c\?\.registrationName/, 'editable name has display priority');
assert.match(page, /function walletBalanceCents\(entry\)/, 'V26 has an explicit cents parser');
assert.match(page, /function walletBalanceText\(entry\)/, 'V26 formats balances from authoritative cents');
assert.equal((page.match(/walletBalanceAmount\(c\)/g) || []).length, 7, 'captain balance calculations use the cents contract');
assert.equal((page.match(/walletBalanceText\(c\)/g) || []).length, 5, 'captain balance displays use the cents contract');
assert.match(page, /api\('\/api\/admin\/captains\?fresh=1'\)/, 'captain list bypasses stale read cache');
assert.match(page, /api\('\/api\/admin\/company-wallet\?fresh=1'\)/, 'company wallet bypasses stale read cache');
const editStart = page.indexOf('async function saveCaptainEdit');
const editEnd = page.indexOf('async function applyCaptainCredit', editStart);
assert.ok(editStart >= 0 && editEnd > editStart, 'edit handler boundaries exist');
const edit = page.slice(editStart, editEnd);
assert.match(edit, /const endpoint=pin\?'/, 'PIN edits keep the owner-protected combined endpoint');
assert.match(edit, /\/api\/admin\/users\//, 'PIN edit endpoint remains supported');
assert.match(edit, /\/api\/admin\/captains\//, 'name-only edit uses the captain endpoint');
assert.doesNotMatch(page, /wallet_cents\s*=/, 'V26 does not mutate wallet cents');
new vm.Script(script);
console.log('V26 captain edit and balance contract: PASS');
