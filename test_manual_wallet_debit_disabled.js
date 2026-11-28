const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('server.js', 'utf8');
const adminStart = source.indexOf('async function handleAdminWalletAdjustment');
const adminEnd = source.indexOf('function handleAdminDirectWalletCredit', adminStart);
assert.ok(adminStart >= 0 && adminEnd > adminStart, 'admin wallet adjustment handler exists');

function makeDb() {
  const stats = { writes: 0, transactions: 0 };
  return {
    stats,
    prepare() {
      return {
        get() {
          return { id: 7, phone: 'fixture-captain', name: 'Fixture Captain', wallet_cents: 1250, active: 1, role: 'captain', account_status: 'active', is_bot: 0 };
        },
        run() { stats.writes += 1; return { changes: 1, lastInsertRowid: 1 }; },
      };
    },
    transaction(fn) {
      return (...args) => { stats.transactions += 1; return fn(...args); };
    },
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request() {
  return { params: { id: '7' }, body: { direction: 'debit', amount: 2, reason: 'test fixture', idempotencyKey: 'fixture-key-123456789' } };
}

async function assertDenied(handler, db, label) {
  const res = makeResponse();
  await handler(request(), res);
  assert.equal(res.statusCode, 403, `${label}: debit is forbidden`);
  assert.equal(res.body.code, 'MANUAL_WALLET_DEBIT_DISABLED', `${label}: stable denial code`);
  assert.equal(res.body.financialMutation, false, `${label}: response explicitly confirms no mutation`);
  assert.equal(db.stats.writes, 0, `${label}: no database writes`);
  assert.equal(db.stats.transactions, 0, `${label}: no transaction started`);
}

(async () => {
  const adminDb = makeDb();
  const adminContext = { db: adminDb };
  vm.runInNewContext(`${source.slice(adminStart, adminEnd)}\nthis.handler = handleAdminWalletAdjustment;`, adminContext);
  await assertDenied(adminContext.handler, adminDb, 'admin wallet endpoint');

  const dashboardStart = source.indexOf('app.post("/api/dashboard/captains/:id/wallet-adjustment"');
  const dashboardEnd = source.indexOf('\napp.post("/api/admin/whatsapp/restart"', dashboardStart);
  assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart, 'dashboard wallet route exists');
  const dashboardDb = makeDb();
  const registration = {};
  const dashboardContext = {
    db: dashboardDb,
    requireCompanyOwner() {},
    app: { post(path, middleware, handler) { registration.path = path; registration.handler = handler; } },
  };
  vm.runInNewContext(source.slice(dashboardStart, dashboardEnd), dashboardContext);
  assert.equal(registration.path, '/api/dashboard/captains/:id/wallet-adjustment');
  await assertDenied(registration.handler, dashboardDb, 'dashboard wallet endpoint');

  const index = fs.readFileSync('public/index.html', 'utf8');
  const adminPage = fs.readFileSync('admin.html', 'utf8');
  assert.match(index, /\.ops-btn\[data-wallet-direction="debit"\]\{display:none!important\}/, 'primary panel hides the general manual debit button');
  assert.match(index, /data-wallet-direction="credit"/, 'primary panel retains credit');
  assert.doesNotMatch(adminPage, /adjustCaptainWallet\(\$\{Number\(c\.id\)\},'debit'\)/, 'legacy admin panel no longer offers general manual debit');
  assert.match(adminPage, /adjustCaptainWallet\(\$\{Number\(c\.id\)\},'credit'\)/, 'legacy admin panel retains credit');
  assert.match(adminPage, /if\(direction!=='credit'\)/, 'legacy admin client refuses non-credit adjustments');

  console.log('manual wallet debit APIs deny without writes; credit UI remains available');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
