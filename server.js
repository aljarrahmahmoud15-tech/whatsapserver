
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || null;

app.use(cors());
app.use(express.json());

// === حل مشكلة Disk في Render - نسختك المحسنة ===
function getAuthPath() {
  const possiblePaths = [
    '/app/wwebjs_auth',          // Render Disk اللي انت عامله
    '/app/.wwebjs_auth',         // المسار القديم
    path.join(__dirname, 'wwebjs_auth'), // Local
    './wwebjs_auth'
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`✅ Found existing auth at: ${p}`);
      return p;
    }
  }
  // لو ما في شي، استخدم المسار الصح للـ Disk الجديد
  const finalPath = '/app/wwebjs_auth';
  console.log(`📁 Using new auth path: ${finalPath}`);
  return finalPath;
}

const authPath = getAuthPath();
console.log('🔐 Final Auth Path:', authPath);

// === حفظ SYNC_GROUP_ID بشكل دائم ===
const SYNC_FILE = path.join(authPath, '../sync_group.json');
let SYNC_GROUP_ID = null;
try {
  if (fs.existsSync(SYNC_FILE)) {
    const data = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
    SYNC_GROUP_ID = data.groupId;
    console.log(`🔄 Loaded sync group: ${SYNC_GROUP_ID}`);
  }
} catch(e) { console.log('No sync file yet'); }

function saveSyncGroup(groupId) {
  try {
    fs.writeFileSync(SYNC_FILE, JSON.stringify({ groupId, updatedAt: new Date().toISOString() }));
    SYNC_GROUP_ID = groupId;
  } catch(e) { console.error('Save sync error', e.message); }
}

let qrData = null;
let isReady = false;
let lastQRTime = null;

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
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-software-rasterizer'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    timeout: 60000
  },
  restartOnAuthFail: true
});

client.on('qr', (qr) => { 
  qrData = qr; 
  lastQRTime = new Date();
  console.log('📱 QR Generated at', lastQRTime.toISOString());
});

client.on('ready', () => { 
  isReady = true; 
  qrData = null; 
  console.log('✅ WhatsApp Ready! بضل مربوط للأبد');
});

client.on('disconnected', (reason) => { 
  console.log('❌ Disconnected', reason); 
  isReady = false;
  // اعادة محاولة بعد 5 ثواني
  setTimeout(() => client.initialize().catch(e => console.error(e)), 5000);
});

client.on('auth_failure', (m) => console.log('🔒 Auth failure', m));
client.on('loading_screen', (percent, message) => console.log(`⏳ Loading ${percent}% - ${message}`));

client.on('message', async (msg) => {
  try {
    if (msg.fromMe) return; // لا تحول رسائلك انت
    console.log(`📩 ${msg.from}: ${msg.body?.substring(0,50)}`);
    
    if (SYNC_GROUP_ID && !msg.from.includes('@g.us') && msg.from !== SYNC_GROUP_ID) {
      try {
        const contact = await msg.getContact();
        const name = contact.pushname || contact.shortName || msg.from.replace('@c.us','');
        const text = `📩 *رسالة جديدة*
👤 من: ${name}
📱 رقم: ${msg.from.replace('@c.us','')}

${msg.body || '(صورة/ملف)'}`;
        await client.sendMessage(SYNC_GROUP_ID, text);
      } catch(e){ console.log('Sync error', e.message); }
    }
  } catch(e) { console.error('Message handler error', e.message); }
});

client.initialize().catch(e => console.error('Init error', e));

// === API Routes ===

app.get('/', (req,res)=> {
  res.send(`
    <html dir="rtl" style="font-family:system-ui;padding:20px;text-align:center">
      <h1>${isReady ? '✅ WhatsApp Ready - Live' : '⏳ جاري التشغيل...'}</h1>
      <p>Auth: ${authPath} | Sync: ${SYNC_GROUP_ID ? '✅ فعال' : '❌ غير محدد'}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:20px">
        <a href="/qr" style="background:#25D366;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">📱 QR Code</a>
        <a href="/groups" style="background:#128C7E;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">👥 القروبات</a>
        <a href="/status" style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">📊 الحالة</a>
      </div>
    </html>
  `);
});

app.get('/health', (req,res) => res.json({ status: 'ok', ready: isReady, authPath, syncGroup: SYNC_GROUP_ID, uptime: process.uptime() }));

app.get('/status', (req,res) => res.json({
  ready: isReady,
  hasQR: !!qrData,
  lastQR: lastQRTime,
  authPath,
  syncGroupId: SYNC_GROUP_ID,
  timestamp: new Date().toISOString()
}));

app.get('/qr', async (req,res)=>{
  if(isReady) return res.send(`
    <html dir="rtl" style="font-family:system-ui;padding:20px;text-align:center">
      <h1>✅ مربوط وجاهز - بضل مربوط للأبد</h1>
      <p>قروب المزامنة: ${SYNC_GROUP_ID || 'غير محدد'}</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:20px">
        <a href="/groups" style="background:#25D366;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">شوف القروبات</a>
        <a href="/status" style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">الحالة</a>
      </div>
    </html>
  `);
  if(!qrData) return res.send('<html dir="rtl" style="text-align:center;font-family:system-ui;padding:20px"><h1>⏳ بجهز QR... حدث بعد 5 ثواني</h1><p>Auth Path: '+authPath+'</p><script>setTimeout(()=>location.reload(),3000)</script></html>');
  
  try {
    const qrImage = await qrcode.toDataURL(qrData);
    res.send(`
      <html dir="rtl" style="text-align:center;font-family:system-ui;padding:20px">
        <h2>امسح QR بتلفونك</h2>
        <img src="${qrImage}" style="width:320px;border:12px solid #fff;box-shadow:0 4px 20px rgba(0,0,0,0.15);border-radius:12px">
        <br><br>
        <p style="color:#666">بضل صالح 60 ثانية - بيتجدد لحاله</p>
        <a href="/code?phone=9627XXXXXXXX" style="background:#000;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:10px">او جيب كود 8 ارقام</a>
        <script>setTimeout(()=>location.reload(), 30000)</script>
      </html>
    `);
  } catch(e) { res.send('Error generating QR: '+e.message); }
});

app.get('/qr-image', async (req,res) => {
  if (!qrData) return res.status(404).json({ error: 'QR not ready' });
  try {
    const buffer = await qrcode.toBuffer(qrData, { width: 400 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/code', async (req,res)=>{
  const phone = req.query.phone;
  if(!phone) return res.send(`
    <html dir="rtl" style="padding:20px;font-family:system-ui;text-align:center">
      <h2>🔢 كود 8 ارقام (بدون QR)</h2>
      <form style="margin-top:20px">
        <input name="phone" placeholder="962791234567" style="padding:14px;width:260px;border:2px solid #25D366;border-radius:8px;font-size:16px" required>
        <br><br>
        <button style="padding:12px 24px;background:#25D366;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer">جيب الكود</button>
      </form>
      <p style="color:#666;margin-top:15px">اكتب رقمك مع رمز البلد بدون +</p>
    </html>
  `);
  try{
    if(isReady) return res.send('✅ مربوط اصلا - افتح /groups');
    const code = await client.requestPairingCode(phone);
    res.send(`
      <html dir="rtl" style="text-align:center;font-family:system-ui;padding:30px">
        <h2>كود الربط</h2>
        <h1 style="font-size:52px;letter-spacing:12px;background:#111;color:#25D366;padding:20px 30px;border-radius:16px;display:inline-block;font-family:monospace">${code}</h1>
        <div style="background:#f0f0f0;padding:15px;border-radius:8px;margin-top:20px;max-width:400px;margin-left:auto;margin-right:auto;text-align:right">
          <b>الخطوات:</b><br>
          1. افتح واتساب<br>
          2. الاجهزة المرتبطة > ربط جهاز<br>
          3. اختار "ربط باستخدام رقم الهاتف"<br>
          4. اكتب: <b>${code}</b>
        </div>
      </html>
    `);
  }catch(err){ res.send('<h3>خطأ: '+err.message+'</h3><p>تأكد الرقم صحيح ومع رمز البلد</p><a href="/code">رجوع</a>'); }
});

app.get('/groups', async (req,res)=>{
  if(!isReady) return res.send('<html dir="rtl" style="font-family:system-ui;padding:20px;text-align:center"><h2>⏳ السيرفر مش جاهز بعد</h2><p>اربط واتساب اول - افتح <a href="/qr">/qr</a></p></html>');
  try{
    const chats = await client.getChats();
    const groups = chats.filter(c=>c.isGroup);
    let html = `
      <html dir="rtl" style="font-family:system-ui;padding:20px">
        <h2>👥 قروباتك (${groups.length})</h2>
        <p>انسخ الـ ID اللي بخلص بـ @g.us | المحدد حاليا: <code style="background:#25D366;color:#fff;padding:4px 8px;border-radius:4px">${SYNC_GROUP_ID || 'لا يوجد'}</code></p>
        <a href="/" style="background:#000;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px">رجوع</a>
        <hr style="margin:20px 0">
    `;
    groups.forEach(g=>{
      const isSelected = g.id._serialized === SYNC_GROUP_ID;
      html+= `
        <div style="border:2px solid ${isSelected ? '#25D366' : '#ddd'};padding:14px;margin:12px 0;border-radius:10px;background:${isSelected ? '#f0fff4' : '#fff'}">
          <b style="font-size:18px">${g.name}</b> ${isSelected ? '✅ محدد للمزامنة' : ''}
          <br>
          <code style="background:#eee;padding:6px;display:block;margin:8px 0;word-break:break-all;border-radius:4px;font-size:12px">${g.id._serialized}</code>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <a href="/send-group?groupId=${g.id._serialized}&message=تجربة من السيرفر" style="background:#25D366;color:#fff;padding:8px 14px;text-decoration:none;border-radius:6px;font-size:13px">📤 جرب ارسال</a>
            <a href="/set-sync?groupId=${g.id._serialized}" style="background:${isSelected ? '#666' : '#000'};color:#fff;padding:8px 14px;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">${isSelected ? '✅ محدد' : '⭐ حدد للمزامنة'}</a>
          </div>
        </div>`;
    });
    html+= `</html>`;
    res.send(html);
  }catch(e){ res.send('Error: '+e.message); }
});

app.get('/send-group', async (req,res)=>{
  const {groupId, message} = req.query;
  if(!groupId || !message) return res.send('استخدم: /send-group?groupId=1203xxxxx@g.us&message=مرحبا');
  try{ await client.sendMessage(groupId, message); res.json({ success: true, to: groupId, message }); }catch(e){ res.status(500).json({ success: false, error: e.message }); }
});

app.get('/send', async (req,res)=>{
  const {number, message} = req.query;
  if(!number || !message) return res.send('استخدم: /send?number=9627XXXXXXX&message=مرحبا');
  try{ const chatId = number.includes('@') ? number : `${number}@c.us`; await client.sendMessage(chatId, message); res.json({ success: true, to: number }); }catch(e){ res.status(500).json({ success: false, error: e.message }); }
});

app.post('/send', async (req,res) => {
  const { number, message, groupId } = req.body;
  const target = groupId || (number ? (number.includes('@') ? number : `${number}@c.us`) : null);
  if (!target || !message) return res.status(400).json({ success: false, error: 'number/groupId and message required' });
  try {
    await client.sendMessage(target, message);
    res.json({ success: true, to: target });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/set-sync', (req,res)=>{
  const {groupId} = req.query;
  if(!groupId) return res.send('استخدم: /set-sync?groupId=1203xxxxx@g.us');
  saveSyncGroup(groupId);
  res.send(`
    <html dir="rtl" style="font-family:system-ui;padding:20px;text-align:center">
      <h2>✅ تم تحديد قروب المزامنة</h2>
      <code style="background:#eee;padding:10px;display:block;margin:15px 0;word-break:break-all">${groupId}</code>
      <p>هسه اي رسالة بتيجي رح تتحول لحالها عالقروب - حتى بعد اعادة التشغيل!</p>
      <a href="/groups" style="background:#25D366;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:10px">رجوع للقروبات</a>
    </html>
  `);
});

app.get('/logout', async (req,res) => {
  try { await client.logout(); isReady = false; res.json({ success: true, message: 'Logged out' }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(PORT, ()=> console.log(`🚀 Server on ${PORT} | Auth: ${authPath} | Ready: ${isReady}`));

// graceful shutdown
process.on('SIGINT', async () => { console.log('Shutting down...'); try { await client.destroy(); } catch{} process.exit(0); });
