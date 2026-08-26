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
const { calculateSettlement } = require("./finance");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_PHONE = process.env.BOT_PHONE || "0779110123";
const BOT_PHONE_INTL = process.env.BOT_PHONE_INTL || "962779110123";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const AUTH_PATH = process.env.AUTH_PATH || path.join(DATA_DIR, ".wwebjs_auth");
const QR_PUBLIC = process.env.QR_PUBLIC === "true";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const JWT_SECRET = process.env.JWT_SECRET || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "company";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const CAPTAIN_MIN_BALANCE_CENTS = Number(process.env.CAPTAIN_MIN_BALANCE_CENTS || 0);
const COMPANY_RATE_BPS = Number(process.env.COMPANY_RATE_BPS || 1500);
const PRODUCER_RATE_BPS = Number(process.env.PRODUCER_RATE_BPS || 1500);
const SPECIAL_ORDER_RATE_BPS = Number(process.env.SPECIAL_ORDER_RATE_BPS || 2000);
const COMPANY_FROM_PRODUCER_RATE_BPS = Number(process.env.COMPANY_FROM_PRODUCER_RATE_BPS || 1500);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const loginRate = new Map();
const redeemRate = new Map();
const adminActionRate = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
app.disable("x-powered-by");
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN, credentials: false } : { origin: false }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
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
  order_kind TEXT NOT NULL DEFAULT 'normal' CHECK(order_kind IN ('normal','order')),
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
CREATE TABLE IF NOT EXISTS customer_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  direction TEXT,
  travel_mode TEXT,
  travel_date TEXT,
  travelers_count INTEGER,
  state TEXT NOT NULL DEFAULT 'awaiting_direction',
  last_message_id TEXT,
  last_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code TEXT NOT NULL UNIQUE,
  requester_name TEXT NOT NULL,
  account_ref TEXT,
  category TEXT NOT NULL CHECK(category IN ('general','topup_card','booking')),
  message TEXT NOT NULL,
  requested_value_cents INTEGER,
  status TEXT NOT NULL CHECK(status IN ('new','in_progress','resolved','closed')) DEFAULT 'new',
  admin_reply TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const existingOrderColumns = db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name);
if (!existingOrderColumns.includes("order_kind")) db.exec("ALTER TABLE orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'normal'");

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
const isValidJordanPhone = (phone) => /^9627\d{8}$/.test(String(phone));
function consumeRateLimit(store, key, maxAttempts) {
  const current = Date.now();
  const entry = store.get(key);
  if (!entry || current - entry.startedAt >= RATE_LIMIT_WINDOW_MS) {
    store.set(key, { startedAt: current, count: 1 });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  entry.count += 1;
  return true;
}
function clientAddress(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}
function constantTimeEquals(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(String(actual));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function isBlockedOrInvalidCustomerPhone(phone) {
  return !isValidJordanPhone(phone) || isBlockedPhone(phone);
}
function createTicketCode() {
  let code;
  do { code = `CS-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; } while (db.prepare("SELECT id FROM support_tickets WHERE ticket_code=?").get(code));
  return code;
}
const SUPPORT_CATEGORIES = new Set(["general", "topup_card", "booking"]);
const BLOCKED_PHONES = new Set(["+962792026321", "+962792026320"]);
const GROUP_SETUP_OWNER_PHONES = new Set((process.env.GROUP_SETUP_OWNER_PHONES || "+962785217886,+962775969880").split(",").map(phoneWithCountry).filter(Boolean));
const BLOCKED_PHONE_SET = new Set([...BLOCKED_PHONES].map(phoneWithCountry));
function isBlockedPhone(value) {
  return BLOCKED_PHONE_SET.has(phoneWithCountry(value));
}
function withTimeout(promise, timeoutMs, fallback = null) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}
function normalizeCustomerText(value) {
  return String(value || "").trim().toLowerCase().replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ");
}
function ensureCustomerLead(phone, chatId, name, messageId, body) {
  const stamp = now();
  db.prepare(`INSERT INTO customer_leads(phone,chat_id,name,state,last_message_id,last_text,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET chat_id=excluded.chat_id,name=excluded.name,last_message_id=excluded.last_message_id,last_text=excluded.last_text,updated_at=excluded.updated_at`).run(phone, chatId, name || displayPhone(phone), "awaiting_direction", messageId, body, stamp, stamp);
  return db.prepare("SELECT * FROM customer_leads WHERE phone=?").get(phone);
}
async function sendBotText(to, text) {
  if (!client || !isReady) return false;
  try {
    await withTimeout(client.sendMessage(to, text), 20000, null);
    return true;
  } catch (error) {
    console.error("[WhatsApp] customer reply:", error.message);
    return false;
  }
}
function updateCustomerLead(lead, patch) {
  const next = { ...lead, ...patch, updated_at: now() };
  db.prepare(`UPDATE customer_leads SET direction=?,travel_mode=?,travel_date=?,travelers_count=?,state=?,last_message_id=?,last_text=?,updated_at=? WHERE id=?`).run(next.direction || null, next.travel_mode || null, next.travel_date || null, next.travelers_count || null, next.state, next.last_message_id || null, next.last_text || null, next.updated_at, lead.id);
  return db.prepare("SELECT * FROM customer_leads WHERE id=?").get(lead.id);
}
function customerDirection(text) {
  if (/^(1|الاردن الى سوريا|من الاردن الى سوريا|اردن سوريا|الاردن لسوريا)$/.test(text) || /الاردن.*سوريا/.test(text)) return "jo_to_syria";
  if (/^(2|سوريا الى الاردن|من سوريا الى الاردن|سوريا الاردن)$/.test(text) || /سوريا.*الاردن/.test(text)) return "syria_to_jo";
  if (/^(3|داخل الاردن|نقل داخل الاردن|الاردن)$/.test(text)) return "inside_jo";
  return null;
}
function customerMode(text) {
  if (/^(1|بري|بريا|طريق بري|باص|سيارة)$/.test(text) || /بري/.test(text)) return "road";
  if (/^(2|مطار|جوي|طيران|المطار)$/.test(text) || /مطار|جوي|طيران/.test(text)) return "airport";
  return null;
}
async function handleCustomerMessage(msg) {
  const chatId = String(msg.from || "");
  if (!chatId.endsWith("@c.us")) return;
  const phone = phoneWithCountry(chatId.slice(0, -5));
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return;
  const contact = await withTimeout(msg.getContact(), 8000, null);
  const name = (contact && (contact.pushname || contact.name)) || displayPhone(phone);
  const body = String(msg.body || "").trim();
  if (!body) return;
  let lead = db.prepare("SELECT * FROM customer_leads WHERE phone=?").get(phone);
  if (!lead) {
    lead = ensureCustomerLead(phone, chatId, name, msg.id && msg.id._serialized, body);
    audit("customer.lead.started", "customer_lead", lead.id, { phone, name });
    await sendBotText(chatId, brandedMessage("أهلًا بك", ["اختر نوع الرحلة:", "1️⃣ من الأردن إلى سوريا", "2️⃣ من سوريا إلى الأردن", "3️⃣ نقل داخل الأردن"]));
    return;
  }
  const text = normalizeCustomerText(body);
  if (/^(الغاء|إلغاء|cancel)$/.test(text)) {
    lead = updateCustomerLead(lead, { state: "cancelled", last_message_id: msg.id && msg.id._serialized, last_text: body });
    await sendBotText(chatId, "تم إلغاء الطلب. عند الحاجة اكتب مرحبًا للبدء من جديد.");
    return;
  }
  if (lead.state === "cancelled" || lead.state === "completed") {
    lead = updateCustomerLead(lead, { state: "awaiting_direction", direction: null, travel_mode: null, travel_date: null, travelers_count: null, last_message_id: msg.id && msg.id._serialized, last_text: body });
  }
  if (lead.state === "awaiting_direction") {
    const direction = customerDirection(text);
    if (!direction) {
      await sendBotText(chatId, "اكتب رقم الخيار فقط: 1 الأردن إلى سوريا، 2 سوريا إلى الأردن، أو 3 نقل داخل الأردن.");
      return;
    }
    lead = updateCustomerLead(lead, { direction, state: "awaiting_mode", last_message_id: msg.id && msg.id._serialized, last_text: body });
    await sendBotText(chatId, "ممتاز. اختر طريقة السفر:\n1️⃣ سفر بري\n2️⃣ عبر المطار");
    return;
  }
  if (lead.state === "awaiting_mode") {
    const mode = customerMode(text);
    if (!mode) {
      await sendBotText(chatId, "اكتب 1 للسفر البري أو 2 للسفر عبر المطار.");
      return;
    }
    lead = updateCustomerLead(lead, { travel_mode: mode, state: "awaiting_date", last_message_id: msg.id && msg.id._serialized, last_text: body });
    await sendBotText(chatId, "اكتب تاريخ السفر والوقت المطلوب، مثال: 15/09 الساعة 8 صباحًا.");
    return;
  }
  if (lead.state === "awaiting_date") {
    lead = updateCustomerLead(lead, { travel_date: body, state: "awaiting_passengers", last_message_id: msg.id && msg.id._serialized, last_text: body });
    await sendBotText(chatId, "كم عدد المسافرين؟ اكتب العدد فقط.");
    return;
  }
  if (lead.state === "awaiting_passengers") {
    const count = Number((body.match(/\d+/) || [""])[0]);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      await sendBotText(chatId, "اكتب عدد المسافرين من 1 إلى 50.");
      return;
    }
    lead = updateCustomerLead(lead, { travelers_count: count, state: "completed", last_message_id: msg.id && msg.id._serialized, last_text: body });
    audit("customer.lead.completed", "customer_lead", lead.id, { phone, direction: lead.direction, travelMode: lead.travel_mode, travelersCount: count });
    const directionLabel = { jo_to_syria: "الأردن ← سوريا", syria_to_jo: "سوريا ← الأردن", inside_jo: "داخل الأردن" }[lead.direction] || "غير محدد";
    const modeLabel = lead.travel_mode === "road" ? "سفر بري" : "عبر المطار";
    await sendBotText(chatId, `تم استلام طلبك بنجاح.\n\nالمسار: ${directionLabel}\nالطريقة: ${modeLabel}\nالتاريخ والوقت: ${lead.travel_date}\nعدد المسافرين: ${count}\n\nسيتم التواصل معك من خدمة عملاء شركة الجراح لتأكيد التفاصيل والسعر.`);
  }
}
function ensureBlockedPhones() {
  const insert = db.prepare("INSERT OR IGNORE INTO blocked_phones(phone,note,created_at) VALUES(?,?,?)");
  for (const value of BLOCKED_PHONES) insert.run(phoneWithCountry(value), "مستبعد نهائيًا من القروب والنظام", now());
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
  if (getSetting("special_order_rate_bps") === null) setSetting("special_order_rate_bps", SPECIAL_ORDER_RATE_BPS);
  if (getSetting("company_from_producer_rate_bps") === null) setSetting("company_from_producer_rate_bps", COMPANY_FROM_PRODUCER_RATE_BPS);
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
function isGroupSetupOwner(phone) { return GROUP_SETUP_OWNER_PHONES.has(phoneWithCountry(phone)); }
function configureGroupId(groupId, groupName) {
  const stamp = now();
  db.prepare("INSERT INTO groups_config(group_id,group_name,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(group_id) DO UPDATE SET group_name=excluded.group_name,active=1,updated_at=excluded.updated_at").run(groupId, groupName, stamp, stamp);
  setSetting("group_id", groupId);
  audit("group.configured", "group", groupId, { groupName });
}
function isConfiguredGroup(groupId) {
  const configured = db.prepare("SELECT COUNT(*) AS count FROM groups_config WHERE active=1").get().count;
  return configured > 0 && Boolean(configuredGroup(groupId));
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
    orderKind: /(?:^|\s)(?:اوردر|order)(?:$|\s)/i.test(normalized) ? "order" : "normal",
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
function brandedMessage(title, lines = []) {
  return [
    "╭━━━ ✦ شركة الجراح ✦ ━━━╮",
    `┃ ${title}`,
    "┣━━━━━━━━━━━━━━━━━━━━━━┫",
    ...lines.map((line) => `┃ ${line}`),
    "╰━━━ نقل أسرع • تنظيم أدق ━━━╯",
  ].join("\n");
}
function formatAcceptance(order, captain, producer) {
  return brandedMessage("تم قبول الطلب", [
    `🆔 رقم الطلب: #${order.order_no}`,
    `👤 المنتج: ${producer ? producer.name : "غير محدد"}`,
    `🚕 الكابتن: ${captain.name}`,
    `💰 القيمة الكاملة للرحلة: ${money(order.price_cents)} JOD`,
    `🧾 نوع الطلب: ${order.order_kind === "order" ? "أوردر محدد" : "طلب عادي"}`,
    `💼 المخصوم من رصيد المنفّذ: ${money(order.producer_cents)} JOD`,
    `📊 صافي حصة المنتج: ${money(order.producer_cents - order.company_cents)} JOD | حصة الشركة: ${money(order.company_cents)} JOD`,
  ]);
}

let client = null;
let isReady = false;
let qrCodeData = null;
let lastQrTime = null;
let reconnectTimer = null;
let initializing = false;
let groupCreateInFlight = false;
let groupJoinInFlight = false;
let connectionGeneration = 0;

const puppeteerConfig = {
  headless: true,
  protocolTimeout: 120000,
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
  const isGroup = Boolean(msg.from && String(msg.from).endsWith("@g.us"));
  if (!isGroup) return handleCustomerMessage(msg);
  const contact = await withTimeout(msg.getContact(), 8000, null);
  const senderPhone = phoneWithCountry(contact && contact.number ? contact.number : msg.author || "");
  const body = String(msg.body || "").trim();
  if (!isConfiguredGroup(msg.from)) {
    if (isGroupSetupOwner(senderPhone) && /^#(?:اعتماد|ربط|اعتمد)\\s*(?:القروب|المجموعة)?$/i.test(body)) {
      configureGroupId(msg.from, "الجراح | شبكة التشغيل الرسمية");
      console.log(`[GroupSetup] configured group from owner command: ${msg.from}`);
    }
    return;
  }
  if (isBlockedPhone(senderPhone)) {
    console.warn(`[Policy] blocked phone ignored: ${senderPhone}`);
    return;
  }
  const senderName = (contact && (contact.pushname || contact.name)) || msg._data?.notifyName || displayPhone(senderPhone);
  if (!body) return;
  const stamp = now();
  const inserted = db.prepare("INSERT OR IGNORE INTO messages(message_id,group_id,sender_phone,sender_name,body,message_type,sent_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run(msg.id._serialized, msg.from, senderPhone, senderName, body, msg.type || "text", new Date(Number(msg.timestamp || Date.now() / 1000) * 1000).toISOString(), stamp);
  if (!inserted.changes) return;
  const parsed = parseOrder(body);
  if (parsed.isOrder) {
    const producer = upsertUser({ phone: senderPhone, name: senderName, role: "producer" });
    const orderNo = Number(db.prepare("SELECT COALESCE(MAX(order_no),0)+1 AS next FROM orders").get().next);
    const result = db.prepare("INSERT INTO orders(order_no,source_message_id,group_id,raw_text,price_cents,origin,destination,trip_time,order_kind,producer_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(orderNo, msg.id._serialized, msg.from, body, cents(parsed.price), parsed.origin, parsed.destination, parsed.tripTime, parsed.orderKind, producer.id, "open", stamp, stamp);
    audit("order.created", "order", result.lastInsertRowid, { orderNo, groupId: msg.from });
    console.log(`[Order] #${orderNo} created from ${msg.from}`);
    return;
  }
  if (!isCaptainAcceptance(body)) return;
  const quoted = msg.hasQuotedMsg ? await withTimeout(msg.getQuotedMessage(), 8000, null) : null;
  const order = findOrderByQuotedId(quoted && quoted.id ? quoted.id._serialized : null) || latestOpenOrder(msg.from);
  if (!order) return;
  const captain = upsertUser({ phone: senderPhone, name: senderName, role: "captain" });
  const rateProducer = Number(getSetting("producer_rate_bps", PRODUCER_RATE_BPS));
  const rateSpecialOrder = Number(getSetting("special_order_rate_bps", SPECIAL_ORDER_RATE_BPS));
  const rateCompanyFromProducer = Number(getSetting("company_from_producer_rate_bps", COMPANY_FROM_PRODUCER_RATE_BPS));
  const settlement = calculateSettlement({ priceCents: order.price_cents, orderKind: order.order_kind, regularProducerRateBps: rateProducer, specialOrderProducerRateBps: rateSpecialOrder, companyFromProducerRateBps: rateCompanyFromProducer });
  if (captain.wallet_cents < settlement.captainFeeCents || captain.wallet_cents <= CAPTAIN_MIN_BALANCE_CENTS) {
    await msg.react("⚠️").catch(() => {});
    await client.sendMessage(msg.from, brandedMessage("تعذر تثبيت الطلب", [`⚠️ الكابتن ${captain.name} لا يملك رصيدًا يغطي خصم ${money(settlement.captainFeeCents)} JOD.`, "اطلب بطاقة شحن من خدمة العملاء داخل النظام."])).catch(() => {});
    audit("order.rejected.insufficient_wallet", "order", order.id, { captainId: captain.id, requiredCents: settlement.captainFeeCents, balanceCents: captain.wallet_cents });
    return;
  }
  const companyCents = settlement.companyCents;
  const producerCents = settlement.producerFeeCents;
  const captainCents = settlement.captainGrossCents;
  const producer = order.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(order.producer_user_id) : null;
  const accept = db.transaction(() => {
    const current = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
    if (!current || current.status !== "open") return false;
    const stampNow = now();
    db.prepare("UPDATE orders SET status='accepted', captain_user_id=?, accepted_message_id=?, accepted_at=?, company_cents=?, producer_cents=?, captain_cents=?, updated_at=? WHERE id=? AND status='open'").run(captain.id, msg.id._serialized, stampNow, companyCents, producerCents, captainCents, stampNow, order.id);
    const company = companyUser();
    const companyBalance = Number(company.wallet_cents || 0) + companyCents;
    db.prepare("UPDATE users SET wallet_cents=?, updated_at=? WHERE id=?").run(companyBalance, stampNow, company.id);
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?,?)").run(company.id, order.id, "commission_company", companyCents, companyBalance, `ORDER-${current.order_no}`, "15% من حصة المنتج", stampNow);
    if (producer) {
      const producerBalance = Number(producer.wallet_cents || 0) + settlement.producerNetCents;
      db.prepare("UPDATE users SET wallet_cents=?, updated_at=? WHERE id=?").run(producerBalance, stampNow, producer.id);
      db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?,?)").run(producer.id, order.id, "commission_producer", settlement.producerNetCents, producerBalance, `ORDER-${current.order_no}`, "صافي حصة المنتج بعد حصة الشركة", stampNow);
    }
    const captainBalance = Number(captain.wallet_cents || 0) - settlement.captainFeeCents;
    db.prepare("UPDATE users SET wallet_cents=?, updated_at=? WHERE id=?").run(captainBalance, stampNow, captain.id);
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?,?)").run(captain.id, order.id, "captain_fee", -settlement.captainFeeCents, captainBalance, `ORDER-${current.order_no}`, order.order_kind === "order" ? "خصم 20% من رصيد المنفّذ لأوردر" : "خصم 15% من رصيد المنفّذ");
    audit("order.accepted", "order", order.id, { captainId: captain.id, orderKind: order.order_kind, companyCents, producerFeeCents: settlement.producerFeeCents, producerNetCents: settlement.producerNetCents, captainFeeCents: settlement.captainFeeCents, captainGrossCents: settlement.captainGrossCents });
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
  if (ADMIN_TOKEN && header.startsWith("Bearer ") && constantTimeEquals(header.slice(7), ADMIN_TOKEN)) return true;
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
  if (!consumeRateLimit(loginRate, clientAddress(req), 10)) return res.status(429).json({ error: "Too many login attempts; try again later" });
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
app.get("/status", (req, res) => res.json({ ready: isReady, hasQr: Boolean(qrCodeData), lastQrTime, phone: BOT_PHONE, groupConfigured: Boolean(getSetting("group_id", null)), uptime: process.uptime() }));
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

app.post("/api/admin/group/check-phones", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const rawPhones = Array.isArray(req.body.phones) ? req.body.phones : [];
  const phones = [...new Set(rawPhones.map(phoneWithCountry).filter(Boolean))];
  if (phones.length < 1 || phones.length > 4) return res.status(400).json({ error: "Provide between 1 and 4 participant phone numbers" });
  if (phones.some((phone) => !isValidJordanPhone(phone))) return res.status(400).json({ error: "Participant phones must be valid Jordan mobile numbers" });
  if (phones.some(isBlockedPhone)) return res.status(403).json({ error: "One or more phones are blocked by company policy" });
  if (phones.includes(phoneWithCountry(BOT_PHONE)) || phones.includes(phoneWithCountry(BOT_PHONE_INTL))) return res.status(400).json({ error: "The bot phone must not be listed as a participant" });
  const results = [];
  for (const phone of phones) {
    const id = await withTimeout(client.getNumberId(phone), 20000, null);
    results.push({ phone: displayPhone(phone), registered: Boolean(id), id: id ? id._serialized : null });
  }
  res.json({ success: true, phones: results });
});

app.post("/api/admin/group/create", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupCreateInFlight) return res.status(409).json({ error: "A group creation request is already in progress" });
  if (getSetting("group_id", null)) return res.status(409).json({ error: "A production group is already configured" });
  const groupName = String(req.body.groupName || "الجراح للنقل والخدمات اللوجستية — الطلبات الرسمية").trim();
  const rawPhones = Array.isArray(req.body.phones) ? req.body.phones : [];
  const phones = [...new Set(rawPhones.map(phoneWithCountry).filter(Boolean))];
  if (!groupName || groupName.length > 100) return res.status(400).json({ error: "Invalid group name" });
  if (phones.length < 1 || phones.length > 4) return res.status(400).json({ error: "Provide between 1 and 4 participant phone numbers" });
  if (phones.some((phone) => !isValidJordanPhone(phone))) return res.status(400).json({ error: "Participant phones must be valid Jordan mobile numbers" });
  if (phones.some(isBlockedPhone)) return res.status(403).json({ error: "One or more phones are blocked by company policy" });
  if (phones.includes(phoneWithCountry(BOT_PHONE)) || phones.includes(phoneWithCountry(BOT_PHONE_INTL))) return res.status(400).json({ error: "The bot phone is the group creator and must not be listed as a participant" });
  groupCreateInFlight = true;
  console.log(`[GroupCreate] validating ${phones.length} participant(s)`);
  try {
    const participantIds = [];
    for (const phone of phones) {
      console.log(`[GroupCreate] looking up ${displayPhone(phone)}`);
      const id = await withTimeout(client.getNumberId(phone), 20000, null);
      if (!id) return res.status(400).json({ error: "Phone is not registered on WhatsApp or lookup timed out", phone: displayPhone(phone) });
      participantIds.push(id._serialized || `${phone}@c.us`);
    }
    console.log("[GroupCreate] creating WhatsApp group");
    const created = await withTimeout(client.createGroup(groupName, participantIds), 60000, null);
    if (!created) return res.status(504).json({ error: "WhatsApp group creation timed out; no group was configured" });
    if (typeof created === "string") return res.status(502).json({ error: "WhatsApp could not create the group", details: created });
    const groupId = created && created.gid ? (created.gid._serialized || String(created.gid)) : (created && created.id ? (created.id._serialized || String(created.id)) : null);
    if (!groupId || !groupId.endsWith("@g.us")) return res.status(502).json({ error: "WhatsApp returned an invalid group identifier" });
    const stamp = now();
    db.prepare("INSERT INTO groups_config(group_id,group_name,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(group_id) DO UPDATE SET group_name=excluded.group_name,active=1,updated_at=excluded.updated_at").run(groupId, groupName, stamp, stamp);
    setSetting("group_id", groupId);
    audit("group.created_and_configured", "group", groupId, { groupName, participants: phones });
    res.status(201).json({ success: true, groupId, groupName, participants: phones.map(displayPhone), messageSent: false });
  } catch (error) {
    res.status(502).json({ error: "Unable to create WhatsApp group", details: error.message });
  } finally {
    groupCreateInFlight = false;
  }
});

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

app.post("/api/admin/group/invite-info", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const inviteCode = extractInviteCode(req.body.inviteLink || req.body.inviteCode || "");
  if (!inviteCode || inviteCode.length < 10) return res.status(400).json({ error: "Valid WhatsApp invite link is required" });
  const info = await withTimeout(client.getInviteInfo(inviteCode), 20000, null);
  if (!info) return res.status(504).json({ error: "Invite information lookup timed out" });
  res.json({ success: true, invite: { subject: info.subject || null, id: info.id && (info.id._serialized || String(info.id)) || null, size: info.size || null } });
});

app.post("/api/admin/group/join-invite", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupJoinInFlight) return res.status(409).json({ error: "A group join request is already in progress" });
  const inviteCode = extractInviteCode(req.body.inviteLink || req.body.inviteCode || "");
  const groupName = String(req.body.groupName || "قروب الجراح").trim();
  if (!inviteCode || inviteCode.length < 10) return res.status(400).json({ error: "Valid WhatsApp invite link is required" });
  groupJoinInFlight = true;
  try {
    const groupId = await withTimeout(client.acceptInvite(inviteCode), 60000, null);
    if (!groupId) return res.status(504).json({ error: "WhatsApp invite acceptance timed out; group was not configured" });
    const stamp = now();
    db.prepare("INSERT INTO groups_config(group_id,group_name,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(group_id) DO UPDATE SET group_name=excluded.group_name,active=1,updated_at=excluded.updated_at").run(groupId, groupName, stamp, stamp);
    setSetting("group_id", groupId);
    audit("group.joined_and_configured", "group", groupId, { groupName });
    res.json({ success: true, groupId, groupName });
  } catch (error) {
    res.status(502).json({ error: "Unable to join group", details: error.message });
  } finally {
    groupJoinInFlight = false;
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
  if (!consumeRateLimit(redeemRate, clientAddress(req), 12)) return res.status(429).json({ error: "Too many redemption attempts; try again later" });
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
app.post("/api/support/tickets", (req, res) => {
  if (!consumeRateLimit(redeemRate, clientAddress(req), 8)) return res.status(429).json({ error: "Too many support requests; try again later" });
  const requesterName = String(req.body.requesterName || "").trim().slice(0, 120);
  const accountRef = String(req.body.accountRef || "").trim().slice(0, 120);
  const category = String(req.body.category || "general").trim();
  const message = String(req.body.message || "").trim().slice(0, 2000);
  const requestedValue = req.body.requestedValue === undefined || req.body.requestedValue === "" ? null : Number(req.body.requestedValue);
  if (!requesterName || !message || !SUPPORT_CATEGORIES.has(category)) return res.status(400).json({ error: "requesterName, category and message are required" });
  if (category === "topup_card" && (!Number.isFinite(requestedValue) || requestedValue <= 0 || requestedValue > 1000)) return res.status(400).json({ error: "A valid top-up value is required" });
  if (accountRef && isBlockedPhone(accountRef)) return res.status(403).json({ error: "This account is blocked by company policy" });
  const ticketCode = createTicketCode();
  const stamp = now();
  const result = db.prepare("INSERT INTO support_tickets(ticket_code,requester_name,account_ref,category,message,requested_value_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'new',?,?)").run(ticketCode, requesterName, accountRef || null, category, message, requestedValue === null ? null : cents(requestedValue), stamp, stamp);
  audit("support.ticket.created", "support_ticket", result.lastInsertRowid, { ticketCode, category });
  res.status(201).json({ success: true, ticketCode, status: "new", message: "تم تسجيل طلبك داخل خدمة العملاء" });
});
app.get("/api/admin/support-tickets", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 200").all();
  res.json({ tickets: rows.map((row) => ({ ...row, requestedValue: row.requested_value_cents === null ? null : money(row.requested_value_cents) })) });
});
app.patch("/api/admin/support-tickets/:id", requireAdmin, (req, res) => {
  const ticketId = Number(req.params.id);
  const status = String(req.body.status || "").trim();
  const allowed = new Set(["new", "in_progress", "resolved", "closed"]);
  if (!Number.isInteger(ticketId) || !allowed.has(status)) return res.status(400).json({ error: "Invalid ticket or status" });
  const adminReply = String(req.body.adminReply || "").trim().slice(0, 2000) || null;
  const result = db.prepare("UPDATE support_tickets SET status=?,admin_reply=?,updated_at=? WHERE id=?").run(status, adminReply, now(), ticketId);
  if (!result.changes) return res.status(404).json({ error: "Ticket not found" });
  audit("support.ticket.updated", "support_ticket", ticketId, { status });
  res.json({ success: true, status });
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
  const customerLeads = db.prepare("SELECT COUNT(*) AS count FROM customer_leads WHERE state NOT IN ('cancelled')").get().count;
  res.json({ orders, accepted, customerLeads, companyBalance: money(company.wallet_cents), wallets, ledgerMoves, cards: { issued: issuedCards, redeemed: redeemedCards, void: voidCards }, groupId: getSetting("group_id", null), rules: { company: "15%", producer: "15%", captain: "70%" } });
});
app.get("/api/admin/leads", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id,phone,name,direction,travel_mode,travel_date,travelers_count,state,created_at,updated_at FROM customer_leads ORDER BY updated_at DESC LIMIT 200").all();
  res.json({ leads: rows });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT o.*, p.name AS producer_name, c.name AS captain_name FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id LEFT JOIN users c ON c.id=o.captain_user_id ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ orders: rows.map((row) => ({ ...row, price: money(row.price_cents), company: money(row.company_cents), producerGross: money(row.producer_cents), producer: money(row.producer_cents - row.company_cents), captain: money(row.captain_cents), captainFee: money(row.producer_cents), orderType: row.order_kind === "order" ? "أوردر محدد" : "طلب عادي" })) });
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
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 30)) return res.status(429).json({ error: "Too many administrative actions; try again later" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const to = String(req.body.to || "").trim();
  const message = String(req.body.message || "").trim();
  if (!to || !message) return res.status(400).json({ error: "to and message are required" });
  const chatId = to.endsWith("@g.us") || to.endsWith("@c.us") ? to : `${cleanPhone(to)}@c.us`;
  if (chatId.endsWith("@c.us") && isBlockedPhone(chatId.slice(0, -5))) return res.status(403).json({ error: "This phone is blocked by company policy" });
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
