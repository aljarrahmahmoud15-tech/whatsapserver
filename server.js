
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// مسار القرص - يدعم الاثنين اللي انت عملته واللي بالدوكرفايل
let authPath = '/app/.wwebjs_auth';
let cachePath = '/app/.wwebjs_cache';
if (fs.existsSync('/app/wwebjs_auth')) {
  authPath = '/app/wwebjs_auth';
  console.log('Using disk path /app/wwebjs_auth');
}
if (fs.existsSync('/app/wwebjs_cache')) {
  cachePath = '/app/wwebjs_cache';
}
if (fs.existsSync('/app/.wwebjs_cache')) {
  cachePath = '/app/.wwebjs_cache';
}

console.log('Auth Path:', authPath);
console.log('Cache Path:', cachePath);

let qrData = null;
let isReady = false;
let pairingCode = null;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'main',
    dataPath: authPath
  }),
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
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  }
});

client.on('qr', async (qr) => {
  qrData = qr;
  console.log('QR Generated');
});

client.on('ready', () => {
  isReady = true;
  qrData = null;
  pairingCode = null;
  console.log('✅ WhatsApp Ready! - مربوط وجاهز');
});

client.on('disconnected', (reason) => {
  console.log('Disconnected:', reason);
  isReady = false;
});

client.on('message', async (msg) => {
  // هنا كود توثيق الطلبات اللي عندك - خليه زي ما هو
  console.log('Message:', msg.body);
});

client.initialize().catch(err => console.error('Init error:', err));

// صفحة QR
app.get('/qr', async (req, res) => {
  if (isReady) {
    return res.send('<h1>✅ WhatsApp مربوط وجاهز - بضل فاتح 24/7</h1>');
  }
  if (!qrData) {
    return res.send('<h1>⏳ عم بجهز QR... حدث الصفحة بعد 10 ثواني</h1><script>setTimeout(()=>location.reload(),5000)</script>');
  }
  try {
    const qrImage = await qrcode.toDataURL(qrData);
    res.send(`
      <html dir="rtl"><body style="text-align:center;font-family:system-ui;padding:20px">
        <h2>امسح QR بواتساب</h2>
        <img src="${qrImage}" style="width:300px"><br><br>
        <p>اذا ما زبط - استخدم كود الارقام:</p>
        <a href="/code?phone=9627XXXXXXXX" style="background:#25D366;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold">جيب كود 8 ارقام</a>
        <p>بدل XXXXXXXX برقمك - مثال: /code?phone=962791234567</p>
        <script>setTimeout(()=>location.reload(), 30000)</script>
      </body></html>
    `);
  } catch (e) {
    res.send('Error: ' + e.message);
  }
});

// صفحة كود 8 ارقام - الحل الحقيقي
app.get('/code', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) {
    return res.send(`
      <html dir="rtl" style="font-family:system-ui;padding:20px">
        <h2>كود الربط بـ 8 ارقام (بدون QR)</h2>
        <p>اكتب رقمك مع رمز البلد بدون +</p>
        <p>مثال اردني: 96279XXXXXXX</p>
        <form action="/code" method="get">
          <input name="phone" placeholder="962791234567" style="padding:12px;width:250px;font-size:18px">
          <button style="padding:12px 20px;background:#25D366;color:#fff;border:none;border-radius:8px;font-size:18px">جيب الكود</button>
        </form>
      </html>
    `);
  }
  try {
    if (isReady) return res.send('✅ مربوط اصلاً - جاهز');
    console.log('Requesting pairing code for', phone);
    const code = await client.requestPairingCode(phone);
    pairingCode = code;
    console.log('Pairing Code:', code);
    res.send(`
      <html dir="rtl"><body style="text-align:center;font-family:system-ui;padding:30px">
        <h1>كودك:</h1>
        <h1 style="font-size:48px;letter-spacing:10px;background:#000;color:#fff;padding:20px;border-radius:12px;display:inline-block">${code}</h1>
        <h3>روح واتساب > الاعدادات > الاجهزة المرتبطة > ربط جهاز > ربط باستخدام رقم الهاتف</h3>
        <h3>اكتب هاد الكود: ${code}</h3>
        <p>الكود بضل شغال دقيقة - اذا انتهى حدث الصفحة</p>
      </body></html>
    `);
  } catch (err) {
    console.error(err);
    res.send('خطأ: ' + err.message + '<br><br>تأكد الرقم مع رمز البلد مثال 96279XXXXXXX');
  }
});

app.get('/', (req, res) => {
  res.send(isReady ? '✅ WhatsApp Ready - Live 2GB' : '⏳ Starting... افتح /qr او /code');
});

app.listen(PORT, () => console.log('Server on', PORT));
