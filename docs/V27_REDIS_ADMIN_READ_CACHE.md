# V27 — Valkey/Redis لبقية مسارات لوحة الإدارة

## الحالة

تم توسيع طبقة Valkey الموجودة في Render من `bootstrap` وملخص القروب إلى مسارات القراءة الإدارية القابلة لإعادة البناء. الاتصال يبقى اختياريًا؛ عند غياب `REDIS_URL` أو تعطل Valkey يستمر الخادم باستخدام كاش الذاكرة دون إسقاط WhatsApp أو تعطيل اللوحة.

## طريقة العمل

كل مسار مفعّل يمر عبر `v27AdminReadCache(kind, ttlMs)`. تتم المصادقة أولًا، ثم تُفحص ذاكرة العملية، وبعدها Redis عند الحاجة. عند عدم وجود قيمة، ينفّذ المسار مصدره الحالي مرة واحدة، ثم تُحفظ الاستجابة في الذاكرة وValkey مع TTL قصير. مفاتيح Redis تحتوي namespace وإصدارًا ونسخة generation، ولا يدخل فيها token أو password أو cookie.

عند نجاح أي طلب mutation داخل `/api`، يُزاد generation وتُفرغ ذاكرة العملية. وبذلك لا تُستخدم قيم الجيل السابق بعد تعديل موظف أو كابتن أو طلب أو محفظة أو إعداد. التحديثات التي تعمل في الخلفية لا تُخزّن نتائج التنفيذ نفسها؛ مسارات الحالة المباشرة تبقى للمتابعة الحية.

## المسارات والتخزين

| الفئة | أمثلة | TTL المبدئي |
|---|---|---:|
| حالة البوت والنظام | `bot/status`, `system/health`, `send-diagnostics` | 1 ثانية |
| القوائم التشغيلية | `captains`, `orders`, `open`, `unconfirmed-bookings`, `support-tickets` | 1–3 ثوانٍ |
| المالية للقراءة | `company-wallet`, `wallets`, `settlements`, `subscriptions`, `daily-charges` | 1–2 ثانية |
| الهوية والتفاصيل | `group/permissions`, `group/members`, `captain/:id/profile` | 1–3 ثوانٍ |
| الإدارة والإعدادات | `staff`, `users`, `leads`, `settings` | 2–5 ثوانٍ |

تُترك `/health` خارج Redis كليًا. كما تبقى خارج كاش القراءة الموزع مسارات القرار والتدقيق والتشغيل الحي، ومنها `owner-control`, `send-status`, وفحوصات المجموعة التي قد تقرأ WhatsApp مباشرة. لا تُخزّن الجلسة، ملفات `.wwebjs_auth` أو `.baileys_auth`، QR، SQLite، دفتر المحافظ المرجعي، مفاتيح idempotency، أو نتائج تنفيذ مالية.

وتبقى أيضًا الاستجابات التي تحمل أسرارًا أو رموز وصول خارج Redis حتى لو كانت للمالك فقط: روابط دعوة الكباتن، `inviteCode` ورابط القروب، قائمة بطاقات الشحن، ودفتر حركة محفظة كابتن. هذه المسارات تُقرأ مباشرة مع `no-store` وفق عقدها الحالي.

## التحقق والنشر

تمت إضافة اختبار رجعي يثبت حدود الذاكرة، fallback، generation invalidation، وربط المسارات الأساسية. يجب تشغيل `node --check server.js` و`git diff --check` و`npm test` قبل الدمج. بعد النشر تُراجع رؤوس `X-V27-Read-Cache` و`X-V27-Bootstrap-Cache` و`X-Group-Summary-Cache`، وتُراجع سجلات Render بحثًا عن `[Redis] cache ready` أو رسائل fallback دون كشف قيمة `REDIS_URL`.
