#!/usr/bin/env node
'use strict';

/**
 * Safe one-captain notification test.
 *
 * Default mode is read-only preview. It never sends a message and never calls
 * a wallet or settlement endpoint. Sending requires both --send and the exact
 * confirmation phrase, and the server-side notification kill switch must be
 * explicitly enabled by a later code/config change.
 */

const DEFAULT_BASE_URL = 'https://whatsapserver-2.onrender.com';
const SEND_CONFIRMATION = 'SEND-ONE-CAPTAIN-NOTIFICATION';
const NOTIFICATION_KEY_PREFIX = 'CAPTAIN-APPROVAL-TEST';

function usage() {
  console.log(`Usage:
  ADMIN_TOKEN=... node safe_single_captain_notification_test.js --captain-id 123
  ADMIN_TOKEN=... node safe_single_captain_notification_test.js --captain-id 123 --send --confirm ${SEND_CONFIRMATION}

Options:
  --captain-id <id>   Required captain database ID.
  --base-url <url>    Optional service URL; defaults to ${DEFAULT_BASE_URL}.
  --send              Request one approval-notification test; preview is the default.
  --confirm <text>    Required with --send; must equal ${SEND_CONFIRMATION}.
  --help              Show this help.

Authentication:
  Set ADMIN_TOKEN, or provide ADMIN_COOKIE for an authenticated admin session.
`);
}

function parseArgs(argv) {
  const options = { send: false, confirm: '', baseUrl: DEFAULT_BASE_URL, captainId: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--send') {
      options.send = true;
      continue;
    }
    if (arg === '--captain-id' || arg === '--base-url' || arg === '--confirm') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--captain-id') options.captainId = value;
      if (arg === '--base-url') options.baseUrl = value.replace(/\/$/, '');
      if (arg === '--confirm') options.confirm = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

async function request(baseUrl, path, { token, cookie, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function captainPreview(profile) {
  const captain = profile?.captain;
  if (!captain || captain.role !== 'captain') throw new Error('The selected ID is not a captain account');
  if (Number(captain.is_bot) === 1) throw new Error('Bot/system accounts are not eligible for this test');
  if (Number(captain.active) !== 1 || captain.account_status !== 'active') throw new Error('Captain must be active');
  if (!captain.approved_at) throw new Error('Captain must have an approval timestamp');
  return {
    id: captain.id,
    name: captain.name,
    phone: captain.phone,
    active: Boolean(captain.active),
    accountStatus: captain.account_status,
    approvedAt: captain.approved_at,
    walletBalance: captain.balance,
    mutation: 'none',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!/^\d+$/.test(options.captainId) || Number(options.captainId) < 1) throw new Error('--captain-id must be a positive integer');
  if (options.send && options.confirm !== SEND_CONFIRMATION) throw new Error(`--send requires --confirm ${SEND_CONFIRMATION}`);
  if (!options.send && options.confirm) throw new Error('--confirm is only valid with --send');
  const token = String(process.env.ADMIN_TOKEN || '').trim();
  const cookie = String(process.env.ADMIN_COOKIE || '').trim();
  if (!token && !cookie) throw new Error('Set ADMIN_TOKEN or ADMIN_COOKIE; secrets are never printed');

  const profile = await request(options.baseUrl, `/api/admin/captains/${encodeURIComponent(options.captainId)}/profile`, { token, cookie });
  const preview = captainPreview(profile);
  console.log(JSON.stringify({ mode: options.send ? 'send' : 'preview', ...preview }, null, 2));

  if (!options.send) {
    console.log('DRY_RUN_ONLY: no WhatsApp message was sent and no financial endpoint was called.');
    return;
  }

  const idempotencyKey = `${NOTIFICATION_KEY_PREFIX}-${preview.id}`;
  const result = await request(options.baseUrl, `/api/admin/captains/${encodeURIComponent(preview.id)}/approval-notification-test`, {
    token,
    cookie,
    method: 'POST',
    body: { test: true, idempotencyKey },
  });
  console.log(JSON.stringify({ ...result, idempotencyKey, mutation: 'none', walletChanged: false }, null, 2));
}

main().catch(fail);
