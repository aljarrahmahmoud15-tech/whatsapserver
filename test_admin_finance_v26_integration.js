const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('./admin.html', 'utf8');

assert.match(admin, /id="financialHubCard"/, 'v26 financial hub exists');
assert.match(admin, /الإدارة المالية · 3 بنود/, 'financial hub is the primary three-item navigation entry');
assert.match(admin, /الاشتراكات الشهرية/, 'subscription item is present');
assert.match(admin, /محفظة الشركة/, 'company wallet item is present');
assert.match(admin, /محفظة الخدمات/, 'service wallet item is present');
assert.match(admin, /\/api\/admin\/company-wallet/, 'company wallet data is read from the bot API');
assert.match(admin, /\/api\/admin\/captains/, 'captain/entity data is read from the bot API');
assert.match(admin, /\/api\/admin\/subscriptions\?compact=1/, 'subscription data is read from the bot API');
assert.match(admin, /setInterval\(\(\)=>void loadFinanceV26\(\),30000\)/, 'financial data polls every 30 seconds');
assert.match(admin, /لا توجد حركة مالية أو رسالة WhatsApp من هذه الشاشة/, 'hub declares read-only behavior');
assert.match(admin, /محرك البوت الحالي يعمل بدورة 7 أيام/, 'UI discloses the current seven-day backend policy');
assert.ok(admin.includes("String(c.account_status||'')!=='merged'"), 'merged accounts are excluded from the entity summary');
const panelStart = admin.indexOf('function openFinanceV26Panel(');
const panelEnd = admin.indexOf('\nfunction closeFinanceV26Panel', panelStart);
assert.ok(panelStart >= 0 && panelEnd > panelStart, 'finance read panel is present');
assert.doesNotMatch(admin.slice(panelStart, panelEnd), /\/api\/admin\/captain-wallet-pool\/(?:execute|preview)/, 'finance read panel does not invoke pool operations');
const start = admin.indexOf('async function loadFinanceV26()');
const end = admin.indexOf('\nfunction startFinanceV26', start);
assert.ok(start >= 0 && end > start, 'finance loader is present');
const loader = admin.slice(start, end);
assert.doesNotMatch(loader, /method:\s*['"]POST['"]|method:\s*['"]PATCH['"]|method:\s*['"]DELETE['"]/, 'finance loader is read-only');
console.log('v26 financial hub integration guardrails verified');
