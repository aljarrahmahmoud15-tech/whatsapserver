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
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', async (qr) => {
  qrCodeData = await qrcode.toDataURL(qr);
});

client.on('ready', () => {
  isReady = true;
  qrCodeData = null;
  console.log('READY');
});

client.initialize();

app.get('/qr', (req, res) => {
  if (isReady) return res.send('متصل ✅');
  if (!qrCodeData) return res.send('ثواني... اعمل ريفريش');
  res.send(`<img src="${qrCodeData}" />`);
});

app.post('/send', async (req, res) => {
  const { number, message } = req.body;
  const chatId = `${number.replace(/[^0-9]/g, '')}@c.us`;
  const r = await client.sendMessage(chatId, message);
  res.json({ success: true, id: r.id.id });
});

app.listen(3000, () => console.log('Server running'));
