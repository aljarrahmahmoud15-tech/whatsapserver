const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
app.use(express.json());

// مسار القرص
let authPath = '/app/.wwebjs_auth';
if (fs.existsSync('/app/wwebjs_auth')) authPath = '/app/wwebjs_auth';

let qrData = null;
let isReady = false;

// !! حط هون ID القروب اللي بدك تزامن عليه - بعد ما تجيبه من /groups
let SYNC_GROUP_ID = null; // مثلا '1203630xxxxx@g.us'

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'main', dataPath: authPath }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--no-first-run','--no-zygote','--single-process','--disable-gpu'],
  }
});

client.on('qr', (qr) => { qrData = qr; console.log('QR Generated'); });
client.on('ready', () => { isReady = true; qrData = null; console.log('✅ WhatsApp Ready!'); });
client.on('disconnected', () => { isReady = false; });

client.on('message', async (msg) => {
  console.log('Message from', msg.from, ':', msg.body);
  // مزامنة تلقائية للقروب اذا محدد
  if (SYNC_GROUP_ID && !msg.from.includes('@g.us') && msg.from !== SYNC_GROUP_ID) {
    try {
      const contact = await msg.getContact();
      const name = contact.pushname || contact.number;
      await client.sendMessage(SYNC_GROUP_ID, `📩 رسالة جديدة من: ${name} - ${msg.from.replace('@c.us','')}\n\n${msg.body}`);
    } catch(e){ console.log('Sync error', e.message); }
  }
});

client.initialize();

// الصفحة الرئيسية
app.get('/', (req,res)=> res.send(isReady ? '✅ WhatsApp Ready - Live + Groups' : '⏳ Starting... افتح /qr'));

// QR
app.get('/qr', async (req,res)=>{
  if(isReady) return res.send('<h1>✅ مربوط وجاهز</h1><a href="/groups">شوف القروبات</a>');
  if(!qrData) return res.send('<h1>⏳ بجهز QR... حدث بعد 10 ثواني</h1><script>setTimeout(()=>location.reload(),5000)</script>');
  const qrImage = await qrcode.toDataURL(qrData);
  res.send(`<html dir="rtl" style="text-align:center;font-family:system-ui;padding:20px"><h2>امسح QR</h2><img src="${qrImage}" style="width:300px"><br><br><a href="/code?phone=9627XXXXXXXX">او جيب كود ارقام</a></html>`);
});

// كود 8 ارقام
app.get('/code', async (req,res)=>{
  const phone = req.query.phone;
  if(!phone) return res.send(`<html dir="rtl" style="padding:20px;font-family:system-ui"><h2>كود 8 ارقام</h2><form><input name="phone" placeholder="962791234567" style="padding:12px;width:250px"><button style="padding:12px;background:#25D366;color:#fff;border:none">جيب الكود</button></form></html>`);
  try{
    if(isReady) return res.send('✅ مربوط اصلا');
    const code = await client.requestPairingCode(phone);
    res.send(`<html dir="rtl" style="text-align:center;font-family:system-ui;padding:30px"><h1 style="font-size:48px;letter-spacing:10px;background:#000;color:#fff;padding:20px;border-radius:12px;display:inline-block">${code}</h1><h3>واتساب > الاجهزة المرتبطة > ربط باستخدام رقم الهاتف > اكتب ${code}</h3></html>`);
  }catch(err){ res.send('خطأ: '+err.message); }
});

// 1. شوف كل القروبات و ID تبعهم
app.get('/groups', async (req,res)=>{
  if(!isReady) return res.send('⏳ السيرفر مش جاهز بعد - اربط واتساب اول');
  try{
    const chats = await client.getChats();
    const groups = chats.filter(c=>c.isGroup);
    let html = `<html dir="rtl" style="font-family:system-ui;padding:20px"><h2>قروباتك (${groups.length})</h2><p>انسخ الـ ID اللي بخلص بـ @g.us وحطه في الكود</p>`;
    groups.forEach(g=>{
      html+= `<div style="border:1px solid #ccc;padding:12px;margin:10px 0;border-radius:8px"><b>${g.name}</b><br><code style="background:#eee;padding:4px">${g.id._serialized}</code><br><a href="/send-group?groupId=${g.id._serialized}&message=تجربة من السيرفر">جرب ابعت هون</a></div>`;
    });
    html+= `</html>`;
    res.send(html);
  }catch(e){ res.send('Error: '+e.message); }
});

// 2. ابعت رسالة لقروب
app.get('/send-group', async (req,res)=>{
  const {groupId, message} = req.query;
  if(!groupId || !message) return res.send('استخدم: /send-group?groupId=1203xxxxx@g.us&message=مرحبا');
  try{
    await client.sendMessage(groupId, message);
    res.send(`✅ تم الارسال للقروب ${groupId}`);
  }catch(e){ res.send('خطأ: '+e.message); }
});

// 3. ابعت رسالة لرقم عادي
app.get('/send', async (req,res)=>{
  const {number, message} = req.query;
  if(!number || !message) return res.send('استخدم: /send?number=9627XXXXXXX&message=مرحبا');
  try{
    const chatId = number.includes('@') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.send(`✅ تم الارسال لـ ${number}`);
  }catch(e){ res.send('خطأ: '+e.message); }
});

// 4. حدد قروب المزامنة التلقائية
app.get('/set-sync', (req,res)=>{
  const {groupId} = req.query;
  if(!groupId) return res.send('استخدم: /set-sync?groupId=1203xxxxx@g.us');
  SYNC_GROUP_ID = groupId;
  res.send(`✅ تم تحديد قروب المزامنة: ${groupId}<br>هسه اي رسالة بتيجي على رقمك رح تتحول لحالها عالقروب`);
});

app.listen(PORT, ()=> console.log('Server on', PORT));
