const assert = require('node:assert/strict');
const fs = require('node:fs');
const { registerZeroBalanceGroupRemovalRoutes } = require('./zero-balance-group-removal');

const GROUP_ID = '120123456789@g.us';
const BOT_PHONE = '962790000005';
const OWNER_PHONE = '962790000006';
const makeMember = (phone, isAdmin = false) => ({ id: `${phone}@c.us`, user: phone, isAdmin });

function makeHarness(options = {}) {
  const users = [
    { id: 1, phone: '962790000001', name: 'Zero Candidate', registration_name: null, wallet_cents: 0, is_bot: 0, role: 'captain', account_status: 'active' },
    { id: 2, phone: '962790000002', name: 'Negative', wallet_cents: -1, is_bot: 0, role: 'captain', account_status: 'active' },
    { id: 3, phone: '962790000003', name: 'Positive', wallet_cents: 1, is_bot: 0, role: 'captain', account_status: 'active' },
    { id: 4, phone: '962790000004', name: 'Admin', wallet_cents: 0, is_bot: 0, role: 'captain', account_status: 'active' },
    { id: 5, phone: BOT_PHONE, name: 'Bot', wallet_cents: 0, is_bot: 1, role: 'captain', account_status: 'active' },
    { id: 6, phone: OWNER_PHONE, name: 'Owner', wallet_cents: 0, is_bot: 0, role: 'captain', account_status: 'active' },
    { id: 7, phone: '962790000007', name: 'Merged', wallet_cents: 0, is_bot: 0, role: 'captain', account_status: 'merged' },
  ];
  let members = [
    makeMember('962790000001'),
    makeMember('962790000002'),
    makeMember('962790000003'),
    makeMember('962790000004', true),
    makeMember(BOT_PHONE, true),
    makeMember(OWNER_PHONE),
    { id: '777777777777@lid', user: '777777777777', isAdmin: false },
    makeMember('962790000007'),
  ];
  if (options.includeSecondCandidate) {
    users.push({ id: 8, phone: '962790000008', name: 'Second Zero', registration_name: null, wallet_cents: 0, is_bot: 0, role: 'captain', account_status: 'active' });
    members.push(makeMember('962790000008'));
  }
  const removedParticipantIds = [];
  const dbMutations = [];
  const accountFinancialWrites = [];
  const operationRows = options.operationRows || new Map();
  const auditEvents = [];
  let connectionGeneration = 1;
  let contextReadCount = 0;
  let releaseContextRead = () => {};
  const contextReadGate = new Promise((resolve) => { releaseContextRead = () => { if (options.incrementGenerationOnRelease) connectionGeneration += 1; resolve(); }; });
  const db = {
    prepare(sql) {
      const isWrite = /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
      if (isWrite && !/group_zero_balance_removal_operations/i.test(sql)) accountFinancialWrites.push(sql);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b[\s\S]*\b(?:users|wallet_ledger|orders|order_settlements|transactions)\b/i, 'route must not change accounts or financial records');
      if (/\bFROM\s+users\b/i.test(sql)) {
        return {
          all: () => users.filter((user) => user.role === 'captain' && user.is_bot === 0),
          get: (id) => users.find((user) => user.id === Number(id)) || null,
        };
      }
      if (/group_zero_balance_removal_operations/i.test(sql) && isWrite) {
        return { run: (values) => { operationRows.set(values.operation_id, { ...values, account_mutation: 0, financial_mutation: 0 }); } };
      }
      if (/FROM\s+group_zero_balance_removal_operations/i.test(sql) && /WHERE\s+operation_id/i.test(sql)) {
        return { get: (id) => operationRows.get(String(id)) || null };
      }
      if (/FROM\s+group_zero_balance_removal_operations/i.test(sql) && /WHERE\s+status\s+IN/i.test(sql)) {
        return { all: () => [...operationRows.values()].filter((row) => ['queued', 'running'].includes(row.status)).sort((a, b) => String(a.operation_id).localeCompare(String(b.operation_id))) };
      }
      if (/FROM\s+group_zero_balance_removal_operations/i.test(sql)) {
        const recent = () => [...operationRows.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.operation_id).localeCompare(String(a.operation_id))).slice(0, 5);
        return { get: () => recent()[0] || null, all: recent };
      }
      throw new Error(`unsupported test SQL: ${sql}`);
    },
    exec(sql) {
      dbMutations.push(sql);
      assert.match(sql, /CREATE TABLE IF NOT EXISTS group_zero_balance_removal_operations/i, 'only the group operation log may be created');
    },
  };
  const ownerGuard = () => {};
  const mutationLimiter = () => {};
  const readLimiter = () => {};
  const routes = new Map();
  const app = {
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); },
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
  };
  const serializedWhatsappUserId = (value) => {
    if (value && typeof value === 'object') return value._serialized || value.id?._serialized || String(value.id || '');
    const raw = String(value || '');
    return raw.includes('@') ? raw : (raw ? `${raw}@c.us` : '');
  };
  const phoneWithCountry = (value) => String(value || '').replace(/\D/g, '');
  const snapshot = () => ({ id: GROUP_ID, name: 'Official group', isGroup: true, participants: members.map((member) => ({ ...member })) });
  const context = () => {
    const participantIds = members.map((member) => member.id);
    const phoneToParticipantId = new Map();
    for (const member of members) {
      if (String(member.id).endsWith('@lid')) continue;
      phoneToParticipantId.set(member.user, member.id);
    }
    return {
      participantIds,
      phoneToParticipantId,
      chat: {
        isGroup: true,
        participants: members,
        async removeParticipants(ids) {
          if (options.assertPersistedRemoving) {
            const persistedRow = [...operationRows.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
            const persistedResults = JSON.parse(persistedRow?.results_json || '[]');
            assert.equal(persistedResults[0]?.status, 'removing', 'durable state must be persisted before WhatsApp is called');
          }
          const applyRemoval = () => {
            removedParticipantIds.push(...ids);
            members = members.filter((member) => !ids.includes(member.id));
            return { status: 200 };
          };
          if (options.removeMode === 'delay-after-timeout') {
            return new Promise((resolve) => setTimeout(() => resolve(applyRemoval()), options.delayedRemovalMs || 30));
          }
          if (options.removeMode === 'reject-after-remove') { applyRemoval(); throw new Error('simulated acknowledgement loss'); }
          if (options.removeMode === 'reject') throw new Error('simulated RPC rejection');
          return applyRemoval();
        },
      },
    };
  };
  let pendingWork = null;
  registerZeroBalanceGroupRemovalRoutes(app, {
    db,
    requireOwnerAdmin: ownerGuard,
    adminMutationLimiter: mutationLimiter,
    adminReadLimiter: readLimiter,
    configuredRuntimeGroupId: () => GROUP_ID,
    isConfiguredGroup: (id) => id === GROUP_ID,
    isReady: () => true,
    getConnectionGeneration: () => connectionGeneration,
    readGroupRemovalContext: async () => {
      contextReadCount += 1;
      if (contextReadCount === options.failContextReadAt) throw new Error('simulated group verification failure');
      if (contextReadCount === options.pauseContextReadAt) await contextReadGate;
      return context();
    },
    readGroupSnapshot: async () => snapshot(),
    connectedBotPhone: () => BOT_PHONE,
    serializedWhatsappUserId,
    phoneWithCountry,
    isValidJordanPhone: (phone) => /^9627\d{8}$/.test(phone),
    isBlockedPhone: () => false,
    isProtectedOwnerIdentity: (phone) => phone === BOT_PHONE || phone === OWNER_PHONE,
    audit: (...args) => {
      if (options.bumpGenerationOnAuditEvent === args[0]) connectionGeneration += 1;
      if (options.failAuditEvent === args[0]) throw new Error('simulated audit failure');
      auditEvents.push(args);
    },
    now: () => new Date().toISOString(),
    removeRpcTimeoutMs: options.removeRpcTimeoutMs,
    sleep: async () => {},
    runInBackground: (work) => { pendingWork = work(); },
  });

  function route(method, path) {
    const handlers = routes.get(`${method} ${path}`);
    assert.ok(handlers, `missing route ${method} ${path}`);
    assert.equal(handlers[0], ownerGuard, 'all new routes must be owner-only');
    assert.equal(handlers[1], method === 'GET' ? readLimiter : mutationLimiter);
    return handlers.at(-1);
  }
  function response() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
  }
  return { route, response, users, removedParticipantIds, dbMutations, accountFinancialWrites, operationRows, auditEvents, releaseContextRead, setConnectionGeneration: (value) => { connectionGeneration = value; }, getPendingWork: () => pendingWork, groupId: GROUP_ID };
}

(async () => {
  const harness = makeHarness({ assertPersistedRemoving: true });
  const previewRes = harness.response();
  await harness.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: harness.groupId } }, previewRes);
  assert.equal(previewRes.statusCode, 200);
  assert.equal(previewRes.body.mutation, 'none');
  assert.equal(previewRes.body.financialMutation, false);
  assert.equal(previewRes.body.accountMutation, false);
  assert.deepEqual(previewRes.body.candidates.map((candidate) => candidate.captainId), [1], 'only exact-zero, non-protected, non-admin group members are eligible');
  assert.equal(previewRes.body.summary.admins, 2);
  assert.equal(previewRes.body.summary.protected, 1);
  assert.equal(previewRes.body.summary.unresolved, 1, 'unresolved LID must never be guessed into a phone match');
  assert.equal(harness.removedParticipantIds.length, 0, 'preview must be read-only');

  const executeRes = harness.response();
  await harness.route('POST', '/api/admin/group/zero-balance-removals/execute')({
    body: {
      groupId: harness.groupId,
      previewId: previewRes.body.previewId,
      fingerprint: previewRes.body.fingerprint,
      expectedCount: previewRes.body.summary.count,
      confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
    },
  }, executeRes);
  assert.equal(executeRes.statusCode, 202);
  assert.equal(executeRes.body.accountMutation, false);
  assert.equal(executeRes.body.financialMutation, false);
  await harness.getPendingWork();

  const statusRes = harness.response();
  harness.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: executeRes.body.operationId } }, statusRes);
  assert.equal(statusRes.body.operation.status, 'succeeded');
  assert.equal(statusRes.body.operation.removed, 1);
  assert.deepEqual(harness.removedParticipantIds, ['962790000001@c.us']);
  assert.equal(harness.accountFinancialWrites.length, 0, 'no account or financial table writes are allowed');
  assert.ok(harness.dbMutations.every((sql) => /group_zero_balance_removal_operations/i.test(sql)), 'only the dedicated operation status table may be created');

  const stale = makeHarness();
  const stalePreview = stale.response();
  await stale.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: stale.groupId } }, stalePreview);
  stale.users[0].wallet_cents = 1;
  const staleExecute = stale.response();
  await stale.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    groupId: stale.groupId,
    previewId: stalePreview.body.previewId,
    fingerprint: stalePreview.body.fingerprint,
    expectedCount: stalePreview.body.summary.count,
    confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, staleExecute);
  assert.equal(staleExecute.statusCode, 409, 'changed balance must invalidate the preview');
  assert.equal(stale.removedParticipantIds.length, 0, 'a stale preview must not remove anyone');

  const concurrent = makeHarness({ pauseContextReadAt: 2 });
  const concurrentPreview = concurrent.response();
  await concurrent.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: concurrent.groupId } }, concurrentPreview);
  const concurrentBody = {
    previewId: concurrentPreview.body.previewId,
    fingerprint: concurrentPreview.body.fingerprint,
    expectedCount: concurrentPreview.body.summary.count,
    confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  };
  const firstConcurrentResponse = concurrent.response();
  const firstConcurrentPromise = concurrent.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: concurrentBody }, firstConcurrentResponse);
  const competingResponse = concurrent.response();
  await concurrent.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: concurrentBody }, competingResponse);
  assert.equal(competingResponse.statusCode, 409, 'a second request must be blocked while the first revalidates');
  concurrent.releaseContextRead();
  await firstConcurrentPromise;
  await concurrent.getPendingWork();
  assert.equal(firstConcurrentResponse.statusCode, 202);
  assert.equal(concurrent.removedParticipantIds.length, 1, 'the same preview must not run two removals');

  const uncertain = makeHarness({ failContextReadAt: 4 });
  const uncertainPreview = uncertain.response();
  await uncertain.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: uncertain.groupId } }, uncertainPreview);
  const uncertainExecute = uncertain.response();
  await uncertain.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    previewId: uncertainPreview.body.previewId,
    fingerprint: uncertainPreview.body.fingerprint,
    expectedCount: uncertainPreview.body.summary.count,
    confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, uncertainExecute);
  await uncertain.getPendingWork();
  const uncertainStatus = uncertain.response();
  uncertain.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: uncertainExecute.body.operationId } }, uncertainStatus);
  assert.equal(uncertainStatus.body.operation.status, 'uncertain');
  assert.equal(uncertainStatus.body.operation.results[0].status, 'unknown');
  const uncertainAudit = uncertain.auditEvents.find((event) => event[0] === 'group.zero_balance_member.removal_unknown');
  assert.equal(uncertainAudit[3].groupMembershipChanged, 'unknown', 'audit must not claim that an unverified request left membership unchanged');
  assert.equal(uncertainStatus.body.operation.accountMutation, false);
  assert.equal(uncertainStatus.body.operation.financialMutation, false);

  const restarted = makeHarness({ operationRows: harness.operationRows });
  const restartedStatus = restarted.response();
  restarted.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: {} }, restartedStatus);
  assert.equal(restartedStatus.body.operation.operationId, executeRes.body.operationId);
  assert.equal(restartedStatus.body.operation.status, 'succeeded', 'completed status must survive a process restart');

  const interruptedRow = {
    operation_id: 'ZBGR-INTERRUPTED', group_id: GROUP_ID, status: 'running', created_at: '2026-11-17T18:00:00.000Z', updated_at: '2026-11-17T18:00:01.000Z',
    started_at: '2026-11-17T18:00:00.000Z', finished_at: null, requested: 2, completed: 0, removed: 0, failed: 0, skipped: 0, unknown: 0,
    audit_failure: null, results_json: JSON.stringify([
      { captainId: 1, name: 'Zero Candidate', phone: '962790000001', status: 'removing', error: null },
      { captainId: 8, name: 'Second Zero', phone: '962790000008', status: 'pending', error: null },
    ]), account_mutation: 0, financial_mutation: 0,
  };
  const interruptedRows = new Map([['ZBGR-INTERRUPTED', interruptedRow]]);
  interruptedRows.set('ZBGR-QUEUED', { ...interruptedRow, operation_id: 'ZBGR-QUEUED', status: 'queued', created_at: '2026-11-17T17:59:00.000Z', updated_at: '2026-11-17T17:59:00.000Z', started_at: null, results_json: JSON.stringify([
    { captainId: 1, name: 'Zero Candidate', phone: '962790000001', status: 'pending', error: null },
  ]) });
  for (let i = 1; i <= 6; i += 1) {
    interruptedRows.set(`ZBGR-FINISHED-${i}`, { ...interruptedRow, operation_id: `ZBGR-FINISHED-${i}`, status: 'succeeded', created_at: `2026-11-17T18:0${i}:00.000Z`, updated_at: `2026-11-17T18:0${i}:01.000Z`, finished_at: `2026-11-17T18:0${i}:01.000Z`, results_json: '[]' });
  }
  const recovered = makeHarness({ operationRows: interruptedRows });
  const recoveredStatus = recovered.response();
  recovered.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: 'ZBGR-INTERRUPTED' } }, recoveredStatus);
  assert.equal(recoveredStatus.body.operation.status, 'uncertain', 'an interrupted removal must be restored as uncertain');
  assert.equal(recoveredStatus.body.operation.results[0].status, 'unknown');
  assert.equal(recoveredStatus.body.operation.results[1].status, 'skipped');
  assert.equal(interruptedRows.get('ZBGR-INTERRUPTED').status, 'uncertain', 'recovery must include active operations older than the latest five rows');
  const recoveredQueued = recovered.response();
  recovered.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: 'ZBGR-QUEUED' } }, recoveredQueued);
  assert.equal(recoveredQueued.body.operation.status, 'stopped', 'a queued operation must also be recovered after restart');
  assert.equal(recoveredQueued.body.operation.results[0].status, 'skipped');

  const timeout = makeHarness({ includeSecondCandidate: true, removeMode: 'delay-after-timeout', removeRpcTimeoutMs: 5, delayedRemovalMs: 30 });
  const timeoutPreview = timeout.response();
  await timeout.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: timeout.groupId } }, timeoutPreview);
  assert.equal(timeoutPreview.body.summary.count, 2);
  const timeoutExecute = timeout.response();
  await timeout.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    previewId: timeoutPreview.body.previewId, fingerprint: timeoutPreview.body.fingerprint,
    expectedCount: timeoutPreview.body.summary.count, confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, timeoutExecute);
  await timeout.getPendingWork();
  const timeoutStatus = timeout.response();
  timeout.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: timeoutExecute.body.operationId } }, timeoutStatus);
  assert.equal(timeoutStatus.body.operation.status, 'uncertain');
  assert.equal(timeoutStatus.body.operation.results[0].status, 'unknown');
  assert.equal(timeoutStatus.body.operation.results[1].status, 'skipped', 'no next member may be removed after an uncertain RPC');
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(timeout.removedParticipantIds, ['962790000001@c.us'], 'a late RPC must not be falsely reported as a confirmed failure');

  const rejectedAfterRemoval = makeHarness({ removeMode: 'reject-after-remove' });
  const rejectedPreview = rejectedAfterRemoval.response();
  await rejectedAfterRemoval.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: rejectedAfterRemoval.groupId } }, rejectedPreview);
  const rejectedExecute = rejectedAfterRemoval.response();
  await rejectedAfterRemoval.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    previewId: rejectedPreview.body.previewId, fingerprint: rejectedPreview.body.fingerprint,
    expectedCount: rejectedPreview.body.summary.count, confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, rejectedExecute);
  await rejectedAfterRemoval.getPendingWork();
  const rejectedStatus = rejectedAfterRemoval.response();
  rejectedAfterRemoval.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: rejectedExecute.body.operationId } }, rejectedStatus);
  assert.equal(rejectedStatus.body.operation.status, 'succeeded', 'a rejected acknowledgement is still a confirmed removal only after exact live-state verification');
  assert.equal(rejectedStatus.body.operation.results[0].status, 'removed');

  const rejectedWithoutRemoval = makeHarness({ removeMode: 'reject' });
  const rejectedNoEffectPreview = rejectedWithoutRemoval.response();
  await rejectedWithoutRemoval.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: rejectedWithoutRemoval.groupId } }, rejectedNoEffectPreview);
  const rejectedNoEffectExecute = rejectedWithoutRemoval.response();
  await rejectedWithoutRemoval.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    previewId: rejectedNoEffectPreview.body.previewId, fingerprint: rejectedNoEffectPreview.body.fingerprint,
    expectedCount: rejectedNoEffectPreview.body.summary.count, confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, rejectedNoEffectExecute);
  await rejectedWithoutRemoval.getPendingWork();
  const rejectedNoEffectStatus = rejectedWithoutRemoval.response();
  rejectedWithoutRemoval.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: rejectedNoEffectExecute.body.operationId } }, rejectedNoEffectStatus);
  assert.equal(rejectedNoEffectStatus.body.operation.status, 'uncertain', 'RPC rejection without an exclusive live-state diff is not a confirmed failure');
  assert.equal(rejectedNoEffectStatus.body.operation.results[0].status, 'unknown');

  const auditFailure = makeHarness({ includeSecondCandidate: true, failAuditEvent: 'group.zero_balance_member.removal_requested' });
  const auditPreview = auditFailure.response();
  await auditFailure.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: auditFailure.groupId } }, auditPreview);
  const auditExecute = auditFailure.response();
  await auditFailure.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    previewId: auditPreview.body.previewId, fingerprint: auditPreview.body.fingerprint,
    expectedCount: auditPreview.body.summary.count, confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, auditExecute);
  await auditFailure.getPendingWork();
  const auditStatus = auditFailure.response();
  auditFailure.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: auditExecute.body.operationId } }, auditStatus);
  assert.equal(auditStatus.body.operation.results[0].status, 'failed');
  assert.equal(auditStatus.body.operation.results[1].status, 'skipped');
  assert.equal(auditFailure.removedParticipantIds.length, 0, 'a failed audit write must stop before any WhatsApp removal');

  const reconnect = makeHarness({ pauseContextReadAt: 2, incrementGenerationOnRelease: true });
  const reconnectPreview = reconnect.response();
  await reconnect.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: reconnect.groupId } }, reconnectPreview);
  const reconnectExecute = reconnect.response();
  const reconnectPromise = reconnect.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    previewId: reconnectPreview.body.previewId, fingerprint: reconnectPreview.body.fingerprint,
    expectedCount: reconnectPreview.body.summary.count, confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, reconnectExecute);
  reconnect.releaseContextRead();
  await reconnectPromise;
  assert.equal(reconnectExecute.statusCode, 409, 'a connection-generation change during group reads must abort before removal');
  assert.equal(reconnect.removedParticipantIds.length, 0);

  const reconnectAtRpc = makeHarness({ bumpGenerationOnAuditEvent: 'group.zero_balance_member.removal_requested' });
  const reconnectAtRpcPreview = reconnectAtRpc.response();
  await reconnectAtRpc.route('POST', '/api/admin/group/zero-balance-removals/preview')({ body: { groupId: reconnectAtRpc.groupId } }, reconnectAtRpcPreview);
  const reconnectAtRpcExecute = reconnectAtRpc.response();
  await reconnectAtRpc.route('POST', '/api/admin/group/zero-balance-removals/execute')({ body: {
    previewId: reconnectAtRpcPreview.body.previewId, fingerprint: reconnectAtRpcPreview.body.fingerprint,
    expectedCount: reconnectAtRpcPreview.body.summary.count, confirmation: 'REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1',
  } }, reconnectAtRpcExecute);
  await reconnectAtRpc.getPendingWork();
  const reconnectAtRpcStatus = reconnectAtRpc.response();
  reconnectAtRpc.route('GET', '/api/admin/group/zero-balance-removals/status')({ query: { operationId: reconnectAtRpcExecute.body.operationId } }, reconnectAtRpcStatus);
  assert.equal(reconnectAtRpcStatus.body.operation.results[0].status, 'skipped', 'connection generation must be rechecked after audit and before WhatsApp call');
  assert.equal(reconnectAtRpc.removedParticipantIds.length, 0);

  for (const page of ['public/index.html', 'admin.html', 'public/admin-v26.html']) {
    const html = fs.readFileSync(page, 'utf8');
    assert.match(html, /zero-balance-removals\/preview/, `${page} must call the preview API`);
    assert.match(html, /zero-balance-removals\/execute/, `${page} must call the owner-confirmed execute API`);
    assert.match(html, /إزالة من القروب فقط/, `${page} must describe the group-only action`);
    assert.match(html, /uncertain:'النتيجة غير محسومة'/, `${page} must label an unverified operation as uncertain`);
    assert.match(html, /unknown:'تعذر التحقق'/, `${page} must label an unverified participant result accurately`);
    assert.match(html, /operation\.auditFailure/, `${page} must display an audit failure warning`);
    if (page === 'public/index.html') assert.match(html, /data-nav="whatsapp"[\s\S]*ops-zero-balance-preview/, 'the primary / page must expose the feature in the WhatsApp/group drawer');
  }

  console.log('zero-balance group-only removal preview/owner/zero-balance/revalidation/concurrency/uncertain-result/no-financial-mutation: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
