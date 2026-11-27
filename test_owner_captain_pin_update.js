const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('./server.js', 'utf8');
const root = fs.readFileSync('./public/index.html', 'utf8');
const v26 = fs.readFileSync('./public/admin-v26.html', 'utf8');
const v27 = fs.readFileSync('./public/admin-v27.html', 'utf8');

assert.match(source, /function requireCompanyOwner\(req, res, next\)/);
const pinRouteStart = source.indexOf('app.patch("/api/admin/captains/:id/pin", requireCompanyOwner');
const pinRouteEnd = source.indexOf('app.post("/api/admin/captains/:id/suspend-and-remove"', pinRouteStart);
assert.ok(pinRouteStart >= 0 && pinRouteEnd > pinRouteStart, 'dedicated owner PIN route boundaries must exist');
const pinRoute = source.slice(pinRouteStart, pinRouteEnd);
assert.match(pinRoute, /if \(!validCaptainPin\(pin\)\)/);
assert.match(pinRoute, /captain_pin_hash=\?,captain_pin_ciphertext=NULL,captain_auth_method='pin'/);
assert.match(pinRoute, /bcrypt\.hashSync\(pin, 10\)/);
assert.match(pinRoute, /audit\("captain\.pin\.updated"/);
assert.doesNotMatch(pinRoute, /pin:\s*pin\b/, 'the endpoint response must not expose the PIN');

const usersRouteStart = source.indexOf('app.patch("/api/admin/users/:id"');
const usersRouteEnd = source.indexOf('app.delete("/api/admin/users/:id"', usersRouteStart);
assert.ok(usersRouteStart >= 0 && usersRouteEnd > usersRouteStart, 'general user route boundaries must exist');
const usersRoute = source.slice(usersRouteStart, usersRouteEnd);
assert.match(usersRoute, /pinFieldRequested/);
assert.match(usersRoute, /session\.role !== "company"/);
assert.match(usersRoute, /تغيير رمز الكابتن متاح للمالك فقط/);

assert.doesNotMatch(root, /captain-pin-owner\.js/, 'the PIN action stays inside the dashboard IIFE');
assert.match(root, /id="ops-content"/);
assert.match(root, /id="captainPinValue" type="password"/);
assert.match(root, /id="captainPinConfirm" type="password"/);
assert.match(root, /api\('\/api\/admin\/captains\/'\+encodeURIComponent\(pendingCaptainPinId\)\+'\/pin',\{method:'PATCH'/);
assert.match(root, /const pinActionContainer=document\.getElementById\('ops-content'\)/);
assert.match(root, /const isOwner=await pinOwnerRole\(\)/);
assert.match(root, /if\(!isOwner\)\{pinActionContainer\.querySelectorAll\('\[data-captain-pin\]'\)/,
  'root PIN action is inserted only after an owner-role check');
const actionContainerStart = root.indexOf('function captainPinActionsContainer(saveButton) {');
const actionContainerEnd = root.indexOf('async function pinOwnerRole()', actionContainerStart);
assert.ok(actionContainerStart >= 0 && actionContainerEnd > actionContainerStart,
  'root PIN action container helper exists');
const actionContainerContext = {};
vm.runInNewContext(root.slice(actionContainerStart, actionContainerEnd)
  + '\nthis.captainPinActionsContainer = captainPinActionsContainer;', actionContainerContext);
const fallbackCell = {};
const rowWithoutWrapper = { querySelector: () => null };
const saveButtonWithoutWrapper = {
  closest: (selector) => selector === 'tr' ? rowWithoutWrapper : selector === 'td' ? fallbackCell : null,
};
assert.equal(actionContainerContext.captainPinActionsContainer(saveButtonWithoutWrapper), fallbackCell,
  'root PIN action falls back to the captain table action cell');
const preferredActions = {};
const rowWithWrapper = { querySelector: (selector) => selector === '.ops-actions' ? preferredActions : null };
const saveButtonWithWrapper = {
  closest: (selector) => selector === 'tr' ? rowWithWrapper : selector === 'td' ? fallbackCell : null,
};
assert.equal(actionContainerContext.captainPinActionsContainer(saveButtonWithWrapper), preferredActions,
  'root PIN action prefers an existing ops-actions wrapper');
assert.equal(actionContainerContext.captainPinActionsContainer(null), null,
  'root PIN action handles a missing save button safely');
assert.match(root, /actions=captainPinActionsContainer\(saveButton\)/,
  'root PIN action uses the tested table-cell resolver');
assert.match(root, /button\.dataset\.captainPin=captainId/);
assert.match(root, /button\.addEventListener\('click',\(\)=>openCaptainPinDialog\(captainId/);
assert.match(root, /pinActionObserver\.observe\(pinActionContainer,\{childList:true,subtree:true\}\)/);

for (const [name, page] of [['V26', v26], ['V27', v27]]) {
  assert.match(page, /data-safe-action="pin"/);
  assert.match(page, /if\(kind==='pin'\)return updateCaptainPin\(id\)/);
  assert.match(page, /id="captainActionPinConfirm"/);
  assert.match(page, /api\('\/api\/admin\/captains\/'\+encodeURIComponent\(id\)\+'\/pin',\{method:'PATCH'/);
  assert.match(page, /window\.confirm/);
  const saveStart = page.indexOf('async function saveCaptainEdit(id){');
  const pinStart = page.indexOf('async function updateCaptainPin(id){', saveStart);
  assert.ok(saveStart >= 0 && pinStart > saveStart, `${name} separates name editing from PIN changes`);
  const nameSave = page.slice(saveStart, pinStart);
  assert.doesNotMatch(nameSave, /captainActionPin|\/api\/admin\/users/);
  assert.match(nameSave, /JSON\.stringify\(\{name\}\)/);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0, `${name} inline JavaScript exists`);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script, { filename: `${name}#script` }));
}

const rootScripts = [...root.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(rootScripts.length > 0, 'root V27 inline JavaScript exists');
for (const script of rootScripts) assert.doesNotThrow(() => new vm.Script(script, { filename: 'root V27#script' }));

console.log('owner-only captain PIN route and dedicated masked UI actions in root/V26/V27: PASS');
