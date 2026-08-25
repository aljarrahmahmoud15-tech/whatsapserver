const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeData = null;
let isReady = false;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

client.on('qr', async (qr) => {
    qrCodeData = await qrcode.toDataURL(qr);
    console.log('QR Generated');
});

client.on('ready', () => {
    isReady = true;
    qrCodeData = null;
    console.log('Client is ready!');
});

client.on('auth_failure', msg => {
    console.error('Auth failure', msg);
});

client.initialize().catch(err => console.error(err));

app.get('/', (req, res) => {
    res.send(isReady ? '✅ WhatsApp Connected & Ready!' : '⏳ Waiting for QR scan... Go to /qr');
});

app.get('/qr', (req, res) => {
    if (isReady) return res.send('<h1>✅ Already Connected!</h1><a href="/">Home</a>');
    if (!qrCodeData) return res.send('<h1>⏳ Generating QR... refresh in 5 sec</h1><script>setTimeout(()=>location.reload(),5000)</script>');
    res.send(`<div style="text-align:center;margin-top:50px"><h2>Scan this QR</h2><img src="${qrCodeData}" style="width:320px;border:10px solid #fff;box-shadow:0 0 20px rgba(0,0,0,.2)"><br><small>Refreshing every 5 sec</small></div><script>setTimeout(()=>location.reload(),10000)</script>`);
});

app.get('/status', (req, res) => {
    res.json({ ready: isReady, hasQR: !!qrCodeData });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
