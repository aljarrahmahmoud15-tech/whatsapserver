const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const server = fs.readFileSync('server.js', 'utf8');

const guardStart = server.indexOf('function acceptanceBalanceGuard');
const guardEnd = server.indexOf('\nfunction latestOpenOrder', guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart, 'acceptance balance policy must exist');
const guardSource = server.slice(guardStart, guardEnd);
assert.match(guardSource, /state: "insufficient_balance"/);
assert.match(guardSource, /CAPTAIN_MIN_BALANCE_CENTS/);
assert.match(guardSource, /return \{ allowed: false, state: "insufficient_balance"/);
assert.match(guardSource, /return \{ allowed: true, walletOwner, balanceCents, requiredCents, projectedBalanceCents \}/);

const context = {
  CAPTAIN_MIN_BALANCE_CENTS: -100,
  BOT_FINANCIAL_MODE: 'captain',
  calculateConfiguredSettlement: () => ({ confirmingCaptainFeeCents: 125 }),
  companyUser: () => ({ id: 1, role: 'company' }),
};
vm.runInNewContext(`${guardSource}\nthis.acceptanceBalanceGuard = acceptanceBalanceGuard;`, context);
const candidate = { id: 55, price_cents: 1000, order_kind: 'regular' };
const lowPositive = context.acceptanceBalanceGuard(candidate, { id: 17, is_bot: 0, wallet_cents: 25 });
assert.equal(lowPositive.allowed, true);
assert.equal(lowPositive.projectedBalanceCents, -100);
const alreadyNegative = context.acceptanceBalanceGuard(candidate, { id: 18, is_bot: 0, wallet_cents: -50 });
assert.equal(alreadyNegative.allowed, false);
assert.equal(alreadyNegative.state, 'insufficient_balance');
const sufficient = context.acceptanceBalanceGuard(candidate, { id: 19, is_bot: 0, wallet_cents: 500 });
assert.equal(sufficient.allowed, true);
assert.equal(sufficient.projectedBalanceCents, 375);

const registerStart = server.indexOf('function registerAcceptance');
const identityIndex = server.indexOf('persistWhatsappIdentity(identityValue, senderPhone, "accepted_message_sender")', registerStart);
const guardCallIndex = server.indexOf('const balanceGuard = acceptanceBalanceGuard(candidate, captain)', registerStart);
const acceptanceInsertIndex = server.indexOf('INSERT INTO order_candidate_acceptances', registerStart);
assert.ok(identityIndex >= 0 && guardCallIndex > identityIndex && acceptanceInsertIndex > guardCallIndex, 'acceptance follows identity and balance checks');

const settlementStart = server.indexOf('function settlePendingOrder(');
const settlementEnd = server.indexOf('\nfunction settleHistoricalConfirmedOrder', settlementStart);
assert.ok(settlementStart >= 0 && settlementEnd > settlementStart, 'live order settlement must exist');
const settlement = server.slice(settlementStart, settlementEnd);
const settlementGuardIndex = settlement.indexOf('return { state: "insufficient_balance"');
const orderInsertIndex = settlement.indexOf('const orderInsert = db.prepare("INSERT INTO orders');
const captainDebitIndex = settlement.indexOf('UPDATE users SET wallet_cents=wallet_cents-?');
assert.ok(settlementGuardIndex >= 0 && settlementGuardIndex < orderInsertIndex, 'settlement rejects negative projected balance before order mutation');
assert.ok(captainDebitIndex > orderInsertIndex, 'captain debit remains after atomic order creation');
assert.match(settlement, /INSERT OR IGNORE INTO order_settlements/);
assert.match(settlement, /UPDATE order_settlements SET status='applied'/);

const historyStart = server.indexOf('function settleHistoricalConfirmedOrder');
const historyEnd = server.indexOf('\nfunction ', historyStart + 10);
const history = server.slice(historyStart, historyEnd > historyStart ? historyEnd : undefined);
assert.match(history, /return \{ state: "insufficient_balance"/);
assert.match(server, /if \(direction === "debit" && nextBalance < CAPTAIN_MIN_BALANCE_CENTS\)/, 'manual wallet debits retain their existing debt limit');
assert.match(server, /negative projected balances allowed down to -1\.00 JOD; normal debit 15%, order debit 20%/);
assert.match(server, /يُسمح بالتثبيت حتى رصيد متوقع -1\.00 دينار؛ الطلب العادي يخصم 15% والأوردر يخصم 20% حتى حد الدين/);

console.log('negative-balance settlement is allowed to -1.00 JOD and rejected below the floor; manual debit limit remains');
