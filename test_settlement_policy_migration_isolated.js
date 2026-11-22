const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Slice the settlement settings bootstrap out of server.js and run it against an in-memory
// settings store. The server is never required, so no DB, Redis or Puppeteer is started.
const source = fs.readFileSync('./server.js', 'utf8');
const start = source.indexOf('  const settlementDefaults = [');
const end = source.indexOf('  for (const definition of Object.values(OWNER_NOTIFICATION_DEFINITIONS))');
assert.ok(start > 0 && end > start, 'settlement settings bootstrap located');
const block = source.slice(start, end);

const constants = {
  COMPANY_RATE_BPS: 300,
  PRODUCER_RATE_BPS: 1300,
  SPECIAL_ORDER_RATE_BPS: 1700,
  SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS: 300,
  COMPANY_FROM_PRODUCER_RATE_BPS: 300,
  APPROVED_SETTLEMENT_POLICY_VERSION: '13_3_normal_17_3_order_v3',
  OWNER_CUSTOM_SETTLEMENT_POLICY_VERSION: 'owner_custom_after_v3',
};

function runSeed(initialSettings) {
  const store = new Map(Object.entries(initialSettings || {}));
  const getSetting = (key) => (store.has(key) ? store.get(key) : null);
  const setSetting = (key, value) => { store.set(key, String(value)); };
  vm.runInNewContext(block, { ...constants, getSetting, setSetting }, { timeout: 5000 });
  return Object.fromEntries(store.entries());
}

const APPROVED = {
  producer_rate_bps: '1300',
  company_rate_bps: '300',
  company_from_producer_rate_bps: '300',
  special_order_rate_bps: '1700',
  special_order_company_from_producer_rate_bps: '300',
  order_producer_rate_bps: '1700',
  order_company_rate_bps: '300',
  settlement_policy_version: '13_3_normal_17_3_order_v3',
};

// 1) Fresh install: defaults land on the approved split in one boot.
assert.deepEqual(runSeed({}), APPROVED, 'fresh settings store carries the approved split');

// 2) The old two-field owner edit (13% + 3.29% on every kind) is upgraded exactly once.
assert.deepEqual(runSeed({
  producer_rate_bps: '1300', company_rate_bps: '329',
  special_order_rate_bps: '1300', special_order_company_from_producer_rate_bps: '329',
  order_producer_rate_bps: '1300', order_company_rate_bps: '329',
  settlement_policy_version: 'owner_custom',
}), APPROVED, 'legacy owner_custom settings are upgraded to the approved split');

// 3) Prior approved version tags migrate forward.
assert.deepEqual(runSeed({ settlement_policy_version: '12_4_all_order_kinds_v1' }), APPROVED, '12%/4% era settings reach the approved split');
assert.deepEqual(runSeed({ settlement_policy_version: '12_3_all_order_kinds_v2' }), APPROVED, '12%/3% era settings reach the approved split');

// 4) An owner edit saved through the new route is never overwritten by a restart.
const edited = runSeed({
  producer_rate_bps: '1400', company_rate_bps: '250',
  order_producer_rate_bps: '1800', order_company_rate_bps: '250',
  settlement_policy_version: 'owner_custom_after_v3',
});
assert.equal(edited.producer_rate_bps, '1400', 'owner normal downloader rate survives a restart');
assert.equal(edited.company_rate_bps, '250', 'owner company rate survives a restart');
assert.equal(edited.order_producer_rate_bps, '1800', 'owner order downloader rate survives a restart');
assert.equal(edited.settlement_policy_version, 'owner_custom_after_v3', 'owner edit tag is preserved');

// 5) The approved numbers really are 16% normal and 20% order.
assert.equal(Number(APPROVED.producer_rate_bps) + Number(APPROVED.company_rate_bps), 1600, 'normal total is 16%');
assert.equal(Number(APPROVED.order_producer_rate_bps) + Number(APPROVED.order_company_rate_bps), 2000, 'order total is 20%');
assert.equal(APPROVED.company_rate_bps, APPROVED.order_company_rate_bps, 'the company share is identical for both kinds');

console.log('settlement policy migration verified: approved split applied once, owner edits preserved');
