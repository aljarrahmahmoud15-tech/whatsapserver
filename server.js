Const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

let sock; // Make socket globally accessible to the routing context 
let isConnected = false;

async function startWhatsApp() {
const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

sock = makeWASocket({
auth: state,
printQRInTerminal: false
});

sock.ev.on('creds.update', saveCreds);

// Track connection lifecycle
sock.ev.on('connection.update', (update) => {
const { connection, lastDisconnect } = update;
if (connection === 'open') {
console.log('WhatsApp connection successfully opened!');
isConnected = true;
} else if (connection === 'close') {
console.log('WhatsApp connection closed. Reconnecting...');
isConnected = false;
startWhatsApp(); // Automatic reconnection logic
}
});
}

// Pairing code endpoint


app.get('/code', async (req, res) => {

// 1. Ensure the socket instance exists and is connected
if (!sock || !isConnected) {
return res.status(503).json({
success: false,
error: "WhatsApp client is initializing. Please try again in a few seconds."
});
}

try {
let phone = req.query.phone;
if (!phone) {
return res.status(400).json({ success: false, error: "Missing 'phone' query parameter." });
}

// 2. Clean the phone number (remove +, spaces, dashes)
phone = phone.replace(/[^0-9]/g, '');

// 3. Request the 8-digit pairing code
const code = await sock.requestPairingCode(phone);


return res.json({ success: true, phone, code });

} catch (err) {
return res.status(500).json({ success: false, error: err.message });
}
});

// Start application components
app.listen(PORT, () => {
console.log(`HTTP Server running on port ${PORT}`);
startWhatsApp();
});
