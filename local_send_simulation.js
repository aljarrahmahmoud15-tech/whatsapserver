#!/usr/bin/env node
'use strict';

/**
 * Local, network-free simulation of the admin WhatsApp send lifecycle.
 *
 * This file deliberately does not require server.js, start Express, launch
 * Chromium, read Render credentials, or touch SQLite. It reproduces only the
 * adapter boundary used by /api/admin/send:
 *
 *   getChatById -> chat.sendMessage -> client.sendMessage fallback
 *
 * It is intended to distinguish application routing/fallback problems from a
 * WhatsApp Web / Puppeteer error such as "r: r".
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GROUP_ID = '120363426604560611@g.us';
const ORDER_MESSAGE = 'السعر 12 من إربد إلى عمّان';
const CONTROL_MESSAGE = '🧪 اختبار اتصال محلي لا يرسل إلى WhatsApp ولا ينشئ حجزًا.';
const PUPPETEER_ERROR = 'r: r\n    at #evaluate (file:///app/node_modules/puppeteer-core/lib/puppeteer/cdp/ExecutionContext.js:402:19)';

function now() {
  return new Date().toISOString();
}

function makeMessage(id) {
  return { id: { _serialized: id }, body: 'simulated' };
}

function serializedMessageId(value) {
  return String(value?.id?._serialized || value?.id || '').trim() || null;
}

function makeError(message) {
  const error = new Error(message);
  error.stack = message;
  return error;
}

function createFakeClient({
  chat,
  chats = [],
  getChatByIdError = null,
  getChatsError = null,
  chatError = null,
  chatResult = makeMessage('simulated-chat-message'),
  clientError = null,
  clientResult = makeMessage('simulated-client-message'),
  settlementCalls,
}) {
  const calls = [];
  const fakeChat = chat === null
    ? null
    : {
        id: { _serialized: GROUP_ID },
        async sendMessage(message, options) {
          calls.push({ method: 'chat.sendMessage', message, options });
          if (chatError) throw chatError;
          return chatResult;
        },
      };

  const client = {
    async getChatById(chatId) {
      calls.push({ method: 'client.getChatById', chatId });
      if (getChatByIdError) throw getChatByIdError;
      return fakeChat;
    },
    async getChats() {
      calls.push({ method: 'client.getChats' });
      if (getChatsError) throw getChatsError;
      return chats;
    },
    async sendMessage(chatId, message, options) {
      calls.push({ method: 'client.sendMessage', chatId, message, options });
      if (clientError) throw clientError;
      return clientResult;
    },
    settlementCalls,
  };
  return { client, calls };
}

async function withTimeout(promise, timeoutMs, fallback) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The send adapter is intentionally shaped like the deployed route's
 * sendPromise. It returns a structured local result instead of an HTTP reply.
 */
async function simulateAdminSend({ client, chatId, message, timeoutMs = 1000, audit }) {
  const sendPromise = Promise.resolve().then(async () => {
    let chat = null;
    try {
      chat = typeof client.getChatById === 'function'
        ? await withTimeout(client.getChatById(chatId), 120, null)
        : null;
    } catch (error) {
      audit('getChatById.failed', { error: error.message });
    }

    if (!chat && typeof client.getChats === 'function') {
      try {
        const chats = await withTimeout(client.getChats(), 120, []);
        chat = (Array.isArray(chats) ? chats : []).find(
          (item) => String(item?.id?._serialized || item?.id || '') === chatId,
        ) || null;
      } catch (error) {
        audit('getChats.failed', { error: error.message });
      }
    }

    if (chat && typeof chat.sendMessage === 'function') {
      try {
        return await chat.sendMessage(message);
      } catch (chatError) {
        audit('chat.sendMessage.failed', { error: chatError.message });
        if (typeof client.sendMessage !== 'function') throw chatError;
        try {
          return await client.sendMessage(chatId, message);
        } catch (clientError) {
          clientError.cause = chatError;
          throw clientError;
        }
      }
    }

    return client.sendMessage(chatId, message);
  });

  const timeoutMarker = Symbol('timeout');
  try {
    const sent = await withTimeout(sendPromise, timeoutMs, timeoutMarker);
    if (sent === timeoutMarker) {
      audit('send.pending', { timeoutMs });
      return { sendState: 'pending', messageId: null, error: null };
    }
    const messageId = serializedMessageId(sent);
    if (messageId) {
      audit('send.confirmed', { messageId });
      return { sendState: 'confirmed', messageId, error: null };
    }
    audit('send.waiting_message_create', {});
    return { sendState: 'pending', messageId: null, error: null };
  } catch (error) {
    audit('send.failed', { error: error.message });
    return { sendState: 'failed', messageId: null, error: error.message };
  }
}

function makeScenario(name, setup, expected) {
  return { name, setup, expected };
}

async function runScenario(scenario) {
  const events = [];
  const settlementCalls = [];
  const audit = (event, details) => events.push({ at: now(), event, ...details });
  const { client, calls } = scenario.setup(settlementCalls);
  const result = await simulateAdminSend({
    client,
    chatId: GROUP_ID,
    message: scenario.message,
    audit,
  });

  assert.equal(result.sendState, scenario.expected.sendState, `${scenario.name}: send state`);
  assert.equal(Boolean(result.messageId), Boolean(scenario.expected.messageId), `${scenario.name}: message id presence`);
  assert.equal(settlementCalls.length, 0, `${scenario.name}: no settlement may occur in send simulation`);

  const sendCalls = calls.filter((call) => call.method.endsWith('sendMessage'));
  for (const call of sendCalls) {
    assert.equal(call.options, undefined, `${scenario.name}: no unstable waitUntilMsgSent option may be passed`);
  }

  return {
    name: scenario.name,
    message: scenario.message,
    result,
    calls,
    events,
    financialMutation: settlementCalls.length,
  };
}

async function main() {
  const scenarios = [
    makeScenario(
      'control-plain-text-succeeds',
      () => createFakeClient({
        chatResult: makeMessage('control-plain-001'),
        settlementCalls: [],
      }),
      { sendState: 'confirmed', messageId: true },
    ),
    makeScenario(
      'arabic-order-observed-production-error',
      () => createFakeClient({
        chatError: makeError(PUPPETEER_ERROR),
        clientError: makeError(PUPPETEER_ERROR),
        settlementCalls: [],
      }),
      { sendState: 'failed', messageId: false },
    ),
    makeScenario(
      'chat-fails-client-fallback-succeeds',
      () => createFakeClient({
        chatError: makeError('chat adapter unavailable'),
        clientResult: makeMessage('fallback-001'),
        settlementCalls: [],
      }),
      { sendState: 'confirmed', messageId: true },
    ),
    makeScenario(
      'chat-unavailable-getChats-fallback-succeeds',
      (settlementCalls) => {
        const fallback = createFakeClient({
          chat: null,
          chats: [{ id: { _serialized: GROUP_ID }, sendMessage: async (message, options) => {
            fallback.calls.push({ method: 'chat.sendMessage', message, options });
            return makeMessage('getchats-001');
          } }],
          settlementCalls,
        });
        return fallback;
      },
      { sendState: 'confirmed', messageId: true },
    ),
    makeScenario(
      'send-accepted-without-message-object',
      () => createFakeClient({
        chatResult: null,
        clientResult: null,
        settlementCalls: [],
      }),
      { sendState: 'pending', messageId: false },
    ),
  ];

  const results = [];
  for (const scenario of scenarios) {
    scenario.message = scenario.name.includes('order') ? ORDER_MESSAGE : CONTROL_MESSAGE;
    results.push(await runScenario(scenario));
  }

  const productionLike = results.find((row) => row.name === 'arabic-order-observed-production-error');
  const control = results.find((row) => row.name === 'control-plain-text-succeeds');
  assert.equal(productionLike.result.error.startsWith('r: r'), true, 'production-like error must remain visible');
  assert.equal(control.result.sendState, 'confirmed', 'control message must use the same adapter successfully');
  assert.equal(productionLike.financialMutation, 0, 'production-like failure must not mutate finances');
  assert.equal(productionLike.calls.filter((c) => c.method.endsWith('sendMessage')).length, 2, 'both primary and fallback must be observed');

  const report = {
    generatedAt: now(),
    mode: 'local-only-no-network-no-render-no-whatsapp-no-sqlite',
    groupId: GROUP_ID,
    orderMessage: ORDER_MESSAGE,
    conclusion: {
      localAdapterRouting: 'verified',
      productionErrorBoundary: 'chat.sendMessage/client.sendMessage adapter boundary',
      puppeteerErrorReproducedAsObservedInput: true,
      rootCauseProvenByLocalSimulation: false,
      why: 'The simulator can reproduce the state transition and fallback behavior, but it cannot execute WhatsApp Web internals. The r: r failure must be captured with browser-side diagnostics or a minimal real client probe.',
      settlementAttempted: false,
      walletMutation: false,
    },
    scenarios: results,
  };

  const reportPath = path.join(__dirname, 'local_send_simulation_report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    mode: report.mode,
    scenarioCount: results.length,
    productionLike: productionLike.result,
    control: control.result,
    financialMutations: results.reduce((sum, row) => sum + row.financialMutation, 0),
    conclusion: report.conclusion,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
