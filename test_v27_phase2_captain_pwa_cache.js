const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('./public/admin-v27.html', 'utf8');
const captain = fs.readFileSync('./public/captain.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('./public/captain-manifest.json', 'utf8'));
const sw = fs.readFileSync('./public/captain-sw.js', 'utf8');
const server = fs.readFileSync('./server.js', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

assert.equal(manifest.short_name, 'V27');
assert.equal(manifest.start_url, '/captain?mode=login');
assert.equal(manifest.display, 'standalone');
assert.match(captain, /rel="manifest" href="\/captain-manifest\.json"/);
assert.match(captain, /id="reg-vehicle-type"/);
assert.match(captain, /id="reg-vehicle-model"/);
assert.match(captain, /vehicleType,vehicleModel/);
assert.match(captain, /id="captain-support-open"/);
assert.match(captain, /\/api\/support\/tickets/);
assert.match(captain, /id="install-app-btn"/);
assert.match(captain, /beforeinstallprompt/);
assert.match(captain, /serviceWorker\.register\('\/captain-sw\.js'/);
assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);

assert.match(admin, /<title>العزوة · Owner Control V27<\/title>/);
assert.match(admin, /class="v27-signal-mark"[^>]*>V27<\/span>/);
assert.doesNotMatch(admin, /owner-vault|خزنة المالك/);
assert.match(admin, /المركبة/);
assert.match(admin, /id="v27SubscriptionCaptainsPreview"/);
assert.match(admin, /openSubscriptionCaptainsPreview/);

for (const marker of ['vehicle_type TEXT', 'vehicle_model TEXT', 'ALTER TABLE users ADD COLUMN vehicle_type', 'ALTER TABLE captain_invites ADD COLUMN vehicle_model', 'vehicleType', 'vehicleModel']) {
  assert.match(server, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.equal(packageJson.dependencies.redis.startsWith('^4.'), true);
assert.match(server, /createRedisClient/);
assert.match(server, /REDIS_URL/);
assert.match(server, /readRedisJson/);
assert.match(server, /writeRedisJson/);
assert.match(server, /X-V27-Bootstrap-Cache.*REDIS-HIT/);
assert.match(server, /X-Group-Summary-Cache.*REDIS-HIT/);
assert.match(server, /using memory cache/);
assert.match(server, /app\.get\("\/v27", v27PageLimiter, \(req, res\) =>[\s\S]{0,260}res\.sendFile\(path\.join\(__dirname, "public", "admin-v27\.html"\)\)/);
assert.match(server, /app\.get\("\/admin-v27\.html", \(req, res\) =>[\s\S]{0,180}res\.sendFile\(path\.join\(__dirname, "public", "admin-v27\.html"\)\)/);

console.log('active V27 owner dashboard, captain vehicle, support, PWA, and Redis cache guardrails: PASS');
