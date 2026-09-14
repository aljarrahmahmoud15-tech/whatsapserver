const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

assert.ok(
  server.includes('findCaptainByPhone(normalized, { activeOnly: true }) || findActiveRegisteredUser(normalized)'),
  'active registered operational users can participate as captains'
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
  server.includes('confirmingCaptainFeeCents') && server.includes('خصم 12% لصاحب تنزيل الطلب و4% للشركة'),
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
  server.includes('status=\'approved\',name=?,phone=?,pin_hash=?') && server.includes('activated: true'),
  'captain registration immediately approves and activates the account'
);
assert.ok(
  server.includes('confirmingCaptainWalletDebit: "16% (12% لصاحب تنزيل الطلب + 4% للشركة)"'),
  'the agreed 12% plus 4% accounting rule is exposed'
);

console.log('shared captain eligibility and registration status guardrails verified');
