const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { evaluateBalance } = require('./insufficient-balance-cleanup');
const server = fs.readFileSync('server.js', 'utf8');
const guardStart = server.indexOf('function acceptanceBalanceGuard');
const guardEnd = server.indexOf('\nfunction latestOpenOrder', guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart);
const guardSource = server.slice(guardStart, guardEnd);
const context = {
  CAPTAIN_MIN_BALANCE_CENTS: 0,
  BOT_FINANCIAL_MODE: 'captain',
  calculateConfiguredSettlement: () => ({ confirmingCaptainFeeCents: 125 }),
  companyUser: () => ({ id: 1, role: 'company' }),
  evaluateBalance,
};
vm.runInNewContext(`${guardSource}\nthis.acceptanceBalanceGuard = acceptanceBalanceGuard;`, context);
const candidate = { id: 55, price_cents: 1000, order_kind: 'regular' };
const insufficient = context.acceptanceBalanceGuard(candidate, { id: 17, is_bot: 0, wallet_cents: 25 });
assert.equal(insufficient.allowed, false);
assert.equal(insufficient.state, 'insufficient_balance');
assert.equal(insufficient.projectedBalanceCents, -100);
const exact = context.acceptanceBalanceGuard(candidate, { id: 19, is_bot: 0, wallet_cents: 125 });
assert.equal(exact.allowed, true);
assert.equal(exact.projectedBalanceCents, 0);
assert.match(server, /const balanceGuard = evaluateBalance\(/);
assert.match(server, /if \(!balanceGuard\.allowed\)/);
assert.match(server, /orderSettlementDebtPolicy: "projected balances below 0\.00 JOD are rejected/);
assert.match(server, /يُرفض التثبيت إذا أصبح الرصيد المتوقع أقل من 0\.00 دينار/);
console.log('zero-floor settlement guard verified');
