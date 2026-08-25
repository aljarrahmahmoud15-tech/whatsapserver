const express=require('express');
const cors=require('cors');
const qrcode=require('qrcode');
const fs=require('fs');
const {Client,LocalAuth}=require('whatsapp-web.js');
const app=express();
app.use(cors());
app.use(express.json({limit:'10mb'}));
if(!fs.existsSync('./.wwebjs_auth')) fs.mkdirSync('./.wwebjs_auth',{recursive:true});
let qrImage=null;
let status='INITIALIZING';
const client=new Client({
  authStrategy:new LocalAuth({dataPath:'./.wwebjs_auth',clientId:'render-client'}),
  puppeteer:{
    headless:true,
    executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||undefined,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process','--disable-gpu']
  }
});
client.on('qr',async(qr)=>{
  status='QR_READY';
  qrImage=await qrcode.toDataURL(qr);
  console.log('QR READY');
});
client.on('ready',()=>{
  status='CONNECTED';
  qrImage=null;
  console.log('READY');
});
client.on('authenticated',()=>status='AUTHENTICATED');
client.on('disconnected',()=>{status='DISCONNECTED';qrImage=null;});
client.initialize().catch(e=>{console.error(e);status='INIT_FAILED';});
app.get('/',(req,res)=>res.json({status,message:'Running',qr:'/qr',send:'POST /send'}));
app.get('/status',(req,res)=>res.json({status,ready:status==='CONNECTED',hasQR:!!qrImage}));
app.get('/qr',(req,res)=>{
  if(status==='CONNECTED') return res.send('<h1 style="text-align:center;margin-top:100px;font-family:sans-serif">✅ متصل - Connected</h1>');
  if(qrImage) return res.send(`<div style="text-align:center;font-family:sans-serif"><h2>امسح الرمز بواتساب</h2><img src="${qrImage}" style="width:300px"/><p>Status:${status}</p></div><meta http-equiv="refresh" content="15">`);
  res.send(`<h2 style="text-align:center;margin-top:100px;font-family:sans-serif">جاري التشغيل... ${status}</h2><script>setTimeout(()=>location.reload(),5000)</script>`);
});
app.post('/send',async(req,res)=>{
  if(status!=='CONNECTED') return res.status(400).json({success:false,error:status});
  try{
    const{number,message}=req.body;
    const clean=number.replace(/[^0-9]/g,'');
    const chatId=`${clean}@c.us`;
    const r=await client.sendMessage(chatId,message);
    res.json({success:true,id:r.id._serialized});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});
const PORT=process.env.PORT||10000;
app.listen(PORT,'0.0.0.0',()=>console.log('Listening on '+PORT));
