const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const app = express();
const PORT = process.env.PORT || 3000;
// بيانات دخول الإدارة المعتمدة لنسخة المالك والكابتن
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '9871040319';
const sessions = new Map();
let sock;
let latestQr = null;
let connectionState = 'starting';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/captain', (req, res) => res.sendFile(path.join(__dirname, 'public', 'captain.html')));

function getSession(req) {
  const token = String(req.headers.cookie || '').match(/(?:^|;\s*)admin_session=([^;]+)/)?.[1];
  return token && sessions.has(token) ? sessions.get(token) : null;
}
function requireAdmin(req, res, next) {
  if (!getSession(req)) return res.status(401).json({ error: 'Admin authentication required.' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, createdAt: Date.now() });
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  res.json({ success: true, username });
});
app.post('/api/auth/logout', (req, res) => {
  const token = String(req.headers.cookie || '').match(/(?:^|;\s*)admin_session=([^;]+)/)?.[1];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ success: true });
});
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  res.json({ orders: 0, accepted: 0, pendingConfirmation: 0, wallets: 0, ledgerMoves: 0, companyBalance: '0.00', cards: { issued: 0, redeemed: 0, void: 0 }, groupId: null });
});

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  sock = makeWASocket({ auth: state, printQRInTerminal: true, browser: Browsers.macOS('Desktop') });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    if (qr) { latestQr = qr; connectionState = 'qr_ready'; console.log('WhatsApp QR is ready for scanning.'); }
    if (connection === 'open') { latestQr = null; connectionState = 'open'; console.log('WhatsApp connection successfully opened!'); }
    else if (connection === 'close') { connectionState = 'closed_reconnecting'; console.log('WhatsApp connection closed. Reconnecting...'); setTimeout(startWhatsApp, 3000); }
  });
}

startWhatsApp();
app.get('/status', (req, res) => res.json({ success: true, state: connectionState, qrReady: Boolean(latestQr) }));
app.get('/qr', (req, res) => {
  if (!latestQr) return res.status(404).json({ success: false, error: 'QR is not ready. Refresh in a few seconds.', state: connectionState });
  return res.json({ success: true, qr: latestQr });
});
app.get('/code', async (req, res) => {
  if (!sock) return res.status(503).json({ success: false, error: 'WhatsApp client is initializing. Please try again in a few seconds.' });
  try {
    let phone = req.query.phone;
    if (!phone) return res.status(400).json({ success: false, error: "Missing 'phone' query parameter." });
    phone = phone.replace(/[^0-9]/g, '');
    const code = await sock.requestPairingCode(phone);
    return res.json({ success: true, phone, code });
  } catch (err) {
    console.error('Pairing code error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate pairing code. Please refresh in a few seconds.' });
  }
});
app.listen(PORT, () => console.log('Server running on port ' + PORT));
