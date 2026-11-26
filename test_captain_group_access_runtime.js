const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { test } = require('node:test');

const source = fs.readFileSync('./server.js', 'utf8');
const hashStart = source.indexOf('function captainAuthCodeHash(phone, code) {');
const hashEnd = source.indexOf('\nfunction customerAuthCodeHash', hashStart);
const compareStart = source.indexOf('function constantTimeEquals(actual, expected) {');
const compareEnd = source.indexOf('\nfunction ', compareStart + 1);
const accessStart = source.indexOf('const CAPTAIN_GROUP_ACCESS_PURPOSE = "official_group_access";');
const accessEnd = source.indexOf('async function resolveReadableGroupChat(groupId)', accessStart);

assert.ok(hashStart >= 0 && hashEnd > hashStart, 'production OTP HMAC function is available');
assert.ok(compareStart >= 0 && compareEnd > compareStart, 'production constant-time comparator is available');
assert.ok(accessStart >= 0 && accessEnd > accessStart, 'production group-access helpers are available');

const hmacFunction = source.slice(hashStart, hashEnd);
const compareFunction = source.slice(compareStart, compareEnd);
const accessFunctions = source.slice(accessStart, accessEnd);

test('Captain group OTP is gated, hashed, bounded, single-use, and leaves accounts intact on uncertainty', async (t) => {
  const databasePath = path.join(os.tmpdir(), `captain-group-access-${process.pid}-${crypto.randomBytes(5).toString('hex')}.sqlite`);
  const db = new Database(databasePath);
  t.after(() => {
    db.close();
    fs.rmSync(databasePath, { force: true });
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, phone TEXT NOT NULL, role TEXT NOT NULL, is_bot INTEGER NOT NULL,
      active INTEGER NOT NULL, account_status TEXT NOT NULL, captain_whatsapp_verified_at TEXT,
      captain_last_login_at TEXT, updated_at TEXT, wallet_cents INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE captain_auth_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, captain_user_id INTEGER NOT NULL, phone TEXT NOT NULL,
      purpose TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL, verified_at TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO users(id,phone,role,is_bot,active,account_status,wallet_cents)
      VALUES(1,'fixture-captain-phone','captain',0,1,'active',12500);
  `);

  const fixturePhone = 'fixture-captain-phone';
  const fixtureOtherPhone = 'fixture-other-member';
  const officialGroup = 'approved-group@g.us';
  const generatedCode = [8, 6, 4, 2, 0, 9].join('');
  const fixtureSecret = Buffer.alloc(32, 42);
  let runtimeGroup = officialGroup;
  let snapshotAvailable = true;
  let snapshotThrows = false;
  let nextSnapshotGate = null;
  let memberPresent = true;
  const freshReads = [];
  const sentMessages = [];
  const audits = [];

  const context = {
    db,
    crypto,
    Buffer,
    CAPTAIN_SESSION_SECRET: fixtureSecret,
    configuredRuntimeGroupId: () => runtimeGroup,
    isOfficialGroupTarget: (groupId) => groupId === officialGroup,
    client: {},
    isReady: true,
    connectionGeneration: 7,
    readGroupSnapshot: async (groupId, options) => {
      freshReads.push({ groupId, options });
      if (nextSnapshotGate) {
        const gate = nextSnapshotGate;
        nextSnapshotGate = null;
        gate.started();
        return gate.promise;
      }
      if (snapshotThrows) throw new Error('temporary page failure');
      if (!snapshotAvailable || groupId !== officialGroup) return null;
      const member = memberPresent ? fixturePhone : fixtureOtherPhone;
      return { id: groupId, isGroup: true, participants: [{ id: `${member}@c.us`, user: member }] };
    },
    resolveWhatsappLidsFromConfiguredGroup: async () => [],
    serializedWhatsappUserId: (value) => {
      if (typeof value === 'string') return value;
      return String(value?._serialized || value?.id?._serialized || value?.id || '');
    },
    directJordanPhoneFromWhatsappValue: (value) => {
      const raw = typeof value === 'string' ? value : String(value?.id || value?.user || '');
      if (raw.endsWith('@c.us')) return raw.slice(0, -5);
      return [fixturePhone, fixtureOtherPhone].includes(raw) ? raw : '';
    },
    phoneWithCountry: (value) => String(value || ''),
    isValidJordanPhone: (value) => [fixturePhone, fixtureOtherPhone].includes(String(value || '')),
    createCaptainWhatsappCode: () => generatedCode,
    sendBotText: async (to, text) => { sentMessages.push({ to, text }); return true; },
    now: () => new Date().toISOString(),
    audit: (...args) => audits.push(args),
  };
  vm.runInNewContext(
    `${hmacFunction}\n${compareFunction}\n${accessFunctions}\nthis.__captainGroupAccess = { requestCaptainOfficialGroupAccessCode, verifyCaptainOfficialGroupAccessCode, getCaptainOfficialGroupMembership, invalidateCaptainGroupMembershipCache, captainAuthCodeHash };`,
    context,
    { timeout: 3000 },
  );
  const api = context.__captainGroupAccess;
  const user = { id: 1, phone: fixturePhone, role: 'captain', is_bot: 0 };

  let resolveStaleSnapshot;
  let markStaleSnapshotStarted;
  const staleSnapshotStarted = new Promise((resolve) => { markStaleSnapshotStarted = resolve; });
  nextSnapshotGate = { promise: new Promise((resolve) => { resolveStaleSnapshot = resolve; }), started: () => markStaleSnapshotStarted() };
  const staleMembershipRead = api.getCaptainOfficialGroupMembership(fixturePhone);
  await staleSnapshotStarted;
  api.invalidateCaptainGroupMembershipCache();
  resolveStaleSnapshot({ id: officialGroup, isGroup: true, participants: [{ id: `${fixturePhone}@c.us`, user: fixturePhone }] });
  assert.equal((await staleMembershipRead).status, 'unavailable', 'a result started before group-leave invalidation cannot confirm membership');
  assert.equal((await api.getCaptainOfficialGroupMembership(fixturePhone)).status, 'member', 'a subsequent fresh read can re-establish membership');
  api.invalidateCaptainGroupMembershipCache();

  const readsBeforeIssue = freshReads.length;
  const issued = await api.requestCaptainOfficialGroupAccessCode(user, { source: 'pin_login' });
  assert.equal(issued.status, 'sent');
  assert.equal(freshReads.length, readsBeforeIssue + 1);
  assert.equal(freshReads.at(-1).groupId, officialGroup);
  assert.equal(freshReads.at(-1).options.forceRefresh, true, 'membership lookup requires a fresh official-group snapshot');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, `${fixturePhone}@c.us`, 'OTP is sent only to the registered private WhatsApp recipient');
  assert.match(sentMessages[0].text, new RegExp(`(^|\\D)${generatedCode}(\\D|$)`));
  assert.doesNotMatch(sentMessages[0].to, /@g\.us$/);

  let challenge = db.prepare('SELECT * FROM captain_auth_challenges WHERE id=?').get(issued.challengeId);
  assert.equal(challenge.purpose, 'official_group_access');
  assert.equal(challenge.attempts, 0);
  assert.equal(challenge.verified_at, null);
  assert.notEqual(challenge.code_hash, generatedCode, 'plaintext OTP is never persisted');
  assert.equal(challenge.code_hash, api.captainAuthCodeHash(fixturePhone, generatedCode), 'stored challenge uses the production HMAC function');
  const remainingMs = Date.parse(challenge.expires_at) - Date.now();
  assert.ok(remainingMs > 9 * 60 * 1000 && remainingMs <= 10 * 60 * 1000, 'OTP lifetime is at most ten minutes');

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await api.verifyCaptainOfficialGroupAccessCode(user, '000000');
    assert.equal(result.status, 'invalid_code', `wrong attempt ${attempt} is rejected`);
  }
  challenge = db.prepare('SELECT * FROM captain_auth_challenges WHERE id=?').get(issued.challengeId);
  assert.equal(challenge.attempts, 5);
  assert.equal((await api.verifyCaptainOfficialGroupAccessCode(user, '000000')).status, 'expired', 'a sixth attempt is refused');

  const reissued = await api.requestCaptainOfficialGroupAccessCode(user, { source: 'pin_login' });
  assert.equal(reissued.status, 'sent');
  const verified = await api.verifyCaptainOfficialGroupAccessCode(user, generatedCode);
  assert.equal(verified.status, 'verified');
  assert.equal((await api.verifyCaptainOfficialGroupAccessCode(user, generatedCode)).status, 'expired', 'successful OTP is one-time only');
  const storedUser = db.prepare('SELECT active,account_status,wallet_cents,captain_whatsapp_verified_at FROM users WHERE id=1').get();
  assert.deepEqual({ active: storedUser.active, account_status: storedUser.account_status, wallet_cents: storedUser.wallet_cents }, { active: 1, account_status: 'active', wallet_cents: 12500 }, 'OTP verification preserves account state and wallet data');
  assert.ok(storedUser.captain_whatsapp_verified_at, 'successful verification records only the access proof');

  const messagesBeforeUnavailable = sentMessages.length;
  const proofBeforeUnavailable = storedUser.captain_whatsapp_verified_at;
  const pending = await api.requestCaptainOfficialGroupAccessCode(user, { source: 'pin_login' });
  assert.equal(pending.status, 'sent');
  snapshotAvailable = false;
  api.invalidateCaptainGroupMembershipCache();
  assert.equal((await api.verifyCaptainOfficialGroupAccessCode(user, generatedCode)).status, 'unavailable', 'a null fresh snapshot blocks verification without consuming the OTP');
  assert.equal((await api.requestCaptainOfficialGroupAccessCode(user)).status, 'unavailable');
  assert.equal(sentMessages.length, messagesBeforeUnavailable + 1, 'no additional OTP is sent when membership cannot be checked');
  assert.equal(db.prepare('SELECT captain_whatsapp_verified_at FROM users WHERE id=1').get().captain_whatsapp_verified_at, proofBeforeUnavailable, 'transient read failures do not revoke access proof');
  let pendingChallenge = db.prepare('SELECT attempts,verified_at FROM captain_auth_challenges WHERE id=?').get(pending.challengeId);
  assert.deepEqual({ attempts: pendingChallenge.attempts, verified_at: pendingChallenge.verified_at }, { attempts: 0, verified_at: null }, 'unavailable membership leaves the existing OTP unused');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM captain_auth_challenges WHERE purpose=? AND verified_at IS NULL').get('official_group_access').count, 1, 'transient failure preserves rather than replaces the pending challenge');

  snapshotAvailable = true;
  snapshotThrows = true;
  api.invalidateCaptainGroupMembershipCache();
  assert.equal((await api.verifyCaptainOfficialGroupAccessCode(user, generatedCode)).status, 'unavailable', 'unexpected WhatsApp refresh errors fail closed as temporary unavailability');
  assert.equal(db.prepare('SELECT captain_whatsapp_verified_at FROM users WHERE id=1').get().captain_whatsapp_verified_at, proofBeforeUnavailable, 'refresh exceptions do not revoke access proof');
  pendingChallenge = db.prepare('SELECT attempts,verified_at FROM captain_auth_challenges WHERE id=?').get(pending.challengeId);
  assert.deepEqual({ attempts: pendingChallenge.attempts, verified_at: pendingChallenge.verified_at }, { attempts: 0, verified_at: null }, 'refresh exceptions do not consume OTP attempts');

  snapshotThrows = false;
  memberPresent = false;
  api.invalidateCaptainGroupMembershipCache();
  const nonMember = await api.requestCaptainOfficialGroupAccessCode(user);
  assert.equal(nonMember.status, 'not_member');
  assert.equal(sentMessages.length, messagesBeforeUnavailable + 1, 'confirmed non-members receive no new code');
  const afterLeave = db.prepare('SELECT active,account_status,wallet_cents,captain_whatsapp_verified_at FROM users WHERE id=1').get();
  assert.deepEqual({ active: afterLeave.active, account_status: afterLeave.account_status, wallet_cents: afterLeave.wallet_cents }, { active: 1, account_status: 'active', wallet_cents: 12500 }, 'confirmed departure does not disable or alter the account or wallet');
  assert.equal(afterLeave.captain_whatsapp_verified_at, null, 'only the group-access proof is revoked on confirmed departure');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM captain_auth_challenges WHERE purpose=? AND verified_at IS NULL').get('official_group_access').count, 0, 'confirmed departure invalidates the pending OTP');

  const readsBeforeWrongGroup = freshReads.length;
  runtimeGroup = 'untrusted-group@g.us';
  api.invalidateCaptainGroupMembershipCache();
  assert.equal((await api.requestCaptainOfficialGroupAccessCode(user)).status, 'unavailable', 'membership checks fail closed outside the configured official group');
  assert.equal(freshReads.length, readsBeforeWrongGroup, 'no participant lookup is performed for another group');
  assert.equal(sentMessages.length, messagesBeforeUnavailable + 1, 'no code is sent after a non-official-group check');
  assert.ok(audits.some((entry) => entry[0] === 'captain.group_access.revoked'));
});
