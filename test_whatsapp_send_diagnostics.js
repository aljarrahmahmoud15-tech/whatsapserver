const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const simulation = fs.readFileSync('./local_send_simulation.js', 'utf8');

assert.match(server, /let whatsappSendDiagnostics = \{/);
assert.match(server, /function recordWhatsAppPageDiagnostic\(/);
assert.match(server, /async function installWhatsAppSendDiagnostics\(instance, generation\)/);
assert.match(server, /page\.on\("pageerror"/);
assert.match(server, /page\.on\("console"/);
assert.match(server, /window\.__waslniSendDiagnostics/);
assert.match(server, /api\.sendMessage = hooked/);
assert.match(server, /looksLikeOrder/);
assert.match(server, /optionKeys/);
assert.match(server, /lastError/);
assert.match(server, /installWhatsAppSendDiagnostics\(instance, generation\)/);
assert.match(server, /app\.get\("\/api\/admin\/whatsapp\/send-diagnostics", requireAdmin/);
assert.match(server, /mutation: "none"/);
assert.match(server, /readWhatsAppSendDiagnostics\(\)/);
assert.doesNotMatch(server, /send-diagnostics[\s\S]{0,1800}client\.sendMessage/);
assert.match(simulation, /mode: 'local-only-no-network-no-render-no-whatsapp-no-sqlite'/);

console.log('WhatsApp Web send diagnostics instrumentation guardrails verified');
