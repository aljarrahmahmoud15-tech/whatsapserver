const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NOTIFY_NUMBER = process.env.NOTIFY_NUMBER || "962779110123";
const SESSION_PATH = process.env.SESSION_PATH?.trim() || "/app/session";
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

let isClientReady = false;

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
  console.log("QR RECEIVED");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  isClientReady = true;
  console.log("WhatsApp client is ready.");
});

client.on("disconnected", () => {
  isClientReady = false;
});

client.initialize();

app.get("/", (req, res) => {
  res.send("Server running");
});

app.post("/send-whatsapp", async (req, res) => {
  try {
    if (!isClientReady) {
      return res.status(503).json({ error: "WhatsApp not ready" });
    }
    const { name, phone, message } = req.body;
    const chatId = `${NOTIFY_NUMBER}@c.us`;
    const text = `رسالة جديدة\nالاسم: ${name}\nالهاتف: ${phone}\nالرسالة: ${message}`;
    await client.sendMessage(chatId, text);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server on ${PORT}`);
});
