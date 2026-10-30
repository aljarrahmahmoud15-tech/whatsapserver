const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const server = fs.readFileSync('server.js', 'utf8');

const guardStart = server.indexOf('function acceptanceBalanceGuard');
const guardEnd = server.indexOf('\nfunction latestOpenOrder', guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart, 'acceptance balance policy must exist');
const guardSource = server.slice(guardStart, guardEnd);
assert.doesNotMatch(guardSource, /state: "insufficient_balance"/);
assert.doesNotMatch(guardSource, /balanceCents >= 0 && balanceCents < requiredCents/);
assert.match(guardSource, /order\.acceptance\.allowed_with_negative_balance/);
assert.match(guardSource, /financialMutation: false/);
assert.match(guardSource, /return \{ allowed: true, walletOwner, balanceCents, requiredCents, projectedBalanceCents \}/);

const auditEvents = [];
const context = {
  BOT_FINANCIAL_MODE: 'captain',
  calculateConfiguredSettlement: () => ({ confirmingCaptainFeeCents: 125 }),
  companyUser: () => ({ id: 1, role: 'company' }),
  audit: (...args) => auditEvents.push(args),
};
vm.runInNewContext(`${guardSource}\nthis.acceptanceBalanceGuard = acceptanceBalanceGuard;`, context);
const candidate = { id: 55, price_cents: 1000, order_kind: 'regular' };
const lowPositive = context.acceptanceBalanceGuard(candidate, { id: 17, is_bot: 0, wallet_cents: 25 });
assert.equal(lowPositive.allowed, true);
assert.equal(lowPositive.projectedBalanceCents, -100);
assert.equal(auditEvents[0][0], 'order.acceptance.allowed_with_negative_balance');
assert.equal(auditEvents[0][3].financialMutation, false);
const alreadyNegative = context.acceptanceBalanceGuard(candidate, { id: 18, is_bot: 0, wallet_cents: -50 });
assert.equal(alreadyNegative.allowed, true);
assert.equal(alreadyNegative.projectedBalanceCents, -175);
assert.equal(auditEvents.length, 2);
const sufficient = context.acceptanceBalanceGuard(candidate, { id: 19, is_bot: 0, wallet_cents: 500 });
assert.equal(sufficient.allowed, true);
assert.equal(sufficient.projectedBalanceCents, 375);
assert.equal(auditEvents.length, 2, 'non-negative projected balance does not create a debt audit');

const registerStart = server.indexOf('function registerAcceptance');
const identityIndex = server.indexOf('persistWhatsappIdentity(identityValue, senderPhone, "accepted_message_sender")', registerStart);
const guardCallIndex = server.indexOf('const balanceGuard = acceptanceBalanceGuard(candidate, captain)', registerStart);
const acceptanceInsertIndex = server.indexOf('INSERT INTO order_candidate_acceptances', registerStart);
assert.ok(identityIndex >= 0 && guardCallIndex > identityIndex && acceptanceInsertIndex > guardCallIndex, 'acceptance follows identity and eligibility checks');

const settlementStart = server.indexOf('function settlePendingOrder(');
const settlementEnd = server.indexOf('\nfunction settleHistoricalConfirmedOrder', settlementStart);
assert.ok(settlementStart >= 0 && settlementEnd > settlementStart, 'live order settlement must exist');
const settlement = server.slice(settlementStart, settlementEnd);
const debtLimitAuditIndex = settlement.indexOf('audit("order.candidate_debt_limit_bypassed"');
const debtRecordedAuditIndex = settlement.indexOf('audit("order.candidate_debt_recorded"');
const orderInsertIndex = settlement.indexOf('const orderInsert = db.prepare("INSERT INTO orders');
const captainDebitIndex = settlement.indexOf('UPDATE users SET wallet_cents=wallet_cents-?');
assert.ok(debtLimitAuditIndex >= 0 && debtRecordedAuditIndex > debtLimitAuditIndex && orderInsertIndex > debtRecordedAuditIndex && captainDebitIndex > orderInsertIndex, 'negative debt is audited while the existing atomic settlement still completes');
assert.match(settlement, /INSERT OR IGNORE INTO order_settlements/);
assert.match(settlement, /UPDATE order_settlements SET status='applied'/);

assert.match(server, /if \(direction === "debit" && nextBalance < CAPTAIN_MIN_BALANCE_CENTS\)/, 'manual wallet debits retain their existing debt limit');
assert.match(server, /orderSettlementDebtPolicy: "يسمح بتثبيت جميع أنواع الطلبات وخصم 15% حتى مع الرصيد السالب"/);

console.log('negative-balance acceptance and settlement policy: ok; manual debit limit remains');
