const assert = require("node:assert/strict");
const fs = require("node:fs");
const server = fs.readFileSync("server.js", "utf8");
const admin = fs.readFileSync("admin.html", "utf8");
const v26 = fs.readFileSync("public/admin-v26.html", "utf8");

assert.match(server, /api\/admin\/settings/);
assert.match(server, /api\/admin\/settings\/settlement/);
assert.match(server, /requireOwnerAdmin/);
assert.match(server, /if \(getSetting\(key\) === null\) setSetting\(key, value\)/);
assert.match(server, /producerRateBps: policy\.producerRateBps/);
assert.match(server, /companyRateBps: policy\.companyRateBps/);
assert.match(admin, /id="ownerSettingsCard"/);
assert.match(admin, /saveSettlementPolicy/);
assert.match(v26, /data-admin-action="settings"/);
assert.match(v26, /openOwnerSettings/);

// Equal-or-stricter additions for the owner-approved split policy.
assert.match(server, /app\.patch\("\/api\/admin\/settings\/settlement", requireOwnerAdmin/);
assert.match(server, /specialOrderProducerRateBps: policy\.specialOrderProducerRateBps/);
assert.match(server, /specialOrderCompanyFromProducerRateBps: policy\.specialOrderCompanyFromProducerRateBps/);
assert.match(server, /order_producer_rate_bps", next\.orderProducerRateBps/);
assert.match(server, /order_company_rate_bps", next\.orderCompanyRateBps/);
assert.match(server, /admin\.settlement_policy\.changed/);
assert.match(server, /specialOrderProducerRateBps: before\.specialOrderProducerRateBps/);
assert.match(server, /specialOrderCompanyRateBps: next\.orderCompanyRateBps/);
assert.match(admin, /id="settlementOrderProducerRate"/);
assert.match(admin, /id="settlementOrderCompanyRate"/);
assert.match(admin, /orderProducerRatePercent:orderProducer/);
assert.doesNotMatch(server, /setSetting\("order_producer_rate_bps", next\.producerRateBps\)/);

console.log("owner settlement settings guard passed");
