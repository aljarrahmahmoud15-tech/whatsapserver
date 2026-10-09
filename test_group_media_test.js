const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const routeStart = server.indexOf('app.post("/api/admin/group/send-test-media"');
const routeEnd = server.indexOf('app.post("/api/admin/send"', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'مسار اختبار الوسائط موجود قبل مسار النص العام');
const route = server.slice(routeStart, routeEnd);

assert.match(route, /const officialGroupId = configuredRuntimeGroupId\(\)/, 'المسار يستخدم القروب الرسمي المهيأ على Server 2');
assert.match(route, /groupId !== officialGroupId/, 'المسار يرفض أي قروب خارج القروب المهيأ');
assert.match(route, /req\.body\?\.confirm !== true/, 'المسار يتطلب تأكيد المالك');
assert.match(route, /X-Idempotency-Key/, 'المسار يستخدم مفتاح منع التكرار');
assert.match(route, /registerAdminSend\(\{ operationId, chatId: groupId, message: caption \}\)/, 'المسار يسجل العملية idempotently');
assert.match(route, /isWhatsAppStorageSendBlocked\(\)/, 'المسار يحترم حارس IndexedDB');
assert.match(route, /renderOperationsMessageMedia\("اختبار وسائط TAKE&GO"/, 'المسار يعيد استخدام مولد بطاقة العمليات الإنتاجي');
assert.match(route, /client\.sendMessage\(groupId, media/, 'المسار يرسل مباشرة إلى المعرّف الرسمي');
assert.match(route, /client\.sendMessage\(groupId, media, \{ caption \}\)/, 'المسار يستخدم خيارات الإرسال الإنتاجية');
assert.doesNotMatch(route, /waitUntilMsgSent/, 'لا يغيّر خيار انتظار الوسائط الإنتاجي');
assert.match(route, /Only the verified official group is allowed/, 'لا يسمح بوجهة أخرى');
assert.doesNotMatch(route, /req\.body\?\.(?:mediaUrl|file|base64)/, 'لا يقبل ملفًا أو رابطًا عشوائيًا من العميل');

console.log('official-group media test route guardrails verified');
