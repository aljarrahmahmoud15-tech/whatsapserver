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
assert.match(page, /pattern="\[0-9\]\{5\}"/);
assert.doesNotMatch(page, /pattern="\\d\{5\}"/);
assert.match(script, /function zeroBalancePreviewContractIsValid\(preview\)/);
assert.match(script, /function zeroBalancePreviewSafeForExecution\(preview\)/);
const gateStart = script.indexOf('function zeroBalancePreviewContractIsValid(');
const gateEnd = script.indexOf('function updateZeroBalanceExecuteButton(', gateStart);
assert.ok(gateStart >= 0 && gateEnd > gateStart, 'preview contract helpers must be extractable for focused testing');
const gateContext = vm.createContext({});
new vm.Script(`${script.slice(gateStart, gateEnd)};globalThis.contractIsValid=zeroBalancePreviewContractIsValid;globalThis.safeForExecution=zeroBalancePreviewSafeForExecution;`).runInContext(gateContext);
const validPreview = {success:true,mutation:'none',accountMutation:false,financialMutation:false,previewId:'preview-id',groupId:'test@g.us',generatedAt:new Date(Date.now()-1000).toISOString(),fingerprint:'fingerprint',expiresAt:new Date(Date.now()+60000).toISOString(),candidates:[{}],summary:{count:1,unresolved:0,ambiguous:0,protected:0,previousUnknownOverlap:0,previousUnknownUnidentified:0}};
assert.equal(gateContext.contractIsValid(validPreview), true, 'a complete, successful, unexpired read-only preview must validate');
assert.equal(gateContext.safeForExecution(validPreview), true, 'a complete safe preview must allow the owner button to activate');
assert.equal(gateContext.contractIsValid({...validPreview,success:false}), false, 'HTTP-success JSON without success=true must be rejected');
for (const key of ['unresolved','ambiguous','protected','previousUnknownOverlap','previousUnknownUnidentified']) {
  const summary = {...validPreview.summary};
  delete summary[key];
  assert.equal(gateContext.contractIsValid({...validPreview,summary}), false, `${key} must be present explicitly`);
}
assert.equal(gateContext.contractIsValid({...validPreview,candidates:[]}), false, 'candidate count must match the summary');
assert.equal(gateContext.contractIsValid({...validPreview,expiresAt:'invalid'}), false, 'expiry must be valid and current');
assert.equal(gateContext.contractIsValid({...validPreview,generatedAt:undefined}), false, 'generation time must be present');
assert.equal(gateContext.contractIsValid({...validPreview,expiresAt:new Date(Date.now()-60000).toISOString()}), false, 'an expired preview must be rejected');
assert.equal(gateContext.safeForExecution({...validPreview,summary:{...validPreview.summary,previousUnknownOverlap:1}}), false, 'unknown overlap must prevent execution');
assert.equal(gateContext.safeForExecution({...validPreview,summary:{...validPreview.summary,count:0},candidates:[]}), false, 'an empty preview must not enable execution');
assert.match(script,/const enabled=zeroBalanceOwnerSession&&zeroBalancePreviewSafeForExecution\(preview\)&&!zeroBalanceOperationBusy\(\)/, 'only the owner may receive an enabled execute button');
const loginStart=script.indexOf('async function login(){');
const loginEnd=script.indexOf('document.querySelectorAll',loginStart);
assert.ok(loginStart>=0&&loginEnd>loginStart,'login handler must be available for owner-state review');
assert.match(script.slice(loginStart,loginEnd),/await refreshZeroBalanceOwnerSession\(\)/,'owner role must be refreshed after a successful login');
for (const handler of ['openCaptainAction', 'saveCaptainEdit', 'applyCaptainCredit', 'suspendCaptainAndRemove']) {
  assert.match(script, new RegExp(`function ${handler}\\(`), `${handler} must be implemented`);
}
assert.doesNotMatch(script, /function openCaptainAction\(\)\s*\{\s*return;?\s*\}/);
assert.doesNotMatch(script, /function openStaffNameSearch\(\)\s*\{\s*return;?\s*\}/);
new vm.Script(script);
console.log('V26 captain buttons are delegated, implemented, and syntax-valid: PASS');
