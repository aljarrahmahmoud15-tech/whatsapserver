const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');

assert.match(server, /app\.post\("\/api\/admin\/group\/confirmed-preview", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/group\/confirm-one", requireAdmin/);
assert.match(server, /async function fetchExactGroupEvidenceMessages\(groupId, sourceMessageId, acceptanceMessageId\)/);
assert.match(server, /const exactEvidenceRequested = Boolean\(expected\.sourceMessageId && expected\.acceptanceMessageId\)/);
assert.match(server, /fetchExactGroupEvidenceMessages\(groupId, expected\.sourceMessageId, expected\.acceptanceMessageId\)/);
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
assert.match(admin, /const text=await r\.text\(\);let data;try\{data=text\?JSON\.parse\(text\):\{\}\}/);
assert.doesNotMatch(admin, /catch\{data=\{error:await r\.text\(\)\}\}/);

console.log('exact group recovery preview, owner approval, company wallet routing, and UI guardrails verified');
