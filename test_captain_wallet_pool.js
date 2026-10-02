const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');

assert.match(server, /CREATE TABLE IF NOT EXISTS captain_wallet_pool_operations/);
assert.match(server, /app\.post\("\/api\/admin\/captain-wallet-pool\/preview", requireBotWalletOwner/);
assert.match(server, /app\.post\("\/api\/admin\/captain-wallet-pool\/execute", requireBotWalletOwner/);
assert.match(server, /CAPTAIN_WALLET_POOL_PREVIEW_STALE/);
assert.match(server, /db\.transaction\(\(\) => \{/);
assert.match(server, /captain_pool_distribution/);
assert.match(server, /captain_pool_withdrawal/);
assert.match(server, /captain\.wallet_pool\.\$\{operation\}\.applied/);
assert.match(admin, /id="captainWalletPoolCard"/);
assert.match(admin, /previewCaptainWalletPool\('distribute'\)/);
assert.match(admin, /previewCaptainWalletPool\('withdraw'\)/);
assert.match(admin, /APPLY_CAPTAIN_WALLET_POOL/);

function allocations(rows, requestedCents, operation) {
  const base = Math.floor(requestedCents / rows.length);
  const remainder = requestedCents % rows.length;
  return rows.map((row, index) => {
    const equalShare = base + (index < remainder ? 1 : 0);
    const amountCents = operation === 'withdraw' ? Math.min(row.balanceCents, equalShare) : equalShare;
    return { id: row.id, amountCents, after: row.balanceCents + (operation === 'withdraw' ? -amountCents : amountCents) };
  });
}

const distribute = allocations([
  { id: 1, balanceCents: 100 },
  { id: 2, balanceCents: 100 },
  { id: 3, balanceCents: 100 },
], 100, 'distribute');
assert.deepEqual(distribute.map((row) => row.amountCents), [34, 33, 33], 'distribution must split cents deterministically');
assert.equal(distribute.reduce((sum, row) => sum + row.amountCents, 0), 100);

const withdraw = allocations([
  { id: 1, balanceCents: 25 },
  { id: 2, balanceCents: 10000 },
], 10000, 'withdraw');
assert.deepEqual(withdraw.map((row) => row.amountCents), [25, 5000], 'withdraw must take only the available amount from a low-balance wallet');
assert.ok(withdraw.every((row) => row.after >= 0), 'withdraw must never make a positive wallet negative');
assert.equal(withdraw.reduce((sum, row) => sum + row.amountCents, 0), 5025);

const executeStart = server.indexOf('app.post("/api/admin/captain-wallet-pool/execute"');
const executeEnd = server.indexOf('app.get("/api/staff/company-wallet"', executeStart);
const executeBlock = server.slice(executeStart, executeEnd);
assert.equal(/sendBotText|sendMessage|sendCaptainStatusText/.test(executeBlock), false, 'wallet pool must not send WhatsApp messages');
assert.match(executeBlock, /expectedEligibleHash/);
assert.match(executeBlock, /confirmation !== CAPTAIN_WALLET_POOL_CONFIRMATION/);

console.log('captain wallet pool regression: PASS');
