const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeData = null;
let isReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});

client.on('qr', async (qr) => {
  qrCodeData = await qrcode.toDataURL(qr);
  console.log('QR generated');
});

client.on('ready', () => {
  isReady = true;
  qrCodeData = null;
  console.log('READY');
});

client.initialize();

app.get('/', (req, res) => {
  res.send('WhatsApp Server is running. Go to /qr to scan.');
});

app.get('/qr', (req, res) => {
  if (isReady) return res.send('متصل ✅');
  if (qrCodeData) return res.send(`<p>امسح الرمز... ثواني</p><img src="${qrCodeData}" />`);
  res.send('جاري التهيئة... حدث الصفحة');
});

app.post('/send', async (req, res) => {
  try {
    const { number, message } = req.body;
    const chatId = `${number.replace(/[^0-9]/g, '')}@c.us`;
    const r = await client.sendMessage(chatId, message);
    res.json({ success: true, id: r.id._serialized });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
