const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('./server.js', 'utf8');
const index = fs.readFileSync('./public/index.html', 'utf8');

assert.ok(server.includes('app.get("/api/admin/cards", requireAdmin'), 'admin card history API is protected');
assert.ok(server.includes('app.post("/api/admin/cards", requireAdmin'), 'admin card issuance API is protected');
assert.ok(server.includes('issue_idempotency_key'), 'card issuance persists an idempotency key');
assert.ok(server.includes('delivery_idempotency_key'), 'card delivery persists an idempotency key');
assert.ok(server.includes('cardDeliveryInFlight.has(cardId)'), 'card delivery rejects concurrent sends');
assert.ok(server.includes('renderTopupCardMedia'), 'card delivery renders an official branded image');
assert.ok(server.includes('const appUrl = captainAppUrl(captainInviteBaseUrl(req))'), 'card message contains the official operations gateway');
assert.ok(server.includes('app.post("/api/captain/redeem-card", requireCaptain'), 'captain session redemption API exists');
assert.ok(server.includes('source: "captain_portal"'), 'portal redemption is audited');
assert.ok(server.includes('if (!cardEncryptionKey) return res.status(503)'), 'card issuance requires encryption');
assert.ok(server.includes('app.post("/api/redeem"'), 'captain redemption endpoint remains available');
assert.ok(index.includes('id="generate-card"'), 'owner card issuance control exists');
assert.ok(index.includes('crypto.randomUUID()'), 'owner UI creates request idempotency keys');
assert.ok(index.includes('/api/admin/cards?limit=12'), 'owner UI reads recent card history');
assert.ok(index.includes('id="topup-history-refresh"'), 'owner UI provides history refresh');
assert.ok(index.includes('data-card-history-send'), 'owner UI provides controlled resend action');
assert.ok(index.includes('https://whatsapserver-2.onrender.com/join.html'), 'owner invite points to the official operations gateway');
assert.ok(fs.readFileSync('./public/captain.html', 'utf8').includes('id="topup-redeem-form"'), 'captain app has a redemption form');
assert.ok(fs.readFileSync('./public/captain.html', 'utf8').includes('/api/captain/redeem-card'), 'captain app submits redemption to the session API');
assert.ok(fs.readFileSync('./public/captain.html', 'utf8').includes('renderTopupCards'), 'captain app renders card notifications');
console.log('top-up API guardrails verified');
