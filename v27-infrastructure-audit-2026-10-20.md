# تدقيق بنية مشروع V27 — 2026-10-20

## القرار التنفيذي

**الهدف المعتمد:** تشغيل V27 الإنتاجي من مستودع واحد واضح وخدمة Render واحدة واضحة، مع إبقاء خدمات WhatsApp الشقيقة معزولة وعدم نقل جلسة WhatsApp أو قاعدة البيانات بين الخدمات.

**التوصية:** الإبقاء دون نقل على:

- GitHub: `aljarrahmahmoud15-tech/whatsapserver`، فرع `main`.
- Render: `whatsapserver-2` المرتبط بالنطاق `https://bot.wasselni-biz.com`.

هذا هو الزوج الأنسب حاليًا لأنه الوحيد الذي يجمع نسخة الراكب المعتمدة، V27، دورة الرحلة المباشرة، إشعارات الرحلة، تطبيق الكابتن، اختبارات الحماية، واتصال WhatsApp جاهزًا على النطاق الفعلي.

## الأدلة الحالية

- آخر commit قبل هذه الجولة: `78e599a` — توحيد هوية V27 — بتاريخ 2026-10-20.
- المستودع الحالي يحتوي 276 ملفًا متعقبًا و175 ملف اختبار، ويحتوي وحدات `direct-ride` وواجهات `admin-v27`.
- فحص الخدمة العامة:
  - `https://bot.wasselni-biz.com/health` يعيد HTTP 200 و`ready=true` وWhatsApp في حالة جاهز.
  - `/status` يعمل ويؤكد أن الخدمة مربوطة بقروبها وبيئتها الحالية، دون نقل أو تغيير أي هوية.
- خدمة Render الحالية مرتبطة بالمستودع `whatsapserver` والفرع `main`، وبها النطاق `bot.wasselni-biz.com`.
- الخدمة الحالية تستخدم Docker مع قرص دائم مركّب على `/app/data` بحجم 10 GB، وملف `render.yaml` أصبح يطابق ذلك مع فحص `/health`.
- تم تفعيل `Auto-Deploy: On Commit` في Render لخدمة `whatsapserver-2`.
- فحص الصحة لم ينفذ أي طلب كتابة أو تسوية أو إرسال WhatsApp.

## مقارنة المرشحين في GitHub

| المستودع | الحالة | الأدلة | القرار |
|---|---|---|---|
| [whatsapserver](https://github.com/aljarrahmahmoud15-tech/whatsapserver) | نشط جدًا، آخر تحديث 2026-10-20 | 276 ملفًا، 175 اختبارًا، direct ride، إشعارات، V27، واجهة الراكب المعتمدة | **المصدر الإنتاجي المعتمد** |
| [nexora-v27-platform](https://github.com/aljarrahmahmoud15-tech/nexora-v27-platform) | خاص، آخر تحديث 2026-10-17 | 251 ملفًا و167 اختبارًا، قريب من قاعدة V27، لكنه لا يحتوي دورة direct ride الحالية | احتياطي/مرجع تاريخي، لا ينقل إليه الآن |
| [nexora-v27](https://github.com/aljarrahmahmoud15-tech/nexora-v27) | خاص، آخر تحديث 2026-10-17 | فرع/نسخة تشغيلية أقدم، بلا direct ride الحالي | لا ينقل إليه |
| [nexora-core](https://github.com/aljarrahmahmoud15-tech/nexora-core) | نشط، آخر تحديث 2026-10-12 | Core/Modules وقاعدة منفصلة، وليس نسخة WhatsApp الإنتاجية الحالية | مسار تطوير مستقبلي، ليس بديلًا فوريًا |
| [nexora-ride](https://github.com/aljarrahmahmoud15-tech/nexora-ride) | خاص، آخر تحديث 2026-10-14 | هيكل صغير جدًا، بلا اختبارات أو إعداد Render مكتمل | غير مناسب |
| [waslni-owner-control](https://github.com/aljarrahmahmoud15-tech/waslni-owner-control) | خاص، آخر تحديث 2026-10-09 | تطبيق Owner Control مستقل بواجهة TypeScript/React، وليس بوت WhatsApp الحالي | مكمل محتمل، لا ينقل المشروع إليه |
| [wasselni-owner-dashboard](https://github.com/aljarrahmahmoud15-tech/wasselni-owner-dashboard) | خاص، آخر تحديث 2026-10-08 | لوحة/تطبيق منفصل، دون تعريف Render مباشر | لا ينقل إليه |
| [wasselni-ops](https://github.com/aljarrahmahmoud15-tech/wasselni-ops) | أقدم، آخر تحديث 2026-09-30 | لوحة PostgreSQL بسيطة على الخطة المجانية، بلا جلسة WhatsApp | غير مناسب للإنتاج الحالي |
| [aljarah-operations](https://github.com/aljarrahmahmoud15-tech/aljarah-operations) | أقدم، آخر تحديث 2026-09-17 | نسخة عمليات مستقلة، لها هوية وتشغيل منفصلان | تبقى معزولة |
| [whatsapp-server-group-only](https://github.com/aljarrahmahmoud15-tech/whatsapp-server-group-only) | خاص، آخر تحديث 2026-09-19 | نسخة WhatsApp أقدم، بلا ميزات V27 الحالية | تبقى مرجعًا/احتياطيًا |
| [whatsapp-server](https://github.com/aljarrahmahmoud15-tech/whatsapp-server) | عام، آخر تحديث 2026-10-16 | خدمة WhatsApp عامة TypeScript/Deno، مختلفة عن عقد V27 | غير مناسب للنقل |
| [makdevs-server](https://github.com/aljarrahmahmoud15-tech/makdevs-server) | أقدم | خادم سابق، وليس مصدر V27 المنشور | لا يستخدم |
| `whatsapserver-meta` و`-meta-bot-2026-` | قديمة/موازية | خدمات Meta أو بوت منفصل، وليست نطاق V27 الحالي | تبقى منفصلة |
| `wasselni-whatsapp-reader` | قديم | قارئ رسائل منفصل | لا يستخدم كمصدر إنتاج |
| `travelhub-booking-system` | قديم | بداية نظام حجوزات عام | لا يستخدم كمصدر V27 |
| `features-copilot-plans` و`nexora-terminal` | أدوات/خطط | ليست خدمة V27 الإنتاجية | لا نقل |

## جرد Render

لوحة Render تعرض 21 خدمة: 18 غير موقوفة يدويًا و3 موقوفة يدويًا.

### المجموعة الحالية أو القريبة من V27

- `whatsapserver-2`: Deployed، Docker، Oregon، آخر تحديث حديث، مرتبط بـ `whatsapserver/main` والنطاق الفعلي. **الهدف الإنتاجي.**
- `whatsapserver-clean`: Deployed، Docker، Oregon، مرتبط بفرع `clean-instance` ونطاق مستقل. فحصه الصحي ناجح، لكنه يحمل هوية WhatsApp وقروبًا مختلفين؛ **يمنع دمجه مع الإنتاج**.
- `whatsapserver-2-tmbg`: خدمة موازية على Node، ليست النطاق الفعلي المعتمد.
- `whatsapserver-2-cache`: Valkey، مورد مساعد وليس خادم تطبيق.
- `v27-taj`: فرع `taj` من `nexora-v27-platform`؛ الصفحة تعمل لكن فحص الصحة يظهر WhatsApp provisioning وغير جاهز والقروب غير مهيأ.
- `v27-azwa`: فرع `azwa` من `nexora-v27-platform`؛ نفس مشكلة عدم الجاهزية التشغيلية.
- `v27-sheikh` و`v27-waselni-now` و`v27-north`: موقوفة يدويًا؛ لا تصلح هدفًا حاليًا.

### الخدمات الأخرى

- `whatsapserver-meta` و`-meta-bot-2026-`: بوتات/خدمات Meta موازية.
- `alshaikh-delivery` و`taj-delivery-tmbg` و`aljarah-operations`: عمليات أو فروع منفصلة بهويات مستقلة.
- `nexora-core`: خدمة Node مستقلة، وفحص `/health` ناجح، لكنها ليست بوت WhatsApp الحالي.
- `nexora-db`: PostgreSQL 16، قاعدة منفصلة.
- `nexora-terminal-control`: خدمة Node للتحكم الطرفي.
- `waslni-owner-control`: تطبيق Owner Control مستقل.
- `whatsappserver-new-1`: نسخة Docker موازية في Frankfurt.
- `wasselni-ops`: لوحة Node في Frankfurt.
- `wasselni-ops-db`: PostgreSQL 18 مرتبط بلوحة العمليات.

## ملاحظات مخاطر مهمة

1. لا يوجد سبب تقني أو تشغيلي للنقل الآن؛ النقل قد يفقد جلسة WhatsApp أو يخلط هوية القروب بين sibling services.
2. تم إغلاق اختلاف إعداد النشر: `render.yaml` يعرّف Dockerfile وقرص `/app/data` بحجم 10 GB، وهو مطابق للإعداد الفعلي في Render.
3. تم تنظيف الاختبارات القديمة التي خلطت بين الهوية المرئية V27 ومرمز الإلغاء الداخلي V26؛ النتيجة النهائية `204/204`.
4. لم يتم نقل أي مشروع أو حذف أي خدمة أو خلط أي جلسة WhatsApp؛ التغيير الخارجي الوحيد هو تفعيل Auto-Deploy للخدمة الإنتاجية الحالية.

## الهدف النهائي المقترح

اعتبار `whatsapserver/main` + `whatsapserver-2` **Single Source of Truth لـV27**، ويشمل:

- واجهة الراكب المعتمدة.
- تطبيق الكابتن.
- مركز الإدارة V27.
- دورة الرحلة المباشرة وإشعاراتها.
- WhatsApp والبيانات الدائمة.
- اختبارات التشغيل والحماية.

تبقى `whatsapserver-clean` بيئة استعادة/اختبار منفصلة، وتبقى فروع `nexora-v27-platform` مختبرات أو فروعًا مستقبلية إلى أن تثبت parity كاملة.

## خطة التنفيذ المختصرة

1. **اعتماد المصدر:** لا نقل؛ تثبيت `whatsapserver/main` و`whatsapserver-2` كهدف V27 الإنتاجي.
2. **تم تنظيف الاختبارات:** فُصلت النصوص التاريخية الداخلية عن هوية V27 الظاهرة، والنتيجة `204/204`.
3. **تم توحيد Render:** Docker + `/app/data` بحجم 10 GB + `Auto-Deploy: On Commit` + `/health`، دون تغيير الأسرار أو مسارات الجلسة.
4. **تمت حماية الهوية:** بقيت `clean-instance` وكل الفروع الأخرى معزولة؛ لا نسخ لجلسة WhatsApp أو group identity أو قاعدة البيانات.
5. **إدارة البدائل:** لم تُحذف الخدمات القديمة ولم تُنقل أي خدمة؛ تبقى staging/legacy حتى قرار منفصل.
6. **تم التحقق النهائي:** فحص `/health` و`/status` والروابط العامة read-only، مع إبقاء `DIRECT_RIDE_LIVE_DISPATCH=false` كما هو.

## نتيجة التنفيذ

- الهدف: `whatsapserver/main` + `whatsapserver-2`.
- الاختبارات: `204/204` ناجحة.
- Render: Docker، قرص دائم `/app/data` بحجم 10 GB، Auto-Deploy مفعّل على `On Commit`.
- الحالة التشغيلية: لا نقل، لا حذف، لا تغيير هوية WhatsApp، ولا تفعيل توزيع حي إضافي للرحلات المباشرة.

## المصادر التي تمت مراجعتها

- [GitHub organization](https://github.com/aljarrahmahmoud15-tech)
- [المستودع الإنتاجي](https://github.com/aljarrahmahmoud15-tech/whatsapserver)
- [لوحة Render](https://dashboard.render.com/)
- [خدمة whatsapserver-2](https://dashboard.render.com/web/srv-dagbnenqj5pc738f44e0)
- [الخدمة العامة الحالية](https://bot.wasselni-biz.com/health)
- [خدمة clean-instance](https://dashboard.render.com/web/srv-dan9ohqjnfac73ft2rug)
- [خدمة nexora-core](https://dashboard.render.com/web/srv-db67sfo473hc73dfkt40)
