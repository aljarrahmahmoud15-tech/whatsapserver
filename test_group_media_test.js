const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const routeStart = server.indexOf('app.post("/api/admin/group/send-test-media"');
const routeEnd = server.indexOf('app.post("/api/admin/send"', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'مسار اختبار الوسائط موجود قبل مسار النص العام');
const route = server.slice(routeStart, routeEnd);

assert.match(route, /120363426604560611@g\.us/, 'المسار مقيد بالقروب الرسمي');
assert.match(route, /req\.body\?\.confirm !== true/, 'المسار يتطلب تأكيد المالك');
assert.match(route, /X-Idempotency-Key/, 'المسار يستخدم مفتاح منع التكرار');
assert.match(route, /registerAdminSend\(\{ operationId, chatId: groupId, message: caption \}\)/, 'المسار يسجل العملية idempotently');
assert.match(route, /isWhatsAppStorageSendBlocked\(\)/, 'المسار يحترم حارس IndexedDB');
assert.match(route, /new MessageMedia\("image\/png"/, 'المسار يرسل PNG فعلية');
assert.match(route, /sharp\(Buffer\.from\(svg\)\)\.png\(\)\.toBuffer\(\)/, 'الصورة تُنشأ ثابتًا داخل الخادم');
assert.match(route, /client\.sendMessage\(groupId, media/, 'المسار يرسل مباشرة إلى المعرّف الرسمي');
assert.doesNotMatch(route, /chat\.sendMessage\(media/, 'لا يعيد المحاولة عبر كائن chat قد يكرر الوسائط');
assert.match(route, /waitUntilMsgSent: false/, 'الإرسال لا يعيد المحاولة تلقائيًا من WhatsApp');
assert.match(route, /Only the verified official group is allowed/, 'لا يسمح بوجهة أخرى');
assert.doesNotMatch(route, /req\.body\?\.(?:mediaUrl|file|base64)/, 'لا يقبل ملفًا أو رابطًا عشوائيًا من العميل');

console.log('official-group media test route guardrails verified');
