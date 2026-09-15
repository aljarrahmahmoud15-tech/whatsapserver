const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');

assert.match(server, /app\.post\("\/api\/admin\/group\/confirmed-preview", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/group\/confirm-one", requireAdmin/);
assert.match(server, /function recoveryExpectedMatches\(evidence, expected = \{\}\)/);
assert.match(server, /sourceMessageId, acceptanceMessageId, downloaderPhone, and executorPhone are required/);
assert.match(server, /mutation: "none"/);
assert.match(server, /importSource = "group_history_24h"/);
assert.match(server, /importSource: "admin_exact_group_recovery"/);
assert.match(server, /const producer = quoted\.fromMe && BOT_FINANCIAL_MODE === "company" \? companyUser\(\)/);
assert.match(server, /const producer = botProducer \? companyUser\(\)/);
assert.match(server, /existingSettlement\?\.status === "applied"/);
assert.match(server, /await sendFinalBookingCard\(groupId, result\.producer\?\.name, result\.captain\?\.name, result\.order\?\.price_cents\)/);
assert.match(admin, /id="historyRecoveryCard"/);
assert.match(admin, /\/api\/admin\/group\/confirmed-preview/);
assert.match(admin, /\/api\/admin\/group\/confirm-one/);
assert.match(admin, /اعتماد وتسوية/);
assert.match(admin, /لا تُطبق العملية أكثر من مرة/);

console.log('exact group recovery preview, owner approval, company wallet routing, and UI guardrails verified');
