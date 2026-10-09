const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('./admin.html', 'utf8');
assert.match(admin, /id="groupMessageTestCard"/, 'بطاقة اختبار القروب موجودة');
assert.match(admin, /id="groupTestMessage"[^>]*maxlength="1000"/, 'حقل الرسالة محدود بألف حرف');
assert.match(admin, /id="groupTestConfirm"[^>]*type="checkbox"/, 'يوجد تأكيد صريح للإرسال الاختباري');
assert.match(admin, /refreshConfiguredGroupId\(\)/, 'الوجهة تُقرأ من حالة القروب المعتمد');
assert.match(admin, /to:window\.currentConfiguredGroupId\|\|''/, 'الإرسال لا يقبل وجهة ثابتة من الواجهة');
assert.match(admin, /X-Idempotency-Key/, 'الإرسال يستخدم مفتاح منع التكرار');
assert.match(admin, /testOnly:true/, 'الطلب موسوم كاختبار فقط');
assert.match(admin, /السعر\\s\*\[0-9٠-٩\]\+/, 'يمنع صيغة السعر الرقمية');
assert.match(admin, /\^تم\$/, 'يمنع رسالة تم');
assert.match(admin, /👍/, 'يمنع تفاعل الإعجاب كنص');
assert.match(admin, /button\.disabled=!check\.valid/, 'الزر معطل حتى اجتياز التحقق');
assert.match(admin, /const successText=response\.messageId\?/);
assert.match(admin, /result\.className='notice ok';result\.textContent=successText/);
assert.match(admin, /if\(!result\.classList\.contains\('ok'\)\)validateGroupTestMessage\(\)/);
console.log('group message test UI guardrails verified');
