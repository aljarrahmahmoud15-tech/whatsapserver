const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

let sock;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal:false ,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log('WhatsApp connection successfully opened!');
        } else if (connection === 'close') {
            console.log('WhatsApp connection closed. Reconnecting...');
            setTimeout(startWhatsApp, 3000);
        }
    });
}

startWhatsApp();

app.get('/code', async (req, res) => {
    if (!sock) {
        return res.status(503).json({ success: false, error: "WhatsApp client is initializing. Please try again in a few seconds." });
    }

    try {
        let phone = req.query.phone;
        if (!phone) {
            return res.status(400).json({ success: false, error: "Missing 'phone' query parameter." });
        }

        phone = phone.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(phone);
        return res.json({ success: true, phone, code });
    } catch (err) {
        console.error("Pairing code error:", err);
        return res.status(500).json({ success: false, error: "Failed to generate pairing code. Please refresh in a few seconds." });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
