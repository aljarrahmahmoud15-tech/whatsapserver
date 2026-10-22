const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

assert.match(server, /const nexoraOtpRate = new Map\(\);/);
assert.match(server, /app\.post\("\/api\/internal\/nexora\/otp", async \(req, res\) => \{/);
assert.match(server, /String\(process\.env\.NEXORA_SECRET \|\| ""\)\.trim\(\)/);
assert.match(server, /constantTimeEquals\(providedSecret, configuredSecret\)/);
assert.match(server, /const NEXORA_OTP_TEXT_PATTERN = \/\^رمز الدخول إلى NEXORA Ride:/);
assert.match(server, /consumeRateLimit\(nexoraOtpRate, `\$\{clientAddress\(req\)\}:\$\{phone\}`, 5\)/);
assert.match(server, /res\.status\(202\)\.json\(\{ ok: true, status: "uncertain" \}\)/);

console.log('NEXORA OTP webhook guard verified: shared secret, OTP-only payload, and rate limit are present');
