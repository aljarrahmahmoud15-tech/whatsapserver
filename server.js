const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const AUTH_PATH = process.env.AUTH_PATH || path.join(DATA_DIR, "auth");
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

if (!fs.existsSync(DATA_DIR)) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} }

let Database = null, db = null;
try {
    Database = require("better-sqlite3");
    const dbPath = path.join(DATA_DIR, "bot.db");
    db = new Database(dbPath);
} catch (e) {}

let calculateSettlement = () => {};
try {
    const finance = require("./finance");
    if (finance.calculateSettlement) calculateSettlement = finance.calculateSettlement;
} catch (e) {}

let Client = null, LocalAuth = null, client = null;
let qrCodeData = null, isReady = false, monitoredGroups = [];
const groupsFile = path.join(DATA_DIR, "monitored_groups.json");
if (fs.existsSync(groupsFile)) { try { monitoredGroups = JSON.parse(fs.readFileSync(groupsFile, 'utf8')); } catch {} }

const INVITE_TO_BIND = "GvUJ2S0P7V2Ig9FBwty23N";

async function bindNewGroup() {
    if (!isReady || !client) return;
    try {
        const inviteCode = INVITE_TO_BIND.replace("https://chat.whatsapp.com/", "").trim();
        try {
            const groupId = await client.acceptInvite(inviteCode);
            if (!monitoredGroups.includes(groupId)) {
                monitoredGroups.push(groupId);
                fs.writeFileSync(groupsFile, JSON.stringify(monitoredGroups, null, 2));
            }
            try { await client.sendMessage(groupId, "🚚 بوت الجراح مربوط ✅"); } catch {}
        } catch (e) {
            try {
                const chats = await client.getChats();
                const groups = chats.filter(c => c.isGroup);
                if (monitoredGroups.length === 0) {
                    monitoredGroups = groups.map(g => g.id._serialized);
                    fs.writeFileSync(groupsFile, JSON.stringify(monitoredGroups, null, 2));
                }
            } catch {}
        }
    } catch (err) {}
}

try {
    const wweb = require("whatsapp-web.js");
    Client = wweb.Client; LocalAuth = wweb.LocalAuth;
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }
    });
    client.on('qr', async (qr) => { qrCodeData = qr; });
    client.on('ready', async () => { isReady = true; setTimeout(bindNewGroup, 5000); });
    client.on('message', async (msg) => {
        try {
            const chat = await msg.getChat(); if (!chat.isGroup) return;
            if (monitoredGroups.length === 0 || monitoredGroups.includes(chat.id._serialized)) {
                try { calculateSettlement(msg); } catch {}
            }
        } catch {}
    });
    client.initialize().catch(() => {});
} catch (e) {}

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get('/', (req, res) => {
    res.send(<h1>🚚 الجراح - ${isReady ? '✅ Online' : '⏳ Starting'}</h1><a href="/qr">QR</a> | <a href="/bind">ربط</a> | <a href="/health">Health</a>);
});
app.get('/qr', async (req, res) => {
    if (!qrCodeData) return res.send(isReady ? '✅ متصل' : '⏳ بانتظار QR');
    try { const qrImg = await qrcode.toDataURL(qrCodeData); res.send(<img src="${qrImg}" style="width:300px">); }
    catch { res.send("QR error"); }
});
app.get('/groups', async (req, res) => {
    if (!client || !isReady) return res.json({ ready: false, monitored: monitoredGroups });
    try { const chats = await client.getChats(); const groups = chats.filter(c => c.isGroup).map(g => ({ id: g.id._serialized, name: g.name })); res.json({ ready: true, monitored: monitoredGroups, all: groups }); }
    catch (e) { res.json({ error: e.message, monitored: monitoredGroups }); }
});
app.get('/bind', async (req, res) => { await bindNewGroup(); res.json({ ok: true, monitored: monitoredGroups }); });
app.get('/health', (req, res) => res.json({ ok: true, ready: isReady, groups: monitoredGroups.length }));
app.listen(PORT, () => console.log(Server running ${PORT}));
