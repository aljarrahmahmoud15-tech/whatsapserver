const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const captain = fs.readFileSync('./public/captain.html', 'utf8');
const rideHtml = fs.readFileSync('./public/ride-captain.html', 'utf8');
const rideClient = fs.readFileSync('./public/ride-captain.js', 'utf8');
const serviceWorker = fs.readFileSync('./public/captain-sw.js', 'utf8');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));

assert.match(server, /const CAPTAIN_GROUP_ACCESS_PURPOSE = "official_group_access"/);
assert.match(server, /CAPTAIN_GROUP_MEMBERSHIP_CACHE_TTL_MS = 10000/);

const snapshotReader = between(server, 'async function readGroupSnapshot(groupId, { forceRefresh = false } = {})', 'async function resolveReadableGroupChat(groupId)');
assert.match(snapshotReader, /if \(!forceRefresh\)/, 'fresh checks must bypass the direct cached chat snapshot');
assert.match(snapshotReader, /metadataRefreshed = true/);
assert.match(snapshotReader, /if \(requireFresh && !metadataRefreshed\)/, 'fresh membership cannot use stale metadata');
assert.match(snapshotReader, /if \(forceRefresh\) \{[\s\S]*?return null;\s*\}\s*const fallbackChat/, 'fresh refresh failures must not fall back to stale participant snapshots');

const membershipLoader = between(server, 'async function loadOfficialGroupMemberPhones()', 'function revokeCaptainOfficialGroupVerification');
assert.match(membershipLoader, /configuredRuntimeGroupId\(\)/);
assert.match(membershipLoader, /isOfficialGroupTarget\(groupId\)/);
assert.match(membershipLoader, /readGroupSnapshot\(groupId, \{ forceRefresh: true \}\)/);
assert.match(membershipLoader, /resolveWhatsappLidsFromConfiguredGroup\(lids, \{ hydrateGroup: false \}\)/);
assert.match(membershipLoader, /generation !== connectionGeneration/);
assert.match(membershipLoader, /unresolvedLids \? \{ status: "unavailable" \} : \{ status: "not_member" \}/);

const issueChallenge = between(server, 'async function requestCaptainOfficialGroupAccessCode(user,', 'function respondCaptainGroupAccessCodeIssue');
assert.match(issueChallenge, /getCaptainOfficialGroupMembership\(user\.phone\)/);
assert.match(issueChallenge, /membership\.status !== "member"/);
assert.match(issueChallenge, /captainAuthCodeHash\(user\.phone, code\)/);
assert.match(issueChallenge, /Date\.now\(\) \+ 10 \* 60 \* 1000/);
assert.match(issueChallenge, /sendBotText\(/);
assert.match(issueChallenge, /purpose,code_hash,attempts,expires_at,created_at/);
assert.doesNotMatch(issueChallenge, /console\.(?:log|info|warn|error).*code/);

const verifyChallenge = between(server, 'async function verifyCaptainOfficialGroupAccessCode(user, code)', 'async function resolveReadableGroupChat(groupId)');
assert.match(verifyChallenge, /invalidateCaptainGroupMembershipCache\(\)/);
assert.match(verifyChallenge, /getCaptainOfficialGroupMembership\(user\?\.phone\)/);
assert.match(verifyChallenge, /attempts\) >= 5/);
assert.match(verifyChallenge, /attempts<5/);
assert.match(verifyChallenge, /constantTimeEquals\(challenge\.code_hash/);
assert.match(verifyChallenge, /verified_at=\?/);
assert.match(verifyChallenge, /captain_whatsapp_verified_at/);

const pinLogin = between(server, 'app.post("/api/captain/login"', 'app.post("/api/captain/change-pin"');
const magicLogin = between(server, 'app.post("/api/captain/login-link/exchange"', 'app.post("/api/captain/whatsapp/request-code"');
const whatsappLogin = between(server, 'app.post("/api/captain/whatsapp/request-code"', 'app.post("/api/internal/nexora/otp"');
for (const [name, route] of [["PIN", pinLogin], ["magic link", magicLogin], ["WhatsApp OTP", whatsappLogin]]) {
  assert.match(route, /requestCaptainOfficialGroupAccessCode\(/, `${name} login must use the shared membership-gated code issuer`);
  assert.doesNotMatch(route, /jwt\.sign\(/, `${name} login must not mint a session before OTP verification`);
  assert.doesNotMatch(route, /setCaptainSessionCookie\(/, `${name} login must not set a session before OTP verification`);
}
assert.match(magicLogin, /getCaptainOfficialGroupMembership\(link\.phone\)/);

const authMiddleware = between(server, 'async function validateCaptainSessionGroupAccess(session)', 'function validCustomerPin(value)');
assert.match(authMiddleware, /groupVerifiedAt/);
assert.match(authMiddleware, /getCaptainOfficialGroupMembership\(user\.phone\)/);
assert.match(authMiddleware, /membership\.status === "unavailable"/);
assert.match(authMiddleware, /membership\.status !== "member"/);
assert.match(authMiddleware, /revokeCaptainOfficialGroupVerification/);
assert.match(authMiddleware, /captain_group_verification_unavailable/);
assert.match(authMiddleware, /captain_official_group_membership_required/);
assert.match(server, /instance\.on\("group_leave"[\s\S]*?isOfficialGroupTarget\(notification\.chatId\)[\s\S]*?invalidateCaptainGroupMembershipCache\(\)/);
assert.match(server, /app\.get\("\/api\/captain\/access", requireCaptain/);
assert.match(server, /validateCaptainSessionGroupAccess\(req\.captainSession\)[\s\S]*?res\.end\(\)/);

const protectedCaptainRoutes = server.match(/app\.(?:get|post|put|delete)\("[^"]+",\s*requireCaptain/g) || [];
assert.ok(protectedCaptainRoutes.length >= 17, `expected centralized protection on Captain routes, found ${protectedCaptainRoutes.length}`);

assert.match(captain, /id="group-verification-form"/);
assert.match(captain, /id="group-lock"/);
assert.match(captain, /\/api\/captain\/group-access\/verify/);
assert.match(captain, /startCaptainAccessWatch\(\)/);
assert.match(captain, /إعادة فحص العضوية/);
assert.match(rideHtml, /id="verify-card"/);
assert.match(rideHtml, /id="lock-card"/);
assert.match(rideHtml, /src="\/ride-captain\.js"/);
assert.match(rideClient, /\/api\/captain\/group-access\/verify/);
assert.match(rideClient, /\/api\/captain\/access/);
assert.match(rideClient, /function lockAccess\(/);
assert.match(rideClient, /closeStream\(\);\s*stopWatch\(\);\s*stopPolling\(\)/);
assert.match(serviceWorker, /v27-captain-shell-v4/);
assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);

console.log('captain group OTP, live membership lock, temporary-unavailable behavior, and PWA guardrails verified');
