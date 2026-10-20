const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWhatsAppWorkerBridge } = require('./whatsapp-worker-bridge');

// A stub worker stands in for the real one: it proves the transport, the snapshot
// revival and the event forwarding without needing WhatsApp or a browser.
const stubPath = path.join(os.tmpdir(), `clean-worker-stub-${process.pid}.js`);
fs.writeFileSync(stubPath, `
const send = (m) => { try { if (process.connected && process.send) process.send(m); } catch (_) {} };
send({ kind: 'boot' });
process.on('message', async (msg) => {
  if (msg.method === 'initialize') { send({ kind: 'online' }); setTimeout(() => send({ kind: 'event', name: 'ready', payload: [{ wid: { _serialized: '962797907580@c.us', user: '962797907580', server: 'c.us' } }] }), 30); return send({ id: msg.id, ok: true, result: { started: true } }); }
  if (msg.method === 'invoke') {
    if (msg.target === 'getChatById') return send({ id: msg.id, ok: true, result: { __handle: 'h1', __kind: 'Chat', id: { __wid: { _serialized: '120363430477331505@g.us', user: '120363430477331505', server: 'g.us' } }, name: 'TAKE&GO الشمال', isGroup: true, participants: [{ __handle: 'h2', __kind: 'Participant', id: { __wid: { _serialized: '962799999999@c.us', user: '962799999999', server: 'c.us' } }, isAdmin: false }] } });
    if (msg.target === 'sendMessage') return send({ id: msg.id, ok: true, result: { __handle: 'h3', __kind: 'Message', id: { __wid: { _serialized: 'MID1', user: 'MID1', server: 'c.us' } }, body: String(msg.args[0] || ''), fromMe: true } });
    if (msg.target === 'boom') return send({ id: msg.id, ok: false, error: 'stub_failure' });
    return send({ id: msg.id, ok: true, result: { echoed: msg.target, args: msg.args } });
  }
  if (msg.method === 'pageEvaluate') return send({ id: msg.id, ok: true, result: { ran: String(msg.args.fn).includes('return 41 + 1'), args: msg.args.args } });
  if (msg.method === 'info') return send({ id: msg.id, ok: true, result: { wid: { _serialized: '962797907580@c.us', user: '962797907580', server: 'c.us' }, pushname: 'Clean' } });
  if (msg.method === 'destroy' || msg.method === 'shutdown') { send({ id: msg.id, ok: true, result: { done: true } }); setTimeout(() => process.exit(0), 20); return; }
  send({ id: msg.id, ok: false, error: 'unknown_rpc' });
});
`);

(async () => {
  const events = [];
  const bridge = createWhatsAppWorkerBridge({ scriptPath: stubPath, config: { clientId: 'test' } });
  bridge.on('ready', (info) => events.push(['ready', info]));
  bridge.on('message', (msg) => events.push(['message', msg]));

  await bridge.initialize();

  // Unknown members are remote methods, and known members stay real values.
  const chat = await bridge.getChatById('120363430477331505@g.us');
  assert.equal(chat.name, 'TAKE&GO الشمال');
  assert.equal(chat.isGroup, true);
  assert.equal(chat.id._serialized, '120363430477331505@g.us');
  assert.equal(String(chat.id), '120363430477331505@g.us');
  assert.equal(chat.participants.length, 1);
  assert.equal(chat.participants[0].id._serialized, '962799999999@c.us');
  assert.equal(chat.participants[0].isAdmin, false);

  // Methods on a returned object are forwarded on demand.
  const sent = await chat.sendMessage('مرحبا');
  assert.equal(sent.body, 'مرحبا');
  assert.equal(sent.fromMe, true);

  // Page work is proxied as source + args.
  const pageResult = await bridge.pupPage.evaluate(() => { return 41 + 1; }, 'arg1');
  assert.equal(pageResult.ran, true);
  assert.deepEqual(pageResult.args, ['arg1']);

  // Worker failures surface as rejections, not silent successes.
  await assert.rejects(() => bridge.boom(), /stub_failure/);

  // Events emitted by the worker reach the API listeners.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'ready');
  assert.equal(events[0][1].wid.user, '962797907580');

  // Info snapshots stay readable through the client.info contract.
  const info = await bridge.fetchInfo();
  assert.equal(info.wid._serialized, '962797907580@c.us');
  assert.equal(bridge.info.wid.user, '962797907580');

  const status = bridge.status();
  assert.equal(status.mode, 'worker');
  assert.ok(status.rpcCount >= 4);
  assert.equal(status.rpcFailures, 1);

  await bridge.destroy();
  assert.equal(bridge.child, null);
  assert.equal(bridge.status().state, 'stopped');

  // The API must never place the client in both modes at once.
  const server = fs.readFileSync('./server.js', 'utf8');
  assert.match(server, /const WHATSAPP_CLIENT_MODE = String\(process\.env\.WHATSAPP_CLIENT_MODE \|\| "inline"\)/);
  assert.match(server, /let whatsappClientModeActive = WHATSAPP_CLIENT_MODE;/);
  assert.match(server, /if \(whatsappClientModeActive === "worker"\) \{\n    instance = createWhatsAppWorkerBridge\(\{/);
  assert.match(server, /whatsappWorkerFallbackUsed = true;\n      whatsappClientModeActive = "inline";/);
  assert.match(server, /await withTimeout\(disposeClientInstance\(currentClient, "worker_fallback"\), 20000, null\);/);
  assert.match(server, /app\.get\("\/api\/admin\/whatsapp\/client-placement", requireAdmin/);
  // The worker owns the session on the same disk, so no new QR is required.
  const worker = fs.readFileSync('./whatsapp-worker.js', 'utf8');
  assert.match(worker, /new LocalAuth\(\{ clientId: config\.clientId, dataPath: config\.authPath \}\)/);
  assert.doesNotMatch(worker, /better-sqlite3|db\.prepare/);
  // The worker must not send anything on its own.
  assert.doesNotMatch(worker, /sendMessage\(/);

  fs.rmSync(stubPath, { force: true });
  console.log('Clean WhatsApp worker bridge verified: transport, snapshot revival, method forwarding, page proxy, events, failure surfacing, single-owner fallback');
})().catch((error) => {
  console.error('FAILED:', error && error.message);
  process.exit(1);
});