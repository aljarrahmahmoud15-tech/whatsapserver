'use strict';

const assert = require('node:assert/strict');

const WARNING = 0.80;
const CRITICAL = 0.90;

function indexedDbErrorIsActive(pageState) {
  const lastErrorAt = Date.parse(pageState?.lastError?.at || '');
  const lastResultAt = Date.parse(pageState?.lastResult?.at || '');
  if (!pageState?.lastError || !Number.isFinite(lastErrorAt)) return false;
  return !Number.isFinite(lastResultAt) || lastErrorAt >= lastResultAt;
}

function createPressureState() {
  return {
    status: 'unknown',
    blocked: false,
    reason: null,
    usageBytes: null,
    quotaBytes: null,
    usageRatio: null,
    databaseCount: null,
    lastCheckedAt: null,
    lastErrorAt: null,
    alertState: null,
    blockedAttempts: 0,
  };
}

function updatePressure(state, snapshot) {
  const usageRatio = Number.isFinite(Number(snapshot?.usageRatio)) ? Number(snapshot.usageRatio) : null;
  const quotaError = indexedDbErrorIsActive(snapshot?.pageState);
  let status = 'unknown';
  let reason = null;
  if (quotaError) {
    status = 'critical';
    reason = 'QuotaExceededError/IndexedDB send failure';
  } else if (usageRatio !== null && usageRatio >= CRITICAL) {
    status = 'critical';
    reason = `IndexedDB usage ${(usageRatio * 100).toFixed(1)}%`;
  } else if (usageRatio !== null && usageRatio >= WARNING) {
    status = 'warning';
    reason = `IndexedDB usage ${(usageRatio * 100).toFixed(1)}%`;
  } else if (usageRatio !== null) {
    status = 'normal';
  }
  return {
    ...state,
    status,
    blocked: status === 'critical',
    reason,
    usageRatio,
    usageBytes: snapshot?.usageBytes ?? null,
    quotaBytes: snapshot?.quotaBytes ?? null,
    databaseCount: snapshot?.databaseCount ?? null,
    lastErrorAt: snapshot?.pageState?.lastError?.at || null,
    alertState: status === 'critical' ? 'critical' : null,
  };
}

function installGuard(instance, getPressure, setPressure) {
  const originalSendMessage = instance.sendMessage.bind(instance);
  instance.sendMessage = async (...args) => {
    if (getPressure().blocked) {
      setPressure({ ...getPressure(), blockedAttempts: getPressure().blockedAttempts + 1 });
      const error = new Error('WhatsApp sending paused: IndexedDB storage pressure is critical');
      error.code = 'WHATSAPP_INDEXEDDB_SEND_PAUSED';
      throw error;
    }
    return originalSendMessage(...args);
  };
}

async function attemptSend(instance) {
  try {
    const result = await instance.sendMessage('simulation@g.us', 'NO_NETWORK_TEST');
    return { accepted: true, result };
  } catch (error) {
    return { accepted: false, code: error.code, message: error.message };
  }
}

async function main() {
  let pressure = createPressureState();
  let underlyingCalls = 0;
  const getPressure = () => pressure;
  const setPressure = (next) => { pressure = next; };
  const instance = {
    async sendMessage() {
      underlyingCalls += 1;
      return { id: 'underlying-send-must-not-run-when-blocked' };
    },
  };
  installGuard(instance, getPressure, setPressure);

  pressure = updatePressure(pressure, { usageRatio: 0.8999, usageBytes: 8999, quotaBytes: 10000, databaseCount: 14 });
  const belowThreshold = await attemptSend(instance);
  assert.equal(pressure.status, 'warning');
  assert.equal(pressure.blocked, false);
  assert.equal(belowThreshold.accepted, true);
  assert.equal(underlyingCalls, 1);

  pressure = updatePressure(pressure, { usageRatio: 0.90, usageBytes: 9000, quotaBytes: 10000, databaseCount: 14 });
  const atThreshold = await attemptSend(instance);
  assert.equal(pressure.status, 'critical');
  assert.equal(pressure.blocked, true);
  assert.equal(atThreshold.accepted, false);
  assert.equal(atThreshold.code, 'WHATSAPP_INDEXEDDB_SEND_PAUSED');
  assert.equal(pressure.blockedAttempts, 1);
  assert.equal(underlyingCalls, 1, 'the underlying WhatsApp send must not run at the critical threshold');

  const quotaTimestamp = '2026-09-23T02:17:00.000Z';
  pressure = updatePressure(pressure, {
    usageRatio: 0.40,
    usageBytes: 4000,
    quotaBytes: 10000,
    databaseCount: 14,
    pageState: { lastError: { at: quotaTimestamp, message: 'QuotaExceededError' }, lastResult: null },
  });
  const quotaErrorCase = await attemptSend(instance);
  assert.equal(pressure.status, 'critical');
  assert.equal(pressure.blocked, true);
  assert.equal(pressure.reason, 'QuotaExceededError/IndexedDB send failure');
  assert.equal(quotaErrorCase.code, 'WHATSAPP_INDEXEDDB_SEND_PAUSED');
  assert.equal(pressure.blockedAttempts, 2);
  assert.equal(underlyingCalls, 1);

  pressure = updatePressure(pressure, { usageRatio: 0.70, usageBytes: 7000, quotaBytes: 10000, databaseCount: 14 });
  const recovered = await attemptSend(instance);
  assert.equal(pressure.status, 'normal');
  assert.equal(pressure.blocked, false);
  assert.equal(recovered.accepted, true);
  assert.equal(underlyingCalls, 2);

  const report = {
    mode: 'local-only-no-network-no-render-no-whatsapp-no-sqlite',
    threshold: '90%',
    scenarios: {
      belowThreshold: { ratio: 0.8999, status: 'warning', blocked: false, sendAccepted: belowThreshold.accepted },
      atThreshold: { ratio: 0.90, status: 'critical', blocked: true, sendAccepted: atThreshold.accepted, errorCode: atThreshold.code },
      quotaExceededError: { ratio: 0.40, status: 'critical', blocked: true, sendAccepted: quotaErrorCase.accepted, errorCode: quotaErrorCase.code },
      recovery: { ratio: 0.70, status: 'normal', blocked: false, sendAccepted: recovered.accepted },
    },
    underlyingCalls,
    blockedAttempts: pressure.blockedAttempts,
    financialMutations: 0,
    networkCalls: 0,
    conclusion: 'At 90% and on an active QuotaExceededError, the guard rejects the send before the underlying WhatsApp send function is called; below critical pressure, sending is allowed again.',
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
