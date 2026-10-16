const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('./server.js', 'utf8');
const admin = fs.readFileSync('./admin.html', 'utf8');

assert.match(server, /const botPhone = connectedBotPhone\(\);/);
assert.match(server, /phoneDisplay: botPhoneDisplay/);
assert.match(server, /whatsappLink = isValidJordanPhone\(botPhone\) \? `https:\/\/wa\.me\/\$\{botPhone\}` : null/);
assert.match(server, /app\.get\("\/api\/admin\/bot\/status", requireAdmin/);
assert.match(admin, /id="botIdentityCard"/);
assert.match(admin, /id="botPhone"/);
assert.match(admin, /id="botWhatsAppLink"/);
assert.match(admin, /function renderBotIdentity\(data\)/);
assert.match(admin, /renderBotIdentity\(bot\)/);
assert.match(admin, /href="#botIdentityCard"/);
console.log('admin bot identity number and WhatsApp link wiring verified');
