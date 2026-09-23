const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

assert.match(server, /CAPTAIN_COMPLETION_ANNOUNCEMENT_CONFIRMATION = "SEND_COMPANY_COMPLETION_ANNOUNCEMENT"/, 'الإعلان يطلب تأكيدًا خاصًا به');
assert.match(server, /CAPTAIN_COMPLETION_ANNOUNCEMENT_VERSION = "company-completion-v1"/, 'الإعلان مربوط بإصدار محتوى ثابت');
assert.match(server, /إعلان اكتمال شركة وصلني الآن/, 'الإعلان يحمل عنوانًا عربيًا واضحًا');
assert.match(server, /renderOperationsMessageMedia\(title, lines\)/, 'الإعلان يستخدم بطاقة صورة تشغيلية موحّدة');
assert.match(server, /role='captain' AND is_bot=0 AND active=1 AND account_status='active'/, 'الإرسال يقتصر على الكباتن النشطين غير البوت');
assert.match(server, /captain\.company_completion\.\$\{runKey\}/, 'لكل إعلان ومتلقي مفتاح idempotency مستقل');
assert.match(server, /sendWhatsAppAtMostOnce\(recipient, media, \{ caption \}, 30000\)/, 'الإرسال محمي من التكرار');
assert.match(server, /app\.post\("\/api\/admin\/captains\/announce-completion", requireAdmin/, 'المسار مالكي ومصادق');
assert.match(server, /app\.get\("\/api\/admin\/captains\/announce-completion\/:runKey", requireAdmin/, 'حالة البث قابلة للقراءة فقط');
assert.match(server, /app\.get\("\/api\/admin\/captains\/announcement-chat-check\/:phone", requireAdmin/, 'فحص رسالة المستلم قراءة فقط');
assert.match(server, /fetchMessages\(\{ limit: 60, fromMe: true \}\)/, 'فحص الرسالة يستخدم سجل WhatsApp الصادر فقط');
assert.doesNotMatch(server.slice(server.indexOf('app.post("/api/admin/captains/announce-completion"'), server.indexOf('app.get("/api/admin/captains/cleanup-preview"')), /wallet_cents|wallet_ledger|topup_cards|order_settlements/, 'الإعلان لا يغير المحافظ أو الحجوزات');

console.log('company completion announcement guardrails verified');
