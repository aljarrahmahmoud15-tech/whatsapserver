const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const app = express();
app.use(cors());
app.use(express.json());
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NOTIFY_NUMBER = process.env.NOTIFY_NUMBER || "923139401824";
const SESSION_PATH = process.env.SESSION_PATH?.trim() || "/app/session";
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
let isClientReady = false;
let lastQr = null;
const puppeteerOptions = { headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"] };
if (PUPPETEER_EXECUTABLE_PATH) puppeteerOptions.executablePath = PUPPETEER_EXECUTABLE_PATH;
const client = new Client({ authStrategy: new LocalAuth({ dataPath: SESSION_PATH }), puppeteer: puppeteerOptions });
client.on("qr", (qr) => { lastQr = qr; console.log("QR RECEIVED"); qrcode.generate(qr, { small: true }); });
client.on("ready", () => { isClientReady = true; lastQr = null; console.log("READY"); });
client.on("disconnected", () => { isClientReady = false; });
client.on("auth_failure", (m) => { console.error(m); });
client.initialize();
app.get("/health", (req,res)=> res.json({ ready: isClientReady, hasQr: !!lastQr }));
app.get("/", (req,res)=> res.send("Server running. Go to /qr"));
app.get("/qr", (req,res)=>{
  if (!lastQr) {
    if (isClientReady) return res.send('<h1 style="text-align:center;color:green;margin-top:50px">✅ مربوط وجاهز</h1>');
    return res.send('<html><body style="text-align:center;font-family:Arial;margin-top:50px"><h1>⏳ بستنى QR...</h1><p>بحدث لحاله كل 5 ثواني</p><script>setTimeout(()=>location.reload(),5000)</script></body></html>');
  }
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(lastQr)}`;
  res.send(`<html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;font-family:Arial} .box{background:#fff;padding:20px;border-radius:16px} h1{color:#00d084}</style></head><body><h1>امسح QR بواتساب</h1><div class="box"><img src="${qrUrl}" style="width:300px;height:300px"></div><p>واتساب > الأجهزة المرتبطة > ربط جهاز</p><script>setTimeout(()=>location.reload(),30000)</script></body></html>`);
});
app.post("/send-whatsapp", async (req,res)=>{
  if (!isClientReady) return res.status(503).json({ error: "Not ready" });
  const { name, email, subject, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: "Name and message required" });
  const text = `📩 New Message\n👤 ${name}\n📧 ${email||"N/A"}\n📝 ${subject||"N/A"}\n\n${message}`;
  try { await client.sendMessage(`${NOTIFY_NUMBER}@c.us`, text); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: e.message }); }
});
app.listen(PORT, ()=> console.log("Running on "+PORT));
