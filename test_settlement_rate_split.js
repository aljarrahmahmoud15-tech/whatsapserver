const assert = require('node:assert/strict');
const fs = require('node:fs');
const { calculateSettlement } = require('./finance');

const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');

// 1) Behaviour: the approved split really differs by order kind.
const normal15 = calculateSettlement({ priceCents: 1500, orderKind: 'normal' });
const order15 = calculateSettlement({ priceCents: 1500, orderKind: 'order' });
assert.equal(normal15.producerFeeCents + normal15.companyCents, 240, 'normal 15 JOD debits 2.40 JOD (16%)');
assert.equal(order15.producerFeeCents + order15.companyCents, 300, 'order 15 JOD debits 3.00 JOD (20%)');
assert.notEqual(normal15.confirmingCaptainFeeCents, order15.confirmingCaptainFeeCents, 'the two kinds must not settle identically');
assert.equal(order15.producerFeeCents, 255, 'order 15 JOD: 17% to the downloader captain');
assert.equal(order15.companyCents, 45, 'order 15 JOD: 3% to the company');
assert.equal(order15.executorWalletCreditCents, 0, 'the external fare never credits the executor');

// 2) The owner route can store order rates separately from normal rates.
assert.ok(server.includes('const orderProducerPercent = optionalPercent(req.body?.orderProducerRatePercent, producerPercent);'), 'route reads an order downloader percent');
assert.ok(server.includes('const orderCompanyPercent = optionalPercent(req.body?.orderCompanyRatePercent, companyPercent);'), 'route reads an order company percent');
assert.ok(server.includes('setSetting("order_producer_rate_bps", next.orderProducerRateBps);'), 'order downloader rate is stored separately');
assert.ok(server.includes('setSetting("order_company_rate_bps", next.orderCompanyRateBps);'), 'order company rate is stored separately');
assert.ok(!server.includes('setSetting("order_producer_rate_bps", next.producerRateBps);'), 'order rate must not reuse the normal rate');
assert.ok(!server.includes('setSetting("order_company_rate_bps", next.companyRateBps);'), 'order company rate must not reuse the normal company rate');
assert.ok(server.includes('setSetting("settlement_policy_version", OWNER_CUSTOM_SETTLEMENT_POLICY_VERSION);'), 'owner edits are tagged so a restart cannot overwrite them');

// 3) Confirmation text and dashboard text are derived from the saved policy, not written by hand.
assert.ok(server.includes('const saved = settlementPolicyResponse();'), 'the PATCH response reads the saved policy');
assert.ok(server.includes('تم حفظ نسب التسوية: طلب عادي ${saved.producerRatePercent}%'), 'confirmation message is derived');
assert.ok(!server.includes('تم حفظ نسب التسوية 12%'), 'the stale 12% confirmation message is gone');
assert.ok(server.includes('policy: runtimeSettlementPolicyDisplay(),'), 'dashboard policy block is derived');
assert.ok(!/producerWalletRate:\s*"\d/.test(server), 'no hard-coded producer rate literal remains');

// 4) The approved split is applied once at boot and survives later owner edits.
assert.ok(server.includes('const APPROVED_SETTLEMENT_POLICY_VERSION = "13_3_normal_17_3_order_v3";'), 'approved policy version tag exists');
assert.ok(server.includes('const OWNER_CUSTOM_SETTLEMENT_POLICY_VERSION = "owner_custom_after_v3";'), 'owner edit tag is distinct from the approved tag');
assert.ok(server.includes('if (splitPolicyVersion !== APPROVED_SETTLEMENT_POLICY_VERSION && splitPolicyVersion !== OWNER_CUSTOM_SETTLEMENT_POLICY_VERSION) {'), 'boot migration is guarded by both tags');
assert.ok(server.includes('["order_producer_rate_bps", SPECIAL_ORDER_RATE_BPS]'), 'migration seeds the order downloader rate from the order constant');
assert.ok(server.includes('["order_company_rate_bps", SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS]'), 'migration seeds the order company rate from the order constant');

// 5) The owner panel exposes and sends all four rates.
assert.ok(admin.includes('id="settlementOrderProducerRate"'), 'panel has an order downloader field');
assert.ok(admin.includes('id="settlementOrderCompanyRate"'), 'panel has an order company field');
assert.ok(admin.includes('orderProducerRatePercent:orderProducer'), 'panel sends the order downloader rate');
assert.ok(admin.includes('orderCompanyRatePercent:orderCompany'), 'panel sends the order company rate');
assert.ok(admin.includes("orderProducer.value=settlementPolicyState?.specialOrderProducerRatePercent??''"), 'panel loads the saved order rate');
assert.ok(!admin.includes('specialOrderProducerRatePercent??15'), 'stale 15% panel fallback is gone');
assert.ok(!admin.includes('12% للكابتن الأول'), 'stale 12% panel wording is gone');

// 6) The group acceptance card states the rate of the kind it belongs to.
assert.ok(server.includes('function orderKindSettlementLabel(orderKind) {'), 'per-kind fee label helper exists');
assert.ok(server.includes('`${isOrderKind ? "أوردر محدد" : "طلب عادي"} · خصم ${ratePercentFromBps(safeProducer + safeCompany)}%'), 'label states the kind total from the saved rates');
assert.doesNotMatch(server, /نوع الطلب: \$\{order\.order_kind === "order" \? "أوردر محدد · خصم/, 'the old static fee sentence is gone from the card');

console.log('settlement rate split guard verified: normal 16% and order 20% are stored and shown independently');
