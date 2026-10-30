const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
assert.match(source, /const CAPTAIN_REMOVAL_PAUSED = true;/, 'captain removal must remain paused by default');
assert.match(source, /function rejectCaptainRemovalWhilePaused\(/);
assert.match(source, /captainRemovalPaused: CAPTAIN_REMOVAL_PAUSED/, 'health must expose the pause state for live verification');

function route(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `route boundaries missing: ${startMarker}`);
  return source.slice(start, end);
}

const blockedRoutes = [
  [
    'generic captain archive',
    route('app.delete("/api/admin/users/:id"', 'app.get("/api/admin/captains"'),
    'db.prepare("UPDATE users SET active=0,account_status=\'suspended\',archived_at='
  ],
  [
    'official group removal and suspension',
    route('app.post("/api/admin/captains/:id/suspend-and-remove"', 'app.delete("/api/admin/captains/:id"'),
    'removeParticipants'
  ],
  [
    'captain archive',
    route('app.delete("/api/admin/captains/:id"', 'app.post("/api/admin/captains/:id/restore"'),
    'db.prepare("UPDATE users SET active=0,account_status=\'suspended\',archived_at='
  ],
  [
    'captain merge',
    route('app.post("/api/admin/captains/:id/merge"', 'app.post("/api/admin/captains/resend-access-card"'),
    'await db.backup('
  ],
  [
    'bulk captain cleanup',
    route('app.post("/api/admin/captains/cleanup-execute"', 'app.get("/api/admin/group/live-messages"'),
    'db.backup('
  ],
  [
    'group reset and bulk purge',
    route('app.post("/api/admin/group/reset-recreate"', 'app.post("/api/admin/group/finalize-created"'),
    'fs.mkdirSync('
  ],
];

for (const [name, body, protectedEffect] of blockedRoutes) {
  const guardAt = body.indexOf('rejectCaptainRemovalWhilePaused(');
  const effectAt = body.indexOf(protectedEffect);
  assert.ok(guardAt >= 0, `${name} must consult the pause guard`);
  assert.ok(effectAt > guardAt, `${name} must be blocked before its side effect`);
}

const purge = route('function purgeExperimentalCaptains()', 'async function resetGroupInBackground');
assert.ok(purge.indexOf('CAPTAIN_REMOVAL_PAUSED') >= 0);
assert.ok(purge.indexOf('CAPTAIN_REMOVAL_PAUSED') < purge.indexOf('DELETE FROM wallet_ledger'));

const helper = route('function rejectCaptainRemovalWhilePaused(', 'function adminSendMessageMatches(');
for (const marker of ['res.status(423)', 'code: "CAPTAIN_REMOVAL_PAUSED"', 'mutation: "none"', 'financialMutation: false', 'settlementMutation: false']) {
  assert.ok(helper.includes(marker), `pause response must include ${marker}`);
}

const restore = route('app.post("/api/admin/captains/:id/restore"', 'app.get("/api/admin/captains/:id/merge-preview"');
assert.doesNotMatch(restore, /rejectCaptainRemovalWhilePaused/, 'restoration must remain available');

console.log('captain removal/archive/merge routes are paused; restore and read-only paths remain available');
