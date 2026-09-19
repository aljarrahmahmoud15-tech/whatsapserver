const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('./admin.html', 'utf8');
assert.match(admin, /id="whatsappAlert"/, 'يوجد شريط تنبيه انقطاع WhatsApp');
assert.match(admin, /role="alert"/, 'التنبيه معلن لقارئات الشاشة');
assert.match(admin, /aria-live="assertive"/, 'التنبيه فوري لقارئات الشاشة');
assert.match(admin, /api\('\/api\/admin\/bot\/status'\)/, 'المراقب يقرأ حالة WhatsApp المحمية');
assert.match(admin, /setInterval\(\(\)=>void pollWhatsAppAlert\(\),15000\)/, 'المراقبة الدورية كل 15 ثانية');
assert.match(admin, /lastDisconnectAt/, 'التنبيه يعرض وقت آخر انقطاع');
assert.match(admin, /new Notification\('وصلني الآن — انقطاع WhatsApp'/, 'يدعم إشعار المتصفح عند السماح به');
assert.match(admin, /eventKey!==waAlertKey/, 'يمنع تكرار إشعار نفس الحدث');
assert.match(admin, /startWhatsAppAlertMonitor\(\)/, 'تبدأ المراقبة بعد فتح لوحة الإدارة');
console.log('WhatsApp disconnect alert UI guardrails verified');
