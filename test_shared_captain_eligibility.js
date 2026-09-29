const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

assert.ok(
  server.includes('findCaptainByPhone(normalized, { activeOnly: true }) || findActiveRegisteredUser(normalized)'),
  'active registered operational users can participate as captains'
);
assert.ok(
  server.includes("UPDATE users SET role='captain'") && server.includes('if (role !== "captain")'),
  'all human users are migrated and maintained as captains'
);
assert.ok(
  server.includes('captain.auto_registered_from_approved_group') && server.includes("INSERT INTO users(phone,name,role,wallet_cents,active,is_bot"),
  'valid approved-group senders are auto-registered as active captains'
);
assert.ok(
  server.includes('captain.active !== 1 || captain.account_status !== "active"'),
  'inactive or suspended users remain blocked from claiming orders'
);
assert.ok(
  server.includes('findActiveRegisteredUser(confirmerPhone)') && server.includes('confirmer.is_bot === 1'),
  'all active registered users can confirm while bot and company identities remain blocked'
);
assert.ok(
  server.includes('confirmingCaptainFeeCents') && server.includes('خصم 12% لصاحب تنزيل الطلب و3% للشركة'),
  'confirming captain pays the downloader share plus company share'
);
assert.ok(
  server.includes('تسجيلك قيد مراجعة الشركة؛ لا يمكن الدخول قبل اعتماد الكابتن'),
  'pending captain registrations receive a clear status message'
);
assert.ok(
  server.includes('أكمل تسجيل الكابتن لأول مرة من رابط التسجيل قبل محاولة الدخول'),
  'unsubmitted captain registrations receive a clear next step'
);
assert.ok(
  server.includes('captain.join.requested') && server.includes('accountCreated: false') && server.includes('status: "pending"'),
  'captain registration creates a pending request without activating the account'
);
assert.ok(
  server.includes('app.post("/api/admin/captain-invites/:id/decision", requireAdmin') && server.includes('captain.join.approved'),
  'owner approval is required to create and activate the captain account'
);
assert.ok(
  server.includes('confirmingCaptainWalletRate: "-15% (12% downloader + 3% company)"'),
  'the agreed 12% plus 3% accounting rule is exposed'
);
assert.ok(
  server.includes('posted_share_cents') &&
  server.includes('executed_debit_cents') &&
  server.includes('executedDebit: money(executedDebitCents)'),
  'captain-facing fee summaries include the full 15% debit'
);
assert.ok(
  server.includes('const PRODUCER_RATE_BPS = 1200;') &&
  server.includes('const SPECIAL_ORDER_RATE_BPS = 1200;') &&
  server.includes('const COMPANY_FROM_PRODUCER_RATE_BPS = 300;'),
  'the approved 12% downloader and 3% company rates are immutable policy constants'
);
assert.ok(
  server.includes('setSetting("producer_rate_bps", PRODUCER_RATE_BPS);') &&
  server.includes('setSetting("company_from_producer_rate_bps", COMPANY_FROM_PRODUCER_RATE_BPS);'),
  'legacy stored settlement settings are normalized during startup'
);
assert.doesNotMatch(
  server,
  /regularProducerRateBps:\s*Number\(getSetting\("producer_rate_bps"/,
  'settlement cannot reuse stale producer-rate settings'
);
assert.doesNotMatch(
  server,
  /companyFromProducerRateBps:\s*Number\(getSetting\("company_from_producer_rate_bps"/,
  'settlement cannot reuse stale company-rate settings'
);

console.log('shared captain eligibility and registration status guardrails verified');
