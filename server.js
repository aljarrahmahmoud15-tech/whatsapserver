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
const PUPPETEER_EXECUTABLE_PATH = (process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable").trim();
const puppeteerOptions = {
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote']
};
puppeteerOptions.executablePath = PUPPETEER_EXECUTABLE_PATH;

let isClientReady = false;

console.log(`Using session path: ${SESSION_PATH}`);
console.log('Using Puppeteer executable path:', PUPPETEER_EXECUTABLE_PATH);

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH
    }),
    puppeteer: puppeteerOptions
});

client.on("qr", (qr) => {
    console.log("Scan this QR code:");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    isClientReady = true;
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
    res.json({
        ready: isClientReady
    });
});

app.post("/send-whatsapp", async (req, res) => {
    if (!isClientReady) {
        return res.status(503).json({
            error: "WhatsApp client not ready."
        });
    }

    const { name, email, subject, message } = req.body;

    if (!name || !message) {
        return res.status(400).json({
            error: "Name and message are required."
        });
    }

    const text =
`📩 New Portfolio Message

👤 Name: ${name}
📧 Email: ${email || "N/A"}
📝 Subject: ${subject || "N/A"}

💬 Message:
${message}`;

    try {
        await client.sendMessage(`${NOTIFY_NUMBER}@c.us`, text);

        res.json({
            success: true
        });
    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});