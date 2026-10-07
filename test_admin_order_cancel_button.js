const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

assert.match(admin, /function cancelAndReverseOrder\(orderId,orderNo,button\)/);
assert.match(admin, /cancel-and-reverse/);
assert.match(admin, /V26_CANCEL_ORDER/);
assert.match(admin, /X-Idempotency-Key/);
assert.match(admin, /window\.confirm\(`سيتم إلغاء الطلب/);
assert.match(admin, /window\.prompt\('للتأكيد اكتب النص التالي حرفيًا: V26_CANCEL_ORDER'/);
assert.match(admin, /o\.settlementStatus==='applied'&&\['accepted','completed'\]\.includes\(o\.status\)/);
assert.match(admin, /إلغاء وعكس التسوية/);
assert.match(admin, /await Promise\.all\(\[loadOrders\(\),loadSettlements\(\),loadCompanyWallet\(\)\]\)/);
console.log('owner order cancellation and settlement reversal button guardrails verified');
