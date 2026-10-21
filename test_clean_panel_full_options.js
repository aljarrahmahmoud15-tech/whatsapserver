// Guardrails for the modern panel: every owner option must be wired to a real route.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const v26 = fs.readFileSync(path.join(__dirname, 'public', 'admin-v26.html'), 'utf8');
const v27 = fs.readFileSync(path.join(__dirname, 'public', 'admin-v27.html'), 'utf8');

for (const [name, html] of [['v26', v26], ['v27', v27]]) {
  // The three captain buttons were bound to a function that did not exist, so every
  // click threw ReferenceError and nothing happened.
  assert.match(html, /async function openCaptainAction\(id, action\) \{/, `${name}: openCaptainAction must exist`);
  assert.doesNotMatch(html, /openCaptainAction\(Number\(b\.dataset\.captainId\),b\.dataset\.safeAction\)\)\}\)[\s\S]{0,400}function openCaptainAction[\s\S]{0,200}undefined/);
  assert.match(html, /data-safe-action="edit"/, `${name}: edit button`);
  assert.match(html, /data-safe-action="credit"/, `${name}: credit button`);
  assert.match(html, /data-safe-action="suspend"/, `${name}: suspend button`);
  // Each action must call its real endpoint.
  assert.match(html, /api\('\/api\/admin\/captains\/' \+ encodeURIComponent\(id\), \{ method: 'PATCH'/, `${name}: edit route`);
  assert.match(html, /\/direct-credit'/, `${name}: direct credit route`);
  assert.match(html, /confirmation: 'SUSPEND_AND_REMOVE_CAPTAIN'/, `${name}: suspend confirmation`);
  assert.match(html, /idempotencyKey = 'OWNER-CREDIT-'/, `${name}: credit idempotency key`);
  // Reverse transfer and owner commands must stay available.
  assert.match(html, /function cancelOrderAndReverse\(id,button\)\{/, `${name}: reverse transfer`);
  assert.match(html, /\/cancel-and-reverse'/, `${name}: reverse route`);
  assert.match(html, /confirmation:'V26_CANCEL_ORDER'/, `${name}: reverse confirmation`);
  assert.match(html, /data-owner-command="status\.snapshot"/, `${name}: owner commands`);
  assert.match(html, /api\('\/api\/admin\/owner-control\/command'/, `${name}: owner command route`);
}

// The legacy /admin.html route must serve the modern panel, not the Oct-16 file.
assert.match(server, /const modernPanel = path\.join\(__dirname, "public", "admin-v27\.html"\);\n  if \(fs\.existsSync\(modernPanel\)\) return res\.sendFile\(modernPanel\);/);
assert.match(server, /app\.get\("\/admin-legacy\.html", \(req, res\) => \{/);

// The routes the panel calls must exist in the server.
assert.match(server, /app\.patch\("\/api\/admin\/captains\/:id", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/direct-credit", requireBotWalletOwner/);
assert.match(server, /app\.post\("\/api\/admin\/captains\/:id\/suspend-and-remove", requireAdmin/);
assert.match(server, /app\.post\("\/api\/admin\/orders\/:id\/cancel-and-reverse"/);
assert.match(server, /app\.post\("\/api\/admin\/owner-control\/command", requireBotWalletOwner/);


// Deduction policy card must be visible and wired in both panels.
for (const [name, html] of [['v26', v26], ['v27', v27]]) {
  assert.match(html, /id="deductionPolicyPanel"/, `${name}: deduction policy card`);
  assert.match(html, /async function loadDeductionPolicy\(\)/, `${name}: policy loader`);
  assert.match(html, /async function setDeductionPolicy\(enabled\)/, `${name}: policy setter`);
  assert.match(html, /api\('\/api\/admin\/subscriptions\/schedule'\)/, `${name}: schedule read route`);
  assert.match(html, /api\('\/api\/admin\/subscriptions\/schedule', \{ method: 'POST'/, `${name}: schedule write route`);
  assert.match(html, /ENABLE_CAPTAIN_DEDUCTIONS/, `${name}: resume confirmation phrase`);
  assert.match(html, /id="deductionStopButton"/, `${name}: stop button`);
  assert.match(html, /id="deductionResumeButton"/, `${name}: resume button`);
  assert.match(html, /الخصومات موقوفة بالكامل/, `${name}: stopped badge text`);
}
assert.match(server, /app\.get\("\/api\/admin\/subscriptions\/schedule", requireAdmin/, 'schedule read route on server');
assert.match(server, /app\.post\("\/api\/admin\/subscriptions\/schedule", requireBotWalletOwner/, 'schedule write route on server');

console.log('Modern panel options verified: reverse transfer, captain editing (edit/credit/suspend) and owner commands are all wired, and /admin.html serves the modern panel');
