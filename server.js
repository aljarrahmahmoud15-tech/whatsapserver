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
const puppeteerOptions = { headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"] };
if (PUPPETEER_EXECUTABLE_PATH) puppeteerOptions.executablePath = PUPPETEER_EXECUTABLE_PATH;
const client = new Client({ authStrategy: new LocalAuth({ dataPath: SESSION_PATH }), puppeteer: puppeteerOptions });
client.on("qr", (qr) => { lastQr = qr; console.log("Scan this QR code:"); qrcode.generate(qr, { small: true }); });
client.on("ready", () => { isClientReady = true; lastQr = null; console.log("WhatsApp client is ready."); });
client.on("disconnected", (reason) => { isClientReady = false; console.log("Disconnected:", reason); });
client.on("auth_failure", (msg) => { console.error("Authentication failed:", msg); });
client.initialize();
app.get("/health", (req, res) => { res.json({ ready: isClientReady }); });
app.get("/qr", (req, res) => {
  if (!lastQr) {
    if (isClientReady) return res.send('<h1 style="color:green;text-align:center">✅ الواتساب مربوط</h1>');
    return res.send('<h1 style="text-align:center">⏳ بستنى QR...<script>setTimeout(()=>location.reload(),5000)</script></h1>');
  }
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(lastQr)}`;
  res.send(`<html><body style="background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;font-family:Arial"><h1 style="color:#00d084">امسح الـ QR</h1><div style="background:#fff;padding:20px;border-radius:16px"><img src="${qrUrl}" style="width:300px"></div><p>واتساب > الأجهزة المرتبطة > ربط جهاز</p><script>setTimeout(()=>location.reload(),30000)</script></body></html>`);
});
app.post("/send-whatsapp", async (req, res) => {
  if (!isClientReady) return res.status(503).json({ error: "WhatsApp client not ready." });
  const { name, email, subject, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: "Name and message are required." });
  const text = `📩 New Portfolio Message\n\n👤 Name: ${name}\n📧 Email: ${email || "N/A"}\n📝 Subject: ${subject || "N/A"}\n\n💬 Message:\n${message}`;
  try { await client.sendMessage(`${NOTIFY_NUMBER}@c.us`, text); res.json({ success: true }); }
  catch (err) { console.error(err); res.status(500).json({ success: false, error: err.message }); }
});
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
