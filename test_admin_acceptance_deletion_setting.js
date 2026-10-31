const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const admin = fs.readFileSync('public/admin-v27.html', 'utf8');

assert.match(server, /app\.get\("\/api\/admin\/settings", requireOwnerAdmin/);
assert.match(server, /acceptanceDeletion: insufficientBalanceAcceptanceDeletionResponse\(\)/);
assert.match(server, /app\.patch\("\/api\/admin\/settings\/acceptance-deletion", requireOwnerAdmin/);
assert.match(server, /financialMutation: false, settlementMutation: false/);
assert.match(server, /setSetting\(INSUFFICIENT_BALANCE_ACCEPTANCE_DELETION_SETTING_KEY, req\.body\.enabled \? "1" : "0"\)/);
assert.match(admin, /id="ownerAcceptanceDeletionForm"/);
assert.match(admin, /id="ownerAcceptanceDeletionEnabled"/);
assert.match(admin, /\/api\/admin\/settings\/acceptance-deletion/);
assert.match(admin, /لا يغيّر هذا الخيار التسويات المالية/);

console.log('owner acceptance-deletion toggle guardrails verified');
