const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('./public/index.html', 'utf8');
const script = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((text) => text.includes('previewZeroBalanceGroupRemoval'));
assert.ok(script, 'root V27 inline script must contain the zero-balance controls');

assert.match(page, /id="ops-zero-balance-panel" class="ops-card" hidden/,
  'the existing root panel must remain hidden until an owner session is confirmed');
assert.match(page, /id="ops-zero-balance-preview" type="button" disabled/,
  'preview must be disabled by default');
assert.match(page, /id="ops-zero-balance-execute" type="button" disabled/,
  'execution must be disabled by default');
assert.doesNotMatch(page, /ops-zero-balance-count/,
  'the root panel must not require or bind a manual candidate count');
assert.match(script, /async function whatsapp\(\)\{if\(!requireAuth\(\)\)return;await refreshZeroBalanceOwnerSession\(\);/,
  'the root WhatsApp panel must refresh the owner role before rendering');
assert.match(script, /document\.getElementById\('ops-zero-balance-preview'\)\.onclick=\(\)=>void previewZeroBalanceGroupRemoval\(\)/,
  'the preview button must invoke the guarded preview handler');
assert.match(script, /document\.getElementById\('ops-zero-balance-execute'\)\.onclick=\(\)=>void executeZeroBalanceGroupRemoval\(\)/,
  'the execute button must invoke the guarded execution handler');

const sourceLines = script.split(/\r?\n/);
function sourceLine(prefix) {
  const line = sourceLines.find((candidate) => candidate.trim().startsWith(prefix));
  assert.ok(line, `missing root V27 function: ${prefix}`);
  return line;
}

const definitions = [
  "let ACTIVE_GROUP_ID='fixture-official-group';",
  sourceLine('let zeroBalanceGroupRemovalPreview='),
  sourceLine('function zeroBalanceGroupRemovalBusy('),
  sourceLine('function zeroBalancePreviewContractIsValid('),
  sourceLine('function zeroBalancePreviewSafeForExecution('),
  sourceLine('function setZeroBalanceOwnerVisibility('),
  sourceLine('async function refreshZeroBalanceOwnerSession('),
  sourceLine('function updateZeroBalanceGroupRemovalButton('),
  sourceLine('async function previewZeroBalanceGroupRemoval('),
  sourceLine('async function executeZeroBalanceGroupRemoval('),
].join('\n');

const elements = {
  'ops-zero-balance-panel': { hidden: true },
  'ops-zero-balance-preview': { disabled: true },
  'ops-zero-balance-execute': { disabled: true },
};
const apiCalls = [];
const fetchCalls = [];
const confirmations = [];
const toastMessages = [];
let identityRole = 'staff';
let confirmDecision = false;
const previewFixture = {
  success: true,
  mutation: 'none',
  accountMutation: false,
  financialMutation: false,
  previewId: 'fixture-preview',
  groupId: 'fixture-official-group',
  generatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  fingerprint: 'fixture-fingerprint',
  summary: {
    count: 1,
    unresolved: 0,
    ambiguous: 0,
    protected: 0,
    previousUnknownOverlap: 0,
    previousUnknownUnidentified: 0,
  },
  candidates: [{ name: 'Fixture Candidate' }],
};

const context = vm.createContext({
  document: { getElementById: (id) => elements[id] || null },
  window: { confirm: (message) => { confirmations.push(message); return confirmDecision; } },
  fetch: async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true, json: async () => ({ user: { role: identityRole } }) };
  },
  api: async (path, options = {}) => {
    apiCalls.push({ path, options });
    if (path === '/api/admin/group/zero-balance-removals/preview') {
      return JSON.parse(JSON.stringify(previewFixture));
    }
    if (path === '/api/admin/group/zero-balance-removals/execute') {
      return { operationId: 'fixture-operation', status: 'queued' };
    }
    throw new Error(`unexpected mock API path: ${path}`);
  },
  setTimeout: () => 1,
  clearTimeout: () => {},
  renderZeroBalanceGroupRemoval: () => {},
  refreshZeroBalanceGroupRemovalStatus: async () => {},
  showToast: (message) => toastMessages.push(message),
});
new vm.Script(definitions).runInContext(context);

function fixtureExpression(fixture) {
  return `zeroBalanceGroupRemovalPreview = ${JSON.stringify(fixture)};`;
}

(async () => {
  vm.runInContext('updateZeroBalanceGroupRemovalButton()', context);
  assert.equal(elements['ops-zero-balance-panel'].hidden, true);
  assert.equal(elements['ops-zero-balance-preview'].disabled, true,
    'a non-owner must not receive an enabled preview button');
  assert.equal(elements['ops-zero-balance-execute'].disabled, true);

  assert.equal(await vm.runInContext('refreshZeroBalanceOwnerSession()', context), false);
  assert.equal(elements['ops-zero-balance-panel'].hidden, true,
    'a non-owner response must keep the panel hidden');
  identityRole = 'company';
  assert.equal(await vm.runInContext('refreshZeroBalanceOwnerSession()', context), true);
  assert.equal(elements['ops-zero-balance-panel'].hidden, false,
    'the company owner session may reveal the existing panel');
  assert.equal(elements['ops-zero-balance-preview'].disabled, false,
    'the owner can request a preview when a group is available');
  assert.equal(elements['ops-zero-balance-execute'].disabled, true,
    'execution remains disabled before a safe preview');

  const contractIsValid = vm.runInContext('zeroBalancePreviewContractIsValid', context);
  const safeForExecution = vm.runInContext('zeroBalancePreviewSafeForExecution', context);
  assert.equal(contractIsValid(previewFixture), true);
  assert.equal(safeForExecution(previewFixture), true);
  assert.equal(safeForExecution({ ...previewFixture, expiresAt: new Date(Date.now() - 1000).toISOString() }), false,
    'an expired preview must never enable execution');
  assert.equal(safeForExecution({ ...previewFixture, summary: { ...previewFixture.summary, unresolved: 1 } }), false,
    'unresolved identities must block execution');
  assert.equal(safeForExecution({ ...previewFixture, summary: { ...previewFixture.summary, previousUnknownOverlap: 1 } }), false,
    'overlap with an earlier unknown result must block execution');
  assert.equal(safeForExecution({ ...previewFixture, summary: { ...previewFixture.summary, count: 0 }, candidates: [] }), false,
    'an empty preview must not enable execution');
  assert.equal(contractIsValid({ ...previewFixture, candidates: [] }), false,
    'candidate-count mismatch must invalidate the preview contract');
  assert.equal(contractIsValid({ ...previewFixture, financialMutation: true }), false,
    'a preview that does not attest read-only financial behavior must be rejected');
  assert.equal(contractIsValid({ ...previewFixture, summary: { count: 1 } }), false,
    'missing identity safety counters must invalidate the preview contract');

  await vm.runInContext('previewZeroBalanceGroupRemoval()', context);
  assert.deepEqual(apiCalls.map((call) => call.path), ['/api/admin/group/zero-balance-removals/preview'],
    'the simulated preview click must call only the preview path');
  assert.equal(elements['ops-zero-balance-execute'].disabled, false,
    'a complete, fresh, safe preview enables the owner execute button');

  vm.runInContext(fixtureExpression({
    ...previewFixture,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  }), context);
  vm.runInContext('updateZeroBalanceGroupRemovalButton()', context);
  assert.equal(elements['ops-zero-balance-execute'].disabled, true,
    'the execute button must disable when the preview expires');

  vm.runInContext(fixtureExpression(previewFixture), context);
  vm.runInContext("zeroBalanceGroupRemovalOperation = { status: 'running' }; updateZeroBalanceGroupRemovalButton()", context);
  assert.equal(elements['ops-zero-balance-preview'].disabled, true,
    'a running operation must block another preview');
  assert.equal(elements['ops-zero-balance-execute'].disabled, true,
    'a running operation must block execution');
  vm.runInContext('zeroBalanceGroupRemovalOperation = null; updateZeroBalanceGroupRemovalButton()', context);

  confirmDecision = false;
  await vm.runInContext('executeZeroBalanceGroupRemoval()', context);
  assert.equal(apiCalls.filter((call) => call.path.endsWith('/execute')).length, 0,
    'declining the manual owner confirmation must not call execution');
  assert.match(confirmations.at(-1), /إزالة 1 عضوًا/,
    'the final manual confirmation must name the preview count');

  confirmDecision = true;
  await vm.runInContext('executeZeroBalanceGroupRemoval()', context);
  const executeCalls = apiCalls.filter((call) => call.path.endsWith('/execute'));
  assert.equal(executeCalls.length, 1,
    'one explicit confirmation must invoke exactly one mocked execute request');
  assert.deepEqual(JSON.parse(executeCalls[0].options.body), {
    groupId: 'fixture-official-group',
    previewId: 'fixture-preview',
    fingerprint: 'fixture-fingerprint',
    expectedCount: 1,
    confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  }, 'execution must bind to the exact fresh preview and fixed confirmation phrase');
  assert.ok(fetchCalls.every((call) => call.url === '/api/staff/me'),
    'all identity reads in this test are mocked owner-role checks');
  assert.ok(apiCalls.every((call) => call.path.startsWith('/api/admin/group/zero-balance-removals/')),
    'every API call in this test is handled by the local mock; no live network request is made');
  assert.equal(toastMessages.length, 0);

  console.log('root V27 zero-balance buttons/owner gate/fresh-preview safety/manual confirmation/no manual count/no live requests: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
