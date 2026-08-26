const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_PHONE = process.env.BOT_PHONE || "0779110123";
const BOT_PHONE_INTL = process.env.BOT_PHONE_INTL || "962779110123";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const AUTH_PATH = process.env.AUTH_PATH || path.join(DATA_DIR, ".wwebjs_auth");
const QR_PUBLIC = process.env.QR_PUBLIC === "true";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const JWT_SECRET = process.env.JWT_SECRET || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "company";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const CAPTAIN_MIN_BALANCE_CENTS = Number(process.env.CAPTAIN_MIN_BALANCE_CENTS || 0);
const COMPANY_RATE_BPS = Number(process.env.COMPANY_RATE_BPS || 1500);
const PRODUCER_RATE_BPS = Number(process.env.PRODUCER_RATE_BPS || 1500);
const CAPTAIN_RATE_BPS = Number(process.env.CAPTAIN_RATE_BPS || 7000);

fs.mkdirSync(DATA_DIR, { recursive: true });
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const db = new Database(path.join(DATA_DIR, "aljarah.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('company','producer','captain')),
  wallet_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groups_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  group_id TEXT,
  sender_phone TEXT,
  sender_name TEXT,
  body TEXT NOT NULL,
  message_type TEXT,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no INTEGER NOT NULL UNIQUE,
  source_message_id TEXT NOT NULL UNIQUE,
  group_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  origin TEXT,
  destination TEXT,
  trip_time TEXT,
  producer_user_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('open','accepted','completed','cancelled')) DEFAULT 'open',
  captain_user_id INTEGER,
  accepted_message_id TEXT,
  accepted_at TEXT,
  company_cents INTEGER NOT NULL DEFAULT 0,
  producer_cents INTEGER NOT NULL DEFAULT 0,
  captain_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(producer_user_id) REFERENCES users(id),
  FOREIGN KEY(captain_user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER,
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  reference TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
CREATE TABLE IF NOT EXISTS topup_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  code_last4 TEXT NOT NULL,
  value_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('issued','redeemed','void')) DEFAULT 'issued',
  redeemed_by INTEGER,
  redeemed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(redeemed_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blocked_phones (
  phone TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const cleanPhone = (value = "") => String(value).replace(/[^0-9]/g, "").replace(/^00/, "");
const phoneWithCountry = (value = "") => {
  const raw = cleanPhone(value);
  if (raw.startsWith("0")) return "962" + raw.slice(1);
  return raw;
};
const cents = (value) => Math.round(Number(value || 0) * 100);
const money = (value) => (Number(value || 0) / 100).toFixed(2);
const hashCode = (code) => crypto.createHash("sha256").update(String(code).trim().toUpperCase()).digest("hex");
const randomCode = () => {
  const part = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FD-5JD-${part}`;
};
const displayPhone = (phone) => phone ? `+${phone}` : "غير معروف";
const BLOCKED_PHONE_INPUTS = ["0792026321", "0792026320"];
const BLOCKED_PHONE_SET = new Set(BLOCKED_PHONE_INPUTS.map(phoneWithCountry));
function isBlockedPhone(value) {
  return BLOCKED_PHONE_SET.has(phoneWithCountry(value));
}
function ensureBlockedPhones() {
  const insert = db.prepare("INSERT OR IGNORE INTO blocked_phones(phone,note,created_at) VALUES(?,?,?)");
  for (const value of BLOCKED_PHONE_INPUTS) insert.run(phoneWithCountry(value), "مستبعد نهائيًا من القروب والنظام", now());
}

function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, String(value), now());
}
function ensureSystemUsers() {
  const stamp = now();
  const company = db.prepare("SELECT id FROM users WHERE role='company' ORDER BY id LIMIT 1").get();
  if (!company) db.prepare("INSERT INTO users(phone,name,role,created_at,updated_at) VALUES(?,?,?,?,?)").run("system-company", "شركة الجراح", "company", stamp, stamp);
  if (getSetting("company_rate_bps") === null) setSetting("company_rate_bps", COMPANY_RATE_BPS);
  if (getSetting("producer_rate_bps") === null) setSetting("producer_rate_bps", PRODUCER_RATE_BPS);
  if (getSetting("captain_rate_bps") === null) setSetting("captain_rate_bps", CAPTAIN_RATE_BPS);
  if (getSetting("currency") === null) setSetting("currency", "JOD");
}
ensureBlockedPhones();
ensureSystemUsers();

function upsertUser({ phone, name, role }) {
  const normalized = phoneWithCountry(phone) || `unknown-${Date.now()}`;
  if (isBlockedPhone(normalized)) throw new Error("Blocked phone is not allowed");
  const stamp = now();
  const existing = db.prepare("SELECT * FROM users WHERE phone=?").get(normalized);
  if (existing) {
    if (name && name !== existing.name) db.prepare("UPDATE users SET name=?, updated_at=? WHERE id=?").run(name, stamp, existing.id);
    return db.prepare("SELECT * FROM users WHERE id=?").get(existing.id);
  }
  const resolvedRole = role || "captain";
  const result = db.prepare("INSERT INTO users(phone,name,role,created_at,updated_at) VALUES(?,?,?,?,?)").run(normalized, name || displayPhone(normalized), resolvedRole, stamp, stamp);
  return db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
}
function companyUser() { return db.prepare("SELECT * FROM users WHERE role='company' ORDER BY id LIMIT 1").get(); }
function configuredGroup(groupId) { return db.prepare("SELECT * FROM groups_config WHERE group_id=? AND active=1").get(groupId); }
function isConfiguredGroup(groupId) {
  const configured = db.prepare("SELECT COUNT(*) AS count FROM groups_config WHERE active=1").get().count;
  return configured === 0 || Boolean(configuredGroup(groupId));
}
function audit(action, entityType, entityId, details, actorUserId = null) {
  db.prepare("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)").run(actorUserId, action, entityType, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, now());
}
function parseOrder(text) {
  const normalized = String(text || "").replace(/\u200f|\u200e/g, "");
  const priceMatch = normalized.match(/(?:السعر|سعر|price)\s*[:：]?\s*(\d+(?:[.,]\d{1,2})?)/i);
  const price = priceMatch ? Number(priceMatch[1].replace(",", ".")) : null;
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const routeLine = lines.find((line) => /من\s+.+\s+إلى|من\s+.+\s+الى/i.test(line)) || "";
  const route = routeLine.match(/من\s+(.+?)\s+إلى\s+(.+)/i) || routeLine.match(/من\s+(.+?)\s+الى\s+(.+)/i);
  const timeMatch = normalized.match(/(\d{1,2}(?::\d{2})?\s*(?:صباحا|مساء|ص|م)?)/i);
  return {
    isOrder: /وصلني\s*(?:الآن|الان)?/i.test(normalized) && price !== null,
    price,
    origin: route ? route[1].trim() : null,
    destination: route ? route[2].trim() : null,
    tripTime: timeMatch ? timeMatch[1].trim() : null,
  };
}
function isCaptainAcceptance(text) {
  return /(^|\s)تم(?:\s|$)|تم\s+اول\s+راكب|تم\s+أول\s+راكب/i.test(String(text || "").trim());
}
function latestOpenOrder(groupId) {
  return db.prepare("SELECT * FROM orders WHERE group_id=? AND status='open' ORDER BY id DESC LIMIT 1").get(groupId);
}
function findOrderByQuotedId(quotedId) {
  if (!quotedId) return null;
  return db.prepare("SELECT * FROM orders WHERE source_message_id=? LIMIT 1").get(quotedId);
}
function formatAcceptance(order, captain, producer) {
  return [
    "✅ تم قبول الطلب",
    `🆔 رقم الطلب: #${order.order_no}`,
    `👤 المنتج: ${producer ? producer.name : "غير محدد"}`,
    `🚕 الكابتن: ${captain.name}`,
    `💰 القيمة: ${money(order.price_cents)} JOD`,
    `💼 صافي الكابتن: ${money(order.captain_cents)} JOD`,
    `📊 عمولة الشركة: ${money(order.company_cents)} JOD | عمولة المنتج: ${money(order.producer_cents)} JOD`,
  ].join("\n");
}

let client = null;
let isReady = false;
let qrCodeData = null;
let lastQrTime = null;
let reconnectTimer = null;
let initializing = false;
let connectionGeneration = 0;

const puppeteerConfig = {
  headless: true,
  defaultViewport: null,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-features=IsolateOrigins,site-per-process",
    "--window-size=1280,900",
  ],
};

async function destroyClient() {
  const current = client;
  client = null;
  isReady = false;
  if (!current) return;
  try { await current.destroy(); } catch (error) { console.warn("[WhatsApp] destroy:", error.message); }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await initializeWhatsApp();
  }, 5000);
}

function createClient() {
  const generation = ++connectionGeneration;
  const instance = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    puppeteer: puppeteerConfig,
  });
  instance.on("qr", (qr) => {
    if (generation !== connectionGeneration) return;
    qrCodeData = qr;
    lastQrTime = new Date();
    isReady = false;
    console.log("[WhatsApp] New QR generated");
  });
  instance.on("authenticated", () => console.log("[WhatsApp] authenticated"));
  instance.on("ready", () => {
    if (generation !== connectionGeneration) return;
    isReady = true;
    qrCodeData = null;
    const connectedPhone = instance.info && instance.info.wid ? instance.info.wid.user : BOT_PHONE_INTL;
    console.log(`[WhatsApp] ready: ${connectedPhone}`);
  });
  instance.on("auth_failure", (message) => {
    if (generation !== connectionGeneration) return;
    isReady = false;
    console.error("[WhatsApp] auth_failure:", message);
    scheduleReconnect();
  });
  instance.on("disconnected", (reason) => {
    if (generation !== connectionGeneration) return;
    isReady = false;
    qrCodeData = null;
    console.warn("[WhatsApp] disconnected:", reason);
    scheduleReconnect();
  });
  instance.on("message", async (msg) => {
    if (generation !== connectionGeneration) return;
    try { await handleIncomingMessage(msg); } catch (error) { console.error("[WhatsApp] message handler:", error); }
  });
  return instance;
}

async function initializeWhatsApp() {
  if (initializing || isReady) return;
  initializing = true;
  try {
    await destroyClient();
    client = createClient();
    await client.initialize();
  } catch (error) {
    console.error("[WhatsApp] initialize:", error.message);
    isReady = false;
    scheduleReconnect();
  } finally {
    initializing = false;
  }
}

async function handleIncomingMessage(msg) {
  if (!msg || msg.fromMe) return;
  const chat = await msg.getChat();
  const isGroup = Boolean(chat && chat.isGroup && msg.from.endsWith("@g.us"));
  if (!isGroup || !isConfiguredGroup(msg.from)) return;
  const contact = await msg.getContact().catch(() => null);
  const senderPhone = phoneWithCountry(contact && contact.number ? contact.number : msg.author || "");
  if (isBlockedPhone(senderPhone)) {
    console.warn(`[Policy] blocked phone ignored: ${senderPhone}`);
    return;
  }
  const senderName = (contact && (contact.pushname || contact.name)) || msg._data?.notifyName || displayPhone(senderPhone);
  const body = String(msg.body || "").trim();
  if (!body) return;
  const stamp = now();
  const inserted = db.prepare("INSERT OR IGNORE INTO messages(message_id,group_id,sender_phone,sender_name,body,message_type,sent_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run(msg.id._serialized, msg.from, senderPhone, senderName, body, msg.type || "text", new Date(Number(msg.timestamp || Date.now() / 1000) * 1000).toISOString(), stamp);
  if (!inserted.changes) return;
  const parsed = parseOrder(body);
  if (parsed.isOrder) {
    const producer = upsertUser({ phone: senderPhone, name: senderName, role: "producer" });
    const orderNo = Number(db.prepare("SELECT COALESCE(MAX(order_no),0)+1 AS next FROM orders").get().next);
    const result = db.prepare("INSERT INTO orders(order_no,source_message_id,group_id,raw_text,price_cents,origin,destination,trip_time,producer_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(orderNo, msg.id._serialized, msg.from, body, cents(parsed.price), parsed.origin, parsed.destination, parsed.tripTime, producer.id, "open", stamp, stamp);
    audit("order.created", "order", result.lastInsertRowid, { orderNo, groupId: msg.from });
    console.log(`[Order] #${orderNo} created from ${msg.from}`);
    return;
  }
  if (!isCaptainAcceptance(body)) return;
  const quoted = msg.hasQuotedMsg ? await msg.getQuotedMessage().catch(() => null) : null;
  const order = findOrderByQuotedId(quoted && quoted.id ? quoted.id._serialized : null) || latestOpenOrder(msg.from);
  if (!order) return;
  const captain = upsertUser({ phone: senderPhone, name: senderName, role: "captain" });
  if (captain.wallet_cents <= CAPTAIN_MIN_BALANCE_CENTS) {
    await msg.react("⚠️").catch(() => {});
    await client.sendMessage(msg.from, `⚠️ لا يمكن تثبيت الطلب #${order.order_no} للكابتن ${captain.name} لأن رصيده غير كافٍ. اطلب بطاقة شحن من خدمة العملاء.`).catch(() => {});
    audit("order.rejected.insufficient_wallet", "order", order.id, { captainId: captain.id });
    return;
  }
  const rateCompany = Number(getSetting("company_rate_bps", COMPANY_RATE_BPS));
  const rateProducer = Number(getSetting("producer_rate_bps", PRODUCER_RATE_BPS));
  const companyCents = Math.round(order.price_cents * rateCompany / 10000);
  const producerCents = Math.round(order.price_cents * rateProducer / 10000);
  const captainCents = order.price_cents - companyCents - producerCents;
  const producer = order.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(order.producer_user_id) : null;
  const accept = db.transaction(() => {
    const current = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
    if (!current || current.status !== "open") return false;
    const stampNow = now();
    db.prepare("UPDATE orders SET status='accepted', captain_user_id=?, accepted_message_id=?, accepted_at=?, company_cents=?, producer_cents=?, captain_cents=?, updated_at=? WHERE id=? AND status='open'").run(captain.id, msg.id._serialized, stampNow, companyCents, producerCents, captainCents, stampNow, order.id);
    const company = companyUser();
    const companyBalance = Number(company.wallet_cents || 0) + companyCents;
    db.prepare("UPDATE users SET wallet_cents=?, updated_at=? WHERE id=?").run(companyBalance, stampNow, company.id);
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?,?)").run(company.id, order.id, "commission_company", companyCents, companyBalance, `ORDER-${current.order_no}`, "عمولة الشركة", stampNow);
    if (producer) {
      const producerBalance = Number(producer.wallet_cents || 0) + producerCents;
      db.prepare("UPDATE users SET wallet_cents=?, updated_at=? WHERE id=?").run(producerBalance, stampNow, producer.id);
      db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?,?)").run(producer.id, order.id, "commission_producer", producerCents, producerBalance, `ORDER-${current.order_no}`, "عمولة المنتج", stampNow);
    }
    const captainBalance = Number(captain.wallet_cents || 0) + captainCents;
    db.prepare("UPDATE users SET wallet_cents=?, updated_at=? WHERE id=?").run(captainBalance, stampNow, captain.id);
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?,?)").run(captain.id, order.id, "trip_net", captainCents, captainBalance, `ORDER-${current.order_no}`, "صافي رحلة بعد خصم 30%", stampNow);
    audit("order.accepted", "order", order.id, { captainId: captain.id, companyCents, producerCents, captainCents });
    return true;
  })();
  if (!accept) return;
  const accepted = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
  await msg.react("👍").catch(() => {});
  await client.sendMessage(msg.from, formatAcceptance(accepted, captain, producer)).catch((error) => console.error("[WhatsApp] acceptance send:", error.message));
}

function parseCookies(header = "") {
  return String(header).split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index < 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}
function isAdmin(req) {
  const header = String(req.headers.authorization || "");
  if (ADMIN_TOKEN && (header === `Bearer ${ADMIN_TOKEN}` || req.query.token === ADMIN_TOKEN)) return true;
  if (!JWT_SECRET) return false;
  const session = parseCookies(req.headers.cookie || "").aljarah_session;
  if (!session) return false;
  try {
    const payload = jwt.verify(session, JWT_SECRET);
    return payload && payload.role === "company";
  } catch { return false; }
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `aljarah_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}
function requireQrAccess(req, res, next) {
  if (QR_PUBLIC || isAdmin(req)) return next();
  return res.status(401).send("QR access is protected. Set QR_PUBLIC=true temporarily or use the admin token.");
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.post("/api/auth/login", async (req, res) => {
  if (!JWT_SECRET || !ADMIN_PASSWORD_HASH) return res.status(503).json({ error: "Admin login is not configured" });
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username !== ADMIN_USERNAME || !(await bcrypt.compare(password, ADMIN_PASSWORD_HASH))) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ role: "company", username }, JWT_SECRET, { expiresIn: "7d" });
  setSessionCookie(res, token);
  res.json({ success: true, role: "company", username });
});
app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", "aljarah_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ success: true });
});
app.get("/api/auth/me", requireAdmin, (req, res) => res.json({ authenticated: true, role: "company" }));
app.get("/health", (req, res) => res.json({ status: "online", service: "aljarah-logistics", timestamp: now() }));
app.get("/status", (req, res) => res.json({ ready: isReady, hasQr: Boolean(qrCodeData), lastQrTime, phone: BOT_PHONE, groupId: getSetting("group_id", null), uptime: process.uptime() }));
app.get("/qr", requireQrAccess, async (req, res) => {
  if (isReady) return res.send(`<html dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:50px"><h2>✅ البوت متصل</h2><p>${BOT_PHONE}</p></body></html>`);
  if (!qrCodeData) return res.send('<meta http-equiv="refresh" content="3"><h2 style="font-family:system-ui;text-align:center">جاري تجهيز QR...</h2>');
  const image = await qrcode.toDataURL(qrCodeData);
  res.send(`<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#09111f;color:white;display:grid;place-items:center;min-height:100vh"><main style="text-align:center;background:#14243a;padding:24px;border-radius:18px"><h2>📱 امسح رمز الربط</h2><img src="${image}" style="max-width:320px;width:100%;background:#fff;padding:12px;border-radius:12px"><p>واتساب ← الأجهزة المرتبطة ← ربط جهاز</p><p>الرمز يتجدد تلقائيًا</p></main><script>setTimeout(()=>location.reload(),30000)</script></body></html>`);
});
app.get("/code", requireQrAccess, async (req, res) => {
  if (!client || isReady) return res.status(409).json({ error: "Bot is already connected or initializing" });
  const phone = phoneWithCountry(req.query.phone || BOT_PHONE_INTL);
  try {
    const code = await client.requestPairingCode(phone);
    return res.json({ success: true, phone, code, formatted: String(code).match(/.{1,4}/g).join("-"), expiresIn: 60 });
  } catch (error) {
    return res.status(503).json({ error: "Pairing code unavailable; use QR", details: error.message });
  }
});
function extractInviteCode(value = "") {
  const raw = String(value).trim();
  const match = raw.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : raw.replace(/[^A-Za-z0-9_-]/g, "");
}

app.post("/api/admin/group", requireAdmin, (req, res) => {
  const groupId = String(req.body.groupId || "").trim();
  const groupName = String(req.body.groupName || "قروب الجراح").trim();
  if (!groupId || !groupId.endsWith("@g.us")) return res.status(400).json({ error: "groupId must end with @g.us" });
  const stamp = now();
  db.prepare("INSERT INTO groups_config(group_id,group_name,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(group_id) DO UPDATE SET group_name=excluded.group_name,active=1,updated_at=excluded.updated_at").run(groupId, groupName, stamp, stamp);
  setSetting("group_id", groupId);
  audit("group.configured", "group", groupId, { groupName });
  res.json({ success: true, groupId, groupName });
});

app.post("/api/admin/group/join-invite", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const inviteCode = extractInviteCode(req.body.inviteLink || req.body.inviteCode || "");
  const groupName = String(req.body.groupName || "قروب الجراح").trim();
  if (!inviteCode || inviteCode.length < 10) return res.status(400).json({ error: "Valid WhatsApp invite link is required" });
  try {
    const groupId = await client.acceptInvite(inviteCode);
    const stamp = now();
    db.prepare("INSERT INTO groups_config(group_id,group_name,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(group_id) DO UPDATE SET group_name=excluded.group_name,active=1,updated_at=excluded.updated_at").run(groupId, groupName, stamp, stamp);
    setSetting("group_id", groupId);
    audit("group.joined_and_configured", "group", groupId, { groupName });
    res.json({ success: true, groupId, groupName });
  } catch (error) {
    res.status(502).json({ error: "Unable to join group", details: error.message });
  }
});
app.get("/api/admin/groups", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const chats = await client.getChats();
  res.json({ groups: chats.filter((chat) => chat.isGroup).map((chat) => ({ id: chat.id._serialized, name: chat.name, participants: chat.participants ? chat.participants.length : 0 })) });
});
app.post("/api/admin/cards", requireAdmin, (req, res) => {
  const value = Number(req.body.value || 5);
  if (!Number.isFinite(value) || value <= 0 || value > 1000) return res.status(400).json({ error: "Invalid card value" });
  let code = randomCode();
  while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
  const result = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,created_at) VALUES(?,?,?,'issued',?)").run(hashCode(code), code.slice(-4), cents(value), now());
  audit("topup_card.issued", "topup_card", result.lastInsertRowid, { valueCents: cents(value) });
  res.status(201).json({ id: result.lastInsertRowid, code, value: value.toFixed(2), status: "issued" });
});
app.post("/api/redeem", (req, res) => {
  const phone = phoneWithCountry(req.body.phone || "");
  const code = String(req.body.code || "").trim().toUpperCase();
  if (!phone || !code) return res.status(400).json({ error: "phone and code are required" });
  if (isBlockedPhone(phone)) return res.status(403).json({ error: "This phone is blocked by company policy" });
  const result = db.transaction(() => {
    const card = db.prepare("SELECT * FROM topup_cards WHERE code_hash=? AND status='issued'").get(hashCode(code));
    if (!card) throw new Error("Invalid or already used card");
    const user = upsertUser({ phone, name: phone, role: "captain" });
    const newBalance = Number(user.wallet_cents) + Number(card.value_cents);
    const stamp = now();
    db.prepare("UPDATE topup_cards SET status='redeemed',redeemed_by=?,redeemed_at=? WHERE id=? AND status='issued'").run(user.id, stamp, card.id);
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(newBalance, stamp, user.id);
    db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?)").run(user.id, "topup", card.value_cents, newBalance, `CARD-${card.id}`, "شحن بطاقة", stamp);
    audit("topup_card.redeemed", "topup_card", card.id, { userId: user.id, valueCents: card.value_cents }, user.id);
    return { userId: user.id, balanceCents: newBalance, valueCents: card.value_cents };
  })();
  try { res.json({ success: true, balance: money(result.balanceCents), credited: money(result.valueCents), currency: "JOD" }); } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get("/api/admin/overview", requireAdmin, (req, res) => {
  const orders = db.prepare("SELECT COUNT(*) AS count FROM orders").get().count;
  const accepted = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status='accepted'").get().count;
  const company = companyUser();
  const wallets = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role!='company'").get().count;
  const ledgerMoves = db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count;
  const issuedCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards").get().count;
  const redeemedCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE status='redeemed'").get().count;
  const voidCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE status='void'").get().count;
  res.json({ orders, accepted, companyBalance: money(company.wallet_cents), wallets, ledgerMoves, cards: { issued: issuedCards, redeemed: redeemedCards, void: voidCards }, groupId: getSetting("group_id", null), rules: { company: "15%", producer: "15%", captain: "70%" } });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT o.*, p.name AS producer_name, c.name AS captain_name FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id LEFT JOIN users c ON c.id=o.captain_user_id ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ orders: rows.map((row) => ({ ...row, price: money(row.price_cents), company: money(row.company_cents), producer: money(row.producer_cents), captain: money(row.captain_cents) })) });
});
app.get("/api/admin/wallets", requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id,phone,name,role,wallet_cents,active,updated_at FROM users ORDER BY role,id").all();
  res.json({ wallets: users.map((user) => ({ ...user, balance: money(user.wallet_cents) })) });
});
app.post("/api/admin/logout", requireAdmin, async (req, res) => {
  try {
    await destroyClient();
    qrCodeData = null;
    if (fs.existsSync(AUTH_PATH)) fs.rmSync(AUTH_PATH, { recursive: true, force: true });
    scheduleReconnect();
    res.json({ success: true, message: "Session cleared; a new QR will be generated" });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post("/api/admin/send", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const to = String(req.body.to || "").trim();
  const message = String(req.body.message || "").trim();
  if (!to || !message) return res.status(400).json({ error: "to and message are required" });
  const chatId = to.endsWith("@g.us") || to.endsWith("@c.us") ? to : `${cleanPhone(to)}@c.us`;
  const sent = await client.sendMessage(chatId, message);
  audit("message.sent", "chat", chatId, { messageId: sent.id._serialized });
  res.json({ success: true, messageId: sent.id._serialized });
});

app.listen(PORT, () => {
  console.log(`[HTTP] listening on ${PORT}`);
  console.log(`[Config] phone=${BOT_PHONE} data=${DATA_DIR}`);
  initializeWhatsApp();
});

process.on("SIGTERM", async () => { await destroyClient(); db.close(); process.exit(0); });
process.on("SIGINT", async () => { await destroyClient(); db.close(); process.exit(0); });
