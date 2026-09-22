const assert = require('node:assert/strict');
const fs = require('node:fs');
const { calculateSettlement } = require('./finance');

const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');
const staff = fs.readFileSync('./public/staff.html', 'utf8');

const settlement = calculateSettlement({
  priceCents: 5000,
  orderKind: 'normal',
  regularProducerRateBps: 1200,
  specialOrderProducerRateBps: 1200,
  companyFromProducerRateBps: 400,
  specialOrderCompanyFromProducerRateBps: 400,
});
assert.equal(settlement.producerNetCents, 600, '12% downloader share for 50 JOD');
assert.equal(settlement.companyCents, 200, '4% company share for 50 JOD');
assert.equal(settlement.confirmingCaptainFeeCents, 800, '16% confirming debit for 50 JOD');

assert.match(server, /charged_user_id INTEGER REFERENCES users\(id\)/);
assert.match(server, /charged_user_id=CASE WHEN captain_user_id IN \(SELECT id FROM users WHERE is_bot=1\)/);
assert.match(server, /const BOT_FINANCIAL_MODE = "company"/);
assert.match(server, /const botCompanyConfirmation = !adminApproval && isBotPhone\(confirmerPhone\) && BOT_FINANCIAL_MODE === "company"/);
assert.match(server, /const producer = BOT_FINANCIAL_MODE === "company" \? companyUser\(\) : botEmployeeUser\(\)/);
assert.match(server, /const walletOwner = captain\.is_bot === 1 && BOT_FINANCIAL_MODE === "company" \? company : captain/);
assert.match(server, /companyWalletCharge \? "company_bot_fee" : "captain_fee"/);
assert.match(server, /INSERT OR IGNORE INTO order_settlements\(order_id,status,idempotency_key,captain_user_id,producer_user_id,charged_user_id/);
assert.match(server, /function companyWalletSummary\(\)/);
assert.match(server, /operationalBotPhone/);
assert.match(server, /app\.get\("\/api\/admin\/company-wallet"/);
assert.match(server, /app\.get\("\/api\/staff\/company-wallet"/);
assert.match(server, /companyWallet: companyWalletSummary\(\)/);
assert.match(server, /const acceptanceCaptain = pending\.captain_user_id/);
assert.match(server, /const settlementConfirmerPhone = phoneWithCountry\(acceptanceCaptain\.phone\)/);
assert.match(server, /CREATE TABLE IF NOT EXISTS order_candidate_acceptances/);
assert.match(server, /const result = settlePendingOrder\(pending\.candidate_id, pending\.acceptance_message_id, settlementConfirmerPhone\)/);
assert.match(server, /company_bot_fee/);
assert.match(server, /reaction approval blocked candidate=\$\{pending\.id\} state=\$\{result\.state\}/);

assert.match(admin, /id="companyWalletCard"/);
assert.match(admin, /\/api\/admin\/company-wallet/);
assert.match(admin, /محفظة الشركة الداخلية/);
assert.match(staff, /id="companyWalletCard"/);
assert.match(staff, /\/api\/staff\/company-wallet/);

console.log('company wallet policy, accounting math, APIs, and dashboard visibility verified');
