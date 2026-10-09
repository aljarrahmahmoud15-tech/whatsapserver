const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const start = server.indexOf('async function inspectConfirmedRecoveryMessage');
const end = server.indexOf('async function handleMessageReaction', start);
assert.ok(start >= 0 && end > start, 'مسار فحص التثبيت موجود');
const flow = server.slice(start, end);

assert.match(flow, /isValidJordanPhone\(producerPhone\)/, 'يتحقق من رقم صاحب السعر');
assert.match(flow, /isValidJordanPhone\(captainPhone\)/, 'يتحقق من رقم المنفذ');
assert.match(flow, /recoveryPhoneMatches\(producer\.phone, producerPhone\)/, 'يطابق صاحب السعر بالهاتف');
assert.match(flow, /recoveryPhoneMatches\(captain\.phone, captainPhone\)/, 'يطابق المنفذ بالهاتف');
assert.match(flow, /const producerIdentityResolved = botProducer/, 'يعالج حساب الشركة عند كون رسالة السعر من البوت');
assert.match(flow, /recoveryPhoneMatches\(producerPhone, botPhone\)/, 'يثبت هوية رسالة البوت عبر رقم الاتصال التشغيلي');
assert.match(flow, /const match = Boolean\(phoneIdentityResolved && authorizedThumb\)/, 'التثبيت يتطلب هوية هاتفية وتفاعلًا مصرحًا');
assert.doesNotMatch(flow, /producer\.name\s*===|captain\.name\s*===|producerName.*captainName/, 'لا يعتمد على الاسم للمطابقة');

console.log('phone-only order settlement identity guard verified');
