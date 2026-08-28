// server.js
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

console.log(`Using session path: ${SESSION_PATH}`);
if (PUPPETEER_EXECUTABLE_PATH) {
    console.log(`Using Puppeteer executable path: ${PUPPETEER_EXECUTABLE_PATH}`);
}

const puppeteerOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
};
if (PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOptions.executablePath = PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: puppeteerOptions
});

client.on("qr", (qr) => {
    lastQr = qr;
    console.log("Scan this QR code:");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    isClientReady = true;
    lastQr = null;
    console.log("WhatsApp client is ready.");
});

client.on("disconnected", (reason) => {
    isClientReady = false;
    console.log("Disconnected:", reason);
});

client.on("auth_failure", (msg) => {
    console.error("Authentication failed:", msg);
});

client.initialize();

app.get("/health", (req, res) => {
    res.json({ ready: isClientReady });
});

app.get("/qr", (req, res) => {
    if (!lastQr) {
        if (isClientReady) {
            return res.send('<html dir="rtl" style="font-family:Arial;text-align:center;padding:50px"><h1 style="color:#00d084">✅ الواتساب مربوط وجاهز</h1></html>');
        }
        return res.send('<html dir="rtl" style="font-family:Arial;text-align:center;padding:50px"><h1>⏳ بستنى QR جديد...</h1><script>setTimeout(()=>location.reload(),5000)</script></html>');
    }
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(lastQr)}`;
    res.send(`
      <html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR</title>
      <style>body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;font-family:Arial}.qr{background:#fff;padding:20px;border-radius:16px}h1{color:#00d084}</style></head>
      <body><h1>امسح الـ QR بواتساب</h1><div class="qr"><img src="${qrUrl}" style="width:300px;height:300px"></div><p>واتساب > الأجهزة المرتبطة > ربط جهاز</p><script>setTimeout(()=>location.reload(),30000)</script></body></html>
    `);
});

app.post("/send-whatsapp", async (req, res) => {
    if (!isClientReady) {
        return res.status(503).json({ error: "WhatsApp client not ready." });
    }
    const { name, email, subject, message } = req.body;
    if (!name || !message) {
        return res.status(400).json({ error: "Name and message are required." });
    }
    const text = `📩 New Portfolio Message

👤 Name: ${name}
📧 Email: ${email || "N/A"}
📝 Subject: ${subject || "N/A"}

💬 Message:
${message}`;
    try {
        await client.sendMessage(`${NOTIFY_NUMBER}@c.us`, text);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
