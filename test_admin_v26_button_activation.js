const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('./public/admin-v26.html', 'utf8');
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(script, 'V26 page must contain a JavaScript controller');
assert.match(page, /name="v26-action-build" content="captain-actions-2026-10-20"/);
assert.match(script, /function bindCaptainActions\(\)/);
assert.match(script, /v26ActionsBound/);
assert.match(script, /closest\('\[data-safe-action\]'\)/);
assert.match(script, /bindCaptainActions\(\)/);
for (const handler of ['openCaptainAction', 'saveCaptainEdit', 'applyCaptainCredit', 'suspendCaptainAndRemove']) {
  assert.match(script, new RegExp(`function ${handler}\\(`), `${handler} must be implemented`);
}
assert.doesNotMatch(script, /function openCaptainAction\(\)\s*\{\s*return;?\s*\}/);
assert.doesNotMatch(script, /function openStaffNameSearch\(\)\s*\{\s*return;?\s*\}/);
new vm.Script(script);
console.log('V26 captain buttons are delegated, implemented, and syntax-valid: PASS');
