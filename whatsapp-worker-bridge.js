'use strict';
/**
 * Main-process bridge to the independent WhatsApp worker process.
 *
 * The bridge looks like a whatsapp-web.js client to the rest of the API: it is an
 * EventEmitter, it exposes initialize/destroy/info/pupPage/interface, and any other
 * method call is forwarded to the worker over the child-process channel. Returned
 * objects (chats, messages, contacts) come back as data snapshots whose methods are
 * forwarded on demand, so existing call sites keep working unchanged.
 *
 * Exactly one client may own the WhatsApp session: the caller must never run this
 * bridge and an in-process client at the same time.
 */
const path = require('path');
const { EventEmitter } = require('events');
const { fork } = require('child_process');

function reviveWid(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const serialized = String(raw._serialized || '');
  return {
    _serialized: serialized,
    user: raw.user || (serialized.includes('@') ? serialized.split('@')[0].split(':')[0] : null),
    server: raw.server || (serialized.includes('@') ? serialized.split('@')[1] : null),
    toString() { return this._serialized; },
  };
}

class WhatsAppWorkerBridge extends EventEmitter {
  constructor({ scriptPath, config, requestTimeoutMs = 120000, onFatal } = {}) {
    super();
    this.setMaxListeners(0);
    this.scriptPath = scriptPath || path.join(__dirname, 'whatsapp-worker.js');
    this.config = config || {};
    this.requestTimeoutMs = Math.max(5000, Number(requestTimeoutMs) || 120000);
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.infoSnapshot = null;
    this.workerState = 'stopped';
    this.lastError = null;
    this.startedAt = null;
    this.onFatal = typeof onFatal === 'function' ? onFatal : null;
    this.rpcCount = 0;
    this.rpcFailures = 0;
    this.failuresByMethod = new Map();
    this.lastFailure = null;
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver);
        if (prop === 'then') return undefined;
        // Unknown member: treat it as a remote client method.
        return (...args) => target.callClient(String(prop), args);
      },
    });
  }

  async initialize() {
    if (this.child) return { alreadyStarted: true };
    this.child = fork(this.scriptPath, [], {
      env: { ...process.env, WHATSAPP_WORKER_CONFIG: JSON.stringify(this.config) },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.workerState = 'starting';
    this.startedAt = new Date().toISOString();
    this.child.on('message', (message) => this.handleMessage(message));
    this.child.on('exit', (code, signal) => this.handleExit(code, signal));
    this.child.on('error', (error) => this.handleExit(null, `error:${String((error && error.message) || error)}`));
    await this.send('initialize', {});
    return { started: true, pid: this.child.pid };
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'event') {
      const payload = Array.isArray(message.payload) ? message.payload.map((item) => this.revive(item)) : [];
      if (message.name === 'ready') this.infoSnapshot = this.revive(message.payload && message.payload[0]);
      this.emit(message.name, ...payload);
      return;
    }
    if (message.kind === 'ready') {
      this.workerState = 'ready';
      this.infoSnapshot = this.revive(message.info);
      return;
    }
    if (message.kind === 'online') {
      this.workerState = 'online';
      return;
    }
    if (message.kind === 'fatal') {
      this.lastError = String(message.error || 'worker_fatal');
      this.workerState = 'fatal';
      this.emit('worker_fatal', this.lastError);
      if (this.onFatal) this.onFatal(this.lastError);
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) {
      entry.resolve(this.revive(message.result));
    } else {
      const failure = new Error(String(message.error || 'worker_rpc_failed'));
      this.recordFailure(entry.method, failure);
      entry.reject(failure);
    }
  }

  handleExit(code, signal) {
    const reason = `worker_exit code=${code} signal=${signal}`;
    this.workerState = 'stopped';
    this.child = null;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
    this.lastError = reason;
    this.emit('worker_exit', reason);
    if (this.onFatal) this.onFatal(reason);
  }

  // Objects that came from the worker travel back as handle references, so a value
  // received from one call can be passed straight into the next one.
  sanitizeArg(value, depth = 0) {
    if (value === null || value === undefined) return value;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'function') return undefined;
    if (type !== 'object') return value;
    if (depth > 6) return null;
    if (value.__handleRef) return { __handleRef: value.__handleRef };
    if (Array.isArray(value)) return value.slice(0, 200).map((item) => this.sanitizeArg(item, depth + 1));
    if (value instanceof Date) return value.toISOString();
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const clean = this.sanitizeArg(item, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  send(method, args, extra = {}) {
    if (!this.child) return Promise.reject(new Error('worker_not_started'));
    const id = this.nextId++;
    this.rpcCount += 1;
    const safeArgs = this.sanitizeArg(args);
    const safeExtra = this.sanitizeArg(extra) || {};
    // Report the target method, not just the envelope, so a failing WhatsApp call is
    // identifiable from the status endpoint.
    const label = extra && extra.target ? `${method}:${extra.target}` : method;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const failure = new Error(`worker_rpc_timeout:${method}`);
        this.recordFailure(label, failure);
        reject(failure);
      }, this.requestTimeoutMs);
      if (timer.unref) timer.unref();
      this.pending.set(id, { resolve, reject, timer, method: label });
      try {
        this.child.send({ id, method, args: safeArgs, ...safeExtra });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.recordFailure(label, error);
        reject(error);
      }
    });
  }

  recordFailure(method, error) {
    this.rpcFailures += 1;
    const label = String(method || 'unknown');
    this.failuresByMethod.set(label, (this.failuresByMethod.get(label) || 0) + 1);
    this.lastFailure = { method: label, error: String((error && error.message) || error).slice(0, 200), at: new Date().toISOString() };
  }

  callClient(method, args) {
    return this.send('invoke', undefined, { handle: 'client', target: method, args: Array.isArray(args) ? args : [] });
  }

  callRemote(handle, method, args) {
    return this.send('invoke', undefined, { handle, target: method, args: Array.isArray(args) ? args : [] });
  }

  revive(node) {
    if (node === null || node === undefined) return node;
    if (typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item) => this.revive(item));
    if (node.__wid) return reviveWid(node.__wid);
    if (node.__date) return new Date(node.__date);
    if (!node.__handle) {
      const out = {};
      for (const [key, value] of Object.entries(node)) out[key] = this.revive(value);
      return out;
    }
    const handle = node.__handle;
    const data = {};
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('__')) continue;
      data[key] = this.revive(value);
    }
    const bridge = this;
    Object.defineProperty(data, '__handleRef', { value: handle, enumerable: false });
    return new Proxy(data, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'then' || prop in target) return Reflect.get(target, prop, receiver);
        return (...args) => bridge.callRemote(handle, String(prop), args);
      },
      has(target, prop) { return prop in target; },
    });
  }

  get pupPage() {
    const bridge = this;
    return {
      evaluate: (fn, ...args) => bridge.send('pageEvaluate', { fn: typeof fn === 'function' ? fn.toString() : String(fn), args }),
    };
  }

  get interface() {
    const bridge = this;
    const call = (name) => (...args) => bridge.callClient(name, args);
    return { openChatWindowAt: call('openChatWindowAt'), openChatWindow: call('openChatWindow') };
  }

  get info() {
    return this.infoSnapshot;
  }

  get state() {
    return this.workerState;
  }

  async fetchInfo() {
    const info = await this.send('info', {});
    if (info) this.infoSnapshot = info;
    return info;
  }

  async destroy() {
    if (!this.child) return { alreadyStopped: true };
    try {
      await this.send('destroy', {});
    } catch (_) { /* the worker may already be gone */ }
    const child = this.child;
    this.child = null;
    this.workerState = 'stopped';
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} resolve(); }, 12000);
      if (timer.unref) timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    return { destroyed: true };
  }

  status() {
    return {
      mode: 'worker',
      state: this.workerState,
      pid: this.child ? this.child.pid : null,
      startedAt: this.startedAt,
      rpcCount: this.rpcCount,
      rpcFailures: this.rpcFailures,
      failuresByMethod: Object.fromEntries([...this.failuresByMethod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
      lastFailure: this.lastFailure,
      pending: this.pending.size,
      lastError: this.lastError,
      hasInfo: Boolean(this.infoSnapshot),
    };
  }
}

function createWhatsAppWorkerBridge(options) {
  return new WhatsAppWorkerBridge(options);
}

module.exports = { createWhatsAppWorkerBridge, WhatsAppWorkerBridge };