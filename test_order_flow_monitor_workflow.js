const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/order-flow-monitor.yml', 'utf8');
assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/, 'الفحص مجدول كل 15 دقيقة');
assert.match(workflow, /workflow_dispatch:/, 'يوجد تشغيل يدوي');
assert.match(workflow, /cancel-in-progress: false/, 'لا يلغي الفحص السابق أثناء التداخل');
assert.match(workflow, /npm test/, 'يشغل مجموعة الاختبارات الكاملة');
assert.match(workflow, /test_confirmation_flow_isolated\.js/, 'يشغل محاكاة دورة التثبيت');
assert.match(workflow, /test_selected_reply_reaction\.js/, 'يفحص التفاعل على الرد المختار');
assert.match(workflow, /https:\/\/whatsapserver-2\.onrender\.com/, 'يفحص الخدمة الحية');
assert.match(workflow, /\.groupReceiverReady == true/, 'يتحقق من مستقبل القروب');
assert.match(workflow, /\.whatsappLastError == null/, 'يرفض حالة خطأ WhatsApp');
assert.match(workflow, /\.orders\.pendingConfirmation >= 0/, 'يتحقق من عداد الطلبات المعلقة');
console.log('order flow monitor workflow guardrails verified');
