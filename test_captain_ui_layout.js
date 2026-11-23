const assert = require('node:assert/strict');
const fs = require('node:fs');

// حراسة «شكل وترتيب واجهة الكابتن»: تغيير عرض فقط — بلا لمس للخلفية أو المسارات أو المال.
const captain = fs.readFileSync('./public/captain.html', 'utf8');

function sectionBody() {
  const start = captain.indexOf('<section id="app" class="hidden">');
  const script = captain.indexOf('<script>');
  assert.ok(start >= 0 && script > start, 'captain app section exists before scripts');
  return captain.slice(start, script);
}

function firstIndex(haystack, needle, label) {
  const at = haystack.indexOf(needle);
  assert.ok(at >= 0, `${label} موجود`);
  return at;
}

const app = sectionBody();

// 1) الترتيب المعتمد: الرصيد ثم الطلبات الجارية ثم سجل الطلبات، وكل عمليات الحساب بعدها.
const ORDER = [
  ['<div class="head">', 'رأس المساحة'],
  ['<div id="demo-banner"', 'شريط المعاينة'],
  ['<section class="metrics" aria-label="الملخص المالي"', 'الملخص المالي'],
  ['<section id="captain-active-orders-panel"', 'الطلبات الجارية'],
  ['<div class="grid">', 'سجل الطلبات (الشبكة)'],
  ['<section class="order-format-guide captain-order-guide"', 'لوحة التعليمات'],
  ['aria-label="طلب شحن الرصيد"', 'شحن الرصيد'],
  ['aria-label="بطاقات شحن الرصيد"', 'بطاقات الشحن'],
  ['aria-label="طلب سحب المستحقات"', 'سحب المستحقات'],
  ['aria-label="أدوات V27 للكابتن"', 'أدوات V27'],
  ['aria-label="خدمة العملاء للكابتن"', 'خدمة العملاء'],
  ['aria-label="تغيير رمز الكابتن"', 'تغيير الرمز'],
  ['aria-label="معرض التصاميم القديمة"', 'معرض التصاميم'],
  ['<div class="footer"', 'التذييل'],
];
let previous = -1;
for (const [marker, label] of ORDER) {
  const at = firstIndex(app, marker, label);
  assert.ok(at > previous, `${label} بعد العنصر السابق في ترتيب واجهة الكابتن`);
  previous = at;
}

// 2) لا لوحة ضاعت: كل الأقسام الحادية عشرة ما زالت موجودة مرة واحدة على الأقل.
for (const label of ['الملخص المالي', 'الطلبات الجارية والمعلقة', 'الطلبات الجديدة للكابتن', 'طلب شحن الرصيد',
  'بطاقات شحن الرصيد', 'طلب سحب المستحقات', 'أدوات V27 للكابتن', 'خدمة العملاء للكابتن',
  'تغيير رمز الكابتن', 'معرض التصاميم القديمة']) {
  assert.ok(app.includes(`aria-label="${label}"`), `قسم ${label} لم يُحذف`);
}
assert.equal((app.match(/aria-label="تغيير رمز الكابتن"/g) || []).length, 1, 'قسم تغيير الرمز واحد');
assert.equal((app.match(/aria-label="طلب شحن الرصيد"/g) || []).length, 1, 'قسم الشحن واحد');
assert.ok((app.match(/<section/g) || []).length >= 11, 'عدد الأقسام محفوظ');

// 3) وقت الرحلَة أصبح عنصرًا بارزًا في البطاقتين، مع بقاء النص الاحتياطي «غير محدد».
assert.ok(captain.includes('<div class="row-time"><span class="trip-time-chip">وقت الرحلة: ${escapeHtml(order.trip_time || \'غير محدد\')}</span></div>'),
  'وقت الرحلة يظهر كشارة مستقلة في الطلب الجاري');
assert.ok(captain.includes('class="row-date trip-time-chip"><span class="chip-label">وقت الرحلة:</span>'),
  'وقت الرحلة يظهر كشارة في سجل الطلبات');
assert.ok(captain.includes('.trip-time-chip{'), 'تنسيق الشارة معرّف');
assert.equal((captain.match(/class="[^"]*trip-time-chip/g) || []).length, 2, 'شارة الوقت مرتان فقط (جارٍ + سجل)');
assert.ok(captain.includes("${escapeHtml(trip.trip_time || trip.updated_at || trip.created_at || 'غير محدد')}"), 'الوقت في السجل بنفس المصدر');
// لا اختراع لأوقات: النص يُعرض كما كُتب، ولا تحويل توقيت أو حساب نسبي.
assert.doesNotMatch(captain, /toLocaleTimeString|toISOString\(\)\.slice|new Date\(order\.trip_time/, 'لا تحويل أو parsing لوقت الرحلة');

// 4) حراسة سجل الطلبات المكتمل (نفس قيود test_captain_settlement_card_design، مشددة لا مرتخية).
const tripsStart = captain.indexOf("$('#trips').innerHTML =");
const ledgerStart = captain.indexOf("$('#ledger').innerHTML", tripsStart);
assert.ok(tripsStart >= 0 && ledgerStart > tripsStart, 'مُصيّر الرحلات يسبق سجل الرصيد');
const tripsRenderer = captain.slice(tripsStart, ledgerStart);
assert.match(tripsRenderer, /settlement-summary/);
assert.match(tripsRenderer, /role="status"/);
assert.match(tripsRenderer, /const orderNo = escapeHtml\(trip\.order_no\)/);
assert.match(tripsRenderer, /تمت التسوية المالية للطلب #\$\{orderNo\}/);
assert.doesNotMatch(tripsRenderer, /row-main/);
assert.doesNotMatch(tripsRenderer, /row-meta/);
assert.doesNotMatch(tripsRenderer, /خصم التنفيذ|حصة التنزيل|القيمة الخارجية/);

// 5) لوحة التعليمات مطوية افتراضيًا بنصّاتها المعتمدة دون تغيير.
assert.match(app, /<details class="guide-details" id="captain-order-format-details">/);
assert.doesNotMatch(app, /<details class="guide-details"[^>]*\sopen/, 'لوحة التعليمات مطوية افتراضيًا');
assert.match(app, /<summary class="guide-summary"><h2 id="captain-order-format-title">اكتب الطلب بهذه الصيغة<\/h2>/);
for (const text of ['السعر [القيمة]', 'لا تكتب الوقت أو نقطة الانطلاق أو الوجهة', '👍', 'اقتباس أو بدونه', 'انتظر رسالة «تم قبول الطلب وتثبيته» من النظام']) {
  assert.ok(app.includes(text), `نص التعليمات المعتمد محفوظ: ${text}`);
}
assert.match(app, /id="captain-guide-copy-btn"[^>]*>نسخ صيغة الطلب</);

// 6) مجموعة «حسابي»: ست لوحات فقط، مطوية خلف زر واحد، ولا غلاف يغيّر محددات التصاميم.
assert.equal((app.match(/captain-account-item/g) || []).length, 6, 'ست لوحات داخل حسابي');
assert.match(app, /id="captain-account-toggle" type="button" aria-expanded="false"/);
assert.doesNotMatch(app, /<details class="captain-account/, 'حسابي لا يغلّف الأقسام بوسوم جديدة');
assert.match(captain, /#app:not\(\.account-open\) \.captain-account-item\{display:none\}/);
assert.match(captain, /function setCaptainAccountOpen\(open\)/);
assert.match(captain, /appEl\.classList\.toggle\('account-open', Boolean\(open\)\)/);
// المظهر وحده: لا تحويل تصميمي يعتمد على ترتيب الأبناء في ملفات التصاميم.
assert.doesNotMatch(captain, /#app\s*>/g, 'لا واجهة تعتمد على أبناء مباشرين جدد داخل #app');
const designs = fs.readFileSync('./public/captain-designs.css', 'utf8');
assert.match(designs, /body\[data-captain-design="compact"\] #app>\.panel/);
for (const id of ['classic', 'taj', 'red-white', 'rahlati', 'compact']) {
  assert.ok(designs.includes(`[data-captain-design="${id}"]`), `تصميم ${id} ما زال معروفًا`);
}

// 7) صفر تغيير تعاقدي: قائمة المسارات نفسها حرفيًا (14 مسارًا).
const EXPECTED = [
  '/api/captain/change-pin', '/api/captain/invites/', '/api/captain/login', '/api/captain/login-link/exchange',
  '/api/captain/logout', '/api/captain/overview', '/api/captain/pin-recovery/request-code',
  '/api/captain/pin-recovery/reset', '/api/captain/redeem-card', '/api/captain/register',
  '/api/captain/topup-request', '/api/captain/ui-design', '/api/captain/withdrawal-requests', '/api/support/tickets',
];
const found = [...new Set((captain.match(/\/api\/[a-z0-9\/_-]+/gi) || []).map((p) => p.replace(/\/$/, '')))].sort();
assert.deepEqual(found.map((p) => p.replace(/^\/api\/captain\/invites$/, '/api/captain/invites/')).sort(), EXPECTED.slice().sort(),
  'لا مسار API جديد أو محذوف في واجهة الكابتن');
assert.doesNotMatch(captain, /\/api\/admin\//, 'لا استدعاء أي مسار إدارة من بوابة الكابتن');
assert.doesNotMatch(captain, /wallet-adjust|commission-withdrawal|\/api\/staff\//, 'لا مسار مالي إداري في بوابة الكابتن');

// 8) المصادقة كما هي: 5 أرقام، نفس عقد الإرسال، وتحقّق قبلي أوضح للمالك.
assert.match(captain, /id="captain-change-pin-form"/);
assert.match(captain, /pattern="\[0-9\]\{5\}"/);
assert.match(captain, /body:JSON\.stringify\(\{currentPin,newPin,confirmPin\}\)/);
assert.ok(captain.includes("if(newPin==='00000'){status.textContent='لا يمكن استخدام رمز 00000.';return;}"), 'رفض 00000 محفوظ');
assert.ok(captain.includes("if(/^(01234|12345|23456|34567|45678|56789|98765|43210)$/.test(newPin))"), 'رفض الرموز التسلسلية مضاف');
assert.ok(captain.includes('if(/^(\\d)\\1{4}$/.test(newPin))'), 'رفض الرمز المكرر مضاف');
assert.match(captain, /الرمز تسلسلي سهل التخمين/);
assert.match(captain, /لا تستخدم رقمًا مكررًا خمس مرات/);
assert.match(captain, /api\('\/api\/captain\/pin-recovery\/request-code'/, 'استعادة الرمز لم تُمس');

// 9) إخفاء الأرقام المالية المقصود باقٍ كما أمر المالك.
assert.match(app, /class="metric net" hidden aria-hidden="true"/);
assert.match(app, /class="metric fees" hidden aria-hidden="true"/);
assert.match(app, /<section class="panel" hidden aria-hidden="true">[\s\S]{0,220}aria-label="حركات الرصيد"|<section class="panel" hidden aria-hidden="true">[\s\S]{0,220}id="ledger"/);
assert.match(captain, /posted-share/);
assert.match(captain, /executedDebit/);
assert.doesNotMatch(app, /class="metric (net|fees)"(?! hidden)/, 'لا كشف غير مقصود لبطاقات مالية مخفية');

// 10) لا وسوم خطر مضافة.
assert.doesNotMatch(captain, /document\.write|eval\(|new Function\(/);
assert.doesNotMatch(captain, /<script[^>]+src=/, 'لا مصدر سكريبت خارجي جديد');
assert.ok(captain.includes('serviceWorker.register(\'/captain-sw.js\''), 'تسجيل serviceWorker باقٍ');

console.log('captain UI layout and trip-time guardrails verified');
assert.match(app, /<details class="guide-details" id="captain-order-format-details">/);
