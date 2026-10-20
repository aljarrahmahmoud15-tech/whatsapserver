'use strict';
/**
 * Independent WhatsApp client process for the Clean service.
 *
 * The main API process no longer loads whatsapp-web.js: it spawns this worker,
 * which owns the Puppeteer browser, the LocalAuth session on the same persistent
 * disk (so no new QR is needed) and every page interaction. Communication is
 * JSON over the child-process channel:
 *
 *   worker -> parent : { kind: "event", name, payload } | { kind: "online" } | { kind: "fatal", error }
 *   parent -> worker : { id, method, args }   ->   { id, ok, result } | { id, ok: false, error }
 *
 * The worker never touches the database and never sends anything on its own: it
 * only executes what the API asks for and forwards events.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');

const config = JSON.parse(process.env.WHATSAPP_WORKER_CONFIG || '{}');
const send = (message) => {
  if (process.send) process.send(message);
};

let client = null;
const registry = new Map();
let nextHandle = 1;

const DATA_KEYS = [
  'id', 'name', 'isGroup', 'body', 'from', 'to', 'fromMe', 'author', 'timestamp', 't', 'type',
  'hasReaction', 'hasQuotedMsg', 'quotedStanzaID', 'quotedMessageId', 'participants', 'pushname',
  'number', 'shortName', 'isMyContact', 'formattedTitle', 'caption', 'text', 'ack', 'isNotification',
  'isStatus', 'broadcast', 'subtype', 'chatId', 'message', 'reactions', 'isMedia', 'hasMedia', 'mediaKey',
  'isAdmin', 'isSuperAdmin', 'user', 'server', 'wid', 'isLid', 'notifyName', 'verifiedName', 'about',
  'participantSource', 'participantRawCount', 'groupMetadata', 'mimetype', 'filename', 'sender',
];

function widSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const serialized = value._serialized || (value.user && value.server ? `${value.user}@${value.server}` : null) || (typeof value.toString === 'function' ? String(value) : null);
  if (!serialized) return null;
  return { __wid: { _serialized: String(serialized), user: value.user ? String(value.user) : null, server: value.server ? String(value.server) : null } };
}

function snapshot(value, depth = 0) {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return Number(value);
  if (type === 'function') return undefined;
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return depth > 3 ? [] : value.slice(0, 500).map((item) => snapshot(item, depth + 1));
  if (type !== 'object') return String(value);

  const wid = widSnapshot(value);
  if (wid && !value.serialize && !value.participants) return wid;

  const handle = `h${nextHandle++}`;
  registry.set(handle, value);
  const out = { __handle: handle, __kind: value.constructor ? value.constructor.name : 'object' };
  if (wid) out.id = wid.__wid;
  for (const key of DATA_KEYS) {
    if (key === 'id' && out.id) continue;
    let raw;
    try { raw = value[key]; } catch (_) { continue; }
    if (raw === undefined || typeof raw === 'function') continue;
    try { out[key] = depth > 3 ? undefined : snapshot(raw, depth + 1); } catch (_) { /* skip unserializable */ }
    if (out[key] === undefined) delete out[key];
  }
  try {
    if (typeof value.serialize === 'function' && out.body === undefined) {
      const serialized = value.serialize();
      for (const key of ['body', 'from', 'to', 'fromMe', 'timestamp', 'type', 'hasMedia']) {
        if (out[key] === undefined && serialized[key] !== undefined) out[key] = snapshot(serialized[key], depth + 1);
      }
    }
  } catch (_) { /* ignore */ }
  return out;
}

function resolveHandle(handle) {
  const entry = registry.get(handle);
  if (!entry) throw new Error(`unknown_handle:${handle}`);
  return entry;
}

function reviveArg(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth > 6) return null;
  if (value.__handleRef) return resolveHandle(value.__handleRef).obj ?? resolveHandle(value.__handleRef);
  if (Array.isArray(value)) return value.map((item) => reviveArg(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = reviveArg(item, depth + 1);
  return out;
}

function resolveTarget(handle, method) {
  const base = handle === 'client' ? client : resolveHandle(handle);
  if (!base) throw new Error('client_not_ready');
  // InterfaceController methods live on client.interface, not on the client itself.
  if (method.startsWith('interface.')) {
    const name = method.slice('interface.'.length);
    if (!base.interface || typeof base.interface[name] !== 'function') throw new Error(`unknown_method:${method}`);
    return { target: base.interface, fn: base.interface[name] };
  }
  const fn = base[method];
  if (typeof fn !== 'function') throw new Error(`unknown_method:${method}`);
  return { target: base, fn };
}

async function invoke(handle, method, args) {
  const { target, fn } = resolveTarget(handle, method);
  const revived = Array.isArray(args) ? args.map((item) => reviveArg(item)) : [];
  const result = await fn.apply(target, revived);
  return snapshot(result);
}

async function pageEvaluate(fnSource, args) {
  if (!client || !client.pupPage) throw new Error('page_unavailable');
  // eslint-disable-next-line no-eval
  const fn = (0, eval)(`(${fnSource})`);
  const result = await client.pupPage.evaluate(fn, ...(args || []));
  return snapshot(result);
}

const EVENT_NAMES = [
  'qr', 'ready', 'authenticated', 'auth_failure', 'disconnected', 'change_state', 'loading_screen',
  'message', 'message_create', 'message_ack', 'message_reaction', 'message_revoke_everyone',
  'group_join', 'group_leave', 'group_update', 'group_admin_changed', 'contact_changed',
  'media_uploaded', 'remote_session_saved', 'unread_count', 'vote_update', 'call',
];

function attachEvents() {
  for (const name of EVENT_NAMES) {
    client.on(name, (...payload) => {
      let serialized;
      try {
        serialized = payload.map((item) => {
          if (typeof item === 'string' || typeof item === 'number' || item === null || item === undefined) return item;
          return snapshot(item);
        });
      } catch (error) {
        serialized = [{ __serializeError: String((error && error.message) || error) }];
      }
      send({ kind: 'event', name, payload: serialized });
    });
  }
}

function clientInfo() {
  try {
    if (!client || !client.info) return null;
    return snapshot({ id: client.info.wid, wid: client.info.wid, pushname: client.info.pushname, platform: client.info.platform, phone: client.info.phone });
  } catch (_) { return null; }
}

function start() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: config.clientId, dataPath: config.authPath }),
    puppeteer: config.puppeteer || { headless: true, args: ['--no-sandbox'] },
    ...(config.webCache ? { webVersionCache: config.webCache } : {}),
    ...(config.deviceName ? { deviceName: config.deviceName } : {}),
    ...(config.browserName ? { browserName: config.browserName } : {}),
  });
  attachEvents();
  client.on('ready', () => send({ kind: 'ready', info: clientInfo() }));
  send({ kind: 'online', pid: process.pid });
  client.initialize().catch((error) => {
    send({ kind: 'fatal', error: String((error && error.message) || error) });
  });
}

process.on('message', async (message) => {
  if (!message || typeof message !== 'object') return;
  const { id, method, args } = message;
  try {
    let result;
    switch (method) {
      case 'initialize':
        start();
        result = { started: true };
        break;
      case 'invoke':
        result = await invoke(message.handle || 'client', message.target, message.args);
        break;
      case 'pageEvaluate':
        result = await pageEvaluate(args && args.fn, args && args.args);
        break;
      case 'info':
        result = clientInfo();
        break;
      case 'state':
        result = { state: client ? await client.getState().catch(() => null) : null, hasPage: Boolean(client && client.pupPage) };
        break;
      case 'destroy':
        try { if (client) await client.destroy(); } catch (_) { /* best effort */ }
        result = { destroyed: true };
        setTimeout(() => process.exit(0), 200);
        break;
      case 'shutdown':
        setTimeout(() => process.exit(0), 50);
        result = { shuttingDown: true };
        break;
      default:
        throw new Error(`unknown_rpc:${method}`);
    }
    if (id !== undefined) send({ id, ok: true, result });
  } catch (error) {
    if (id !== undefined) {
      // Include where the failure came from: a minified one-letter message means the
      // page rejected it, a bridge failure names itself explicitly.
      const origin = String((error && error.stack) || "").split("\n")[1] || "";
      send({ id, ok: false, error: `${String(method || 'call')}:${String((error && error.message) || error)}|${origin.trim().slice(0, 90)}` });
    }
  }
});

process.on('uncaughtException', (error) => {
  send({ kind: 'fatal', error: `uncaught:${String((error && error.message) || error)}` });
});
process.on('unhandledRejection', (error) => {
  send({ kind: 'fatal', error: `unhandled:${String((error && error.message) || error)}` });
});

send({ kind: 'boot', pid: process.pid, ready: false });