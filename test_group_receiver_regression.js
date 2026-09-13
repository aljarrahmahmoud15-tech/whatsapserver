const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

const handlerDefinitions = source.match(/^async function handleIncomingMessage\(/gm) || [];
assert.strictEqual(handlerDefinitions.length, 1, "يجب أن يوجد معالج واحد فقط لرسائل واتساب حتى لا يطغى تعريف متأخر على المعالج التشغيلي");

const groupRouteDefinitions = source.match(/app\.post\(["']\/api\/admin\/group["']/g) || [];
assert.strictEqual(groupRouteDefinitions.length, 1, "يجب أن يوجد مسار واحد فقط لضبط القروب");
assert.match(source, /app\.post\("\/api\/admin\/group", requireAdmin,/, "مسار ضبط القروب محمي بجلسة الإدارة");
assert.doesNotMatch(source, /app\.post\(['"]\/api\/admin\/roles\/grant['"], express\.json\(\),/, "لا يجوز إبقاء مسار منح أدوار غير محمي");

const configureStart = source.indexOf("function configureGroupId(");
const configureEnd = source.indexOf("function isConfiguredGroup(", configureStart);
assert(configureStart >= 0 && configureEnd > configureStart, "دالة تهيئة القروب موجودة");
const configureSource = source.slice(configureStart, configureEnd);
assert(configureSource.includes("UPDATE groups_config SET active=0"), "تهيئة قروب جديد تعطل المعرفات القديمة");
assert(configureSource.includes('setSetting("group_id", groupId)'), "يتم تحديث معرف القروب الرئيسي");
assert(configureSource.includes('setSetting("active_group_id", groupId)'), "يتم توحيد معرف القروب القديم مع الرئيسي");

assert.match(source, /app\.post\("\/api\/admin\/group\/adopt-last-seen", requireAdmin,/, "اعتماد آخر قروب مرصود محمي إداريًا");
assert(source.includes("Date.now() - observedAt > 15 * 60 * 1000"), "لا يمكن اعتماد حدث قروب قديم");
assert(source.includes("const groupReceiverReady = Boolean(isReady || baileysReady);"), "جاهزية مستقبل القروب تشمل مستقبل whatsapp-web.js الرئيسي");
assert(source.includes('const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID?.trim() || "";'), "يمكن تثبيت معرف القروب عبر بيئة النشر");
assert(source.includes("reconcileConfiguredGroupFromEnvironment();"), "تتم مزامنة معرف القروب عند بدء الخدمة");
assert.match(source, /app\.post\("\/api\/admin\/group\/leave-unconfigured", requireAdmin,/, "مسار خروج البوت من القروب غير المعتمد محمي إداريًا");
assert(source.includes("deleted: false"), "خروج البوت لا يحذف القروب غير المعتمد");
assert(source.includes("async function resolveReadableGroupChat(groupId)"), "قارئ التاريخ يبحث عن كائن القروب القابل للقراءة");
assert(source.includes("async function fetchGroupHistory(groupId, limit)"), "قارئ التاريخ موحد لمسارات الرسائل والاستيراد");
assert(source.includes("fetchMessages({ limit, fromMe: false })"), "الاستيراد التاريخي يطلب رسائل القروب الواردة فقط");
assert(source.includes('window.require("WAWebConversationMsgs")') && source.includes("loader?.loadEarlierMsgs"), "القارئ التاريخي يدعم تحميل الرسائل الأقدم من WhatsApp Web مع fallback متوافق");
assert(source.includes("window.WWebJS?.getMessageModel"), "رسائل WhatsApp Web تُحوّل إلى نموذج النظام");
assert(source.includes('app.post("/api/admin/group/import-order-history", requireAdmin'), "مسار استيراد تاريخ الحجوزات محمي إداريًا");

console.log("group receiver regression guardrails verified");
