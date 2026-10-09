const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
assert.match(source, /const recentMessageEventKeys = new Map\(\)/, 'يوجد مخزن مؤقت لأحداث الرسائل');
assert.match(source, /function shouldHandleMessageEvent\(msg, eventName\)/, 'يوجد حارس تكرار للأحداث');
assert.match(source, /MESSAGE_EVENT_DEDUP_TTL_MS = 10 \* 60 \* 1000/, 'مدة الحماية محدودة بعشر دقائق');
assert.match(source, /shouldHandleMessageEvent\(msg, "message_create"\)/, 'message_create محمي من التكرار');
assert.match(source, /shouldHandleMessageEvent\(msg, "message"\)/, 'message محمي من التكرار');
assert.match(source, /isConfiguredGroup\(groupId\)/, 'معالج الرسائل يبقي قفل القروب');
console.log('group event deduplication guardrails verified');
