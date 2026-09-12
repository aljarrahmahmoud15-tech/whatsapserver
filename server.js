const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const v8 = require("v8");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pino = require("pino");
const { execFileSync } = require("child_process");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const sharp = require("sharp");
sharp.concurrency(1);
sharp.cache({ memory: 8, files: 0, items: 4 });
const { calculateSettlement } = require("./finance");
const { isBotGeneratedMessage, isBotReactionSender, isBotFinancialRole } = require("./message_guardrails");

const app = express();
app.set("trust proxy", 1);
app.use((req, res, next) => {
    req.session = req.session || {};
    req.session.user = { role: 'admin', username: 'admin' };
    next();
});
const PORT = Number(process.env.PORT || 10000);
const LEGACY_BOT_PHONE = "0779110123";
const LEGACY_BOT_PHONE_INTL = "962779110123";
const BOT_PHONE = process.env.BOT_PHONE?.trim() || "0779110123";
const BOT_PHONE_INTL = process.env.BOT_PHONE_INTL?.trim() || "962779110123";
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID?.trim() || "";
const WHATSAPP_GROUP_NAME = process.env.WHATSAPP_GROUP_NAME?.trim() || "قروب التشغيل المحدد من البيئة";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const AUTH_PATH = process.env.AUTH_PATH || path.join(DATA_DIR, ".wwebjs_auth");
const BAILEYS_AUTH_PATH = process.env.BAILEYS_AUTH_PATH || path.join(DATA_DIR, ".baileys_auth");
const PUBLIC_APP_URL = String(process.env.PUBLIC_BASE_URL || "https://whatsapserver-2.onrender.com").replace(/\/$/, "");
const runningOnRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_INSTANCE_ID);
if (runningOnRender && path.resolve(DATA_DIR) !== "/app/data") {
  throw new Error(`Persistent DATA_DIR is required on Render; received ${DATA_DIR}`);
}
// Baileys is an optional second WhatsApp connection. Keep it off by default on Render
// so the primary whatsapp-web.js session has the available memory and one QR/session.
const BAILEYS_ENABLED = process.env.BAILEYS_ENABLED === "true";
const QR_PUBLIC = process.env.QR_PUBLIC === "true";
const QR_START_TIME = Date.now();
const QR_PUBLIC_DURATION_MS = 15 * 60 * 1000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DASHBOARD_API_TOKEN = process.env.DASHBOARD_API_TOKEN || "";
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_TOKEN || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Aljarah";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Jojo1987@";
const OWNER_DIRECT_TOKEN = process.env.OWNER_DIRECT_TOKEN || "";
const OWNER_DIRECT_EXPIRES_AT = Number(process.env.OWNER_DIRECT_EXPIRES_AT || 0);
const CAPTAIN_USERNAME = process.env.CAPTAIN_USERNAME || process.env.ADMIN_USERNAME || "admin";
const CAPTAIN_PASSWORD = process.env.CAPTAIN_PASSWORD || process.env.ADMIN_PASSWORD || "9871040319";
const CAPTAIN_PASSWORD_HASH = process.env.CAPTAIN_PASSWORD_HASH || ADMIN_PASSWORD_HASH;
const CAPTAIN_SESSION_SECRET = JWT_SECRET || ADMIN_TOKEN || crypto.randomBytes(32).toString("hex");
const CAPTAIN_MIN_BALANCE_CENTS = Number(process.env.CAPTAIN_MIN_BALANCE_CENTS || -200);
const BOT_FINANCIAL_MODE = process.env.BOT_FINANCIAL_MODE || "company";
const WHATSAPP_CLIENT_ID = process.env.WHATSAPP_CLIENT_ID?.trim() || "aljarah-main-v2";
const COMPANY_RATE_BPS = Number(process.env.COMPANY_RATE_BPS || 1500);
const PRODUCER_RATE_BPS = Number(process.env.PRODUCER_RATE_BPS || 1500);
const SPECIAL_ORDER_RATE_BPS = Number(process.env.SPECIAL_ORDER_RATE_BPS || 2000);
const COMPANY_FROM_PRODUCER_RATE_BPS = Number(process.env.COMPANY_FROM_PRODUCER_RATE_BPS || 1500);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 120);
const QR_RATE_LIMIT_MAX = Number(process.env.QR_RATE_LIMIT_MAX || 3000);
const WHATSAPP_INIT_TIMEOUT_MS = Number(process.env.WHATSAPP_INIT_TIMEOUT_MS || 300000);
const WHATSAPP_GROUP_CREATE_TIMEOUT_MS = Number(process.env.WHATSAPP_GROUP_CREATE_TIMEOUT_MS || 180000);
const WHATSAPP_RECONNECT_BASE_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_BASE_DELAY_MS || 5000);
const WHATSAPP_RECONNECT_MAX_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS || 120000);
const WHATSAPP_RECONNECT_MAX_ATTEMPTS = Number(process.env.WHATSAPP_RECONNECT_MAX_ATTEMPTS || 20);
const GROUP_BRAND_NAME = "شركة الجراح | شبكة التشغيل اللوجستي";
const GROUP_BRAND_DESCRIPTION = "قروب التشغيل الرسمي لشركة الجراح للنقل والخدمات اللوجستية. هنا تُنشر الطلبات، يستلم الكابتن الرحلة، ويجري التوثيق وفق نظام الشركة.";
const GROUP_BRAND_IMAGE_URL = process.env.GROUP_BRAND_IMAGE_URL || "https://3000-igl6dwmxr017cr8770kph-08c34cbc.sg1.manus.computer/manus-storage/aljarah-group-avatar-final_cebe4f44.png";
const GROUP_BRAND_WELCOME = "أهلًا بكم في شبكة التشغيل اللوجستي لشركة الجراح.\n\nالطلبات والرحلات والمحافظ تُدار بمسار واضح وموثق. يرجى الالتزام بصيغة الطلب المعتمدة، وعدم إرسال أي طلب ناقص التفاصيل.\n\nخدمة العملاء جاهزة للمساعدة داخل النظام.";
const loginRate = new Map();
const redeemRate = new Map();
const adminActionRate = new Map();
const apiRate = new Map();
const qrRate = new Map();
const cardDeliveryInFlight = new Set();

fs.mkdirSync(DATA_DIR, { recursive: true });
const PERSISTED_ADMIN_TOKEN_PATH = path.join(DATA_DIR, "admin-token");
let activeAdminToken = ADMIN_TOKEN;
if (!activeAdminToken) {
  try {
    activeAdminToken = fs.readFileSync(PERSISTED_ADMIN_TOKEN_PATH, "utf8").trim();
  } catch {}
}
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
app.use("/api", (req, res, next) => {
  if (!consumeRateLimit(apiRate, clientAddress(req), API_RATE_LIMIT_MAX)) {
    return res.status(429).json({ error: "Too many API requests; try again later" });
  }
  next();
});
app.get("/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, service: "whatsapserver", whatsapp: whatsappState, ready: Boolean(isReady) });
});
app.get("/captain/register", (req, res) => {
  const token = getSetting("captain_public_invite_token", null);
  if (!token) return res.status(503).send("Captain registration link is not ready");
  res.redirect(`/captain?invite=${encodeURIComponent(token)}`);
});
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});
app.get("/owner-direct", (req, res) => {
  const provided = String(req.query.token || "");
  const validToken = OWNER_DIRECT_TOKEN && constantTimeEquals(provided, OWNER_DIRECT_TOKEN);
  const validTime = OWNER_DIRECT_EXPIRES_AT > Date.now();
  if (!validToken || !validTime || !JWT_SECRET) return res.status(401).send("رابط الدخول المباشر غير صالح أو انتهت صلاحيته");
  setSessionCookie(res, jwt.sign({ role: "company", username: ADMIN_USERNAME, direct: true }, JWT_SECRET, { expiresIn: "30m" }));
  res.setHeader("Referrer-Policy", "no-referrer");
  res.redirect(302, "/");
});
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
  is_bot INTEGER NOT NULL DEFAULT 0,
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
  details_json TEXT,
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
  assigned_captain_id INTEGER,
  sent_at TEXT,
  delivery_idempotency_key TEXT,
  issue_idempotency_key TEXT,
  code_ciphertext TEXT,
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
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_phone TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  event TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS captain_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  token_last8 TEXT NOT NULL,
  token_ciphertext TEXT,
  status TEXT NOT NULL CHECK(status IN ('issued','pending','approved','rejected','expired')) DEFAULT 'issued',
  name TEXT,
  phone TEXT,
  pin_hash TEXT,
  pin_ciphertext TEXT,
  approved_user_id INTEGER,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submitted_at TEXT,
  decided_at TEXT,
  FOREIGN KEY(approved_user_id) REFERENCES users(id)
);
`);

const existingInviteColumns = db.prepare("PRAGMA table_info(captain_invites)").all().map((column) => column.name);
if (!existingInviteColumns.includes("token_ciphertext")) db.exec("ALTER TABLE captain_invites ADD COLUMN token_ciphertext TEXT");
const existingLedgerColumns = db.prepare("PRAGMA table_info(wallet_ledger)").all().map((column) => column.name);
if (!existingLedgerColumns.includes("details_json")) db.exec("ALTER TABLE wallet_ledger ADD COLUMN details_json TEXT");
const existingUserColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!existingUserColumns.includes("is_bot")) db.exec("ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0");
if (!existingUserColumns.includes("captain_pin_hash")) db.exec("ALTER TABLE users ADD COLUMN captain_pin_hash TEXT");
if (!existingUserColumns.includes("captain_pin_ciphertext")) db.exec("ALTER TABLE users ADD COLUMN captain_pin_ciphertext TEXT");
const existingOrderColumns = db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name);
if (!existingOrderColumns.includes("order_kind")) db.exec("ALTER TABLE orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'normal'");
if (!existingOrderColumns.includes("pending_captain_user_id")) db.exec("ALTER TABLE orders ADD COLUMN pending_captain_user_id INTEGER");
if (!existingOrderColumns.includes("pending_message_id")) db.exec("ALTER TABLE orders ADD COLUMN pending_message_id TEXT");
if (!existingOrderColumns.includes("pending_at")) db.exec("ALTER TABLE orders ADD COLUMN pending_at TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_pending_message ON orders(pending_message_id)");
const existingCardColumns = db.prepare("PRAGMA table_info(topup_cards)").all().map((column) => column.name);
if (!existingCardColumns.includes("assigned_captain_id")) db.exec("ALTER TABLE topup_cards ADD COLUMN assigned_captain_id INTEGER");
if (!existingCardColumns.includes("sent_at")) db.exec("ALTER TABLE topup_cards ADD COLUMN sent_at TEXT");
if (!existingCardColumns.includes("delivery_idempotency_key")) db.exec("ALTER TABLE topup_cards ADD COLUMN delivery_idempotency_key TEXT");
if (!existingCardColumns.includes("issue_idempotency_key")) db.exec("ALTER TABLE topup_cards ADD COLUMN issue_idempotency_key TEXT");
if (!existingCardColumns.includes("code_ciphertext")) db.exec("ALTER TABLE topup_cards ADD COLUMN code_ciphertext TEXT");
if (!existingCardColumns.includes("void_idempotency_key")) db.exec("ALTER TABLE topup_cards ADD COLUMN void_idempotency_key TEXT");
if (!existingCardColumns.includes("redemption_idempotency_key")) db.exec("ALTER TABLE topup_cards ADD COLUMN redemption_idempotency_key TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_cards_issue_idempotency ON topup_cards(issue_idempotency_key) WHERE issue_idempotency_key IS NOT NULL AND issue_idempotency_key <> ''");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_cards_delivery_idempotency ON topup_cards(delivery_idempotency_key) WHERE delivery_idempotency_key IS NOT NULL AND delivery_idempotency_key <> ''");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_cards_void_idempotency ON topup_cards(void_idempotency_key) WHERE void_idempotency_key IS NOT NULL AND void_idempotency_key <> ''");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_cards_redemption_idempotency ON topup_cards(redemption_idempotency_key) WHERE redemption_idempotency_key IS NOT NULL AND redemption_idempotency_key <> ''");

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
const cardEncryptionSecret = String(DASHBOARD_API_TOKEN || JWT_SECRET || "").trim();
const cardEncryptionKey = cardEncryptionSecret ? crypto.createHash("sha256").update(cardEncryptionSecret).digest() : null;
function encryptCardCode(code) {
  if (!cardEncryptionKey) throw new Error("Card encryption is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cardEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(code), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
function decryptCardCode(payload) {
  if (!cardEncryptionKey || !payload) throw new Error("Card delivery encryption is not configured");
  const [ivValue, tagValue, ciphertextValue] = String(payload).split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Card code payload is invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", cardEncryptionKey, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}
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
const GROUP_SETUP_OWNER_PHONES = new Set(["+962779110123", ...(process.env.GROUP_SETUP_OWNER_PHONES || "+962785217886").split(",")].map(phoneWithCountry).filter(Boolean));
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
function withTimeoutStrict(promise, timeoutMs, fallback = null) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}
async function mediaFromRemoteVideoUrl(url, index = 0) {
  const response = await fetch(String(url), { redirect: "follow", headers: { accept: "video/mp4,video/*" } });
  if (!response.ok) throw new Error(`Guide video download failed with HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!contentType.includes("video") && !String(url).toLowerCase().endsWith(".mp4")) throw new Error("Guide URL did not return a video");
  if (contentLength > 60 * 1024 * 1024) throw new Error("Guide video is larger than the safe upload limit");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 60 * 1024 * 1024) throw new Error("Guide video body is empty or too large");
  const temporaryPath = path.join(DATA_DIR, `.guide-video-${process.pid}-${Date.now()}-${index}.mp4`);
  fs.writeFileSync(temporaryPath, buffer);
  try {
    return MessageMedia.fromFilePath(temporaryPath);
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
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
async function sendBotTextRaw(to, text) {
  if (!client || !isReady) return false;
  try {
    await withTimeout(client.sendMessage(to, text), 20000, null);
    return true;
  } catch (error) {
    console.error("[WhatsApp] raw message fallback:", error.message);
    return false;
  }
}
async function sendCompanyOperationsCard(to, title, lines) {
  if (!client || !isReady) return false;
  const caption = brandedMessage(title, lines);
  try {
    const media = await withTimeout(renderOperationsMessageMedia(title, lines), 30000, null);
    if (!media) throw new Error("operations card render returned no media");
    const sent = await withTimeout(client.sendMessage(to, media, { caption }), 30000, null);
    return Boolean(sent);
  } catch (error) {
    console.error("[WhatsApp] operations card not sent because branded media failed:", error.message);
    return false;
  }
}
async function sendBotText(to, text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 10);
  return sendCompanyOperationsCard(to, "رسالة رسمية من شركة الجراح", lines);
}
async function sendCaptainOperationsCard(to, title, lines) {
  return sendCompanyOperationsCard(to, title, lines);
}
function ownerNotificationPhones() {
  return [...GROUP_SETUP_OWNER_PHONES].map(phoneWithCountry).filter((phone, index, all) => phone && !isBotPhone(phone) && all.indexOf(phone) === index);
}
async function notifyOperations({ event, title, lines, captainPhone = null, ownersOnly = false }) {
  const owners = ownerNotificationPhones();
  const recipients = (ownersOnly ? owners : [...owners, phoneWithCountry(captainPhone)]).filter((phone, index, all) => phone && all.indexOf(phone) === index);
  const results = [];
  for (const phone of recipients) {
    const recipientRole = owners.includes(phone) ? "owner" : "captain";
    const message = lines.filter(Boolean).join("\n");
    const row = db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,created_at) VALUES(?,?,?,?,?,'pending',?)").run(phone, recipientRole, event, title, message, now());
    let deliveryStatus = "failed";
    try { if (await sendCompanyOperationsCard(`${phone}@c.us`, title, lines.filter(Boolean))) deliveryStatus = "sent"; } catch (_) {}
    db.prepare("UPDATE notifications SET delivery_status=? WHERE id=?").run(deliveryStatus, row.lastInsertRowid);
    results.push({ id: row.lastInsertRowid, phone, recipientRole, deliveryStatus });
  }
  return results;
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
function boundedIntegerSetting(key, fallback, minimum, maximum) {
  const value = Number(getSetting(key, fallback));
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}
function operationalSettings() {
  return {
    reconnectBaseDelayMs: boundedIntegerSetting("whatsapp_reconnect_base_delay_ms", WHATSAPP_RECONNECT_BASE_DELAY_MS, 1000, 60000),
    reconnectMaxDelayMs: boundedIntegerSetting("whatsapp_reconnect_max_delay_ms", WHATSAPP_RECONNECT_MAX_DELAY_MS, 10000, 900000),
    reconnectMaxAttempts: boundedIntegerSetting("whatsapp_reconnect_max_attempts", WHATSAPP_RECONNECT_MAX_ATTEMPTS, 1, 100),
    initTimeoutMs: boundedIntegerSetting("whatsapp_init_timeout_ms", WHATSAPP_INIT_TIMEOUT_MS, 60000, 900000),
  };
}
function safePathHealth(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
    return { exists: true, directory: stat.isDirectory(), writable: true };
  } catch (error) {
    return { exists: false, directory: false, writable: false, error: error.code || "unavailable" };
  }
}
function storageInventory() {
  const files = [];
  const directories = [];
  let totalBytes = 0;
  const walk = (directory, relative = "", depth = 0) => {
    if (depth > 12) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        directories.push({ path: childRelative, bytes: 0 });
        walk(absolute, childRelative, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      totalBytes += stat.size;
      files.push({ path: childRelative, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  };
  walk(DATA_DIR);
  const topLevel = new Map();
  for (const file of files) {
    const key = file.path.split(path.sep)[0];
    topLevel.set(key, (topLevel.get(key) || 0) + file.bytes);
  }
  let filesystem = null;
  try {
    const stat = fs.statfsSync(DATA_DIR);
    filesystem = { totalBytes: stat.blocks * stat.bsize, freeBytes: stat.bavail * stat.bsize, availableBytes: stat.bfree * stat.bsize };
  } catch {}
  return {
    dataDir: DATA_DIR,
    totalBytes,
    fileCount: files.length,
    directoryCount: directories.length,
    filesystem,
    topLevel: [...topLevel.entries()].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes),
    largestFiles: files.sort((a, b) => b.bytes - a.bytes).slice(0, 100),
    protectedPaths: ["aljarah.sqlite", "aljarah.sqlite-wal", "aljarah.sqlite-shm", ".wwebjs_auth", ".baileys_auth"],
  };
}
function runtimeHealth() {
  const memory = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  const settings = operationalSettings();
  return {
    node: process.version,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      heapLimitBytes: heap.heap_size_limit,
    },
    storage: {
      dataDir: DATA_DIR,
      dataDirHealth: safePathHealth(DATA_DIR),
      authPathHealth: safePathHealth(AUTH_PATH),
      databaseFileHealth: safePathHealth(path.join(DATA_DIR, "aljarah.sqlite")),
    },
    whatsapp: {
      state: whatsappState,
      ready: Boolean(isReady),
      initializing: Boolean(initializing),
      qrAvailable: Boolean(qrCodeData || baileysQrCodeData),
      lastEvent: whatsappLastEvent,
      lastError: whatsappLastError,
      reconnectAttempts,
      reconnectTimerActive: Boolean(reconnectTimer),
      lastReconnectReason,
      lastReconnectAt,
      lastReadyAt,
      lastDisconnectAt,
      lastInitializationStartedAt,
      lastInitializationFinishedAt,
    },
    settings,
  };
}
function ensureSystemUsers() {
  const stamp = now();
  normalizeBotIdentity(stamp);
  const company = db.prepare("SELECT id FROM users WHERE role='company' ORDER BY id LIMIT 1").get();
  if (!company) db.prepare("INSERT INTO users(phone,name,role,created_at,updated_at) VALUES(?,?,?,?,?)").run("system-company", "شركة الجراح", "company", stamp, stamp);
  if (getSetting("company_rate_bps") === null) setSetting("company_rate_bps", COMPANY_RATE_BPS);
  if (getSetting("producer_rate_bps") === null) setSetting("producer_rate_bps", PRODUCER_RATE_BPS);
  if (getSetting("special_order_rate_bps") === null) setSetting("special_order_rate_bps", SPECIAL_ORDER_RATE_BPS);
  if (getSetting("company_from_producer_rate_bps") === null) setSetting("company_from_producer_rate_bps", COMPANY_FROM_PRODUCER_RATE_BPS);
  if (getSetting("currency") === null) setSetting("currency", "JOD");
  if (getSetting("captain_public_invite_token") === null) setSetting("captain_public_invite_token", crypto.randomBytes(24).toString("base64url"));
}
function normalizeBotIdentity(stamp = now()) {
  const primary = phoneWithCountry(BOT_PHONE_INTL || BOT_PHONE);
  const targets = new Set([BOT_PHONE, BOT_PHONE_INTL, primary].map((value) => cleanPhone(value)).filter((value) => value.length >= 9));
  if (!targets.size) return 0;
  const rows = db.prepare("SELECT id,phone FROM users").all();
  const ownerRows = rows.filter((row) => targets.has(cleanPhone(row.phone)));
  const update = db.prepare("UPDATE users SET role='producer',is_bot=1,active=1,name=?,captain_pin_hash=NULL,captain_pin_ciphertext=NULL,updated_at=? WHERE id=?");
  for (const row of ownerRows) update.run("شركة الجراح — مالك القروب والبوت", stamp, row.id);
  const ownerIds = ownerRows.map((row) => row.id);
  if (ownerIds.length) db.prepare(`UPDATE users SET is_bot=0 WHERE id NOT IN (${ownerIds.map(() => "?").join(",")}) AND is_bot=1`).run(...ownerIds);
  return ownerRows.length;
}
ensureBlockedPhones();
ensureSystemUsers();

function isBotPhone(phone) {
  const normalized = phoneWithCountry(phone);
  return normalized === phoneWithCountry(BOT_PHONE) || normalized === phoneWithCountry(BOT_PHONE_INTL);
}
function botEmployeeUser() {
  const existing = db.prepare("SELECT * FROM users WHERE is_bot=1 LIMIT 1").get();
  if (existing) return existing;
  const stamp = now();
  const result = db.prepare("INSERT INTO users(phone,name,role,wallet_cents,active,is_bot,created_at,updated_at) VALUES(?,?,?,0,1,1,?,?)").run(phoneWithCountry(BOT_PHONE), "منتج موظف — بوت شركة الجراح", "producer", stamp, stamp);
  return db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
}
function upsertUser({ phone, name, role, allowSuspended = false }) {
  const normalized = phoneWithCountry(phone) || `unknown-${Date.now()}`;
  if (isBotFinancialRole(normalized, BOT_PHONE, role)) throw new Error("Bot account cannot have a financial user role");
  if (isBlockedPhone(normalized)) throw new Error("Blocked phone is not allowed");
  const stamp = now();
  const existing = db.prepare("SELECT * FROM users WHERE phone=?").get(normalized);
  if (existing) {
    if (existing.active === 0 && existing.role !== "company" && !allowSuspended) throw new Error("Subscriber account is suspended");
    if (name && name !== existing.name) db.prepare("UPDATE users SET name=?, updated_at=? WHERE id=?").run(name, stamp, existing.id);
    return db.prepare("SELECT * FROM users WHERE id=?").get(existing.id);
  }
  const resolvedRole = role || "captain";
  const result = db.prepare("INSERT INTO users(phone,name,role,created_at,updated_at) VALUES(?,?,?,?,?)").run(normalized, name || displayPhone(normalized), resolvedRole, stamp, stamp);
  return db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
}
function companyUser() { return db.prepare("SELECT * FROM users WHERE role='company' ORDER BY id LIMIT 1").get(); }
async function suspendMemberForDebt(groupId, phone, balanceCents) {
  const normalized = phoneWithCountry(phone);
  if (!isValidJordanPhone(normalized) || balanceCents >= CAPTAIN_MIN_BALANCE_CENTS) return;
  const stamp = now();
  db.prepare("UPDATE users SET active=0,updated_at=? WHERE phone=?").run(stamp, normalized);
  audit("member.suspended_for_debt", "user", normalized, { groupId, balanceCents, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS });
  if (!client || !isReady) return;
  const chat = await withTimeout(client.getChatById(groupId), 20000, null);
  if (chat && typeof chat.removeParticipants === "function") await chat.removeParticipants([`${normalized}@c.us`]).catch((error) => console.error("[WhatsApp] debt suspension:", error.message));
}
function configuredGroup(groupId) { return db.prepare("SELECT * FROM groups_config WHERE group_id=? AND active=1").get(groupId); }
function isGroupSetupOwner(phone) { return GROUP_SETUP_OWNER_PHONES.has(phoneWithCountry(phone)); }
function configureGroupId(groupId, groupName) {
  const stamp = now();
  db.transaction(() => {
    db.prepare("UPDATE groups_config SET active=0,updated_at=? WHERE group_id<>?").run(stamp, groupId);
    db.prepare("INSERT INTO groups_config(group_id,group_name,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(group_id) DO UPDATE SET group_name=excluded.group_name,active=1,updated_at=excluded.updated_at").run(groupId, groupName, stamp, stamp);
    setSetting("group_id", groupId);
    setSetting("active_group_id", groupId);
  })();
  audit("group.configured", "group", groupId, { groupName });
}
function isConfiguredGroup(groupId) {
  const configured = db.prepare("SELECT COUNT(*) AS count FROM groups_config WHERE active=1").get().count;
  return configured > 0 && Boolean(configuredGroup(groupId));
}
function findActiveRegisteredUser(phone) {
  const normalized = phoneWithCountry(phone);
  if (!normalized) return null;
  return db.prepare("SELECT * FROM users WHERE phone=? AND active=1 LIMIT 1").get(normalized)
    || db.prepare("SELECT * FROM users WHERE phone=? AND active=1 LIMIT 1").get(String(phone || "").trim());
}
function ensureProducerUser(phone, name) {
  const normalized = phoneWithCountry(phone);
  if (!normalized) return null;
  const existing = findActiveRegisteredUser(normalized);
  if (existing) return existing;
  const stamp = now();
  db.prepare("INSERT OR IGNORE INTO users(phone,name,role,wallet_cents,active,is_bot,created_at,updated_at) VALUES(?,?, 'producer',0,1,0,?,?)")
    .run(normalized, String(name || displayPhone(normalized)).trim() || displayPhone(normalized), stamp, stamp);
  return findActiveRegisteredUser(normalized);
}
function ensureCaptainUser(phone, name) {
  const normalized = phoneWithCountry(phone);
  if (!normalized) return null;
  const existing = findActiveRegisteredUser(normalized);
  if (existing) return existing.role === "captain" ? existing : null;
  const stamp = now();
  db.prepare("INSERT OR IGNORE INTO users(phone,name,role,wallet_cents,active,is_bot,created_at,updated_at) VALUES(?,?, 'captain',0,1,0,?,?)")
    .run(normalized, String(name || displayPhone(normalized)).trim() || displayPhone(normalized), stamp, stamp);
  const captain = findActiveRegisteredUser(normalized);
  return captain && captain.role === "captain" ? captain : null;
}
function captainAppUrl(baseUrl = process.env.PUBLIC_BASE_URL || "") {
  const normalized = String(baseUrl || "").replace(/\/$/, "");
  return `${normalized || PUBLIC_APP_URL}/join.html`;
}
function captainLoginUrl(baseUrl = process.env.PUBLIC_BASE_URL || "") {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  return `${normalized || PUBLIC_APP_URL}/captain?mode=login`;
}
function captainGatewayUrl(baseUrl = process.env.PUBLIC_BASE_URL || "", inviteToken = "") {
  const gateway = captainAppUrl(baseUrl);
  return inviteToken ? `${gateway}?invite=${encodeURIComponent(inviteToken)}` : gateway;
}
async function addCaptainToConfiguredGroup(captain) {
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return { status: "group_not_configured", groupId: groupId || null };
  if (!client || !isReady) return { status: "bot_not_ready", groupId };
  const phone = phoneWithCountry(captain && captain.phone);
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return { status: "invalid_or_blocked_phone", phone };
  const chat = await withTimeout(client.getChatById(groupId), 20000, null);
  if (!chat || typeof chat.addParticipants !== "function") return { status: "group_unavailable", groupId };
  const result = await withTimeout(chat.addParticipants([`${phone}@c.us`]), 60000, null);
  if (!result || typeof result === "string") return { status: "failed", phone, error: typeof result === "string" ? result : "participant addition timed out" };
  return { status: "added_or_already_member", groupId, phone };
}
function ensureCaptainAccessCredentials(captain) {
  const phone = phoneWithCountry(captain && captain.phone);
  const current = captain && captain.id
    ? captain
    : db.prepare("SELECT id,phone,name,role,active,captain_pin_hash FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
  if (current && captain && captain.temporaryPin) return { ...current, temporaryPin: captain.temporaryPin };
  if (!current || current.captain_pin_hash) return { ...(current || captain), temporaryPin: null };
  const temporaryPin = createCaptainPin();
  db.prepare("UPDATE users SET captain_pin_hash=?,captain_pin_ciphertext=?,updated_at=? WHERE id=? AND role='captain'").run(bcrypt.hashSync(temporaryPin, 10), cardEncryptionKey ? encryptCardCode(temporaryPin) : null, now(), current.id);
  return { ...current, temporaryPin };
}
async function sendCaptainAppLink(captain, baseUrl = process.env.PUBLIC_BASE_URL || "") {
  const prepared = ensureCaptainAccessCredentials(captain);
  const phone = phoneWithCountry(prepared && prepared.phone);
  if (!isValidJordanPhone(phone)) return false;
  const pinLine = prepared.temporaryPin ? `\nالرقم السري المؤقت: ${prepared.temporaryPin}` : "";
  const lines = [
    `الكابتن: ${prepared.name || "حساب الكابتن"}`,
    "تم تسجيلك لدينا ككابتن، وحسابك جاهز للدخول.",
    `رابط الدخول المباشر: ${captainLoginUrl(baseUrl)}`,
    "الخطوة 1: افتح رابط الدخول المباشر المرفق.",
    "الخطوة 2: أدخل رقم هاتفك والرقم السري.",
    "الخطوة 3: اضغط «دخول البوابة» للوصول إلى حسابك.",
    prepared.temporaryPin ? `الرقم السري المؤقت: ${prepared.temporaryPin}` : "الرقم السري محفوظ في النظام.",
    "لا تستخدم رابطًا آخر ولا تشارك الرقم السري مع أي شخص."
  ];
  const sent = await sendCaptainOperationsCard(`${phone}@c.us`, "تم تجهيز دخول الكابتن", lines).catch(() => false);
  if (sent) void notifyOperations({ event: "captain.access_card.sent", title: "تأكيد بطاقة دخول كابتن", lines: [`الكابتن: ${prepared.name || "حساب الكابتن"}`, `رقم الهاتف: ${prepared.phone}`, "تم إرسال بطاقة الدخول المباشر الرسمية إلى الكابتن.", `الرابط: ${captainLoginUrl(baseUrl)}`], ownersOnly: true });
  return sent;
}
function groupParticipantPhone(participant) {
  const raw = participant && participant.id ? (participant.id.user || participant.id._serialized || participant.id) : participant;
  return phoneWithCountry(String(raw || "").replace(/@c\.us$/, "").split(":")[0]);
}
async function resolveGroupChat(groupId, inviteCode = "") {
  if (!groupId || !client || !isReady) return null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const chat = await withTimeout(client.getChatById(groupId), 15000, null);
    if (chat && chat.isGroup && Array.isArray(chat.participants)) return chat;
    if (inviteCode && attempt === 0) await withTimeout(client.acceptInvite(inviteCode), 60000, null);
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}
async function readGroupSnapshot(groupId) {
  if (!groupId || !client || !isReady || !client.pupPage) return null;
  return withTimeout(client.pupPage.evaluate(async (requestedId) => {
    try {
      const wid = window.require("WAWebWidFactory").createWid(requestedId);
      const collections = window.require("WAWebCollections");
      const chat = collections.Chat.get(wid) || (await window.require("WAWebFindChatAction").findOrCreateLatestChat(wid))?.chat;
      if (!chat || !chat.groupMetadata) return null;
      const groupMetadata = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
      try {
        await window.require("WAWebGroupQueryJob").queryAndUpdateGroupMetadataById({ id: requestedId });
      } catch (_) {
        if (groupMetadata?.update) await groupMetadata.update(wid);
      }
      const hydratedChat = collections.Chat.get(wid) || chat;
      const hydratedMetadata = hydratedChat.groupMetadata || chat.groupMetadata;
      const metadata = hydratedMetadata.serialize ? hydratedMetadata.serialize() : hydratedMetadata;
      const participantCollection = hydratedMetadata.participants;
      const serializedParticipants = participantCollection?.serialize ? participantCollection.serialize() : null;
      const modelParticipants = participantCollection?.getModelsArray ? participantCollection.getModelsArray() : null;
      const rawParticipants = Array.isArray(serializedParticipants) ? serializedParticipants : (Array.isArray(modelParticipants) ? modelParticipants.map((participant) => participant.serialize ? participant.serialize() : participant) : (Array.isArray(metadata?.participants) ? metadata.participants : []));
      const { toPn } = window.require("WAWebLidMigrationUtils");
      const participants = rawParticipants.map((participant) => {
        const id = participant && participant.id;
        const phoneId = id && toPn ? (toPn(id) || id) : id;
        const serialized = phoneId && (phoneId._serialized || (phoneId.server && phoneId.user ? `${phoneId.user}@${phoneId.server}` : null) || String(phoneId));
        const user = phoneId && phoneId.user ? String(phoneId.user) : String(serialized || "").split("@")[0].split(":")[0];
        return { id: serialized, user, isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin) };
      }).filter((participant) => participant.id || participant.user);
      return { id: requestedId, name: String(hydratedChat.formattedTitle || hydratedChat.name || ""), isGroup: true, participants, participantSource: Array.isArray(serializedParticipants) && serializedParticipants.length ? "serialize" : (Array.isArray(modelParticipants) && modelParticipants.length ? "models" : (Array.isArray(metadata?.participants) && metadata.participants.length ? "metadata" : "empty")), participantRawCount: rawParticipants.length };
    } catch (_) {
      return null;
    }
  }, groupId), 30000, null);
}
async function resolveReadableGroupChat(groupId) {
  if (!groupId || !client || !isReady) return null;
  let chat = await withTimeout(client.getChatById(groupId), 5000, null);
  if (chat && typeof chat.fetchMessages === "function") return chat;
  const chats = await withTimeout(client.getChats(), 8000, []);
  chat = (Array.isArray(chats) ? chats : []).find((candidate) => String(candidate?.id?._serialized || "") === groupId && candidate.isGroup) || null;
  return chat && typeof chat.fetchMessages === "function" ? chat : null;
}
async function fetchGroupHistory(groupId, limit) {
  const chat = await resolveReadableGroupChat(groupId);
  if (chat) {
    const messages = await withTimeout(chat.fetchMessages({ limit, fromMe: false }), 45000, []);
    return { chat, messages: Array.isArray(messages) ? messages : [] };
  }
  if (!client?.pupPage) return { chat: null, messages: [] };
  const messages = await withTimeout(client.pupPage.evaluate(async (requestedId, requestedLimit) => {
    try {
      const wid = window.require("WAWebWidFactory").createWid(requestedId);
      const store = window.Store || {};
      const chat = store.Chat?.get ? store.Chat.get(wid) : null;
      if (!chat?.msgs?.getModelsArray) return { chat: null, messages: [] };
      const filter = (message) => !message.isNotification && !message.id?.fromMe && String(message.from || "") === requestedId;
      let models = chat.msgs.getModelsArray().filter(filter);
      while (models.length < requestedLimit && store.ConversationMsgs?.loadEarlierMsgs) {
        const earlier = await store.ConversationMsgs.loadEarlierMsgs(chat);
        if (!earlier?.length) break;
        models = [...earlier.filter(filter), ...models];
      }
      models.sort((a, b) => Number(a.t || 0) - Number(b.t || 0));
      models = models.slice(-requestedLimit);
      const serialize = (message) => window.WWebJS?.getMessageModel ? window.WWebJS.getMessageModel(message) : message.serialize();
      return { chat: { id: requestedId, isGroup: true }, messages: models.map(serialize) };
    } catch (error) {
      return { chat: null, messages: [], error: String(error?.message || error) };
    }
  }, groupId, limit), 20000, { chat: null, messages: [] });
  return messages;
}
function createCaptainPin() {
  return String(crypto.randomInt(10000, 100000));
}
async function registerGroupMembersAsCaptains({ groupId = getSetting("group_id", null), sendLinks = true, baseUrl = process.env.PUBLIC_BASE_URL || "", inviteCode = "" } = {}) {
  if (!groupId || !isConfiguredGroup(groupId)) return { status: "group_not_configured", groupId: groupId || null, results: [] };
  if (!client || !isReady) return { status: "bot_not_ready", groupId, results: [] };
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId, inviteCode);
  if (!chat || !Array.isArray(chat.participants)) return { status: "group_unavailable", groupId, results: [] };
  const botPhones = new Set([phoneWithCountry(BOT_PHONE), phoneWithCountry(BOT_PHONE_INTL), connectedBotPhone()]);
  const participants = [...new Map(chat.participants.map((participant) => [groupParticipantPhone(participant), participant])).values()];
  const results = [];
  for (const participant of participants) {
    const phone = groupParticipantPhone(participant);
    if (!phone || botPhones.has(phone)) continue;
    if (!isValidJordanPhone(phone)) {
      results.push({ phone, status: "skipped_invalid_phone" });
      continue;
    }
    if (isBlockedPhone(phone)) {
      results.push({ phone, status: "skipped_blocked" });
      continue;
    }
    const contact = await withTimeout(client.getContactById(`${phone}@c.us`), 8000, null);
    const name = String(contact && (contact.pushname || contact.name || contact.shortName) || displayPhone(phone)).trim().slice(0, 100);
    const existing = db.prepare("SELECT id,phone,name,role,active,captain_pin_hash FROM users WHERE phone=? LIMIT 1").get(phone);
    if (existing && existing.role !== "captain") {
      results.push({ phone, name, status: "skipped_existing_role", role: existing.role });
      continue;
    }
    let captain = existing;
    let temporaryPin = null;
    if (!captain) {
      temporaryPin = createCaptainPin();
      const stamp = now();
      const result = db.prepare("INSERT INTO users(phone,name,role,wallet_cents,active,is_bot,captain_pin_hash,captain_pin_ciphertext,created_at,updated_at) VALUES(?,?, 'captain',0,1,0,?,?,?,?)").run(phone, name, bcrypt.hashSync(temporaryPin, 10), cardEncryptionKey ? encryptCardCode(temporaryPin) : null, stamp, stamp);
      captain = db.prepare("SELECT id,phone,name,role,active,captain_pin_hash FROM users WHERE id=?").get(result.lastInsertRowid);
      audit("captain.registered_from_group", "user", captain.id, { phone, groupId });
    } else if (!captain.captain_pin_hash && captain.active) {
      temporaryPin = createCaptainPin();
      db.prepare("UPDATE users SET captain_pin_hash=?,captain_pin_ciphertext=?,updated_at=? WHERE id=? AND role='captain'").run(bcrypt.hashSync(temporaryPin, 10), cardEncryptionKey ? encryptCardCode(temporaryPin) : null, now(), captain.id);
    }
    const notified = sendLinks ? await sendCaptainAppLink({ ...captain, temporaryPin }, baseUrl) : false;
    results.push({ captainId: captain.id, phone, name, status: existing ? "existing_captain" : "registered", notified, temporaryPinSent: Boolean(temporaryPin) });
  }
  return { status: "completed", groupId, totalMembers: participants.length, results };
}
async function syncActiveCaptainsToConfiguredGroup({ sendLinks = false, baseUrl = process.env.PUBLIC_BASE_URL || "" } = {}) {
  const captains = db.prepare("SELECT id,phone,name FROM users WHERE role='captain' AND active=1 ORDER BY id").all();
  const results = [];
  for (const captain of captains) {
    const membership = await addCaptainToConfiguredGroup(captain).catch((error) => ({ status: "failed", phone: captain.phone, error: error.message }));
    let notified = false;
    if (sendLinks && isValidJordanPhone(phoneWithCountry(captain.phone))) {
      notified = await sendCaptainAppLink(captain, baseUrl);
    }
    results.push({ captainId: captain.id, phone: captain.phone, membership, notified });
  }
  return results;
}
function audit(action, entityType, entityId, details, actorUserId = null) {
  db.prepare("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)").run(actorUserId, action, entityType, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, now());
}
function parseOrder(text) {
  const normalized = String(text || "").replace(/\u200f|\u200e/g, "");
  const digitPattern = "[0-9٠-٩۰-۹]";
  const normalizeDigits = (value) => String(value || "").replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  const priceMatch = normalized.match(new RegExp("السعر\\s*[:：]?\\s*(" + digitPattern + "+(?:[.,٫]" + digitPattern + "{1,2})?)", "i"));
  const price = priceMatch ? Number(normalizeDigits(priceMatch[1]).replace(/[٫,]/g, ".")) : null;
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const routeLine = lines.find((line) => /من\s+.+\s+(?:إلى|الى)\s+|من\s+.+\s+ل(?:ـ)?\s*/i.test(line)) || "";
  const route = routeLine.match(/من\s+(.+?)\s+إلى\s+(.+)/i) || routeLine.match(/من\s+(.+?)\s+الى\s+(.+)/i) || routeLine.match(/من\s+(.+?)\s+ل(?:ـ)?\s*(.+)/i);
  const requestKindMatch = normalized.match(/(?:راكب(?:ة)?|ركاب|حمولة|سيارة(?:\s+كاملة)?|سياره(?:\s+كامله)?|استقبال\s+مطار|اوردر|order)/i);
  const requestKind = Boolean(requestKindMatch);
  return {
    // الصيغة التشغيلية المعتمدة: كلمة «السعر» يتبعها الرقم فقط؛ المسار/نوع الرحلة اختياري وغير معتمد للتمييز.
    isOrder: price !== null,
    price,
    requestKind: requestKindMatch ? requestKindMatch[0].trim() : null,
    origin: route ? route[1].trim() : null,
    destination: route ? route[2].trim() : null,
    tripTime: null,
    orderKind: /(?:^|\s)(?:اوردر|order)(?:$|\s)/i.test(normalized) ? "order" : "normal",
  };
}
function createOrderRecord({ messageId, groupId, body, producer, parsed }) {
  if (!messageId || !groupId || !body || !producer || !parsed || !parsed.isOrder) return null;
  const existingByMessage = db.prepare("SELECT * FROM orders WHERE source_message_id=? LIMIT 1").get(messageId);
  if (existingByMessage) return existingByMessage;
  const recentCutoff = new Date(Date.now() - 120000).toISOString();
  const recentDuplicate = db.prepare("SELECT * FROM orders WHERE group_id=? AND producer_user_id=? AND raw_text=? AND created_at>=? ORDER BY id DESC LIMIT 1").get(groupId, producer.id, body, recentCutoff);
  if (recentDuplicate) return recentDuplicate;
  const stamp = now();
  const orderNo = Number(db.prepare("SELECT COALESCE(MAX(order_no),0)+1 AS next FROM orders").get().next);
  const result = db.prepare("INSERT INTO orders(order_no,source_message_id,group_id,raw_text,price_cents,origin,destination,trip_time,order_kind,producer_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(orderNo, messageId, groupId, body, cents(parsed.price), parsed.origin, parsed.destination, parsed.tripTime, parsed.orderKind, producer.id, "open", stamp, stamp);
  audit("order.created", "order", result.lastInsertRowid, { orderNo, groupId, producerPhone: producer.phone });
  console.log(`[Order] #${orderNo} created from ${groupId}`);
  return db.prepare("SELECT * FROM orders WHERE id=?").get(result.lastInsertRowid);
}
function latestEligibleGroupOrderMessage(messages, groupId) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && !message.fromMe && String(message.from || "") === groupId && parseOrder(message.body).isOrder)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0] || null;
}
function isQuotedOrderRecoveryCommand({ body, fromMe, groupId, quoted }) {
  const isCommand = /^#(?:تسجيل|استرداد)\s*(?:الطلب)?$/i.test(String(body || "").trim());
  return Boolean(
    fromMe && isCommand && quoted && !quoted.fromMe && resolveGroupChatId(quoted) === groupId &&
    quoted.id && quoted.id._serialized && parseOrder(quoted.body).isOrder
  );
}
function isCaptainAcceptance(text) {
  return String(text || "").trim() === "تم";
}
function latestOpenOrder(groupId) {
  return db.prepare("SELECT * FROM orders WHERE group_id=? AND status='open' AND pending_message_id IS NULL ORDER BY id DESC LIMIT 1").get(groupId);
}
function findOrderByQuotedId(quotedId) {
  if (!quotedId) return null;
  return db.prepare("SELECT * FROM orders WHERE source_message_id=? AND status='open' AND pending_message_id IS NULL LIMIT 1").get(quotedId);
}
function brandedMessage(title, lines = []) {
  return [
    "╭━━━ ✦ AL-JARAH OPERATIONS NETWORK ✦ ━━━╮",
    "┃ شركة الجراح | بوابة التشغيل الرسمية",
    "┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫",
    `┃ ${title}`,
    "┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫",
    ...lines.map((line) => `┃ ${line}`),
    "┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫",
    "┃ نقل أسرع • تنظيم أدق • سجل موثّق",
    "╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}
function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}
async function renderTopupCardMedia({ cardId, code, valueCents, captainName, appUrl }) {
  const logoPath = path.join(__dirname, "public", "aljarah-logo-mark-clean.png");
  let logoData = "";
  try { logoData = fs.readFileSync(logoPath).toString("base64"); } catch (_) {}
  const safeName = escapeXml(captainName || "كابتن شبكة الجراح");
  const safeCode = escapeXml(code);
  const safeValue = escapeXml(`${money(valueCents)} JOD`);
  const safeUrl = escapeXml(appUrl || "https://whatsapserver-2.onrender.com/join.html");
  const logoFrame = `<circle cx="142" cy="138" r="86" fill="#48d9d1" opacity=".12"/><circle cx="142" cy="138" r="76" fill="none" stroke="#f6c84c" stroke-opacity=".55" stroke-width="2"/><circle cx="142" cy="138" r="68" fill="none" stroke="#48d9d1" stroke-opacity=".45" stroke-width="2"/><circle cx="142" cy="50" r="7" fill="#48d9d1"/><circle cx="142" cy="50" r="15" fill="none" stroke="#48d9d1" stroke-opacity=".3" stroke-width="2"/>`;
  const logo = logoData ? `<image href="data:image/png;base64,${logoData}" x="76" y="72" width="132" height="132" preserveAspectRatio="xMidYMid meet"/>` : `<circle cx="142" cy="138" r="62" fill="#0b1523" stroke="#f6c84c" stroke-width="4"/><text x="142" y="153" text-anchor="middle" fill="#f6c84c" font-size="54" font-weight="700">ج</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="680" viewBox="0 0 1080 680">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101b2a"/><stop offset=".55" stop-color="#172c40"/><stop offset="1" stop-color="#08111d"/></linearGradient><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe493"/><stop offset=".52" stop-color="#f3bf3b"/><stop offset="1" stop-color="#b57914"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000" flood-opacity=".42"/></filter></defs>
    <rect x="18" y="18" width="1044" height="644" rx="42" fill="url(#bg)" stroke="url(#gold)" stroke-width="5" filter="url(#shadow)"/>
    <path d="M30 470 C260 335 390 590 650 430 S900 350 1050 250 L1050 650 L30 650 Z" fill="#f6c84c" opacity=".08"/>
    <path d="M35 125 H1045 M35 548 H1045" stroke="#f6c84c" stroke-opacity=".3" stroke-width="2"/>
    ${logoFrame}${logo}
    <text x="245" y="101" fill="#f6c84c" font-size="28" font-family="Arial, sans-serif" font-weight="700">AL-JARAH LOGISTICS</text>
    <text x="245" y="139" fill="#ffffff" font-size="23" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">شركة الجراح للنقل والخدمات اللوجستية</text>
    <text x="245" y="202" fill="#8fe9df" font-size="22" font-family="Arial, sans-serif" letter-spacing="3">OFFICIAL OPERATIONS CARD</text>
    <text x="76" y="270" fill="#9fb2c6" font-size="20" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif">بطاقة شحن تشغيلية</text>
    <text x="76" y="335" fill="#ffffff" font-size="38" font-family="Arial, sans-serif" font-weight="700">${safeValue}</text>
    <text x="76" y="402" fill="#9fb2c6" font-size="20" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif">المستفيد</text>
    <text x="76" y="440" fill="#ffffff" font-size="25" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">${safeName}</text>
    <rect x="650" y="235" width="335" height="145" rx="22" fill="#07111f" stroke="#f6c84c" stroke-opacity=".7" stroke-width="2"/>
    <text x="680" y="278" fill="#9fb2c6" font-size="18" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif">رمز التفعيل</text>
    <text x="680" y="337" fill="#ffe493" font-size="34" font-family="Arial, sans-serif" font-weight="700" letter-spacing="2">${safeCode}</text>
    <text x="76" y="602" fill="#d6e0ec" font-size="18" font-family="Arial, sans-serif">افتح بوابة التشغيل الرسمية ثم اختر دخول الكابتن وأدخل الرمز لإضافة الرصيد مباشرة.</text>
    <text x="76" y="630" fill="#8fe9df" font-size="16" font-family="Arial, sans-serif">${safeUrl}</text>
    <text x="1000" y="602" text-anchor="end" fill="#f6c84c" font-size="18" font-family="Arial, sans-serif">CARD-${escapeXml(cardId)}</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new MessageMedia("image/png", png.toString("base64"), `aljarah-topup-card-${cardId}.png`);
}
async function renderOperationsMessageMedia(title, lines = []) {
  const logoPath = path.join(__dirname, "public", "aljarah-logo-mark-clean.png");
  const portalPath = path.join(__dirname, "public", "aljarah-portal-bg-desktop-v2.png");
  let logoData = "";
  let portalData = "";
  try { logoData = fs.readFileSync(logoPath).toString("base64"); } catch (_) {}
  try { portalData = fs.readFileSync(portalPath).toString("base64"); } catch (_) {}
  const safeTitle = escapeXml(title);
  const visibleLines = lines.map((line) => String(line || "")).filter(Boolean).slice(0, 8);
  const logo = logoData ? `<image href="data:image/png;base64,${logoData}" x="424" y="288" width="232" height="232" preserveAspectRatio="xMidYMid meet" opacity=".48"/>` : `<text x="540" y="430" text-anchor="middle" fill="#ffe493" font-size="64" font-weight="700" opacity=".28">ج</text>`;
  const lineMarkup = visibleLines.map((line, index) => `<text x="86" y="${276 + index * 40}" fill="${index === visibleLines.length - 1 ? "#ffcf72" : "#f5f8ff"}" font-size="${index === visibleLines.length - 1 ? 20 : 23}" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="${index === visibleLines.length - 1 ? 700 : 500}">${escapeXml(line).slice(0, 88)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="760" viewBox="0 0 1080 760">
    <defs><linearGradient id="ops-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1722"/><stop offset=".58" stop-color="#162d42"/><stop offset="1" stop-color="#070f18"/></linearGradient><radialGradient id="glow"><stop offset="0" stop-color="#48d9d1" stop-opacity=".45"/><stop offset=".52" stop-color="#48d9d1" stop-opacity=".12"/><stop offset="1" stop-color="#48d9d1" stop-opacity="0"/></radialGradient><linearGradient id="ops-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b1"/><stop offset=".5" stop-color="#f2c34f"/><stop offset="1" stop-color="#9c6816"/></linearGradient></defs>
    ${portalData ? `<image href="data:image/png;base64,${portalData}" x="0" y="0" width="1080" height="760" preserveAspectRatio="xMidYMid slice" opacity=".30"/>` : ""}
    <rect width="1080" height="760" fill="#07121d" opacity=".72"/><rect x="18" y="18" width="1044" height="724" rx="42" fill="url(#ops-bg)" fill-opacity=".78" stroke="url(#ops-gold)" stroke-width="6"/>
    <path d="M42 138 H210 M42 138 V55 M1038 138 H870 M1038 138 V55 M42 622 H210 M42 622 V705 M1038 622 H870 M1038 622 V705" stroke="#f6c84c" stroke-opacity=".72" stroke-width="3"/>
    <path d="M24 186 H74 M24 186 V74 M1056 186 H1006 M1056 186 V74 M24 574 H74 M24 574 V686 M1056 574 H1006 M1056 574 V686" stroke="#48d9d1" stroke-opacity=".28" stroke-width="2"/>
    <path d="M25 505 C240 380 400 650 675 480 S920 390 1055 300 L1055 740 L25 740 Z" fill="#f6c84c" opacity=".08"/>
    <circle cx="540" cy="404" r="252" fill="url(#glow)" opacity=".50"/><circle cx="540" cy="404" r="178" fill="none" stroke="#48d9d1" stroke-opacity=".36" stroke-width="2"/><circle cx="540" cy="404" r="157" fill="none" stroke="#f6c84c" stroke-opacity=".40" stroke-width="2"/><circle cx="540" cy="404" r="128" fill="#071522" fill-opacity=".84" stroke="#8fe9df" stroke-opacity=".32" stroke-width="2"/>
    ${logo}<circle cx="540" cy="226" r="9" fill="#62df99"/><circle cx="540" cy="226" r="22" fill="none" stroke="#62df99" stroke-opacity=".45" stroke-width="3"/><circle cx="540" cy="582" r="6" fill="#f6c84c"/><circle cx="358" cy="404" r="6" fill="#48d9d1"/><circle cx="722" cy="404" r="6" fill="#48d9d1"/>
    <text x="1000" y="83" text-anchor="end" fill="#f6c84c" font-size="25" font-family="Arial, sans-serif" font-weight="700" letter-spacing="2">AL-JARAH OPERATIONS NETWORK</text>
    <text x="352" y="122" fill="#ffffff" font-size="24" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">شركة الجراح | بوابة التشغيل الرسمية</text>
    <rect x="80" y="64" width="238" height="48" rx="20" fill="#5b3e12" fill-opacity=".88" stroke="#ffcf72" stroke-width="2"/><text x="199" y="96" text-anchor="middle" fill="#ffe493" font-size="21" font-family="Arial, sans-serif" font-weight="700">OFFICIAL / VERIFIED</text>
    <rect x="64" y="164" width="952" height="474" rx="30" fill="#07131f" fill-opacity=".74" stroke="#8fe9df" stroke-opacity=".30" stroke-width="2"/>
    <text x="86" y="218" fill="#ffe493" font-size="30" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">${safeTitle}</text>
    <path d="M80 238 H1000" stroke="#f6c84c" stroke-opacity=".35" stroke-width="2"/>
    ${lineMarkup}
    <path d="M80 666 H1000" stroke="#48d9d1" stroke-opacity=".34" stroke-width="2"/>
    <text x="1000" y="708" text-anchor="end" fill="#8fe9df" font-size="20" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">نقل أسرع • تنظيم أدق • سجل موثّق</text>
    <text x="80" y="708" fill="#f6c84c" font-size="18" font-family="Arial, sans-serif">AL-JARAH / OFFICIAL</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new MessageMedia("image/png", png.toString("base64"), "aljarah-operations-message.png");
}
async function sendGroupBrandedMessage(groupId, title, lines) {
  try {
    const media = await withTimeout(renderOperationsMessageMedia(title, lines), 30000, null);
    if (!media) throw new Error("group operations card render returned no media");
    return client.sendMessage(groupId, media, { caption: brandedMessage(title, lines) });
  } catch (error) {
    console.error("[WhatsApp] group operations card not sent because branded media failed:", error.message);
    return null;
  }
}
function formatAcceptance(order, captain, producer) {
  return brandedMessage("تم توثيق الرحلة", [
    `🆔 رقم الطلب: #${order.order_no}`,
    `👤 المنتج المعتمد: ${producer ? producer.name : "غير محدد"}`,
    `🚕 الكابتن المنفّذ: ${captain.name}`,
    `💰 القيمة الكاملة للرحلة: ${money(order.price_cents)} JOD`,
    `🧾 نوع الطلب: ${order.order_kind === "order" ? "أوردر محدد · خصم 20%" : "طلب عادي · خصم 15%"}`,
    `💼 المخصوم من رصيد المنفّذ: ${money(order.producer_cents)} JOD`,
    `📊 صافي حصة المنتج: ${money(order.producer_cents - order.company_cents)} JOD | حصة الشركة: ${money(order.company_cents)} JOD`,
    "✅ تم التوثيق بلايك المنتج، وتم تسجيل التسوية.",
  ]);
}
function formatPendingConfirmation(order, captain) {
  return brandedMessage("بانتظار اعتماد المنتج", [
    `🆔 رقم الطلب: #${order.order_no}`,
    `🚕 وصل رد «تم» من الكابتن: ${captain.name}`,
    "ضع 👍 على رسالة «تم» نفسها لتوثيق الرحلة.",
    "⏳ لا توجد تسوية مالية قبل اعتماد المنتج.",
  ]);
}
function formatOrderCreated(order) {
  return brandedMessage("تم تسجيل الطلب", [
    `🆔 رقم الطلب: #${order.order_no}`,
    `🛣️ المسار: ${order.origin || "غير محدد"} ← ${order.destination || "غير محدد"}`,
    `💰 القيمة: ${money(order.price_cents)} JOD`,
    order.trip_time ? `🕒 الموعد: ${order.trip_time}` : "",
    "⏳ بانتظار استلام الكابتن وتأكيد الرحلة.",
  ].filter(Boolean));
}

let client = null;
let isReady = false;
let whatsappState = "starting";
let whatsappLastEvent = null;
let whatsappLastError = null;
let qrCodeData = null;
let lastQrTime = null;
let temporaryQrGrant = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let lastReconnectReason = null;
let lastReconnectAt = null;
let lastReadyAt = null;
let lastDisconnectAt = null;
let lastInitializationStartedAt = null;
let lastInitializationFinishedAt = null;
let initializing = false;
let groupCreateInFlight = false;
let groupCreateState = { status: "idle", operationId: null, startedAt: null, finishedAt: null, error: null, groupId: null, participants: [] };
let groupInviteInFlight = false;
let groupInviteState = { status: "idle", operationId: null, startedAt: null, finishedAt: null, error: null, groupId: null, inviteUrl: null, participants: [] };
let groupJoinInFlight = false;
let connectionGeneration = 0;
let lastGroupSetupProbe = null;
let lastGroupMessageTelemetry = null;
let lastGuideVideoTelemetry = null;
let lastGroupEventGroupId = null;
let baileysSocket = null;
let baileysReady = false;
let baileysQrCodeData = null;
let baileysInitializing = false;
let baileysReconnectTimer = null;
let baileysConnectionGeneration = 0;
let baileysModulePromise = null;

function findChromeExecutable(root) {
  if (!root || !fs.existsSync(root)) return null;
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isFile() && (entry.name === "chrome" || entry.name === "chrome-headless-shell")) return candidate;
      if (entry.isDirectory() && queue.length < 500) queue.push(candidate);
    }
  }
  return null;
}
function findChromeWithSystemFind(root) {
  try {
    if (!root || !fs.existsSync(root)) return null;
    const result = execFileSync("find", [root, "-type", "f", "-name", "chrome", "-print", "-quit"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return result && fs.existsSync(result) ? result : null;
  } catch (_) {
    return null;
  }
}

const puppeteerCacheDir = process.env.PUPPETEER_CACHE_DIR || `${process.env.HOME || "/tmp"}/.cache/puppeteer`;
const projectPuppeteerCacheDir = typeof path !== "undefined" ? path.join(__dirname, ".cache", "puppeteer") : ".cache/puppeteer";
let puppeteerDetectedPath = null;
try {
  const candidate = require("puppeteer").executablePath();
  if (candidate && fs.existsSync(candidate)) puppeteerDetectedPath = candidate;
} catch (error) { console.warn(`[WhatsApp] Puppeteer executable lookup failed: ${error.message}`); }
const configuredChromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const detectedChromePath = [
    "/opt/render/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome",
    "/opt/render/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome",
  ].find((candidate) => typeof fs !== "undefined" && fs.existsSync(candidate)) ||
  puppeteerDetectedPath ||
  (configuredChromePath && fs.existsSync(configuredChromePath) ? configuredChromePath : null) ||
  findChromeWithSystemFind(projectPuppeteerCacheDir) ||
  findChromeWithSystemFind(puppeteerCacheDir) ||
  findChromeWithSystemFind("/opt/render/.cache/puppeteer") ||
  (typeof fs !== "undefined" ? findChromeExecutable(puppeteerCacheDir) : null) ||
  (typeof fs !== "undefined" ? findChromeExecutable("/opt/render/.cache/puppeteer") : null) ||
  (typeof fs !== "undefined" ? findChromeExecutable("/opt/render/project/src/node_modules/puppeteer/.local-chromium") : null) ||
  (typeof fs !== "undefined" ? ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((candidate) => fs.existsSync(candidate)) : null);
if (detectedChromePath) console.log(`[WhatsApp] using Chrome executable: ${detectedChromePath}`);
else console.warn(`[WhatsApp] Chrome executable not found at startup; searched ${puppeteerCacheDir}`);

const puppeteerConfig = {
  headless: true,
  executablePath: detectedChromePath || undefined,
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

function clearChromiumProfileLocks() {
  // LocalAuth stores the profile under session-<clientId>, not session.
  // Keep the legacy path too, so an older deployment cannot block startup.
  const profileDirs = [
    path.join(AUTH_PATH, `session-${WHATSAPP_CLIENT_ID}`),
    path.join(AUTH_PATH, "session"),
  ];
  for (const profileDir of profileDirs) {
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      const lockPath = path.join(profileDir, name);
      try {
        // Chromium uses a symlink here; existsSync() is false when its target host is gone.
        fs.lstatSync(lockPath);
        fs.unlinkSync(lockPath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        console.warn(`[WhatsApp] profile lock cleanup ${lockPath}:`, error.message);
      }
    }
  }
}
async function disposeClientInstance(instance, label = "client") {
  if (!instance) return;
  try {
    await instance.destroy();
  } catch (error) {
    // whatsapp-web.js may already have closed Chromium after LOGOUT.
    console.warn(`[WhatsApp] ${label} cleanup:`, error.message);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  clearChromiumProfileLocks();
}
async function destroyClient() {
  const current = client;
  client = null;
  isReady = false;
  if (!current) {
    clearChromiumProfileLocks();
    return;
  }
  await disposeClientInstance(current, "destroy");
}

async function restartWhatsApp(reason = "manual restart") {
  connectionGeneration += 1;
  reconnectAttempts = 0;
  lastReconnectReason = reason;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await withTimeout(destroyClient(), 15000, null);
  qrCodeData = null;
  lastQrTime = null;
  initializing = false;
  console.warn(`[WhatsApp] restarting session: ${reason}`);
  scheduleReconnect();
}

async function loadBaileys() {
  if (!baileysModulePromise) baileysModulePromise = import("@whiskeysockets/baileys");
  return baileysModulePromise;
}
function scheduleBaileysReconnect() {
  if (!BAILEYS_ENABLED) return;
  if (baileysReconnectTimer) return;
  baileysReconnectTimer = setTimeout(() => {
    baileysReconnectTimer = null;
    void initializeBaileys();
  }, 5000);
}
async function initializeBaileys() {
  if (!BAILEYS_ENABLED) return;
  if (baileysInitializing || baileysReady) return;
  baileysInitializing = true;
  const generation = ++baileysConnectionGeneration;
  try {
    const { default: makeWASocket, useMultiFileAuthState } = await loadBaileys();
    const { state, saveCreds } = await useMultiFileAuthState(BAILEYS_AUTH_PATH);
    const socket = makeWASocket({ auth: state, logger: pino({ level: "silent" }), markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false });
    baileysSocket = socket;
    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      if (generation !== baileysConnectionGeneration) return;
      if (update.qr) {
        baileysQrCodeData = update.qr;
        baileysReady = false;
        console.log("[Baileys] new QR generated");
      }
      if (update.connection === "open") {
        baileysReady = true;
        baileysQrCodeData = null;
        console.log("[Baileys] group event receiver ready");
      }
      if (update.connection === "close") {
        baileysReady = false;
        baileysQrCodeData = null;
        if (baileysSocket === socket) baileysSocket = null;
        const statusCode = update.lastDisconnect && update.lastDisconnect.error && update.lastDisconnect.error.output && update.lastDisconnect.error.output.statusCode;
        if (statusCode !== 401) scheduleBaileysReconnect();
      }
    });
    socket.ev.on("messages.upsert", async (event) => {
      if (generation !== baileysConnectionGeneration || !event || event.type !== "notify") return;
      for (const message of event.messages || []) {
        try { await handleBaileysUpsert(message); } catch (error) { console.error("[Baileys] message handler:", error.message); }
      }
    });
  } catch (error) {
    console.error("[Baileys] initialize:", error.message);
    scheduleBaileysReconnect();
  } finally {
    baileysInitializing = false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const settings = operationalSettings();
  const attempt = Math.min(reconnectAttempts, settings.reconnectMaxAttempts);
  const delay = Math.min(settings.reconnectMaxDelayMs, settings.reconnectBaseDelayMs * (2 ** Math.min(attempt, 6)));
  reconnectAttempts += 1;
  lastReconnectAt = new Date().toISOString();
  lastReconnectReason = whatsappLastError || whatsappLastEvent || "connection_lost";
  if (reconnectAttempts > settings.reconnectMaxAttempts) {
    reconnectAttempts = settings.reconnectMaxAttempts;
    whatsappState = "reconnect_backoff";
  }
  console.warn(`[WhatsApp] reconnect scheduled in ${delay}ms (attempt ${reconnectAttempts}/${settings.reconnectMaxAttempts})`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await initializeWhatsApp();
  }, delay);
}

function createClient() {
  const generation = ++connectionGeneration;
  const instance = new Client({
    authStrategy: new LocalAuth({ clientId: WHATSAPP_CLIENT_ID, dataPath: AUTH_PATH }),
    puppeteer: puppeteerConfig,
  });
  instance.on("qr", (qr) => {
    whatsappState = "qr";
    whatsappLastEvent = "qr";
    if (generation !== connectionGeneration) return;
    qrCodeData = qr;
    lastQrTime = new Date();
    isReady = false;
    console.log("[WhatsApp] New QR generated");
  });
  instance.on("authenticated", () => {
    whatsappState = "authenticated";
    whatsappLastEvent = "authenticated";
    whatsappLastError = null;
    qrCodeData = null;
    console.log(`[WhatsApp] authenticated (clientId=${WHATSAPP_CLIENT_ID})`);
  });
  instance.on("ready", () => {
    whatsappState = "ready";
    whatsappLastEvent = "ready";
    whatsappLastError = null;
    if (generation !== connectionGeneration) return;
    const connectedPhone = instance.info && instance.info.wid ? phoneWithCountry(instance.info.wid.user) : null;
    const expectedPhone = phoneWithCountry(BOT_PHONE_INTL || BOT_PHONE);
    if (connectedPhone && expectedPhone && connectedPhone !== expectedPhone) {
      whatsappState = "wrong_account";
      whatsappLastEvent = "wrong_account";
      whatsappLastError = "Connected WhatsApp account does not match the configured bot phone";
      isReady = false;
      if (client === instance) client = null;
      console.error(`[WhatsApp] refusing unexpected account: ${connectedPhone}; expected configured bot phone`);
      void disposeClientInstance(instance, "wrong_account");
      scheduleReconnect();
      return;
    }
    isReady = true;
    reconnectAttempts = 0;
    lastReadyAt = new Date().toISOString();
    qrCodeData = null;
    console.log(`[WhatsApp] ready: ${connectedPhone || expectedPhone}`);
  });
  instance.on("auth_failure", (message) => {
    whatsappState = "auth_failure";
    whatsappLastEvent = "auth_failure";
    whatsappLastError = String(message || "authentication failure");
    if (generation !== connectionGeneration) return;
    isReady = false;
    if (client === instance) client = null;
    console.error("[WhatsApp] auth_failure:", message);
    void disposeClientInstance(instance, "auth_failure");
    scheduleReconnect();
  });
  instance.on("disconnected", (reason) => {
    whatsappState = "disconnected";
    whatsappLastEvent = "disconnected";
    whatsappLastError = String(reason || "disconnected");
    if (generation !== connectionGeneration) return;
    isReady = false;
    lastDisconnectAt = new Date().toISOString();
    qrCodeData = null;
    if (client === instance) client = null;
    console.warn("[WhatsApp] disconnected:", reason);
    // Do not leave the old Chromium process alive while the retry starts.
    void disposeClientInstance(instance, "disconnected");
    scheduleReconnect();
  });
  instance.on("loading_screen", (percent, message) => {
    console.log(`[WhatsApp] loading ${percent}%${message ? `: ${message}` : ""}`);
  });
  instance.on("change_state", (state) => {
    console.log(`[WhatsApp] state changed: ${state}`);
  });
  instance.on("message_create", async (msg) => {
    if (generation !== connectionGeneration || !msg || !msg.fromMe) return;
    recordGroupMessageTelemetry("message_create", msg);
    try { await handleIncomingMessage(msg, { allowSelf: true }); } catch (error) { console.error("[WhatsApp] own message handler:", error); }
  });
  instance.on("message", async (msg) => {
    if (generation !== connectionGeneration) return;
    recordGroupMessageTelemetry("message", msg);
    try { await handleIncomingMessage(msg, { allowSelf: true }); } catch (error) { console.error("[WhatsApp] message handler:", error); }
  });
  instance.on("message_reaction", async (reaction) => {
    if (generation !== connectionGeneration) return;
    try { await handleMessageReaction(reaction); } catch (error) { console.error("[WhatsApp] reaction handler:", error); }
  });
  return instance;
}

async function initializeWhatsApp() {
  if (initializing || isReady) return;
  initializing = true;
  lastInitializationStartedAt = new Date().toISOString();
  try {
    await destroyClient();
    client = createClient();
    const initTimeoutMarker = "__WHATSAPP_INIT_TIMEOUT__";
    const initialized = await withTimeoutStrict(client.initialize(), operationalSettings().initTimeoutMs, initTimeoutMarker);
    if (initialized === initTimeoutMarker) {
      console.error(`[WhatsApp] initialize timeout after ${operationalSettings().initTimeoutMs}ms; scheduling controlled retry`);
      isReady = false;
      qrCodeData = null;
      whatsappState = "initialize_timeout";
      whatsappLastEvent = "initialize_timeout";
      whatsappLastError = "WhatsApp initialization timed out; controlled retry scheduled";
      await withTimeout(disposeClientInstance(client, "initialize_timeout"), 15000, null);
      client = null;
      scheduleReconnect();
    }
  } catch (error) {
    whatsappState = "initialize_error";
    whatsappLastEvent = "initialize_error";
    whatsappLastError = String(error?.message || error);
    console.error("[WhatsApp] initialize:", error.message);
    isReady = false;
    scheduleReconnect();
  } finally {
    initializing = false;
    lastInitializationFinishedAt = new Date().toISOString();
  }
}

function connectedBotPhone() {
  const connected = client && client.info && client.info.wid ? client.info.wid.user : BOT_PHONE_INTL;
  return phoneWithCountry(connected || BOT_PHONE_INTL);
}

function resolveGroupChatId(message) {
  const candidates = [message && message.from, message && message.to, message && message.id && message.id.remote];
  return candidates.map((value) => String(value || "")).find((value) => value.endsWith("@g.us")) || "";
}

function recordGroupMessageTelemetry(event, msg) {
  const groupId = resolveGroupChatId(msg);
  if (!groupId) return;
  lastGroupEventGroupId = groupId;
  lastGroupMessageTelemetry = {
    at: now(),
    event,
    fromMe: Boolean(msg.fromMe),
    configured: isConfiguredGroup(groupId),
    hasQuotedMessage: Boolean(msg.hasQuotedMsg),
  };
  console.log(`[GroupEvent] ${event} fromMe=${Boolean(msg.fromMe)} configured=${lastGroupMessageTelemetry.configured} quoted=${lastGroupMessageTelemetry.hasQuotedMessage}`);
}

function baileysJidPhone(jid) {
  return phoneWithCountry(String(jid || "").split("@")[0].split(":")[0]);
}
function baileysMessageText(message) {
  const content = message && message.message ? message.message : {};
  return String(content.conversation || (content.extendedTextMessage && content.extendedTextMessage.text) || "").trim();
}
async function handleBaileysUpsert(message) {
  const key = message && message.key ? message.key : {};
  const groupId = String(key.remoteJid || "");
  if (!groupId.endsWith("@g.us") || key.fromMe) return;
  const body = baileysMessageText(message);
  if (!body) return;
  recordGroupMessageTelemetry("baileys.messages.upsert", { from: groupId, fromMe: false, hasQuotedMsg: Boolean(message.message && message.message.extendedTextMessage && message.message.extendedTextMessage.contextInfo) });
  const senderPhone = baileysJidPhone(key.participant || key.remoteJid);
  const bridgedMessage = {
    from: groupId,
    fromMe: false,
    author: senderPhone,
    body,
    type: "text",
    timestamp: Number(message.messageTimestamp || Date.now() / 1000),
    id: { _serialized: String(key.id || ""), remote: groupId },
    getContact: async () => ({ number: senderPhone, pushname: String(message.pushName || "").trim() || displayPhone(senderPhone) }),
  };
  await handleIncomingMessage(bridgedMessage, { allowSelf: true });
}

async function handleIncomingMessage(msg, { allowSelf = false } = {}) {
  if (!msg || (msg.fromMe && !allowSelf)) return;
  const groupId = resolveGroupChatId(msg);
  const isGroup = Boolean(groupId);
  if (!isGroup) return msg.fromMe ? undefined : handleCustomerMessage(msg);
  const body = String(msg.body || "").trim();
  const setupCommand = /^#(?:اعتماد|ربط|اعتمد)\s*(?:القروب|المجموعة)?$/i.test(body);
  const contact = msg.fromMe ? null : await withTimeout(msg.getContact(), 8000, null);
  const candidates = [msg.fromMe ? connectedBotPhone() : "", contact && contact.number, msg.author, msg._data && msg._data.author];
  const senderPhone = candidates.map(phoneWithCountry).find(isValidJordanPhone) || "";
  const primarySender = Boolean(msg.fromMe) && senderPhone === connectedBotPhone();
  if (!isConfiguredGroup(groupId)) {
    if (setupCommand) {
      lastGroupSetupProbe = { at: now(), fromMe: Boolean(msg.fromMe), senderResolved: Boolean(senderPhone), primarySender, ownerSender: isGroupSetupOwner(senderPhone) };
      console.log(`[GroupSetup] setup command observed: fromMe=${Boolean(msg.fromMe)} senderResolved=${Boolean(senderPhone)} primary=${primarySender} owner=${isGroupSetupOwner(senderPhone)}`);
    }
    const selfSetup = primarySender || senderPhone === phoneWithCountry(BOT_PHONE);
    if (setupCommand && (selfSetup || isGroupSetupOwner(senderPhone))) {
      configureGroupId(groupId, "الجراح | شبكة التشغيل الرسمية");
      console.log(`[GroupSetup] configured group from ${selfSetup ? "primary bot command" : "owner command"}: ${groupId}`);
    }
    return;
  }
  const botGenerated = isBotGeneratedMessage(msg);
  // رسائل البوت العادية ليست رسائل تشغيلية ولا تُحفظ؛ الطلب المنسّق فقط يُسجّل باسم الشركة.
  if (botGenerated && !parseOrder(body).isOrder) return;
  const senderName = msg.fromMe ? "شركة الجراح — المنتج الأساسي" : ((contact && (contact.pushname || contact.name)) || msg._data?.notifyName || displayPhone(senderPhone));
  let insertedMessage = { changes: 0 };
  if (body) {
    const stamp = now();
    const messageId = msg.id && msg.id._serialized;
    if (messageId) {
      insertedMessage = db.prepare("INSERT OR IGNORE INTO messages(message_id,group_id,sender_phone,sender_name,body,message_type,sent_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run(messageId, groupId, senderPhone, senderName, body, msg.type || "text", new Date(Number(msg.timestamp || Date.now() / 1000) * 1000).toISOString(), stamp);
    }
  }
  const quotedForRecovery = msg.hasQuotedMsg ? await withTimeout(msg.getQuotedMessage(), 8000, null) : null;
  if (isQuotedOrderRecoveryCommand({ body, fromMe: Boolean(msg.fromMe), groupId, quoted: quotedForRecovery })) {
    const sourceMessageId = quotedForRecovery.id._serialized;
    const existing = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(sourceMessageId);
    if (existing) {
      await msg.react("ℹ️").catch(() => {});
      return;
    }
    await handleIncomingMessage(quotedForRecovery, { allowSelf: true });
    const recovered = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(sourceMessageId);
    if (recovered) {
      audit("order.recovered_from_quoted_message", "order", recovered.id, { groupId, sourceMessageId });
      await msg.react("✅").catch(() => {});
    } else {
      await msg.react("⚠️").catch(() => {});
    }
    return;
  }
  if (!insertedMessage.changes && !isCaptainAcceptance(body)) return;
  if (isBlockedPhone(senderPhone)) {
    console.warn(`[Policy] blocked phone ignored: ${senderPhone}`);
    return;
  }
  if (!body) return;
  const messageId = msg.id && msg.id._serialized;
  if (!messageId) return;
  const parsed = parseOrder(body);
  if (parsed.isOrder) {
    const producer = botGenerated ? botEmployeeUser() : ensureProducerUser(senderPhone, senderName);
    if (!producer || producer.active === 0) return;
    const order = createOrderRecord({ messageId, groupId, body, producer, parsed });
    if (!order) return;
    if (typeof client !== "undefined" && client && isReady) {
      await sendGroupBrandedMessage(groupId, "تم تسجيل الطلب", [`🆔 رقم الطلب: #${order.order_no}`, `🛣️ المسار: ${parsed.origin || "غير محدد"} ← ${parsed.destination || "غير محدد"}`, `💰 القيمة: ${money(cents(parsed.price))} JOD`, parsed.tripTime ? `🕒 الموعد: ${parsed.tripTime}` : "", "⏳ بانتظار استلام الكابتن وتأكيد الرحلة."].filter(Boolean)).catch((error) => console.error("[WhatsApp] order acknowledgement send:", error.message));
    }
    return;
  }
  if (!isCaptainAcceptance(body)) return;
  const quoted = msg.hasQuotedMsg ? await withTimeout(msg.getQuotedMessage(), 8000, null) : null;
  // لا يُقبل «تم» إلا كرد مباشر على رسالة المنتج التي أنشأت الطلب.
  const order = quoted && quoted.id ? findOrderByQuotedId(quoted.id._serialized) : null;
  if (!order) return;
  const captain = ensureCaptainUser(senderPhone, senderName);
  if (!captain || captain.role !== "captain") return;
  const rateProducer = Number(getSetting("producer_rate_bps", PRODUCER_RATE_BPS));
  const rateSpecialOrder = Number(getSetting("special_order_rate_bps", SPECIAL_ORDER_RATE_BPS));
  const rateCompanyFromProducer = Number(getSetting("company_from_producer_rate_bps", COMPANY_FROM_PRODUCER_RATE_BPS));
  const settlement = calculateSettlement({ priceCents: order.price_cents, orderKind: order.order_kind, regularProducerRateBps: rateProducer, specialOrderProducerRateBps: rateSpecialOrder, companyFromProducerRateBps: rateCompanyFromProducer });
  const pending = db.transaction(() => {
    const current = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
    if (!current || current.status !== "open" || current.pending_message_id) return false;
    const stampNow = now();
    const result = db.prepare("UPDATE orders SET pending_captain_user_id=?, pending_message_id=?, pending_at=?, updated_at=? WHERE id=? AND status='open' AND pending_message_id IS NULL").run(captain.id, messageId, stampNow, stampNow, order.id);
    return result.changes === 1;
  })();
  if (!pending) return;
  audit("order.pending_producer_confirmation", "order", order.id, { captainId: captain.id, pendingMessageId: messageId, requiredCents: settlement.captainFeeCents });
  const producer = db.prepare("SELECT * FROM users WHERE id=?").get(order.producer_user_id);
  if (producer && producer.is_bot === 1) {
    const confirmed = settlePendingOrder(order.id, messageId, producer.phone);
    if (confirmed.state === "accepted") {
      await msg.react("👍").catch((error) => console.error("[WhatsApp] bot confirmation reaction:", error.message));
      await sendGroupBrandedMessage(groupId, "تم تثبيت الطلب", [`🆔 رقم الطلب: #${confirmed.order.order_no}`, `🚕 الكابتن المنفّذ: ${confirmed.captain.name}`, `💰 القيمة: ${money(confirmed.order.price_cents)} JOD`, "✅ تم تثبيت الطلب وتسجيل التسوية." ]).catch((error) => console.error("[WhatsApp] bot confirmation card:", error.message));
    }
    return;
  }
  await sendGroupBrandedMessage(groupId, "بانتظار اعتماد المنتج", [`🆔 رقم الطلب: #${order.order_no}`, `🚕 وصل رد «تم» من الكابتن: ${captain.name}`, "ضع 👍 على رسالة «تم» نفسها لتوثيق الرحلة.", "⏳ لا توجد تسوية مالية قبل اعتماد المنتج."]).catch((error) => console.error("[WhatsApp] pending confirmation send:", error.message));
}

function reactionId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value._serialized || value.id || null;
}

async function resolveReactionSenderPhone(reaction) {
  const rawId = reaction && reaction.senderId;
  const serialized = reactionId(rawId) || String(rawId || "");
  const direct = phoneWithCountry(serialized.replace(/@.*$/, ""));
  if (isValidJordanPhone(direct)) return direct;
  if (!client || !isReady || !serialized) return "";
  const contact = await withTimeout(client.getContactById(serialized), 8000, null);
  return phoneWithCountry(contact && contact.number ? contact.number : "");
}

function settlePendingOrder(orderId, expectedMessageId, producerPhone) {
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (!current || current.status !== "open" || current.pending_message_id !== expectedMessageId) return { state: "stale" };
    const producer = current.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.producer_user_id) : null;
    const producerAuthorized = producer && (
      phoneWithCountry(producer.phone) === phoneWithCountry(producerPhone) ||
      (producer.role === "company" && isGroupSetupOwner(producerPhone)) ||
      (producer.is_bot === 1 && isGroupSetupOwner(producerPhone))
    );
    if (!producerAuthorized) return { state: "unauthorized" };
    const captain = current.pending_captain_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.pending_captain_user_id) : null;
    if (!captain) return { state: "stale" };
    const settlement = calculateSettlement({
      priceCents: current.price_cents,
      orderKind: current.order_kind,
      regularProducerRateBps: Number(getSetting("producer_rate_bps", PRODUCER_RATE_BPS)),
      specialOrderProducerRateBps: Number(getSetting("special_order_rate_bps", SPECIAL_ORDER_RATE_BPS)),
      companyFromProducerRateBps: Number(getSetting("company_from_producer_rate_bps", COMPANY_FROM_PRODUCER_RATE_BPS)),
    });
    if (captain.wallet_cents - settlement.captainFeeCents < CAPTAIN_MIN_BALANCE_CENTS) {
      const stamp = now();
      db.prepare("UPDATE orders SET pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,updated_at=? WHERE id=? AND status='open'").run(stamp, orderId);
      audit("order.rejected.debt_limit_after_confirmation", "order", orderId, { captainId: captain.id, requiredCents: settlement.captainFeeCents, balanceCents: captain.wallet_cents, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS });
      void suspendMemberForDebt(current.group_id, captain.phone, captain.wallet_cents - settlement.captainFeeCents);
      return { state: "debt_limit", order: current, captain, producer, requiredCents: settlement.captainFeeCents, balanceCents: captain.wallet_cents, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS };
    }
    const company = companyUser();
    const stamp = now();
    const botEmployeeProducer = producer.is_bot === 1;
    const companyBalance = Number(company.wallet_cents || 0) + settlement.companyCents;
    const producerBalance = Number(producer.wallet_cents || 0) + settlement.producerNetCents;
    const ledgerDetails = JSON.stringify({ orderNo: current.order_no, priceCents: current.price_cents, origin: current.origin, destination: current.destination, tripTime: current.trip_time, orderKind: current.order_kind });
    const companyFinalBalance = companyBalance;
    const captainBalance = Number(captain.wallet_cents || 0) - settlement.captainFeeCents;
    db.prepare("UPDATE orders SET status='accepted',captain_user_id=?,accepted_message_id=?,accepted_at=?,company_cents=?,producer_cents=?,captain_cents=?,pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,updated_at=? WHERE id=? AND status='open' AND pending_message_id=?").run(captain.id, expectedMessageId, stamp, settlement.companyCents, settlement.producerFeeCents, settlement.captainGrossCents, stamp, orderId, expectedMessageId);
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(companyFinalBalance, stamp, company.id);
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(company.id, orderId, "commission_company", settlement.companyCents, companyBalance, `ORDER-${current.order_no}`, "15% من حصة المنتج", stamp, ledgerDetails);
    if (botEmployeeProducer) {
      db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(producerBalance, stamp, producer.id);
      db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(producer.id, orderId, "commission_bot_producer", settlement.producerNetCents, producerBalance, `ORDER-${current.order_no}`, "صافي حصة منتج البوت الموظف", stamp, ledgerDetails);
    } else {
      db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(producerBalance, stamp, producer.id);
      db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(producer.id, orderId, "commission_producer", settlement.producerNetCents, producerBalance, `ORDER-${current.order_no}`, "صافي حصة المنتج بعد حصة الشركة", stamp, ledgerDetails);
    }
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(captainBalance, stamp, captain.id);
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(captain.id, orderId, "captain_fee", -settlement.captainFeeCents, captainBalance, `ORDER-${current.order_no}`, current.order_kind === "order" ? "خصم 20% من رصيد المنفّذ لأوردر" : "خصم 15% من رصيد المنفّذ", stamp, ledgerDetails);
    audit("order.accepted", "order", orderId, { captainId: captain.id, orderKind: current.order_kind, companyCents: settlement.companyCents, producerFeeCents: settlement.producerFeeCents, producerNetCents: settlement.producerNetCents, captainFeeCents: settlement.captainFeeCents, captainGrossCents: settlement.captainGrossCents, confirmedBy: producer.phone });
    console.log(`[Order] accepted #${current.order_no} group=${current.group_id} captain=${captain.phone} confirmedBy=${producer.phone}`);
    return { state: "accepted", order: db.prepare("SELECT * FROM orders WHERE id=?").get(orderId), captain: db.prepare("SELECT * FROM users WHERE id=?").get(captain.id), producer: db.prepare("SELECT * FROM users WHERE id=?").get(producer.id) };
  })();
}

async function handleMessageReaction(reaction) {
  if (!reaction || reaction.reaction !== "👍") return;
  const messageId = reactionId(reaction.msgId);
  if (!messageId || !client || !isReady) return;
  const target = await withTimeout(client.getMessageById(messageId), 10000, null);
  if (!target || !target.from || !String(target.from).endsWith("@g.us")) return;
  if (!isConfiguredGroup(target.from)) return;
  const producerPhone = await resolveReactionSenderPhone(reaction);
  if (!producerPhone || isBlockedPhone(producerPhone) || isBotReactionSender(producerPhone, connectedBotPhone())) return;
  const pending = db.prepare("SELECT * FROM orders WHERE group_id=? AND status='open' AND pending_message_id=? LIMIT 1").get(target.from, messageId);
  if (!pending) return;
  const result = settlePendingOrder(pending.id, messageId, producerPhone);
  if (result.state === "unauthorized" || result.state === "stale") return;
  if (result.state === "debt_limit") {
    await sendGroupBrandedMessage(target.from, "تعذر توثيق الرحلة", [`⚠️ سيؤدي هذا الحجز إلى تجاوز حد مديونية الكابتن ${result.captain.name}.`, `الحد المسموح: ${money(result.debtLimitCents)} JOD.`, "لم تُسجّل أي تسوية مالية."]).catch((error) => console.error("[WhatsApp] confirmation rejection send:", error.message));
    return;
  }
  if (result.state === "accepted") {
    await sendGroupBrandedMessage(target.from, "تم توثيق الرحلة", [`🆔 رقم الطلب: #${result.order.order_no}`, `👤 المنتج المعتمد: ${result.producer ? result.producer.name : "غير محدد"}`, `🚕 الكابتن المنفّذ: ${result.captain.name}`, `💰 القيمة الكاملة للرحلة: ${money(result.order.price_cents)} JOD`, `🧾 نوع الطلب: ${result.order.order_kind === "order" ? "أوردر محدد · خصم 20%" : "طلب عادي · خصم 15%"}`, `💼 المخصوم من رصيد المنفّذ: ${money(result.order.producer_cents)} JOD`, `📊 صافي حصة المنتج: ${money(result.order.producer_cents - result.order.company_cents)} JOD | حصة الشركة: ${money(result.order.company_cents)} JOD`, result.captain.wallet_cents < 0 ? `⚠️ مديونية الكابتن بعد التسوية: ${money(result.captain.wallet_cents)} JOD` : "✅ لا توجد مديونية على الكابتن بعد التسوية.", "✅ تم التوثيق بلايك المنتج، وتم تسجيل التسوية."]).catch((error) => console.error("[WhatsApp] acceptance send:", error.message));
  }
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
  if (activeAdminToken && header.startsWith("Bearer ") && constantTimeEquals(header.slice(7), activeAdminToken)) return true;
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
function requireAdminOrDashboardApi(req, res, next) {
  if (!isAdmin(req) && !isDashboardApi(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}
function isDashboardApi(req) {
  const header = String(req.headers.authorization || "");
  return Boolean(DASHBOARD_API_TOKEN) && header.startsWith("Bearer ") && constantTimeEquals(header.slice(7), DASHBOARD_API_TOKEN);
}
function requireDashboardApi(req, res, next) {
  if (!isDashboardApi(req)) return res.status(401).json({ error: "Dashboard API unauthorized" });
  next();
}
function requireBotWalletOwner(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: "Bot wallet is owner-only" });
  next();
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `aljarah_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}
function setCaptainSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `aljarah_captain_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}
function clearCaptainSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `aljarah_captain_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
function getCaptainSession(req) {
  const token = parseCookies(req.headers.cookie || "").aljarah_captain_session;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, CAPTAIN_SESSION_SECRET);
    return payload && payload.role === "captain" ? payload : null;
  } catch { return null; }
}
function requireCaptain(req, res, next) {
  const session = getCaptainSession(req);
  if (!session) return res.status(401).json({ error: "Captain authentication required" });
  req.captainSession = session;
  next();
}
function validAdminPassword(value) {
  const password = String(value || "");
  if (ADMIN_PASSWORD && constantTimeEquals(password, ADMIN_PASSWORD)) return true;
  if (ADMIN_PASSWORD_HASH) {
    try { return bcrypt.compareSync(password, ADMIN_PASSWORD_HASH); } catch { return false; }
  }
  return false;
}
function validCaptainPassword(value) {
  const password = String(value || "");
  if (constantTimeEquals(password, CAPTAIN_PASSWORD)) return true;
  if (CAPTAIN_PASSWORD_HASH) {
    try { return bcrypt.compareSync(password, CAPTAIN_PASSWORD_HASH); } catch { return false; }
  }
  return false;
}
function validCaptainPin(value) {
  return /^\d{5}$/.test(String(value || ""));
}
function inviteTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}
function expireCaptainInvites() {
  db.prepare("UPDATE captain_invites SET status='expired',updated_at=? WHERE status IN ('issued','pending') AND expires_at<=?").run(now(), now());
}
function captainInviteBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  const configured = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const base = configured && !/bot\.wasselni-biz\.com/i.test(configured) ? configured : `${protocol}://${req.get("host")}`;
  return base.replace(/\/$/, "");
}
function requireQrAccess(req, res, next) {
  if (!consumeRateLimit(qrRate, clientAddress(req), QR_RATE_LIMIT_MAX)) {
    return res.status(429).send("Too many QR requests; try again later.");
  }
  const queryToken = String(req.query.token || "");
  const header = String(req.headers.authorization || "");
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const isQueryAdmin = Boolean(activeAdminToken) && constantTimeEquals(queryToken, activeAdminToken);
  const isBearerAdmin = Boolean(activeAdminToken) && constantTimeEquals(bearerToken, activeAdminToken);
  const isPublicWindow = QR_PUBLIC && Date.now() - QR_START_TIME < QR_PUBLIC_DURATION_MS;
  if (isPublicWindow || isQueryAdmin || isBearerAdmin || isAdmin(req) || hasTemporaryQrGrant(req)) return next();
  return res.status(401).send("QR access is protected. Use an admin token or a temporary QR grant.");
}
function hasTemporaryQrGrant(req) {
  if (!temporaryQrGrant) return false;
  if (Date.now() >= temporaryQrGrant.expiresAt) {
    temporaryQrGrant = null;
    return false;
  }
  const provided = String(req.query.access || "");
  return constantTimeEquals(provided, temporaryQrGrant.token);
}
function issueTemporaryQrGrant(req) {
  const durationSeconds = Math.max(60, Math.min(180, Number(req.body?.durationSeconds || 120)));
  const token = crypto.randomBytes(32).toString("base64url");
  temporaryQrGrant = { token, expiresAt: Date.now() + durationSeconds * 1000 };
  return { token, durationSeconds, expiresAt: new Date(temporaryQrGrant.expiresAt).toISOString() };
}
app.post("/api/admin/captain-invites", requireAdmin, (req, res) => {
  const token = crypto.randomBytes(24).toString("base64url");
  const stamp = now();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const tokenCiphertext = cardEncryptionKey ? encryptCardCode(token) : null;
  db.prepare("INSERT INTO captain_invites(token_hash,token_last8,token_ciphertext,status,created_at,updated_at,expires_at) VALUES(?,?,?, ?,?,?,?)")
    .run(inviteTokenHash(token), token.slice(-8), tokenCiphertext, "issued", stamp, stamp, expiresAt);
  audit("captain.invite.issued", "captain_invite", token.slice(-8), { expiresAt }, null);
  res.status(201).json({ success: true, inviteUrl: captainGatewayUrl(captainInviteBaseUrl(req), token), expiresAt });
});
app.post("/api/admin/captain-invites/send", requireAdmin, async (req, res) => {
  const phone = phoneWithCountry(String(req.body?.phone || "").replace(/[^0-9]/g, ""));
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم WhatsApp أردني صحيح مطلوب" });
  const token = crypto.randomBytes(24).toString("base64url");
  const stamp = now();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const tokenCiphertext = cardEncryptionKey ? encryptCardCode(token) : null;
  const result = db.prepare("INSERT INTO captain_invites(token_hash,token_last8,token_ciphertext,status,created_at,updated_at,expires_at) VALUES(?,?,?, ?,?,?,?)").run(inviteTokenHash(token), token.slice(-8), tokenCiphertext, "issued", stamp, stamp, expiresAt);
  const inviteUrl = captainGatewayUrl(captainInviteBaseUrl(req), token);
  audit("captain.invite.issued_for_phone", "captain_invite", result.lastInsertRowid, { phone, expiresAt });
  const notified = await sendBotText(`${phone}@c.us`, `دعوة التسجيل الأولى في شركة الجراح\n\nافتح بوابة التشغيل الرسمية، اضغط زر التشغيل الأصفر، ثم اختر «تسجيل كابتن جديد» لإدخال اسمك واختيار رقم سري من 5 أرقام.\nالرابط صالح لدعوة واحدة حتى ${expiresAt.slice(0, 10)}: ${inviteUrl}`);
  res.status(201).json({ success: true, id: result.lastInsertRowid, phone, inviteUrl, expiresAt, notified });
});
app.post("/api/admin/captain-invites/import", requireAdmin, (req, res) => {
  const candidates = Array.isArray(req.body?.captains) ? req.body.captains : [];
  const excluded = new Set((Array.isArray(req.body?.excludePhones) ? req.body.excludePhones : []).map(phoneWithCountry).filter(Boolean));
  if (!candidates.length || candidates.length > 500) return res.status(400).json({ error: "captains must contain between 1 and 500 entries" });
  const stamp = now();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const created = [], skipped = [], rejected = [];
  const insertInvite = db.transaction((items) => {
    for (const candidate of items) {
      const name = String(candidate?.name || "").trim();
      const phone = phoneWithCountry(String(candidate?.phone || ""));
      if (!name || name.length > 100 || !isValidJordanPhone(phone) || isBlockedPhone(phone) || phone === phoneWithCountry(BOT_PHONE) || excluded.has(phone)) {
        rejected.push({ name, phone, reason: excluded.has(phone) ? "excluded" : "invalid_or_blocked" });
        continue;
      }
      const existing = db.prepare("SELECT id,role FROM users WHERE phone=? LIMIT 1").get(phone);
      if (existing) { skipped.push({ name, phone, reason: existing.role === "captain" ? "already_captain" : "assigned_to_other_role" }); continue; }
      const openInvite = db.prepare("SELECT id FROM captain_invites WHERE phone=? AND status IN ('issued','pending') LIMIT 1").get(phone);
      if (openInvite) { skipped.push({ name, phone, reason: "invite_already_open" }); continue; }
      const token = crypto.randomBytes(24).toString("base64url");
      const tokenCiphertext = cardEncryptionKey ? encryptCardCode(token) : null;
      db.prepare("INSERT INTO captain_invites(token_hash,token_last8,token_ciphertext,status,name,phone,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(inviteTokenHash(token), token.slice(-8), tokenCiphertext, "issued", name, phone, stamp, stamp, expiresAt);
      audit("captain.invite.imported", "captain_invite", token.slice(-8), { name, phone, expiresAt }, null);
      created.push({ name, phone, inviteUrl: captainGatewayUrl(captainInviteBaseUrl(req), token), expiresAt });
    }
  });
  insertInvite(candidates);
  res.status(201).json({ success: true, created, skipped, rejected, message: "تم تجهيز الدعوات؛ لا يُنشأ الحساب ولا يُفعّل إلا بعد موافقة المالك" });
});
app.get("/api/captain/invites/:token", (req, res) => {
  expireCaptainInvites();
  const publicToken = getSetting("captain_public_invite_token", null);
  let invite = db.prepare("SELECT id,status,name,phone,token_last8,created_at,updated_at,expires_at,submitted_at,decided_at,decision_note FROM captain_invites WHERE token_hash=? LIMIT 1").get(inviteTokenHash(req.params.token));
  if (!invite && publicToken && constantTimeEquals(req.params.token, publicToken)) invite = { id: 0, status: "issued", name: null, phone: null, token_last8: publicToken.slice(-8), created_at: now(), updated_at: now(), expires_at: null, submitted_at: null, decided_at: null, decision_note: null };
  if (!invite) return res.status(404).json({ error: "بطاقة الدعوة غير موجودة" });
  if (invite.status === "expired") return res.status(410).json({ error: "انتهت صلاحية بطاقة الدعوة" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ invite: { ...invite, canSubmit: invite.status === "issued" || invite.status === "pending" } });
});
app.post("/api/captain/invites/:token/apply", (req, res) => {
  expireCaptainInvites();
  const publicToken = getSetting("captain_public_invite_token", null);
  let createdInviteToken = null;
  let invite = db.prepare("SELECT * FROM captain_invites WHERE token_hash=? LIMIT 1").get(inviteTokenHash(req.params.token));
  if (!invite && publicToken && constantTimeEquals(req.params.token, publicToken)) {
    const token = crypto.randomBytes(24).toString("base64url");
    createdInviteToken = token;
    const stamp = now();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const tokenCiphertext = cardEncryptionKey ? encryptCardCode(token) : null;
    const created = db.prepare("INSERT INTO captain_invites(token_hash,token_last8,token_ciphertext,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?)").run(inviteTokenHash(token), token.slice(-8), tokenCiphertext, "issued", stamp, stamp, expiresAt);
    invite = db.prepare("SELECT * FROM captain_invites WHERE id=? LIMIT 1").get(created.lastInsertRowid);
  }
  if (!invite) return res.status(404).json({ error: "بطاقة الدعوة غير موجودة" });
  if (invite.status === "expired") return res.status(410).json({ error: "انتهت صلاحية بطاقة الدعوة" });
  if (!["issued", "pending"].includes(invite.status)) return res.status(409).json({ error: invite.status === "approved" ? "تمت الموافقة على هذه الدعوة مسبقًا" : "لا يمكن استخدام هذه الدعوة" });
  const name = String(req.body?.name || "").trim();
  const rawPhone = String(req.body?.phone || "").trim();
  const phone = phoneWithCountry(rawPhone);
  const pin = String(req.body?.pin || "").trim();
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "اسم الكابتن مطلوب" });
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم هاتف أردني صحيح مطلوب" });
  if (!validCaptainPin(pin)) return res.status(400).json({ error: "الرقم السري يجب أن يكون 5 أرقام" });
  const existing = db.prepare("SELECT id,role FROM users WHERE phone=? LIMIT 1").get(phone);
  if (existing && existing.role !== "captain") return res.status(409).json({ error: "رقم الهاتف مستخدم لدور آخر" });
  if (existing && existing.role === "captain" && existing.id !== invite.approved_user_id) return res.status(409).json({ error: "يوجد حساب كابتن بهذا الرقم مسبقًا" });
  const stamp = now();
  const pinHash = bcrypt.hashSync(pin, 10);
  const pinCiphertext = cardEncryptionKey ? encryptCardCode(pin) : null;
  db.prepare("UPDATE captain_invites SET status='pending',name=?,phone=?,pin_hash=?,pin_ciphertext=?,submitted_at=?,updated_at=? WHERE id=? AND status IN ('issued','pending')")
    .run(name, phone, pinHash, pinCiphertext, stamp, stamp, invite.id);
  audit("captain.join.requested", "captain_invite", invite.id, { name, phone }, null);
  res.status(202).json({ success: true, status: "pending", token: createdInviteToken || req.params.token, message: "تم إرسال طلبك إلى الشركة للموافقة" });
});
app.get("/api/admin/captain-invites", requireAdmin, (req, res) => {
  expireCaptainInvites();
  const invites = db.prepare("SELECT id,status,name,phone,token_last8,token_ciphertext,created_at,updated_at,expires_at,submitted_at,decided_at,decision_note FROM captain_invites ORDER BY id DESC LIMIT 100").all().map((invite) => {
    let inviteUrl = null;
    if (invite.token_ciphertext) { try { inviteUrl = captainGatewayUrl(captainInviteBaseUrl(req), decryptCardCode(invite.token_ciphertext)); } catch {} }
    const { token_ciphertext: _tokenCiphertext, ...safeInvite } = invite;
    return { ...safeInvite, inviteUrl };
  });
  res.json({ invites });
});
app.post("/api/admin/captain-invites/:id/decision", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const decision = String(req.body?.decision || "").trim().toLowerCase();
  const note = String(req.body?.note || "").trim().slice(0, 240);
  if (!Number.isInteger(id) || !["approve", "reject"].includes(decision)) return res.status(400).json({ error: "قرار الموافقة أو الرفض مطلوب" });
  expireCaptainInvites();
  const invite = db.prepare("SELECT * FROM captain_invites WHERE id=? LIMIT 1").get(id);
  if (!invite) return res.status(404).json({ error: "طلب الدعوة غير موجود" });
  if (invite.status !== "pending") return res.status(409).json({ error: "هذا الطلب ليس قيد الانتظار" });
  const stamp = now();
  if (decision === "reject") {
    db.prepare("UPDATE captain_invites SET status='rejected',decision_note=?,decided_at=?,updated_at=?,pin_hash=NULL,pin_ciphertext=NULL WHERE id=? AND status='pending'").run(note || "تم رفض الطلب من الشركة", stamp, stamp, id);
    audit("captain.join.rejected", "captain_invite", id, { phone: invite.phone, note });
    const notified = invite.phone ? await sendBotText(`${phoneWithCountry(invite.phone)}@c.us`, `تم رفض طلب الانضمام إلى شركة الجراح.\\n${note ? `السبب: ${note}` : "يمكنك التواصل مع الشركة للاستفسار."}`) : false;
    void notifyOperations({ event: "captain.join.rejected", title: "تأكيد رفض طلب انضمام", lines: [`الاسم: ${invite.name || "غير محدد"}`, `الهاتف: ${invite.phone || "غير محدد"}`, note ? `السبب: ${note}` : "تم رفض الطلب من الشركة."], ownersOnly: true });
    return res.json({ success: true, status: "rejected", notified });
  }
  if (!invite.pin_hash || !invite.phone || !invite.name) return res.status(409).json({ error: "بيانات طلب الكابتن غير مكتملة" });
  const existing = db.prepare("SELECT * FROM users WHERE phone=? LIMIT 1").get(invite.phone);
  if (existing && existing.role !== "captain") return res.status(409).json({ error: "رقم الهاتف مستخدم لدور آخر" });
  let captainId;
  if (existing) {
    db.prepare("UPDATE users SET name=?,active=1,captain_pin_hash=?,captain_pin_ciphertext=?,updated_at=? WHERE id=? AND role='captain'").run(invite.name, invite.pin_hash, invite.pin_ciphertext, stamp, existing.id);
    captainId = existing.id;
  } else {
    captainId = db.prepare("INSERT INTO users(phone,name,role,wallet_cents,active,is_bot,captain_pin_hash,captain_pin_ciphertext,created_at,updated_at) VALUES(?,?,\'captain\',0,1,0,?,?,?,?)").run(invite.phone, invite.name, invite.pin_hash, invite.pin_ciphertext, stamp, stamp).lastInsertRowid;
  }
  db.prepare("UPDATE captain_invites SET status='approved',approved_user_id=?,decision_note=?,decided_at=?,updated_at=? WHERE id=? AND status='pending'").run(captainId, note || "تمت الموافقة", stamp, stamp, id);
  audit("captain.join.approved", "captain_invite", id, { captainId, phone: invite.phone });
  let notified = false;
  if (invite.phone) {
    let pinText = "الرقم السري الذي اخترته محفوظ في النظام.";
    if (invite.pin_ciphertext) { try { pinText = `الرقم السري الذي اخترته: ${decryptCardCode(invite.pin_ciphertext)}`; } catch {} }
    const captainAppLink = captainLoginUrl(captainInviteBaseUrl(req));
    notified = await sendCaptainOperationsCard(`${phoneWithCountry(invite.phone)}@c.us`, "تم اعتماد تسجيل الكابتن", [
      `الكابتن: ${invite.name}`,
      "تمت الموافقة على طلبك داخل شبكة الجراح.",
      `رقم الهاتف: ${invite.phone}`,
      pinText,
      `رابط دخول الكابتن المباشر: ${captainAppLink}`,
      "افتح رابط دخول الكابتن المرفق، ثم أدخل رقم هاتفك والرقم السري. هذا الرابط مخصص للدخول بعد الموافقة، وليس لتسجيل كابتن جديد."
    ]);
  }
  const captain = db.prepare("SELECT id,phone,name FROM users WHERE id=? AND role='captain' LIMIT 1").get(captainId);
  const membership = await addCaptainToConfiguredGroup(captain).catch((error) => ({ status: "failed", error: error.message }));
  audit("captain.group_membership.sync", "user", captainId, { membership });
  void notifyOperations({ event: "captain.join.approved", title: "تأكيد اعتماد كابتن", lines: [`الكابتن: ${invite.name}`, `الهاتف: ${invite.phone}`, "تم اعتماد التسجيل وإرسال بطاقة الدخول.", `حالة القروب: ${membership.status || "غير محددة"}`], ownersOnly: true });
  res.json({ success: true, status: "approved", captainId, notified, membership });
});
app.post("/api/captain/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const pin = String(req.body?.pin || "").trim();
  const rawPhone = String(req.body?.phone || "").replace(/[^0-9]/g, "");
  const phone = phoneWithCountry(rawPhone) || rawPhone;
  if (!phone) return res.status(400).json({ error: "رقم هاتف الكابتن مطلوب" });
  const user = db.prepare("SELECT id,phone,name,role,active,captain_pin_hash FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone)
    || db.prepare("SELECT id,phone,name,role,active,captain_pin_hash FROM users WHERE phone=? AND role='captain' LIMIT 1").get(rawPhone);
  if (!user) return res.status(404).json({ error: "لا يوجد حساب كابتن بهذا الرقم" });
  const pinValid = user.captain_pin_hash ? (validCaptainPin(pin) && bcrypt.compareSync(pin, user.captain_pin_hash)) : (username === CAPTAIN_USERNAME && validCaptainPassword(password));
  if (!pinValid) return res.status(401).json({ error: "الرقم السري أو بيانات دخول الكابتن غير صحيحة" });
  if (!user.active) return res.status(403).json({ error: "حساب الكابتن موقوف" });
  const token = jwt.sign({ role: "captain", userId: user.id, phone: user.phone }, CAPTAIN_SESSION_SECRET, { expiresIn: "7d" });
  setCaptainSessionCookie(res, token);
  res.json({ success: true, user: { id: user.id, phone: user.phone, name: user.name, role: user.role, active: Boolean(user.active) } });
});
app.post("/api/captain/logout", (req, res) => {
  clearCaptainSessionCookie(res);
  res.json({ success: true });
});
app.get("/api/captain/overview", requireCaptain, (req, res) => {
  const user = db.prepare("SELECT id,phone,name,role,wallet_cents,active,updated_at FROM users WHERE id=? AND role='captain' LIMIT 1").get(req.captainSession.userId);
  if (!user || !user.active) return res.status(403).json({ error: "Captain account is inactive" });
  const entries = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 100").all(user.id).map((entry) => ({ ...entry, amount: money(entry.amount_cents), balanceAfter: money(entry.balance_after_cents), details: entry.details_json ? JSON.parse(entry.details_json) : null }));
  const trips = db.prepare(`SELECT o.id,o.order_no,o.status,o.price_cents,o.origin,o.destination,o.trip_time,o.order_kind,o.captain_cents,o.created_at,o.updated_at,
    COALESCE((SELECT -SUM(w.amount_cents) FROM wallet_ledger w WHERE w.user_id=o.captain_user_id AND w.order_id=o.id AND w.type='captain_fee'),0) AS captain_fee_cents
    FROM orders o WHERE o.captain_user_id=? ORDER BY o.id DESC LIMIT 100`).all(user.id).map((trip) => {
      const grossCents = Number(trip.captain_cents || 0);
      const feeCents = Number(trip.captain_fee_cents || 0);
      return { ...trip, price: money(trip.price_cents), grossEarnings: money(grossCents), walletFee: money(feeCents), netEarnings: money(grossCents - feeCents) };
    });
  const totals = db.prepare(`SELECT COALESCE(SUM(captain_cents),0) AS gross_cents,
    COALESCE(SUM(CASE WHEN status IN ('accepted','completed') THEN captain_cents ELSE 0 END),0) AS settled_gross_cents
    FROM orders WHERE captain_user_id=?`).get(user.id);
  const fees = db.prepare("SELECT COALESCE(SUM(-amount_cents),0) AS cents FROM wallet_ledger WHERE user_id=? AND type='captain_fee'").get(user.id);
  const topupCards = db.prepare("SELECT id,value_cents,status,sent_at,redeemed_at,created_at FROM topup_cards WHERE assigned_captain_id=? ORDER BY id DESC LIMIT 20").all(user.id).map((card) => ({ id: card.id, value: money(card.value_cents), status: card.status, sentAt: card.sent_at, redeemedAt: card.redeemed_at, createdAt: card.created_at }));
  res.setHeader("Cache-Control", "no-store");
  res.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, active: Boolean(user.active) },
    wallet: { currency: "JOD", balance: money(user.wallet_cents), balanceCents: user.wallet_cents },
    earnings: { gross: money(totals?.settled_gross_cents || 0), fees: money(fees?.cents || 0), net: money((totals?.settled_gross_cents || 0) - (fees?.cents || 0)) },
    entries,
    trips,
    topupCards,
  });
});
app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!JWT_SECRET) return res.status(503).json({ error: "مصادقة الإدارة غير مهيأة" });
  if (username !== ADMIN_USERNAME || !validAdminPassword(password)) return res.status(401).json({ error: "بيانات دخول المالك غير صحيحة" });
  const token = jwt.sign({ role: "company", username }, JWT_SECRET, { expiresIn: "7d" });
  setSessionCookie(res, token);
  res.json({ success: true, role: "company", username });
});
app.post("/api/auth/logout", (req, res) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `aljarah_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  res.json({ success: true });
});
app.get("/status", (req, res) => {
  const groupId = getSetting("group_id", null);
  const activeGroupId = getSetting("active_group_id", null);
  const configuredGroupId = groupId || activeGroupId;
  const groupReceiverReady = Boolean(isReady || baileysReady);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ready: Boolean(isReady),
    phone: connectedBotPhone(),
    groupConfigured: Boolean(configuredGroupId && isConfiguredGroup(configuredGroupId)),
    groupId: configuredGroupId || null,
    groupReceiverReady,
    groupReceiverMode: baileysReady ? "webjs+baileys" : (isReady ? "webjs" : "offline"),
    lastGroupEventAt: lastGroupMessageTelemetry?.at || null,
    lastGroupEventMatched: lastGroupMessageTelemetry ? Boolean(lastGroupMessageTelemetry.configured) : null,
    qrAvailable: Boolean(qrCodeData || baileysQrCodeData),
    whatsappState,
    whatsappLastEvent,
    whatsappLastError,
    whatsappInitializing: Boolean(initializing),
  });
});
app.get("/api/admin/system/health", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, health: runtimeHealth() });
});
app.post("/api/admin/change-password", requireAdmin, (req, res) => {
  const newToken = String(req.body?.newToken || "");
  if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z\d]).{16,128}$/.test(newToken)) {
    return res.status(400).json({ error: "newToken must be 16-128 characters and include uppercase, lowercase, number, and symbol" });
  }
  try {
    const temporaryPath = `${PERSISTED_ADMIN_TOKEN_PATH}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, `${newToken}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, PERSISTED_ADMIN_TOKEN_PATH);
    activeAdminToken = newToken;
    audit("admin.token.changed", "system", "admin", { persisted: true });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, message: "ADMIN_TOKEN changed and persisted", restartRequiredForRenderEnv: true });
  } catch (error) {
    console.error("[Security] admin token persistence failed:", error.message);
    res.status(500).json({ error: "Unable to persist ADMIN_TOKEN" });
  }
});
app.get("/api/admin/bot/status", requireAdmin, (req, res) => {
  const health = runtimeHealth();
  const inventory = storageInventory();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    status: health.whatsapp?.ready ? "connected" : "offline",
    bot: {
      ready: Boolean(health.whatsapp?.ready),
      state: health.whatsapp?.state || "unknown",
      lastEvent: health.whatsapp?.lastEvent || null,
      lastError: health.whatsapp?.lastError || null,
      lastReadyAt: health.whatsapp?.lastReadyAt || null,
      lastDisconnectAt: health.whatsapp?.lastDisconnectAt || null,
      reconnectAttempts: Number(health.whatsapp?.reconnectAttempts || 0),
    },
    session: {
      dataDir: health.storage?.dataDir || DATA_DIR,
      authPath: health.storage?.authPath || AUTH_PATH,
      qrAvailable: Boolean(health.whatsapp?.qrAvailable),
      authPathWritable: Boolean(health.storage?.authPathHealth?.writable),
    },
    storage: {
      dataDirExists: Boolean(health.storage?.dataDirHealth?.exists),
      dataDirWritable: Boolean(health.storage?.dataDirHealth?.writable),
      databaseExists: Boolean(health.storage?.databaseFileHealth?.exists),
      databaseWritable: Boolean(health.storage?.databaseFileHealth?.writable),
      usedBytes: Number(inventory.inventory?.totalBytes || inventory.totalBytes || 0),
      freeBytes: Number(inventory.inventory?.filesystem?.freeBytes || inventory.filesystem?.freeBytes || 0),
      availableBytes: Number(inventory.inventory?.filesystem?.availableBytes || inventory.filesystem?.availableBytes || 0),
    },
    checkedAt: new Date().toISOString(),
  });
});
app.get("/api/admin/system/storage", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, inventory: storageInventory() });
});
app.get("/api/admin/system/settings", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, settings: operationalSettings() });
});
app.patch("/api/admin/system/settings", requireAdmin, (req, res) => {
  const body = req.body || {};
  const fields = [
    ["reconnectBaseDelayMs", "whatsapp_reconnect_base_delay_ms", 1000, 60000],
    ["reconnectMaxDelayMs", "whatsapp_reconnect_max_delay_ms", 10000, 900000],
    ["reconnectMaxAttempts", "whatsapp_reconnect_max_attempts", 1, 100],
    ["initTimeoutMs", "whatsapp_init_timeout_ms", 60000, 900000],
  ];
  const updates = [];
  for (const [input, key, minimum, maximum] of fields) {
    if (body[input] === undefined) continue;
    const value = Number(body[input]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return res.status(400).json({ error: `${input} must be an integer between ${minimum} and ${maximum}` });
    }
    setSetting(key, value);
    updates.push(input);
  }
  if (!updates.length) return res.status(400).json({ error: "No supported settings supplied" });
  audit("system.settings.updated", "system", "whatsapp", { fields: updates });
  void notifyOperations({ event: "system.settings.updated", title: "تأكيد تحديث إعدادات التشغيل", lines: [`الإعدادات التي تم تحديثها: ${updates.join("، ")}`, "تم حفظ الإعدادات داخل قاعدة البيانات.", "سيستخدم البوت القيم الجديدة في دورة الاتصال القادمة."], ownersOnly: true });
  res.json({ success: true, settings: operationalSettings(), updated: updates });
});
app.get("/api/admin/diagnostics/last-group-event", requireAdmin, (req, res) => res.json({ groupId: lastGroupEventGroupId, telemetry: lastGroupMessageTelemetry }));
app.get("/api/admin/diagnostics/last-guide-video-send", requireAdmin, (req, res) => res.json({ telemetry: lastGuideVideoTelemetry }));
app.get("/api/admin/group-messages", requireAdmin, (req, res) => {
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const requestedLimit = Number(req.query.limit || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 50;
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  const beforeId = Number(req.query.beforeId || 0);
  const rows = beforeId > 0
    ? db.prepare("SELECT id,message_id,group_id,sender_phone,sender_name,body,message_type,sent_at,created_at FROM messages WHERE group_id=? AND id<? ORDER BY id DESC LIMIT ?").all(groupId, beforeId, limit)
    : db.prepare("SELECT id,message_id,group_id,sender_phone,sender_name,body,message_type,sent_at,created_at FROM messages WHERE group_id=? ORDER BY id DESC LIMIT ?").all(groupId, limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({ groupId, count: rows.length, messages: rows });
});
app.post("/api/admin/group/send-approved-guide-video", requireAdmin, async (req, res) => {
  const groupId = String(req.body?.groupId || "").trim();
  const videoUrl = String(req.body?.videoUrl || "").trim();
  const officialGroupId = "120363426604560611@g.us";
  if (groupId !== officialGroupId) return res.status(403).json({ error: "Only the verified official group is allowed" });
  if (!/^https:\/\//i.test(videoUrl)) return res.status(400).json({ error: "A secure video URL is required" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  try {
    const chat = await resolveGroupChat(groupId) || await withTimeout(client.getChatById(groupId), 25000, null);
    const media = await withTimeoutStrict(mediaFromRemoteVideoUrl(videoUrl, 0), 120000, null);
    if (!media) return res.status(504).json({ error: "Video download or conversion timed out" });
    const portal = captainAppUrl(captainInviteBaseUrl(req));
    const caption = `شرح الكابتن المعتمد\n\nطريقة التسجيل، متابعة الرصيد والطلبات، وشرح بطاقة الشحن خطوة بخطوة.\n\nرابط التسجيل والبوابة الرسمية:\n${portal}`;
    const sent = chat && typeof chat.sendMessage === "function"
      ? await withTimeoutStrict(chat.sendMessage(media, { caption, waitUntilMsgSent: false }), 180000, null)
      : await withTimeoutStrict(client.sendMessage(groupId, media, { caption, waitUntilMsgSent: false }), 180000, null);
    if (!sent) return res.status(504).json({ error: "WhatsApp returned no confirmation" });
    audit("group.approved_guide_video.sent", "group", groupId, { messageId: sent.id?._serialized || null });
    res.json({ success: true, groupId, messageId: sent.id?._serialized || null, portal });
  } catch (error) {
    res.status(502).json({ error: String(error?.message || error).slice(0, 240) });
  }
});
app.post("/api/admin/group/send-guide-videos", requireAdmin, async (req, res) => {
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const videos = Array.isArray(req.body?.videos) ? req.body.videos.slice(0, 3).filter((url) => /^https:\/\//i.test(String(url || ""))) : [];
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (!videos.length) return res.status(400).json({ error: "At least one secure video URL is required" });
  const snapshot = await readGroupSnapshot(groupId);
  const chat = await resolveGroupChat(groupId);
  if (!snapshot || !snapshot.isGroup || !chat || !chat.isGroup) return res.status(404).json({ error: "Configured chat is not a hydrated group" });
  const captions = [
    "شرح 1/2 · التسجيل وتسجيل الدخول\nافتح بوابة التشغيل الرسمية، اضغط زر التشغيل الأصفر، ثم اختر المسار المناسب: تسجيل كابتن جديد لأول مرة أو دخول الكابتن للحساب المسجل.\nالبوابة: " + captainAppUrl(captainInviteBaseUrl(req)),
    "شرح 2/2 · بطاقة الشحن وتفعيل الرصيد\nمن دخول الكابتن اختر شحن بطاقة رصيد، ثم أدخل الكود واضغط Enter ليُضاف الرصيد مباشرة إلى محفظتك ويُسجل في النظام."
  ];
  const sent = [];
  const errors = [];
  const startedAt = now();
  for (let index = 0; index < videos.length; index += 1) {
    try {
      const media = await withTimeoutStrict(mediaFromRemoteVideoUrl(String(videos[index]), index), 120000, null);
      if (!media) throw new Error("media download or conversion timed out");
      const caption = captions[index] || "شرح بوابة التشغيل الرسمية للكباتن.";
      const message = await withTimeoutStrict(chat.sendMessage(media, { caption, waitUntilMsgSent: false }), 180000, null);
      let confirmed = message && message.id?._serialized ? message : null;
      if (!confirmed) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const recent = await withTimeout(chat.fetchMessages({ limit: 20, fromMe: true }), 30000, []);
        confirmed = recent.find((item) => item && item.hasMedia && String(item.body || "") === caption) || null;
      }
      if (!confirmed) throw new Error("WhatsApp returned no confirmed outgoing media message");
      sent.push({ index, messageId: confirmed.id?._serialized || null });
    } catch (error) {
      errors.push({ index, error: String(error?.message || error).slice(0, 240) });
    }
  }
  lastGuideVideoTelemetry = { groupId, requested: videos.length, sent: sent.length, errors, startedAt, finishedAt: now() };
  audit("group.guide_videos.sent", "group", groupId, { count: sent.length, videos: sent.map((item) => item.index), errors });
  void notifyOperations({ event: "group.guide_videos.sent", title: "تأكيد إرسال فيديوهات شرح الكباتن", lines: [`القروب: ${groupId}`, `عدد الفيديوهات المرسلة: ${sent.length}`, errors.length ? `فشل: ${errors.length} · راجع تشخيص الإرسال.` : "تم إرسال شرح التسجيل والدخول وبطاقة الشحن داخل القروب."], ownersOnly: true });
  res.json({ success: errors.length === 0, groupId, sent, errors });
});

app.post("/api/dashboard/cards", requireDashboardApi, (req, res) => {
  if (!cardEncryptionKey) return res.status(503).json({ error: "Card encryption is not configured" });
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 30)) return res.status(429).json({ error: "Too many card issuance attempts; try again later" });
  const value = Number(req.body?.value);
  const captainId = Number(req.body?.captainId);
  const issueIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isFinite(value) || value <= 0 || value > 1000 || !Number.isInteger(captainId) || captainId < 1 || issueIdempotencyKey.length < 16 || issueIdempotencyKey.length > 100) {
    return res.status(400).json({ error: "Valid value, captainId, and idempotencyKey are required" });
  }
  const captain = db.prepare("SELECT id,phone,name,active,role FROM users WHERE id=? AND role='captain' LIMIT 1").get(captainId);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  if (!captain.active) return res.status(409).json({ error: "Captain is inactive" });
  const existing = db.prepare("SELECT id,value_cents,status,assigned_captain_id,code_ciphertext FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueIdempotencyKey);
  if (existing) {
    if (Number(existing.assigned_captain_id) !== captainId) return res.status(409).json({ error: "Idempotency key is already assigned to another captain" });
    if (existing.status !== "issued") return res.status(409).json({ error: `Card already has status ${existing.status}` });
    return res.json({ id: existing.id, code: decryptCardCode(existing.code_ciphertext), value: money(existing.value_cents), status: existing.status, captainId });
  }
  const code = randomCode();
  const encryptedCode = encryptCardCode(code);
  const result = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,?,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), cents(value), captainId, issueIdempotencyKey, encryptedCode, now());
  audit("topup_card.issued_and_assigned", "topup_card", result.lastInsertRowid, { valueCents: cents(value), captainId, issueIdempotencyKey });
  res.status(201).json({ id: result.lastInsertRowid, code, value: Number(value).toFixed(2), status: "issued", captainId });
});

app.post("/api/dashboard/cards/:id/send", requireDashboardApi, async (req, res) => {
  if (!cardEncryptionKey) return res.status(503).json({ error: "Card encryption is not configured" });
  const cardId = Number(req.params.id);
  const deliveryIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isInteger(cardId) || cardId < 1 || deliveryIdempotencyKey.length < 16 || deliveryIdempotencyKey.length > 100) return res.status(400).json({ error: "Valid card id and idempotencyKey are required" });
  const card = db.prepare("SELECT c.id,c.value_cents,c.status,c.assigned_captain_id,c.sent_at,c.delivery_idempotency_key,c.code_ciphertext,u.phone AS captain_phone,u.name AS captain_name,u.active AS captain_active FROM topup_cards c LEFT JOIN users u ON u.id=c.assigned_captain_id WHERE c.id=? LIMIT 1").get(cardId);
  if (!card) return res.status(404).json({ error: "Card not found" });
  if (card.delivery_idempotency_key && card.delivery_idempotency_key !== deliveryIdempotencyKey) return res.status(409).json({ error: "Card delivery is already recorded with another idempotency key" });
  if (card.sent_at) return res.json({ success: true, cardId, status: "sent", alreadySent: true });
  if (card.status !== "issued") return res.status(409).json({ error: `Card cannot be sent while status is ${card.status}` });
  if (!card.assigned_captain_id || !card.captain_phone || !card.captain_active) return res.status(409).json({ error: "Card must be assigned to an active captain before sending" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp bot is not ready; card was not sent" });
  if (cardDeliveryInFlight.has(cardId)) return res.status(409).json({ error: "Card delivery is already in progress" });
  cardDeliveryInFlight.add(cardId);
  try {
    const code = decryptCardCode(card.code_ciphertext);
    const chatId = `${phoneWithCountry(card.captain_phone)}@c.us`;
    const message = brandedMessage("بطاقة شحن مخصصة", [`الكابتن: ${card.captain_name || "حسابك"}`, `القيمة: ${money(card.value_cents)} JOD`, `رمز البطاقة: ${code}`, "هذه البطاقة مخصصة لهذا الرقم فقط وتُستخدم مرة واحدة.", "للاسترداد أرسل الرمز عبر قناة البوت المعتمدة."]);
    const sent = await withTimeout(client.sendMessage(chatId, message), 20000, null);
    if (!sent) return res.status(504).json({ error: "WhatsApp delivery timed out; card remains unsent" });
    const stamp = now();
    const update = db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(stamp, deliveryIdempotencyKey, cardId);
    if (!update.changes) return res.json({ success: true, cardId, status: "sent", alreadySent: true });
    audit("topup_card.sent", "topup_card", cardId, { captainId: card.assigned_captain_id, messageId: sent.id?._serialized || null, deliveryIdempotencyKey });
    res.json({ success: true, cardId, status: "sent" });
  } catch (error) {
    audit("topup_card.delivery_failed", "topup_card", cardId, { captainId: card.assigned_captain_id, deliveryIdempotencyKey, error: String(error?.message || error) });
    res.status(502).json({ error: "Unable to deliver card through WhatsApp" });
  } finally {
    cardDeliveryInFlight.delete(cardId);
  }
});
app.post("/api/dashboard/cards/:id/void", requireDashboardApi, (req, res) => {
  const cardId = Number(req.params.id);
  const reason = String(req.body?.reason || "").trim();
  const voidIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isInteger(cardId) || cardId < 1 || reason.length < 3 || reason.length > 240 || voidIdempotencyKey.length < 16 || voidIdempotencyKey.length > 100) return res.status(400).json({ error: "Valid card id, reason, and idempotencyKey are required" });
  const card = db.prepare("SELECT id,status,void_idempotency_key FROM topup_cards WHERE id=? LIMIT 1").get(cardId);
  if (!card) return res.status(404).json({ error: "Card not found" });
  if (card.void_idempotency_key && card.void_idempotency_key !== voidIdempotencyKey) return res.status(409).json({ error: "Card cancellation is already recorded with another idempotency key" });
  if (card.status === "void") return res.json({ success: true, cardId, status: "void", alreadyVoided: true });
  if (card.status !== "issued") return res.status(409).json({ error: `Card cannot be cancelled while status is ${card.status}` });
  const stamp = now();
  const update = db.prepare("UPDATE topup_cards SET status='void',void_idempotency_key=? WHERE id=? AND status='issued'").run(voidIdempotencyKey, cardId);
  if (!update.changes) return res.json({ success: true, cardId, status: "void", alreadyVoided: true });
  audit("topup_card.voided", "topup_card", cardId, { reason, voidIdempotencyKey });
  res.json({ success: true, cardId, status: "void", cancelledAt: stamp });
});

app.get("/api/dashboard/captains/portal/:phone", requireDashboardApi, (req, res) => {
  const phone = phoneWithCountry(req.params.phone || "");
  const user = db.prepare("SELECT id,phone,name,role,active FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
  if (!user) return res.status(404).json({ error: "Captain account not found" });
  const wallet = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(user.id);
  const entries = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 100").all(user.id).map((entry) => ({ ...entry, details: entry.details_json ? JSON.parse(entry.details_json) : null }));
  const trips = db.prepare("SELECT id,order_no,status,price_cents,origin,destination,trip_time,created_at,updated_at FROM orders WHERE captain_user_id=? ORDER BY id DESC LIMIT 100").all(user.id).map((trip) => ({ ...trip, price: money(trip.price_cents) }));
  res.setHeader("Cache-Control", "no-store");
  res.json({ user, wallet: { currency: "JOD", balance: money(wallet?.wallet_cents || 0), balanceCents: wallet?.wallet_cents || 0, entries }, trips });
});

app.post("/api/dashboard/captains/redeem", requireDashboardApi, (req, res) => {
  if (!consumeRateLimit(redeemRate, clientAddress(req), 12)) return res.status(429).json({ error: "Too many redemption attempts; try again later" });
  const phone = phoneWithCountry(req.body?.phone || "");
  const code = String(req.body?.code || "").trim().toUpperCase();
  const redemptionIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!phone || !code || redemptionIdempotencyKey.length < 16 || redemptionIdempotencyKey.length > 100) return res.status(400).json({ error: "phone, code, and idempotencyKey are required" });
  if (isBlockedPhone(phone)) return res.status(403).json({ error: "This phone is blocked by company policy" });
  try {
    const result = db.transaction(() => {
      const existing = db.prepare("SELECT id,value_cents,redeemed_by,redeemed_at FROM topup_cards WHERE redemption_idempotency_key=? LIMIT 1").get(redemptionIdempotencyKey);
      if (existing) {
        const existingUser = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(existing.redeemed_by);
        return { alreadyRedeemed: true, balanceCents: existingUser?.wallet_cents || 0, valueCents: existing.value_cents };
      }
      const card = db.prepare("SELECT * FROM topup_cards WHERE code_hash=? LIMIT 1").get(hashCode(code));
      if (!card || card.status !== "issued") throw new Error("Invalid or already used card");
      const assignedUser = card.assigned_captain_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='captain' LIMIT 1").get(card.assigned_captain_id) : null;
      if (!assignedUser || phoneWithCountry(assignedUser.phone) !== phone) throw new Error("This card is assigned to another captain");
      if (!assignedUser.active) throw new Error("Captain account is inactive");
      const newBalance = Number(assignedUser.wallet_cents) + Number(card.value_cents);
      const stamp = now();
      const update = db.prepare("UPDATE topup_cards SET status='redeemed',redeemed_by=?,redeemed_at=?,redemption_idempotency_key=? WHERE id=? AND status='issued'").run(assignedUser.id, stamp, redemptionIdempotencyKey, card.id);
      if (!update.changes) throw new Error("Card was already redeemed");
      db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(newBalance, stamp, assignedUser.id);
      db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?)").run(assignedUser.id, "topup", card.value_cents, newBalance, `CARD-${card.id}`, "شحن بطاقة", stamp, JSON.stringify({ redemptionIdempotencyKey, source: "dashboard_captain_portal" }));
      audit("topup_card.redeemed", "topup_card", card.id, { userId: assignedUser.id, valueCents: card.value_cents, redemptionIdempotencyKey }, assignedUser.id);
      return { alreadyRedeemed: false, balanceCents: newBalance, valueCents: card.value_cents };
    })();
    if (!result.alreadyRedeemed) {
      const captain = db.prepare("SELECT name,phone FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
      void notifyOperations({ event: "topup_card.redeemed", title: "تأكيد إضافة الرصيد", captainPhone: captain?.phone, lines: [`الكابتن: ${captain?.name || "حساب الكابتن"}`, `القيمة المضافة: ${money(result.valueCents)} JOD`, `الرصيد الحالي: ${money(result.balanceCents)} JOD`, "تم تسجيل العملية في دفتر الشركة وإضافة الرصيد مباشرة." ] });
    }
    res.json({ success: true, alreadyRedeemed: result.alreadyRedeemed, balance: money(result.balanceCents), credited: money(result.valueCents), currency: "JOD" });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to redeem card" });
  }
});

app.post("/api/dashboard/captains/:id/wallet-adjustment", requireDashboardApi, (req, res) => {
  const id = Number(req.params.id);
  const captain = db.prepare("SELECT id,phone,name,wallet_cents,active FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const direction = String(req.body?.direction || "").toLowerCase();
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || "").trim();
  const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!["credit", "debit"].includes(direction) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || reason.length < 3 || reason.length > 240 || idempotencyKey.length < 16 || idempotencyKey.length > 100) return res.status(400).json({ error: "Direction, positive amount, reason, and unique idempotencyKey are required" });
  const amountCents = Math.round(amount * 100);
  const signedAmount = direction === "credit" ? amountCents : -amountCents;
  const existing = db.prepare("SELECT id,amount_cents,balance_after_cents,reference FROM wallet_ledger WHERE user_id=? AND type IN ('admin_credit','admin_debit') AND details_json LIKE ? LIMIT 1").get(id, `%\\"idempotencyKey\\":\\"${idempotencyKey.replace(/[\\%_]/g, "\\$&")}\\"%`);
  if (existing) return res.status(409).json({ error: "This adjustment was already recorded", ledgerId: existing.id, reference: existing.reference });
  const nextBalance = captain.wallet_cents + signedAmount;
  if (direction === "debit" && nextBalance < CAPTAIN_MIN_BALANCE_CENTS) return res.status(409).json({ error: `Debit exceeds the captain debt limit (${money(CAPTAIN_MIN_BALANCE_CENTS)})` });
  const reference = `DASH-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const stamp = now();
  const ledgerId = db.transaction(() => {
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain'").run(nextBalance, stamp, id);
    const result = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(id, direction === "credit" ? "admin_credit" : "admin_debit", signedAmount, nextBalance, reference, reason, stamp, JSON.stringify({ idempotencyKey, direction, amount, amountCents, reason, actor: "dashboard" }));
    audit(direction === "credit" ? "captain.wallet.credited" : "captain.wallet.debited", "user", id, { phone: captain.phone, amountCents, reason, reference, balanceAfterCents: nextBalance, actor: "dashboard" });
    return result.lastInsertRowid;
  })();
  void notifyOperations({ event: direction === "credit" ? "captain.wallet.credited" : "captain.wallet.debited", title: "تأكيد حركة محفظة", captainPhone: captain.phone, lines: [`الكابتن: ${captain.name}`, `${direction === "credit" ? "تمت إضافة" : "تم خصم"}: ${money(amountCents)} JOD`, `الرصيد الحالي: ${money(nextBalance)} JOD`, `السبب: ${reason}`, "تم تسجيل الحركة في دفتر الشركة." ] });
  res.status(201).json({ success: true, ledgerId, reference, balance: money(nextBalance), balanceCents: nextBalance });
});

app.post("/api/admin/whatsapp/restart", requireAdmin, async (req, res) => {
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 3)) return res.status(429).json({ error: "Too many restart attempts; try again later" });
  try {
    await restartWhatsApp("admin requested reconnect");
    void notifyOperations({ event: "whatsapp.reconnect.requested", title: "تأكيد إعادة اتصال البوت", lines: ["تم طلب إعادة اتصال واتساب.", "ستبقى قاعدة البيانات وجلسة واتساب محفوظتين.", "ستصل حالة الاتصال الجديدة إلى لوحة المالك بعد اكتمال الدورة."], ownersOnly: true });
    res.json({ success: true, message: "Reconnect scheduled while preserving the WhatsApp session and application data" });
  } catch (error) {
    console.error("[WhatsApp] admin restart:", error.message);
    res.status(500).json({ error: "Unable to schedule WhatsApp reconnect" });
  }
});
app.post("/api/admin/qr-temporary-link", requireAdmin, (req, res) => {
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 30)) return res.status(429).json({ error: "Too many administrative actions; try again later" });
  const grant = issueTemporaryQrGrant(req);
  const origin = process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`;
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, url: `${origin}/qr?access=${encodeURIComponent(grant.token)}`, expiresAt: grant.expiresAt, durationSeconds: grant.durationSeconds });
});
app.post("/api/admin/qr-main-link", requireAdmin, (req, res) => {
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 30)) return res.status(429).json({ error: "Too many administrative actions; try again later" });
  const grant = issueTemporaryQrGrant(req);
  const origin = process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`;
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, url: `${origin}/qr-main?access=${encodeURIComponent(grant.token)}`, expiresAt: grant.expiresAt, durationSeconds: grant.durationSeconds });
});
app.get("/qr-main", requireQrAccess, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
  const refreshTarget = req.query.access ? `/qr-main?access=${encodeURIComponent(String(req.query.access))}` : "/qr-main";
  if (qrCodeData) {
    const image = await qrcode.toDataURL(qrCodeData);
    return res.send(`<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><body style="font-family:system-ui;background:#09111f;color:white;display:grid;place-items:center;min-height:100vh"><main style="text-align:center;background:#14243a;padding:24px;border-radius:18px"><h2>QR البوت الرئيسي</h2><p>امسح هذا الرمز لربط رقم البوت ${BOT_PHONE}</p><img src="${image}" style="max-width:320px;width:100%;background:#fff;padding:12px;border-radius:12px"><p>واتساب ← الأجهزة المرتبطة ← ربط جهاز</p><p>هذا الرمز ليس لمستقبل المجموعة</p></main><script>setTimeout(()=>location.href=${JSON.stringify(refreshTarget)},30000)</script></body></html>`);
  }
  if (isReady) return res.send(`<html dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:50px"><h2>البوت الرئيسي متصل</h2><p>${BOT_PHONE}</p></body></html>`);
  res.send(`<html dir="rtl"><meta charset="utf-8"><meta http-equiv="refresh" content="3;url=${refreshTarget}"><body style="font-family:system-ui;text-align:center;padding:50px"><h2>جاري تجهيز QR البوت الرئيسي...</h2><p>لا تعرض هذه الصفحة QR مستقبل المجموعة.</p></body></html>`);
});
app.get("/qr", requireQrAccess, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
    const refreshTarget = req.query.access ? `/qr?access=${encodeURIComponent(String(req.query.access))}` : "/qr";
  if (qrCodeData) {
    const image = await qrcode.toDataURL(qrCodeData);
    return res.send(`<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><body style="font-family:system-ui;background:#09111f;color:white;display:grid;place-items:center;min-height:100vh"><main style="text-align:center;background:#14243a;padding:24px;border-radius:18px"><h2>امسح QR لربط البوت الرئيسي</h2><img src="${image}" style="max-width:320px;width:100%;background:#fff;padding:12px;border-radius:12px"><p>واتساب ← الأجهزة المرتبطة ← ربط جهاز</p><p>الرمز يتجدد تلقائيًا</p></main><script>setTimeout(()=>location.href=${JSON.stringify(refreshTarget)},30000)</script></body></html>`);
  }
  if (isReady) return res.send(`<html dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:50px"><h2>البوت الرئيسي متصل</h2><p>${BOT_PHONE}</p></body></html>`);
  if (baileysReady) return res.send(`<html dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:50px"><h2>مستقبل رسائل القروب متصل</h2><p>بانتظار QR البوت الرئيسي</p></body></html>`);
  if (!baileysQrCodeData) return res.send('<meta http-equiv="refresh" content="3"><h2 style="font-family:system-ui;text-align:center">جاري تجهيز QR...</h2>');
  const image = await qrcode.toDataURL(baileysQrCodeData);
  res.send(`<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><body style="font-family:system-ui;background:#09111f;color:white;display:grid;place-items:center;min-height:100vh"><main style="text-align:center;background:#14243a;padding:24px;border-radius:18px"><h2>امسح QR لمستقبل القروب</h2><img src="${image}" style="max-width:320px;width:100%;background:#fff;padding:12px;border-radius:12px"><p>واتساب ← الأجهزة المرتبطة ← ربط جهاز</p><p>الرمز يتجدد تلقائيًا</p></main><script>setTimeout(()=>location.href=${JSON.stringify(refreshTarget)},30000)</script></body></html>`);
});

function extractInviteCode(value = "") {
  const raw = String(value).trim();
  const match = raw.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : raw.replace(/[^A-Za-z0-9_-]/g, "");
}
app.get("/code", async (req, res) => {
    try {
        const phone = req.query.phone || "962779110123";
        let code = "";
        if (typeof sock !== 'undefined' && sock.requestPairingCode) {
            code = await sock.requestPairingCode(phone);
        } else if (typeof client !== 'undefined' && client.requestPairingCode) {
            code = await client.requestPairingCode(phone);
        } else {
            return res.status(500).json({ error: "No active whatsapp instance found" });
        }
        return res.json({ success: true, phone, code });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
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

function extractCreatedGroupId(created) {
  const groupId = created && created.gid ? (created.gid._serialized || String(created.gid)) : (created && created.id ? (created.id._serialized || String(created.id)) : null);
  return groupId && String(groupId).endsWith("@g.us") ? String(groupId) : null;
}

async function createGroupInBackground({ operationId, groupName, phones }) {
  let createdGroupId = null;
  const participantResults = phones.map((phone) => ({ phone, status: "pending" }));
  try {
    // WhatsApp Web currently has a known failure mode when createGroup receives
    // participants in the same request. Create the group from the bot account
    // first, then add each participant separately.
    console.log(`[GroupCreate] creating empty group operation=${operationId}`);
    const created = await withTimeout(client.createGroup(groupName), WHATSAPP_GROUP_CREATE_TIMEOUT_MS, null);
    if (!created) throw new Error("WhatsApp group creation timed out; no group was configured");
    if (typeof created === "string") throw new Error(`WhatsApp could not create the group: ${created}`);
    createdGroupId = extractCreatedGroupId(created);
    if (!createdGroupId) throw new Error("WhatsApp returned an invalid group identifier");
    groupCreateState = { ...groupCreateState, status: "adding_participants", groupId: createdGroupId, participants: participantResults };
    let groupChat = await withTimeout(client.getChatById(createdGroupId), 30000, null);
    if (!groupChat || typeof groupChat.addParticipants !== "function") {
      const chats = await withTimeout(client.getChats(), 30000, []);
      groupChat = Array.isArray(chats) ? chats.find((chat) => chat && chat.id && (chat.id._serialized || String(chat.id)) === createdGroupId) : null;
    }
    if (!groupChat || typeof groupChat.addParticipants !== "function") throw new Error("Group was created but could not be opened for participant addition");
    for (const result of participantResults) {
      const participantId = `${result.phone}@c.us`;
      console.log(`[GroupCreate] adding participant ${displayPhone(result.phone)} to ${createdGroupId}`);
      const added = await withTimeout(groupChat.addParticipants([participantId]), 60000, null);
      if (!added || typeof added === "string") {
        result.status = "failed";
        result.error = typeof added === "string" ? added : "participant addition timed out";
        throw new Error(`Could not add ${displayPhone(result.phone)} to the new group`);
      }
      result.status = "added";
      result.response = added && typeof added === "object" ? added : null;
    }
    configureGroupId(createdGroupId, groupName);
    const captainSync = await syncActiveCaptainsToConfiguredGroup({ sendLinks: true });
    audit("group.created_and_configured", "group", createdGroupId, { groupName, participants: phones });
    groupCreateState = { status: "succeeded", operationId, startedAt: groupCreateState.startedAt, finishedAt: now(), error: null, groupId: createdGroupId, participants: participantResults, captainSync };
    console.log(`[GroupCreate] succeeded operation=${operationId} group=${createdGroupId}`);
  } catch (error) {
    groupCreateState = { status: "failed", operationId, startedAt: groupCreateState.startedAt, finishedAt: now(), error: error.message, groupId: createdGroupId, participants: participantResults };
    console.error(`[GroupCreate] failed operation=${operationId}:`, error.message);
  } finally {
    groupCreateInFlight = false;
  }
}


async function openCreatedGroupForAdmin(groupId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const groupChat = await withTimeout(client.getChatById(groupId), 30000, null);
    if (groupChat && typeof groupChat.addParticipants === "function") return groupChat;
    const chats = await withTimeout(client.getChats(), 30000, []);
    const found = Array.isArray(chats) ? chats.find((chat) => chat && chat.isGroup && chat.id && (chat.id._serialized || String(chat.id)) === groupId) : null;
    if (found && typeof found.addParticipants === "function") return found;
    const modelData = await withTimeout(client.pupPage.evaluate(async (requestedId) => {
      try {
        const wid = window.require("WAWebWidFactory").createWid(requestedId);
        const collections = window.require("WAWebCollections");
        const chat = collections.Chat.get(wid) || (await window.require("WAWebFindChatAction").findOrCreateLatestChat(wid))?.chat;
        if (!chat || !chat.groupMetadata) return null;
        const data = chat.serialize ? chat.serialize() : null;
        if (!data) return null;
        data.id = data.id || { _serialized: requestedId };
        data.isGroup = true;
        data.formattedTitle = data.formattedTitle || chat.formattedTitle || chat.name || "";
        data.groupMetadata = data.groupMetadata || (chat.groupMetadata.serialize ? chat.groupMetadata.serialize() : chat.groupMetadata);
        return data;
      } catch (_) {
        return null;
      }
    }, groupId), 30000, null);
    if (modelData && modelData.isGroup && modelData.groupMetadata) {
      const ChatFactory = require("whatsapp-web.js/src/factories/ChatFactory");
      return ChatFactory.create(client, modelData);
    }
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return null;
}

async function finalizeCreatedGroupInBackground({ operationId, groupId, groupName, phones }) {
  const destinationSnapshot = await readGroupSnapshot(groupId);
  const existingPhones = new Set((destinationSnapshot?.participants || []).map(groupParticipantPhone).filter(Boolean));
  const participantResults = phones.map((phone) => ({ phone, status: existingPhones.has(phone) ? "already_present" : "pending" }));
  try {
    const groupChat = await openCreatedGroupForAdmin(groupId);
    if (!groupChat || typeof groupChat.addParticipants !== "function") throw new Error("The newly created group is still unavailable for participant addition");
    groupCreateState = { ...groupCreateState, status: "adding_participants", operationId, groupId, participants: participantResults };
    for (const result of participantResults) {
      if (result.status === "already_present") continue;
      const participantId = result.phone + "@c.us";
      try {
        const added = await withTimeout(groupChat.addParticipants([participantId]), 60000, null);
        if (!added || typeof added === "string") {
          result.status = "failed";
          result.error = typeof added === "string" ? added : "participant addition timed out";
          continue;
        }
        result.status = "added";
        result.response = added && typeof added === "object" ? added : null;
      } catch (error) {
        result.status = "failed";
        result.error = error.message;
        console.error("[GroupCreate] participant addition failed:", result.phone, error.message);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    configureGroupId(groupId, groupName);
    let captainSync = null;
    if (client && isReady) {
      try {
        captainSync = await syncActiveCaptainsToConfiguredGroup({ sendLinks: true });
      } catch (error) {
        captainSync = { status: "sync_failed", error: error.message };
      }
    }
    audit("group.created_and_configured", "group", groupId, { groupName, participants: phones, recovered: true });
    const failedCount = participantResults.filter((participant) => participant.status === "failed").length;
    groupCreateState = { status: failedCount ? "partial" : "succeeded", operationId, startedAt: groupCreateState.startedAt, finishedAt: now(), error: failedCount ? `${failedCount} participant(s) require retry` : null, groupId, participants: participantResults, captainSync, recovered: true };
    console.log("[GroupCreate] recovered operation=" + operationId + " group=" + groupId);
  } catch (error) {
    groupCreateState = { ...groupCreateState, status: "failed", operationId, finishedAt: now(), error: error.message, groupId, participants: participantResults, recoverable: true };
    console.error("[GroupCreate] recovery failed:", error.message);
  } finally {
    groupCreateInFlight = false;
  }
}

function purgeExperimentalCaptains() {
  normalizeBotIdentity();
  const botPhones = new Set([phoneWithCountry(BOT_PHONE), phoneWithCountry(BOT_PHONE_INTL)]);
  const captains = db.prepare("SELECT id,phone FROM users WHERE role='captain'").all().filter((captain) => !botPhones.has(phoneWithCountry(captain.phone)));
  const ids = captains.map((captain) => captain.id);
  const phones = captains.map((captain) => phoneWithCountry(captain.phone)).filter(Boolean);
  db.transaction(() => {
    db.prepare("DELETE FROM wallet_ledger").run();
    db.prepare("DELETE FROM topup_cards").run();
    db.prepare("DELETE FROM support_tickets").run();
    db.prepare("DELETE FROM notifications").run();
    db.prepare("DELETE FROM captain_invites").run();
    db.prepare("DELETE FROM customer_leads").run();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM orders").run();
    db.prepare("DELETE FROM audit_logs").run();
    db.prepare("UPDATE users SET wallet_cents=0,updated_at=? WHERE role='producer' AND is_bot=1").run(now());
    if (ids.length) db.prepare(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")}) AND role='captain'`).run(...ids);
  })();
  return { deletedCaptains: captains.length, deletedPhones: phones };
}

async function resetGroupInBackground({ operationId, oldGroupId, groupName, backupPath, backupName }) {
  try {
    const oldGroup = await readGroupSnapshot(oldGroupId);
    if (!oldGroup || !Array.isArray(oldGroup.participants) || oldGroup.participants.length < 1) {
      groupCreateState = { ...groupCreateState, status: "failed", finishedAt: now(), error: "Could not read members from the currently configured group" };
      return;
    }
    const botPhones = new Set([phoneWithCountry(BOT_PHONE), phoneWithCountry(BOT_PHONE_INTL), connectedBotPhone()]);
    const blockedPhones = new Set([...BLOCKED_PHONE_SET]);
    const rawPhones = [...new Set(oldGroup.participants.map(groupParticipantPhone).filter(Boolean))];
    const phones = rawPhones.filter((phone) => isValidJordanPhone(phone) && !botPhones.has(phone) && !blockedPhones.has(phone));
    if (!phones.length) {
      groupCreateState = { ...groupCreateState, status: "failed", finishedAt: now(), error: "No eligible members remain after owner and blocked-phone exclusions", oldMemberCount: rawPhones.length };
      return;
    }
    await db.backup(backupPath);
    const purge = purgeExperimentalCaptains();
    const stamp = now();
    db.prepare("UPDATE groups_config SET active=0,updated_at=? WHERE active=1").run(stamp);
    db.prepare("DELETE FROM settings WHERE key IN ('group_id','active_group_id')").run();
    groupCreateState = { status: "running", operationId, startedAt: groupCreateState.startedAt, finishedAt: null, error: null, groupId: null, participants: phones.map((phone) => ({ phone, status: "pending" })), reset: true, oldGroupId, oldMemberCount: rawPhones.length, eligibleMemberCount: phones.length, excludedOwnerCount: rawPhones.filter((phone) => botPhones.has(phone)).length, excludedBlockedCount: rawPhones.filter((phone) => blockedPhones.has(phone)).length, backupName, purge };
    await createGroupInBackground({ operationId, groupName, phones });
  } catch (error) {
    groupCreateState = { ...groupCreateState, status: "failed", finishedAt: now(), error: error.message, backupName };
    console.error("[GroupReset] failed:", error.message);
    groupCreateInFlight = false;
  }
}

app.post("/api/admin/group/reset-recreate", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupCreateInFlight) return res.status(409).json({ error: "A group operation is already in progress", operationId: groupCreateState.operationId });
  const oldGroupId = String(getSetting("group_id", "")).trim();
  if (!oldGroupId || !isConfiguredGroup(oldGroupId)) return res.status(409).json({ error: "No currently configured group found" });
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupName = "pre-group-reset-" + Date.now() + ".sqlite";
  const backupPath = path.join(backupDir, backupName);
  const groupName = String(req.body?.groupName || "شركة الجراح — شبكة التشغيل الرسمية").trim().slice(0, 100) || "شركة الجراح — شبكة التشغيل الرسمية";
  const operationId = "RESET-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  groupCreateInFlight = true;
  groupCreateState = { status: "reading_current_group", operationId, startedAt: now(), finishedAt: null, error: null, groupId: null, participants: [], reset: true, oldGroupId, backupName };
  void resetGroupInBackground({ operationId, oldGroupId, groupName, backupPath, backupName });
  res.status(202).json({ success: true, accepted: true, operationId, oldGroupId, backupName, messageSent: false });
});


app.post("/api/admin/group/finalize-created", requireAdmin, (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupCreateInFlight) return res.status(409).json({ error: "A group operation is already in progress", operationId: groupCreateState.operationId });
  const groupId = String(req.body?.groupId || groupCreateState.groupId || "").trim();
  if (!groupId || !groupId.endsWith("@g.us")) return res.status(400).json({ error: "A valid newly created group id is required" });
  if (groupCreateState.status !== "failed" || groupCreateState.groupId !== groupId) return res.status(409).json({ error: "No failed newly created group is available for recovery", status: groupCreateState.status, groupId: groupCreateState.groupId || null });
  const botPhones = new Set([phoneWithCountry(BOT_PHONE), phoneWithCountry(BOT_PHONE_INTL), connectedBotPhone()]);
  const blockedPhones = new Set([...BLOCKED_PHONE_SET]);
  const phones = [...new Set((groupCreateState.participants || []).map((participant) => phoneWithCountry(participant && participant.phone)).filter((phone) => isValidJordanPhone(phone) && !botPhones.has(phone) && !blockedPhones.has(phone)))];
  if (!phones.length) return res.status(409).json({ error: "No eligible members are available for recovery" });
  const operationId = "RECOVER-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  const groupName = String(req.body?.groupName || "شركة الجراح — شبكة التشغيل الرسمية").trim().slice(0, 100) || "شركة الجراح — شبكة التشغيل الرسمية";
  groupCreateInFlight = true;
  groupCreateState = { ...groupCreateState, status: "recovering", operationId, startedAt: now(), finishedAt: null, error: null, groupId, participants: phones.map((phone) => ({ phone, status: "pending" })), recoverable: true };
  void finalizeCreatedGroupInBackground({ operationId, groupId, groupName, phones });
  res.status(202).json({ success: true, accepted: true, operationId, groupId, eligibleMemberCount: phones.length, messageSent: false });
});

async function finalizeExistingGroupInBackground({ operationId, sourceGroupId, groupId, groupName }) {
  try {
    const sourceGroup = await readGroupSnapshot(sourceGroupId);
    if (!sourceGroup || !Array.isArray(sourceGroup.participants) || sourceGroup.participants.length < 1) throw new Error("Could not read members from the source group");
    const botPhones = new Set([phoneWithCountry(BOT_PHONE), phoneWithCountry(BOT_PHONE_INTL), connectedBotPhone()]);
    const blockedPhones = new Set([...BLOCKED_PHONE_SET]);
    const rawPhones = [...new Set(sourceGroup.participants.map(groupParticipantPhone).filter(Boolean))];
    const phones = rawPhones.filter((phone) => isValidJordanPhone(phone) && !botPhones.has(phone) && !blockedPhones.has(phone));
    if (!phones.length) throw new Error("No eligible members remain after owner and blocked-phone exclusions");
    groupCreateState = { ...groupCreateState, status: "recovering_existing_group", operationId, sourceGroupId, groupId, oldMemberCount: rawPhones.length, eligibleMemberCount: phones.length, excludedOwnerCount: rawPhones.filter((phone) => botPhones.has(phone)).length, excludedBlockedCount: rawPhones.filter((phone) => blockedPhones.has(phone)).length, participants: phones.map((phone) => ({ phone, status: "pending" })) };
    await finalizeCreatedGroupInBackground({ operationId, groupId, groupName, phones });
  } catch (error) {
    groupCreateState = { ...groupCreateState, status: "failed", operationId, finishedAt: now(), error: error.message, sourceGroupId, groupId, recoverable: true };
    groupCreateInFlight = false;
    console.error("[GroupCreate] existing-group recovery failed:", error.message);
  }
}

async function sendGroupMemberInvitesInBackground({ operationId, sourceGroupId, groupId, groupName }) {
  try {
    const sourceGroup = await readGroupSnapshot(sourceGroupId);
    if (!sourceGroup || !Array.isArray(sourceGroup.participants) || sourceGroup.participants.length < 1) throw new Error("Could not read members from the source group");
    const groupChat = await openCreatedGroupForAdmin(groupId);
    if (!groupChat || typeof groupChat.getInviteCode !== "function") throw new Error("The destination group is unavailable for invite-link generation");
    const inviteCode = await withTimeout(groupChat.getInviteCode(), 30000, null);
    if (!inviteCode) throw new Error("WhatsApp did not return a group invite link");
    const inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
    const destinationGroup = await readGroupSnapshot(groupId);
    const existingPhones = new Set((destinationGroup?.participants || []).map(groupParticipantPhone).filter(Boolean));
    const botPhones = new Set([phoneWithCountry(BOT_PHONE), phoneWithCountry(BOT_PHONE_INTL), connectedBotPhone()]);
    const blockedPhones = new Set([...BLOCKED_PHONE_SET]);
    const rawPhones = [...new Set(sourceGroup.participants.map(groupParticipantPhone).filter(Boolean))];
    const phones = rawPhones.filter((phone) => isValidJordanPhone(phone) && !botPhones.has(phone) && !blockedPhones.has(phone));
    const participantResults = phones.map((phone) => ({ phone, status: existingPhones.has(phone) ? "already_present" : "pending" }));
    groupInviteState = { status: "sending", operationId, startedAt: groupInviteState.startedAt, finishedAt: null, error: null, sourceGroupId, groupId, inviteUrl, oldMemberCount: rawPhones.length, eligibleMemberCount: phones.length, excludedOwnerCount: rawPhones.filter((phone) => botPhones.has(phone)).length, excludedBlockedCount: rawPhones.filter((phone) => blockedPhones.has(phone)).length, participants: participantResults };
    configureGroupId(groupId, groupName);
    const gateway = captainGatewayUrl(process.env.PUBLIC_BASE_URL || "");
    const title = "تم تسجيلك في شبكة التشغيل";
    const lines = [
      "تم تسجيل رقمك ضمن أعضاء شبكة الجراح التشغيلية.",
      "هذا ليس تسجيل كابتن جديدًا.",
      "افتح البوابة الرسمية واضغط: «دخول الكابتن».",
      `البوابة الرسمية: ${gateway}`,
      "بعد الدخول استخدم الرقم السري المرسل لك، ثم افتح رابط القروب للانضمام:",
      `رابط القروب: ${inviteUrl}`,
    ];
    const inviteCardMedia = await withTimeout(renderOperationsMessageMedia(title, lines), 30000, null);
    if (!inviteCardMedia) throw new Error("official invite card render returned no media");
    for (const result of participantResults) {
      if (result.status === "already_present") continue;
      const previous = db.prepare("SELECT id FROM notifications WHERE recipient_phone=? AND event='group.member.invite' AND delivery_status='sent' ORDER BY id DESC LIMIT 1").get(result.phone);
      if (previous) { result.status = "already_invited"; continue; }
      const notification = db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,created_at) VALUES(?,?,? ,?,?, 'pending',?)").run(result.phone, "captain", "group.member.invite", title, lines.join("\n"), now());
      try {
        const sent = await withTimeout(client.sendMessage(`${result.phone}@c.us`, inviteCardMedia, { caption: brandedMessage(title, lines) }), 30000, null);
        result.status = sent ? "invite_card_sent" : "failed";
        result.error = sent ? null : "official invite card was not sent";
        db.prepare("UPDATE notifications SET delivery_status=? WHERE id=?").run(sent ? "sent" : "failed", notification.lastInsertRowid);
      } catch (error) {
        result.status = "failed";
        result.error = error.message;
        db.prepare("UPDATE notifications SET delivery_status='failed' WHERE id=?").run(notification.lastInsertRowid);
      }
      if (!isReady) {
        result.error = result.error || "WhatsApp session disconnected";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const failedCount = participantResults.filter((participant) => participant.status === "failed").length;
    groupInviteState = { ...groupInviteState, status: failedCount ? "partial" : "succeeded", finishedAt: now(), error: failedCount ? `${failedCount} invite card(s) require retry` : null, participants: participantResults };
    audit("group.member_invites.sent", "group", groupId, { sourceGroupId, eligibleMemberCount: phones.length, inviteUrl });
  } catch (error) {
    groupInviteState = { ...groupInviteState, status: "failed", finishedAt: now(), error: error.message, sourceGroupId, groupId };
    console.error("[GroupInvite] failed:", error.message);
  } finally {
    groupInviteInFlight = false;
  }
}

app.get("/api/admin/group/invite-status", requireAdmin, (req, res) => {
  res.json({ success: true, ...groupInviteState, inviteUrl: groupInviteState.inviteUrl || null });
});

app.get("/api/admin/group/send-member-invites", requireAdmin, (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupInviteInFlight) return res.status(409).json({ error: "Group invite delivery is already in progress", operationId: groupInviteState.operationId });
  const sourceGroupId = String(req.query.sourceGroupId || "120363426604560611@g.us").trim();
  const groupId = String(req.query.groupId || getSetting("group_id", "120363413760988742@g.us")).trim();
  if (req.query.execute !== "1") return res.json({ success: true, ready: true, groupId, sourceGroupId, message: "Use execute=1 to send official invite cards." });
  if (!sourceGroupId.endsWith("@g.us") || !groupId.endsWith("@g.us") || sourceGroupId === groupId) return res.status(400).json({ error: "Source and destination group ids must be valid and different" });
  const groupName = String(req.query.groupName || "شركة الجراح — شبكة التشغيل الرسمية").trim().slice(0, 100) || "شركة الجراح — شبكة التشغيل الرسمية";
  const operationId = "INVITE-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  groupInviteInFlight = true;
  groupInviteState = { status: "queued", operationId, startedAt: now(), finishedAt: null, error: null, groupId, sourceGroupId, inviteUrl: null, participants: [] };
  void sendGroupMemberInvitesInBackground({ operationId, sourceGroupId, groupId, groupName });
  res.status(202).json({ success: true, accepted: true, operationId, sourceGroupId, groupId, messageSent: false });
});

app.post("/api/admin/group/finalize-existing", requireAdmin, (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupCreateInFlight) return res.status(409).json({ error: "A group operation is already in progress", operationId: groupCreateState.operationId });
  const sourceGroupId = String(req.body?.sourceGroupId || "120363426604560611@g.us").trim();
  const groupId = String(req.body?.groupId || "120363413760988742@g.us").trim();
  if (!sourceGroupId.endsWith("@g.us") || !groupId.endsWith("@g.us") || sourceGroupId === groupId) return res.status(400).json({ error: "Source and destination group ids must be valid and different" });
  const groupName = String(req.body?.groupName || "شركة الجراح — شبكة التشغيل الرسمية").trim().slice(0, 100) || "شركة الجراح — شبكة التشغيل الرسمية";
  const operationId = "RECOVER-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  groupCreateInFlight = true;
  groupCreateState = { status: "reading_source_group", operationId, startedAt: now(), finishedAt: null, error: null, groupId, sourceGroupId, participants: [], recovered: true };
  void finalizeExistingGroupInBackground({ operationId, sourceGroupId, groupId, groupName });
  res.status(202).json({ success: true, accepted: true, operationId, sourceGroupId, groupId, messageSent: false });
});

app.get("/api/admin/group/finalize-existing", requireAdmin, (req, res) => {
  if (String(req.query.execute || "") !== "1") return res.status(405).json({ error: "Use POST or provide the explicit execute=1 confirmation" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupCreateInFlight) return res.status(409).json({ error: "A group operation is already in progress", operationId: groupCreateState.operationId });
  const sourceGroupId = String(req.query.sourceGroupId || "120363426604560611@g.us").trim();
  const groupId = String(req.query.groupId || "120363413760988742@g.us").trim();
  if (!sourceGroupId.endsWith("@g.us") || !groupId.endsWith("@g.us") || sourceGroupId === groupId) return res.status(400).json({ error: "Source and destination group ids must be valid and different" });
  const groupName = String(req.query.groupName || "شركة الجراح — شبكة التشغيل الرسمية").trim().slice(0, 100) || "شركة الجراح — شبكة التشغيل الرسمية";
  const operationId = "RECOVER-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  groupCreateInFlight = true;
  groupCreateState = { status: "reading_source_group", operationId, startedAt: now(), finishedAt: null, error: null, groupId, sourceGroupId, participants: [], recovered: true };
  void finalizeExistingGroupInBackground({ operationId, sourceGroupId, groupId, groupName });
  res.redirect(303, "/?finalizeStarted=1");
});
app.post("/api/admin/group/create", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (groupCreateInFlight) return res.status(409).json({ error: "A group creation request is already in progress", operationId: groupCreateState.operationId });
  if (getSetting("group_id", null)) return res.status(409).json({ error: "A production group is already configured" });
  if (groupCreateState.status === "failed" && groupCreateState.groupId) return res.status(409).json({ error: "A group was created but participant addition did not finish; verify the group before retrying", groupId: groupCreateState.groupId, operationId: groupCreateState.operationId });
  const groupName = String(req.body.groupName || "الجراح للنقل والخدمات اللوجستية — الطلبات الرسمية").trim();
  const rawPhones = Array.isArray(req.body.phones) ? req.body.phones : [];
  const phones = [...new Set(rawPhones.map(phoneWithCountry).filter(Boolean))];
  if (!groupName || groupName.length > 100) return res.status(400).json({ error: "Invalid group name" });
  if (phones.length < 1 || phones.length > 4) return res.status(400).json({ error: "Provide between 1 and 4 participant phone numbers" });
  if (phones.some((phone) => !isValidJordanPhone(phone))) return res.status(400).json({ error: "Participant phones must be valid Jordan mobile numbers" });
  if (phones.some(isBlockedPhone)) return res.status(403).json({ error: "One or more phones are blocked by company policy" });
  if (phones.includes(phoneWithCountry(BOT_PHONE)) || phones.includes(phoneWithCountry(BOT_PHONE_INTL))) return res.status(400).json({ error: "The bot phone is the group creator and must not be listed as a participant" });
  const operationId = `GROUP-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  groupCreateInFlight = true;
  groupCreateState = { status: "running", operationId, startedAt: now(), finishedAt: null, error: null, groupId: null, participants: phones.map((phone) => ({ phone, status: "pending" })) };
  void createGroupInBackground({ operationId, groupName, phones });
  res.status(202).json({ success: true, accepted: true, operationId, groupName, participants: phones.map(displayPhone), messageSent: false });
});

app.get("/api/admin/group/create-status", requireAdmin, (req, res) => {
  res.json({ ...groupCreateState, inFlight: groupCreateInFlight, configuredGroupId: getSetting("group_id", null) });
});

app.get("/api/admin/captains", requireAdmin, (req, res) => {
  normalizeBotIdentity();
  const rows = db.prepare("SELECT id,phone,name,role,wallet_cents,active,is_bot,created_at,updated_at FROM users WHERE role='captain' ORDER BY active DESC, id DESC").all();
  res.json({ captains: rows.map((row) => ({ ...row, balance: money(row.wallet_cents) })) });
});
app.post("/api/admin/group/sync-captains", requireAdmin, async (req, res) => {
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const sendLinks = req.body?.sendLinks !== false;
  const results = await syncActiveCaptainsToConfiguredGroup({ sendLinks, baseUrl: captainInviteBaseUrl(req) });
  audit("captains.group_membership.bulk_sync", "group", groupId, { count: results.length, sendLinks });
  void notifyOperations({ event: "captains.group_membership.bulk_sync", title: "تأكيد مزامنة الكباتن", lines: [`عدد الحسابات التي تمت مزامنتها: ${results.length}`, `إرسال بطاقات الدخول: ${sendLinks ? "مفعّل" : "متوقف"}`, "تم تسجيل نتيجة المزامنة في النظام."], ownersOnly: true });
  res.json({ success: true, groupId, sendLinks, results });
});
app.post("/api/admin/group/register-members", requireAdmin, async (req, res) => {
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const sendLinks = req.body?.sendLinks !== false;
  const result = await registerGroupMembersAsCaptains({ groupId, sendLinks, baseUrl: captainInviteBaseUrl(req) });
  audit("group.members.registered_as_captains", "group", groupId, { totalMembers: result.totalMembers || 0, registered: (result.results || []).filter((item) => item.status === "registered").length, sendLinks });
  void notifyOperations({ event: "group.members.registered_as_captains", title: "تأكيد تسجيل أعضاء القروب", lines: [`إجمالي الأعضاء: ${result.totalMembers || 0}`, `الحسابات المسجلة: ${(result.results || []).filter((item) => item.status === "registered").length}`, `إرسال بطاقات الدخول: ${sendLinks ? "مفعّل" : "متوقف"}`], ownersOnly: true });
  res.json({ success: true, ...result, sendLinks });
});
app.post("/api/admin/captains", requireAdminOrDashboardApi, (req, res) => {
  const phone = phoneWithCountry(String(req.body.phone || ""));
  const name = String(req.body.name || "").trim();
  if (!/^\d{8,15}$/.test(phone) || !name || name.length > 100) return res.status(400).json({ error: "Captain name and a valid phone are required" });
  const existing = db.prepare("SELECT id,role FROM users WHERE phone=? LIMIT 1").get(phone);
  if (existing && existing.role !== "captain") return res.status(409).json({ error: "Phone is already assigned to another role" });
  const stamp = now();
  if (existing) {
    db.prepare("UPDATE users SET name=?,active=1,updated_at=? WHERE id=?").run(name, stamp, existing.id);
    audit("captain.reactivated", "user", existing.id, { phone, name });
    void addCaptainToConfiguredGroup({ phone, name });
    void sendCaptainAppLink({ phone, name }, captainInviteBaseUrl(req));
    return res.json({ success: true, id: existing.id, reactivated: true, accountLinkSent: true });
  }
  const result = db.prepare("INSERT INTO users(phone,name,role,wallet_cents,active,is_bot,created_at,updated_at) VALUES(?,?, 'captain',0,1,0,?,?)").run(phone, name, stamp, stamp);
  audit("captain.created", "user", result.lastInsertRowid, { phone, name });
  void addCaptainToConfiguredGroup({ phone, name });
  void sendCaptainAppLink({ phone, name }, captainInviteBaseUrl(req));
  res.status(201).json({ success: true, id: result.lastInsertRowid, accountLinkSent: true });
});
app.get("/api/admin/captains/:id/profile", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid captain id" });
  const captain = db.prepare("SELECT id,phone,name,role,wallet_cents,active,is_bot,created_at,updated_at FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const orders = db.prepare(`SELECT o.id,o.order_no,o.status,o.order_kind,o.raw_text,o.price_cents,o.origin,o.destination,o.trip_time,o.company_cents,o.producer_cents,o.captain_cents,o.created_at,o.updated_at,p.name AS producer_name
    FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id WHERE o.captain_user_id=? ORDER BY o.id DESC LIMIT 200`).all(id);
  const ledger = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 200").all(id).map((entry) => ({ ...entry, details: entry.details_json ? JSON.parse(entry.details_json) : null }));
  const totals = db.prepare(`SELECT COUNT(*) AS trips, COALESCE(SUM(captain_cents),0) AS earnings_cents, COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed, COALESCE(SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS accepted, COALESCE(SUM(CASE WHEN status='open' THEN 1 ELSE 0 END),0) AS open FROM orders WHERE captain_user_id=?`).get(id);
  res.json({ captain: { ...captain, balance: money(captain.wallet_cents) }, summary: { trips: totals.trips, completed: totals.completed, accepted: totals.accepted, open: totals.open, earnings: money(totals.earnings_cents) }, orders: orders.map((order) => ({ ...order, price: money(order.price_cents), company: money(order.company_cents), producer: money(order.producer_cents), earnings: money(order.captain_cents), orderType: order.order_kind === "order" ? "أوردر محدد" : "طلب عادي" })), ledger });
});
app.patch("/api/admin/captains/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const captain = db.prepare("SELECT id,phone,name,active FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const name = req.body.name === undefined ? captain.name : String(req.body.name).trim();
  const active = req.body.active === undefined ? captain.active : (req.body.active ? 1 : 0);
  if (!name || name.length > 100) return res.status(400).json({ error: "Captain name is invalid" });
  db.prepare("UPDATE users SET name=?,active=?,updated_at=? WHERE id=? AND role='captain'").run(name, active, now(), id);
  audit(active ? "captain.activated" : "captain.deactivated", "user", id, { phone: captain.phone, name });
  void notifyOperations({ event: active ? "captain.activated" : "captain.deactivated", title: active ? "تأكيد تفعيل حساب الكابتن" : "تأكيد إيقاف حساب الكابتن", captainPhone: captain.phone, lines: [`الكابتن: ${name}`, `الحالة: ${active ? "نشط" : "موقوف"}`, active ? "يمكن للكابتن استخدام بوابة التشغيل." : "تم إيقاف الدخول والحركات المالية للحساب." ] });
  res.json({ success: true, id, active, name });
});
app.delete("/api/admin/captains/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid captain id" });
  const captain = db.prepare("SELECT id,phone,name,wallet_cents FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const trips = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE captain_user_id=?").get(id).count;
  const ledger = db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=?").get(id).count;
  const cards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE redeemed_by=?").get(id).count;
  if (captain.wallet_cents !== 0 || trips || ledger || cards) return res.status(409).json({ error: "لا يمكن حذف كابتن لديه رحلات أو حركات مالية أو رصيد غير مُسوّى. استخدم الإيقاف عن العمل بدلًا من الحذف.", reasons: { balance: money(captain.wallet_cents), trips, ledger, redeemedCards: cards } });
  db.transaction(() => { db.prepare("DELETE FROM captain_invites WHERE approved_user_id=?").run(id); db.prepare("DELETE FROM users WHERE id=? AND role='captain'").run(id); })();
  audit("captain.deleted", "user", id, { phone: captain.phone, name: captain.name });
  res.json({ success: true, deleted: id });
});
app.post("/api/admin/captains/resend-access-card", requireAdmin, async (req, res) => {
  const phone = phoneWithCountry(String(req.body?.phone || "").replace(/[^0-9]/g, ""));
  const deletePreviousPlain = req.body?.deletePreviousPlain === true;
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم كابتن أردني صحيح مطلوب" });
  const captain = db.prepare("SELECT id,phone,name,active,captain_pin_hash FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
  if (!captain) return res.status(404).json({ error: "الكابتن غير مسجل في النظام" });
  if (!captain.active) return res.status(409).json({ error: "حساب الكابتن غير نشط" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  const chatId = `${phone}@c.us`;
  let deletedPreviousPlain = false;
  let deletedMessageId = null;
  if (deletePreviousPlain) {
    try {
      const chat = await withTimeout(client.getChatById(chatId), 15000, null);
      const messages = chat && typeof chat.fetchMessages === "function" ? await withTimeout(chat.fetchMessages({ limit: 30 }), 20000, []) : [];
      const previous = [...messages].reverse().find((message) => {
        const body = String(message?.body || "");
        return message?.fromMe && !message?.hasMedia && /(تمت الموافقة على طلبك|بوابة التشغيل الرسمية|تم تسجيل حسابك داخل شبكة الجراح)/.test(body);
      });
      if (previous && typeof previous.delete === "function") {
        const removed = await withTimeout(previous.delete(true), 20000, null);
        deletedPreviousPlain = removed !== null;
        deletedMessageId = previous.id?._serialized || null;
      }
    } catch (error) {
      console.error("[WhatsApp] previous plain captain reply cleanup:", error.message);
    }
  }
  const sent = await sendCaptainAppLink(captain, captainInviteBaseUrl(req));
  if (!sent) return res.status(502).json({ error: "تعذر إرسال بطاقة الدخول الرسمية" });
  audit("captain.access_card.resent", "user", captain.id, { phone, deletedPreviousPlain, deletedMessageId });
  res.json({ success: true, captain: { id: captain.id, name: captain.name, phone: captain.phone }, deletedPreviousPlain, cardSent: true });
});
app.post("/api/admin/captains/:id/wallet-adjustment", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const captain = db.prepare("SELECT id,phone,name,wallet_cents,active FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const direction = String(req.body.direction || "").toLowerCase();
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || "").trim();
  const idempotencyKey = String(req.body.idempotencyKey || "").trim();
  if (!["credit", "debit"].includes(direction) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !reason || reason.length > 240 || !idempotencyKey || idempotencyKey.length > 100) {
    return res.status(400).json({ error: "Direction, positive amount, reason, and unique idempotencyKey are required" });
  }
  const amountCents = Math.round(amount * 100);
  if (amountCents < 1) return res.status(400).json({ error: "Amount is too small" });
  const signedAmount = direction === "credit" ? amountCents : -amountCents;
  const existing = db.prepare("SELECT id,amount_cents,balance_after_cents,reference FROM wallet_ledger WHERE user_id=? AND type IN ('admin_credit','admin_debit') AND details_json LIKE ? LIMIT 1").get(id, `%\\"idempotencyKey\\":\\"${idempotencyKey.replace(/[\\%_]/g, "\\$&")}\\"%`);
  if (existing) return res.status(409).json({ error: "This adjustment was already recorded", ledgerId: existing.id, reference: existing.reference });
  const nextBalance = captain.wallet_cents + signedAmount;
  if (direction === "debit" && nextBalance < CAPTAIN_MIN_BALANCE_CENTS) return res.status(409).json({ error: `Debit exceeds the captain debt limit (${money(CAPTAIN_MIN_BALANCE_CENTS)})` });
  const reference = `ADMIN-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const details = { idempotencyKey, direction, amount, amountCents, reason, actor: "admin" };
  const stamp = now();
  const apply = db.transaction(() => {
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain'").run(nextBalance, stamp, id);
    const result = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(id, direction === "credit" ? "admin_credit" : "admin_debit", signedAmount, nextBalance, reference, reason, stamp, JSON.stringify(details));
    audit(direction === "credit" ? "captain.wallet.credited" : "captain.wallet.debited", "user", id, { phone: captain.phone, amountCents, reason, reference, balanceAfterCents: nextBalance });
    return result.lastInsertRowid;
  });
  const ledgerId = apply();
  void notifyOperations({ event: direction === "credit" ? "captain.wallet.credited" : "captain.wallet.debited", title: "تأكيد حركة محفظة", captainPhone: captain.phone, lines: [`الكابتن: ${captain.name}`, `${direction === "credit" ? "تمت إضافة" : "تم خصم"}: ${money(amountCents)} JOD`, `الرصيد الحالي: ${money(nextBalance)} JOD`, `السبب: ${reason}`, "تم تسجيل الحركة في دفتر الشركة." ] });
  res.status(201).json({ success: true, ledgerId, reference, balance: money(nextBalance), balanceCents: nextBalance });
});
app.get("/api/admin/wallet/:phone", requireBotWalletOwner, (req, res) => {
  const phone = phoneWithCountry(req.params.phone || "");
  const user = db.prepare("SELECT id,phone,name,role,wallet_cents,active,is_bot,created_at,updated_at FROM users WHERE phone=? LIMIT 1").get(phone);
  if (!user) return res.status(404).json({ error: "Subscriber wallet not found" });
  const entries = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json FROM wallet_ledger WHERE user_id=? ORDER BY id DESC").all(user.id).map((entry) => ({ ...entry, details: entry.details_json ? JSON.parse(entry.details_json) : null }));
  res.json({ user, wallet: { currency: "JOD", balance: money(user.wallet_cents), balanceCents: user.wallet_cents, entries } });
});

app.post("/api/admin/group", requireAdmin, (req, res) => {
  const groupId = String(req.body.groupId || "").trim();
  const groupName = String(req.body.groupName || "قروب الجراح").trim();
  if (!groupId || !groupId.endsWith("@g.us")) return res.status(400).json({ error: "groupId must end with @g.us" });
  configureGroupId(groupId, groupName);
  void notifyOperations({ event: "group.configured", title: "تأكيد إعداد القروب", lines: [`اسم القروب: ${groupName}`, `المعرف: ${groupId}`, "تم حفظ القروب كقروب التشغيل النشط.", "سيتم تسجيل الرسائل والطلبات الجديدة منه."], ownersOnly: true });
  res.json({ success: true, groupId, groupName });
});

app.get("/api/admin/group/use-original", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = "120363426604560611@g.us";
  const groupName = "🔥 وصلني الآن 🔥 🔥Waslni Now🔥";
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup || !Array.isArray(chat.participants) || chat.participants.length < 1) return res.status(502).json({ error: "The original active WhatsApp group could not be verified" });
  const stamp = now();
  db.prepare("UPDATE groups_config SET active=0,updated_at=? WHERE group_id<>?").run(stamp, groupId);
  configureGroupId(groupId, groupName);
  groupCreateState = { status: "idle", operationId: null, startedAt: null, finishedAt: now(), error: null, groupId, participants: [] };
  groupInviteState = { status: "idle", operationId: null, startedAt: null, finishedAt: now(), error: null, groupId, inviteUrl: null, participants: [] };
  res.json({ success: true, groupId, groupName, membersLoaded: chat.participants.length, newGroupUnused: true });
});

app.post("/api/admin/group/leave-unconfigured", requireAdmin, async (req, res) => {
  const groupId = String(req.body?.groupId || "").trim();
  const originalGroupId = "120363426604560611@g.us";
  if (!groupId || !groupId.endsWith("@g.us")) return res.status(400).json({ error: "groupId must end with @g.us" });
  if (groupId === originalGroupId || groupId === getSetting("group_id", null) || isConfiguredGroup(groupId)) return res.status(409).json({ error: "The configured production group is protected" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const chat = await withTimeout(client.getChatById(groupId), 15000, null) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup || typeof chat.leave !== "function") return res.status(404).json({ error: "Unconfigured group could not be verified" });
  const groupName = String(chat.name || chat.formattedTitle || "");
  const left = await withTimeout(chat.leave(), 60000, false);
  audit("group.unconfigured.left", "group", groupId, { groupName, left: Boolean(left), originalGroupId });
  res.json({ success: true, groupId, groupName, left: Boolean(left), deleted: false, originalGroupUntouched: true });
});
app.get("/api/admin/group/leave-unconfigured", requireAdmin, async (req, res) => {
  const groupId = String(req.query.groupId || "").trim();
  const originalGroupId = "120363426604560611@g.us";
  if (!groupId || !groupId.endsWith("@g.us")) return res.status(400).json({ error: "groupId must end with @g.us" });
  if (groupId === originalGroupId || groupId === getSetting("group_id", null) || isConfiguredGroup(groupId)) return res.status(409).json({ error: "The configured production group is protected" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const chat = await withTimeout(client.getChatById(groupId), 15000, null) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup || typeof chat.leave !== "function") return res.status(404).json({ error: "Unconfigured group could not be verified" });
  const groupName = String(chat.name || chat.formattedTitle || "");
  const left = await withTimeout(chat.leave(), 60000, false);
  audit("group.unconfigured.left", "group", groupId, { groupName, left: Boolean(left), originalGroupId });
  res.json({ success: true, groupId, groupName, left: Boolean(left), deleted: false, originalGroupUntouched: true });
});

app.get("/api/admin/group/delete-unapproved", requireAdmin, async (req, res) => {
  const groupId = String(req.query.groupId || "").trim();
  const newGroupId = "120363413760988742@g.us";
  const originalGroupId = "120363426604560611@g.us";
  const expectedName = "شركة الجراح — شبكة التشغيل الرسمية";
  if (groupId !== newGroupId) return res.status(400).json({ error: "Only the explicitly approved unapproved group can be deleted" });
  if (groupId === originalGroupId || groupId === getSetting("group_id", null)) return res.status(409).json({ error: "The active original group is protected" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup || chat.name !== expectedName) return res.status(404).json({ error: "The explicitly targeted unapproved group was not verified" });
  const participantCount = Array.isArray(chat.participants) ? chat.participants.length : 0;
  await withTimeout(chat.leave(), 60000, null);
  const deleted = await withTimeout(chat.delete(), 60000, false);
  db.prepare("UPDATE groups_config SET active=0,updated_at=? WHERE group_id=?").run(now(), groupId);
  audit("group.unapproved.deleted", "group", groupId, { participantCount, botLeft: true, chatDeleted: Boolean(deleted), originalGroupId });
  res.json({ success: true, groupId, groupName: expectedName, participantCount, botLeft: true, chatDeleted: Boolean(deleted), originalGroupUntouched: true, note: "The bot left and deleted its chat; WhatsApp may retain the group for remaining members." });
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
    const inviteInfo = await withTimeout(client.getInviteInfo(inviteCode), 20000, null);
    let groupId = inviteInfo && inviteInfo.id && (inviteInfo.id._serialized || String(inviteInfo.id));
    const existingChat = groupId && groupId.endsWith("@g.us") ? await withTimeout(client.getChatById(groupId), 20000, null) : null;
    if (!existingChat || !existingChat.isGroup) groupId = await withTimeout(client.acceptInvite(inviteCode), 60000, null);
    if (!groupId) return res.status(504).json({ error: "WhatsApp invite acceptance timed out; group was not configured" });
    const groupChat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
    if (!groupChat) return res.status(502).json({ error: "Group invite was accepted, but WhatsApp has not loaded the group members yet" });
    configureGroupId(groupId, groupName);
    audit("group.joined_and_configured", "group", groupId, { groupName });
    void notifyOperations({ event: "group.joined_and_configured", title: "تأكيد ربط قروب التشغيل", lines: [`اسم القروب: ${groupName}`, `المعرف: ${groupId}`, "تم الانضمام إلى القروب وحفظه كقروب التشغيل النشط."], ownersOnly: true });
    res.json({ success: true, groupId, groupName, membersLoaded: groupChat.participants.length, participantSource: groupChat.participantSource || null });
  } catch (error) {
    res.status(502).json({ error: "Unable to join group", details: error.message });
  } finally {
    groupJoinInFlight = false;
  }
});
app.get("/api/admin/group/diagnostic", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const inviteCode = extractInviteCode(req.query.inviteLink || req.query.inviteCode || "");
  const configuredId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const inviteInfo = inviteCode ? await withTimeout(client.getInviteInfo(inviteCode), 20000, null) : null;
  const chat = configuredId ? await readGroupSnapshot(configuredId) || await resolveGroupChat(configuredId) : null;
  res.json({
    configuredId: configuredId || null,
    configuredChat: chat ? { isGroup: Boolean(chat.isGroup), name: chat.name || null, participants: Array.isArray(chat.participants) ? chat.participants.length : null, participantSource: chat.participantSource || null, participantRawCount: chat.participantRawCount ?? null } : null,
    invite: inviteInfo ? { id: inviteInfo.id && (inviteInfo.id._serialized || String(inviteInfo.id)) || null, subject: inviteInfo.subject || null, size: inviteInfo.size || null } : null,
  });
});
app.post("/api/admin/group/adopt-last-seen", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(lastGroupEventGroupId || "").trim();
  const expectedGroupId = String(req.body?.groupId || groupId).trim();
  if (!groupId || !groupId.endsWith("@g.us") || !lastGroupMessageTelemetry?.at) return res.status(409).json({ error: "No recent group event is available" });
  if (expectedGroupId !== groupId) return res.status(409).json({ error: "The observed group changed; refresh diagnostics before adopting it" });
  const observedAt = Date.parse(lastGroupMessageTelemetry.at);
  if (!Number.isFinite(observedAt) || Date.now() - observedAt > 15 * 60 * 1000) return res.status(409).json({ error: "The last group event is too old; send a new message and retry" });
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup) return res.status(502).json({ error: "The observed chat could not be verified as a WhatsApp group" });
  const groupName = String(chat.name || "قروب الجراح").trim().slice(0, 160) || "قروب الجراح";
  const previousGroupId = getSetting("group_id", null);
  configureGroupId(groupId, groupName);
  audit("group.adopted_from_live_event", "group", groupId, { previousGroupId, eventAt: lastGroupMessageTelemetry.at });
  void notifyOperations({ event: "group.adopted_from_live_event", title: "تم إصلاح استقبال رسائل القروب", lines: [`اسم القروب: ${groupName}`, `المعرف: ${groupId}`, "تم اعتماد القروب الذي وصلت منه الرسائل الفعلية.", "سيتم تسجيل الرسائل والطلبات الجديدة منه."], ownersOnly: true });
  res.json({ success: true, groupId, groupName, previousGroupId, membersLoaded: Array.isArray(chat.participants) ? chat.participants.length : null });
});
app.get("/api/admin/groups", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const chats = await withTimeout(client.getChats(), 25000, null);
  if (!Array.isArray(chats)) return res.status(502).json({ error: "Unable to read WhatsApp chats; the bot remains online" });
  res.json({ groups: chats.filter((chat) => chat.isGroup).map((chat) => ({ id: chat.id._serialized, name: chat.name, participants: chat.participants ? chat.participants.length : 0 })) });
});
app.get("/api/admin/group/members", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  if (!groupId || !groupId.endsWith("@g.us")) return res.status(409).json({ error: "No configured group" });
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup) return res.status(404).json({ error: "Configured chat is not a group" });
  const members = [];
  for (const participant of (chat.participants || [])) {
    const serialized = participant && participant.id && (participant.id._serialized || String(participant.id));
    const phone = participant && (participant.user || (participant.id && participant.id.user)) ? String(participant.user || participant.id.user) : "";
    if (!phone || phone === BOT_PHONE_INTL) continue;
    let contact = null;
    try { contact = await withTimeout(client.getContactById(serialized), 10000, null); } catch (_) {}
    members.push({ phone, name: String((contact && (contact.name || contact.pushname)) || phone).trim(), id: serialized || null, isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin) });
  }
  res.json({ success: true, groupId, groupName: chat.name || null, members, participantSource: chat.participantSource || null, participantRawCount: chat.participantRawCount ?? null });
});
app.get("/api/admin/group/live-messages", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const requestedLimit = Number(req.query.limit || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  await readGroupSnapshot(groupId);
  const { chat, messages } = await fetchGroupHistory(groupId, limit);
  if (!chat) return res.status(404).json({ error: "Configured chat is not readable through WhatsApp" });
  const rows = (Array.isArray(messages) ? messages : []).map((message) => {
    const body = String(message?.body || "").trim();
    return {
      id: message?.id?._serialized || null,
      timestamp: message?.timestamp || null,
      from: message?.from || null,
      to: message?.to || null,
      fromMe: Boolean(message?.fromMe),
      author: message?.author || null,
      body,
      type: message?.type || null,
      hasMedia: Boolean(message?.hasMedia),
      hasQuotedMessage: Boolean(message?.hasQuotedMsg),
      parsedOrder: parseOrder(body),
      captainAcceptance: isCaptainAcceptance(body),
    };
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, groupId, count: rows.length, messages: rows });
});
app.post("/api/admin/group/import-order-history", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const requestedLimit = Number(req.body?.limit || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "No configured production group" });
  const { chat, messages } = await fetchGroupHistory(groupId, limit);
  if (!chat) return res.status(504).json({ error: "Unable to read configured group" });
  const candidates = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && !message.fromMe && String(message.from || "") === groupId && parseOrder(message.body).isOrder)
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const imported = [];
  const skipped = [];
  for (const message of candidates) {
    const messageId = message.id && message.id._serialized;
    if (!messageId) { skipped.push({ reason: "missing_message_id" }); continue; }
    const existing = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(messageId);
    if (existing) { skipped.push({ messageId, reason: "already_registered", orderNo: existing.order_no }); continue; }
    const parsed = parseOrder(message.body);
    const senderPhone = phoneWithCountry(message.author || message.from || "");
    const producer = senderPhone ? findActiveRegisteredUser(senderPhone) : null;
    const order = producer ? createOrderRecord({ messageId, groupId, body: String(message.body || ""), producer, parsed }) : null;
    if (order) {
      imported.push({ messageId, orderNo: order.order_no, status: order.status, historical: true, needsCaptainLink: true });
      audit("order.imported_from_group_history", "order", order.id, { groupId, sourceMessageId: messageId, historical: true, needsCaptainLink: true });
    } else skipped.push({ messageId, reason: "not_created" });
  }
  res.status(201).json({ success: true, groupId, scanned: messages.length, candidates: candidates.length, imported, skipped });
});
app.post("/api/admin/group/recover-latest-order", requireAdmin, async (req, res) => {
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 5)) return res.status(429).json({ error: "Too many recovery attempts; try again later" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "No configured production group" });
  const { chat, messages } = await fetchGroupHistory(groupId, 100);
  if (!chat) return res.status(504).json({ error: "Unable to read configured group" });
  const candidate = latestEligibleGroupOrderMessage(messages, groupId);
  if (!candidate || !candidate.id || !candidate.id._serialized) return res.status(404).json({ error: "No eligible order message found in recent group messages" });
  const existing = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(candidate.id._serialized);
  if (existing) return res.json({ success: true, recovered: false, alreadyRegistered: true, orderNo: existing.order_no, status: existing.status });
  await handleIncomingMessage(candidate, { allowSelf: true });
  const order = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(candidate.id._serialized);
  if (!order) return res.status(502).json({ error: "Eligible message was not recorded as an order" });
  audit("order.recovered_from_group_history", "order", order.id, { groupId, sourceMessageId: candidate.id._serialized });
  res.status(201).json({ success: true, recovered: true, orderNo: order.order_no, status: order.status });
});
app.get("/api/admin/cards", requireAdmin, (req, res) => {
  const requestedLimit = Number(req.query.limit || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 50;
  const cards = db.prepare("SELECT c.id,c.code_last4,c.value_cents,c.status,c.assigned_captain_id,c.sent_at,c.redeemed_at,c.created_at,u.name AS captain_name,u.phone AS captain_phone FROM topup_cards c LEFT JOIN users u ON u.id=c.assigned_captain_id ORDER BY c.id DESC LIMIT ?").all(limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, cards: cards.map((card) => ({ ...card, value: money(card.value_cents), deliveryStatus: card.sent_at ? "sent" : "pending" })) });
});
app.post("/api/admin/cards", requireAdmin, (req, res) => {
  if (!cardEncryptionKey) return res.status(503).json({ error: "تشفير بطاقات الشحن غير مهيأ" });
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 30)) return res.status(429).json({ error: "محاولات إصدار كثيرة؛ حاول لاحقًا" });
  const value = Number(req.body?.value);
  const amountCents = cents(value);
  const phone = phoneWithCountry(String(req.body?.phone || "").replace(/[^0-9]/g, ""));
  const issueIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isFinite(value) || amountCents <= 0 || value > 1000 || issueIdempotencyKey.length < 16 || issueIdempotencyKey.length > 100) return res.status(400).json({ error: "قيمة صحيحة ومفتاح idempotency مطلوبان" });
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم المستفيد الأردني مطلوب" });
  const captain = db.prepare("SELECT id,name,phone,active FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
  if (!captain) return res.status(404).json({ error: "يجب اعتماد الكابتن أولًا قبل إصدار بطاقة الرصيد" });
  if (!captain.active) return res.status(409).json({ error: "حساب الكابتن غير نشط" });
  const existing = db.prepare("SELECT id,value_cents,status,assigned_captain_id,code_ciphertext FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueIdempotencyKey);
  if (existing) {
    if (Number(existing.assigned_captain_id) !== captain.id || Number(existing.value_cents) !== amountCents) return res.status(409).json({ error: "مفتاح العملية مستخدم لبطاقة مختلفة" });
    if (existing.status !== "issued") return res.status(409).json({ error: `البطاقة حالتها ${existing.status} ولا يمكن إعادة إصدارها` });
    return res.json({ id: existing.id, code: decryptCardCode(existing.code_ciphertext), value: money(existing.value_cents), phone, captainName: captain.name, status: existing.status, reused: true });
  }
  let code = randomCode();
  while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
  const encryptedCode = encryptCardCode(code);
  const result = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,?,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), amountCents, captain.id, issueIdempotencyKey, encryptedCode, now());
  audit("topup_card.issued", "topup_card", result.lastInsertRowid, { valueCents: amountCents, captainId: captain.id, issueIdempotencyKey });
  res.status(201).json({ id: result.lastInsertRowid, code, value: money(amountCents), phone, captainName: captain.name, status: "issued", reused: false });
});
app.post("/api/admin/cards/:id/send", requireAdmin, async (req, res) => {
  const cardId = Number(req.params.id);
  const deliveryIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isInteger(cardId) || cardId < 1 || deliveryIdempotencyKey.length < 16 || deliveryIdempotencyKey.length > 100) return res.status(400).json({ error: "معرف البطاقة ومفتاح idempotency مطلوبان" });
  const card = db.prepare("SELECT c.*,u.phone AS captain_phone,u.name AS captain_name,u.active AS captain_active FROM topup_cards c LEFT JOIN users u ON u.id=c.assigned_captain_id WHERE c.id=? LIMIT 1").get(cardId);
  if (!card) return res.status(404).json({ error: "البطاقة غير موجودة" });
  if (card.delivery_idempotency_key && card.delivery_idempotency_key !== deliveryIdempotencyKey) return res.status(409).json({ error: "إرسال البطاقة مسجل بمفتاح مختلف" });
  if (card.sent_at) return res.json({ success: true, alreadySent: true, status: "sent" });
  if (!card.captain_phone || !card.captain_active) return res.status(409).json({ error: "المستفيد غير نشط أو غير معتمد" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا؛ البطاقة محفوظة ولم تُرسل" });
  if (!cardEncryptionKey || !card.code_ciphertext) return res.status(503).json({ error: "تشفير البطاقة غير مهيأ" });
  if (cardDeliveryInFlight.has(cardId)) return res.status(409).json({ error: "إرسال البطاقة قيد التنفيذ" });
  cardDeliveryInFlight.add(cardId);
  try {
    const code = decryptCardCode(card.code_ciphertext);
    const appUrl = captainAppUrl(captainInviteBaseUrl(req));
    const caption = brandedMessage("بطاقة شحن رسمية", [`الكابتن: ${card.captain_name || "حسابك"}`, `القيمة: ${money(card.value_cents)} JOD`, "هذه البطاقة مخصصة لرقمك وتُستخدم مرة واحدة فقط.", `الدخول: ${appUrl}`, "افتح البوابة، اضغط زر التشغيل، اختر دخول الكابتن، ثم أدخل رمز البطاقة واضغط Enter لإضافة الرصيد مباشرة."]);
    const media = await renderTopupCardMedia({ cardId, code, valueCents: card.value_cents, captainName: card.captain_name, appUrl });
    const sent = await withTimeout(client.sendMessage(`${phoneWithCountry(card.captain_phone)}@c.us`, media, { caption }), 30000, null);
    if (!sent) return res.status(504).json({ error: "انتهت مهلة إرسال البطاقة" });
    const update = db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), deliveryIdempotencyKey, cardId);
    if (!update.changes) return res.json({ success: true, alreadySent: true, status: "sent" });
    audit("topup_card.sent", "topup_card", cardId, { captainId: card.assigned_captain_id, messageId: sent.id?._serialized || null, deliveryIdempotencyKey });
    void notifyOperations({ event: "topup_card.sent", title: "تأكيد إرسال بطاقة شحن", lines: [`الكابتن: ${card.captain_name}`, `القيمة: ${money(card.value_cents)} JOD`, `رقم البطاقة الداخلي: #${cardId}`, "تم إرسال البطاقة المصوّرة إلى الكابتن.", "يُضاف الرصيد عند إدخال الرمز من بوابة التشغيل."], ownersOnly: true });
    res.json({ success: true, status: "sent" });
  } catch (error) { audit("topup_card.delivery_failed", "topup_card", cardId, { deliveryIdempotencyKey, error: String(error?.message || error) }); res.status(502).json({ error: "تعذر إرسال بطاقة الرصيد عبر WhatsApp" }); }
  finally { cardDeliveryInFlight.delete(cardId); }
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
    const assignedUser = card.assigned_captain_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='captain' LIMIT 1").get(card.assigned_captain_id) : null;
    if (card.assigned_captain_id && (!assignedUser || phoneWithCountry(assignedUser.phone) !== phone)) throw new Error("This card is assigned to another captain");
    const user = assignedUser || upsertUser({ phone, name: phone, role: "captain", allowSuspended: true });
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
app.post("/api/captain/redeem-card", requireCaptain, (req, res) => {
  if (!consumeRateLimit(redeemRate, clientAddress(req), 12)) return res.status(429).json({ error: "محاولات كثيرة؛ حاول بعد قليل" });
  const code = String(req.body?.code || "").trim().toUpperCase();
  const redemptionIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!/^[A-Z0-9-]{8,80}$/.test(code) || redemptionIdempotencyKey.length < 16 || redemptionIdempotencyKey.length > 100) return res.status(400).json({ error: "أدخل رمز بطاقة صحيحًا" });
  try {
    const result = db.transaction(() => {
      const existingKey = db.prepare("SELECT id,value_cents,redeemed_by FROM topup_cards WHERE redemption_idempotency_key=? LIMIT 1").get(redemptionIdempotencyKey);
      if (existingKey) {
        if (Number(existingKey.redeemed_by) !== Number(req.captainSession.userId)) throw new Error("مفتاح العملية مرتبط بحساب آخر");
        const user = db.prepare("SELECT wallet_cents FROM users WHERE id=? AND role='captain' LIMIT 1").get(req.captainSession.userId);
        return { balanceCents: Number(user?.wallet_cents || 0), valueCents: existingKey.value_cents, alreadyRedeemed: true };
      }
      const card = db.prepare("SELECT * FROM topup_cards WHERE code_hash=? LIMIT 1").get(hashCode(code));
      if (!card) throw new Error("رمز البطاقة غير صحيح");
      if (card.status !== "issued") throw new Error("تم استخدام هذه البطاقة أو إلغاؤها مسبقًا");
      if (card.assigned_captain_id && Number(card.assigned_captain_id) !== Number(req.captainSession.userId)) throw new Error("هذه البطاقة مخصصة لكابتن آخر");
      const user = db.prepare("SELECT id,wallet_cents,active FROM users WHERE id=? AND role='captain' LIMIT 1").get(req.captainSession.userId);
      if (!user || !user.active) throw new Error("حساب الكابتن غير نشط");
      const newBalance = Number(user.wallet_cents || 0) + Number(card.value_cents || 0);
      const stamp = now();
      const update = db.prepare("UPDATE topup_cards SET status='redeemed',redeemed_by=?,redeemed_at=?,redemption_idempotency_key=? WHERE id=? AND status='issued'").run(user.id, stamp, redemptionIdempotencyKey, card.id);
      if (!update.changes) throw new Error("تم استخدام هذه البطاقة أو إلغاؤها مسبقًا");
      db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(newBalance, stamp, user.id);
      db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at) VALUES(?,?,?,?,?,?,?)").run(user.id, "topup", card.value_cents, newBalance, `CARD-${card.id}`, "شحن بطاقة من بوابة التشغيل", stamp);
      audit("topup_card.redeemed", "topup_card", card.id, { userId: user.id, valueCents: card.value_cents, source: "captain_portal" }, user.id);
      return { balanceCents: newBalance, valueCents: card.value_cents, alreadyRedeemed: false };
    })();
    if (!result.alreadyRedeemed) {
      const captain = db.prepare("SELECT name,phone FROM users WHERE id=? AND role='captain' LIMIT 1").get(req.captainSession.userId);
      void notifyOperations({ event: "topup_card.redeemed", title: "تأكيد إضافة الرصيد", captainPhone: captain?.phone, lines: [`الكابتن: ${captain?.name || "حساب الكابتن"}`, `القيمة المضافة: ${money(result.valueCents)} JOD`, `الرصيد الحالي: ${money(result.balanceCents)} JOD`, "تم تسجيل العملية في دفتر الشركة وإضافة الرصيد مباشرة." ] });
    }
    res.json({ success: true, credited: money(result.valueCents), balance: money(result.balanceCents), currency: "JOD", alreadyRedeemed: result.alreadyRedeemed });
  } catch (error) { res.status(400).json({ error: error.message || "تعذر استرداد البطاقة" }); }
});
app.post("/api/captain/topup-request", requireCaptain, (req, res) => {
  const captain = db.prepare("SELECT id,name,phone,active FROM users WHERE id=? AND role='captain' LIMIT 1").get(req.captainSession.userId);
  if (!captain || !captain.active) return res.status(403).json({ error: "Captain account is inactive" });
  const requestedValue = Number(req.body?.requestedValue);
  const message = String(req.body?.message || "أطلب شحن رصيد للمحفظة").trim().slice(0, 500);
  if (!Number.isFinite(requestedValue) || requestedValue <= 0 || requestedValue > 1000) return res.status(400).json({ error: "أدخل قيمة شحن صحيحة بين 1 و1000" });
  const open = db.prepare("SELECT ticket_code FROM support_tickets WHERE account_ref=? AND category='topup_card' AND status IN ('new','in_progress') ORDER BY id DESC LIMIT 1").get(phoneWithCountry(captain.phone));
  if (open) return res.status(409).json({ error: `لديك طلب شحن مفتوح بالفعل: ${open.ticket_code}` });
  const ticketCode = createTicketCode();
  const stamp = now();
  db.prepare("INSERT INTO support_tickets(ticket_code,requester_name,account_ref,category,message,requested_value_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'new',?,?)").run(ticketCode, captain.name, phoneWithCountry(captain.phone), "topup_card", message, cents(requestedValue), stamp, stamp);
  audit("captain.topup_request.created", "support_ticket", ticketCode, { captainId: captain.id, requestedValueCents: cents(requestedValue) }, captain.id);
  void notifyOperations({ event: "topup_request.created", title: "طلب شحن رصيد جديد", lines: [`الكابتن: ${captain.name}`, `القيمة المطلوبة: ${money(cents(requestedValue))} JOD`, `رقم الطلب: ${ticketCode}`, "بانتظار موافقة المالك لإصدار البطاقة وإرسالها."], ownersOnly: true });
  res.status(201).json({ success: true, ticketCode, status: "new", message: "تم إرسال طلب شحن الرصيد إلى الشركة" });
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
  const result = db.prepare("INSERT INTO support_tickets(ticket_code,requester_name,account_ref,category,message,requested_value_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'new',?,?)").run(ticketCode, requesterName, accountRef || null, category, message, requestedValue === null ? null : cents(requestedValue), stamp, stamp);
  audit("support.ticket.created", "support_ticket", result.lastInsertRowid, { ticketCode, category });
  res.status(201).json({ success: true, ticketCode, status: "new", message: "تم تسجيل طلبك داخل خدمة العملاء" });
});
app.get("/api/admin/support-tickets", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 200").all();
  res.json({ tickets: rows.map((row) => ({ ...row, requestedValue: row.requested_value_cents === null ? null : money(row.requested_value_cents) })) });
});
app.get("/api/admin/notifications", requireAdmin, (req, res) => {
  const requestedLimit = Number(req.query.limit || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 50;
  const rows = db.prepare("SELECT id,recipient_phone,recipient_role,event,title,message,delivery_status,message_id,created_at FROM notifications ORDER BY id DESC LIMIT ?").all(limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, notifications: rows });
});
app.post("/api/admin/support-tickets/:id/fulfill-topup", requireAdmin, async (req, res) => {
  const ticketId = Number(req.params.id);
  const ticket = db.prepare("SELECT * FROM support_tickets WHERE id=? LIMIT 1").get(ticketId);
  if (!ticket) return res.status(404).json({ error: "طلب الشحن غير موجود" });
  if (ticket.category !== "topup_card") return res.status(409).json({ error: "هذا الطلب ليس طلب شحن رصيد" });
  if (["resolved", "closed"].includes(ticket.status)) return res.status(409).json({ error: "تم تنفيذ هذا الطلب مسبقًا" });
  const phone = phoneWithCountry(ticket.account_ref || "");
  const captain = db.prepare("SELECT id,name,phone,active FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
  if (!captain || !captain.active) return res.status(409).json({ error: "الكابتن غير موجود أو غير نشط" });
  const valueCents = Number(ticket.requested_value_cents || 0);
  if (valueCents <= 0) return res.status(400).json({ error: "قيمة الشحن غير صالحة" });
  if (!cardEncryptionKey) return res.status(503).json({ error: "تشفير بطاقات الشحن غير مهيأ" });
  let code = randomCode();
  while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
  const encryptedCode = encryptCardCode(code);
  const card = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,code_ciphertext,created_at) VALUES(?,?,?,'issued',?,?,?)").run(hashCode(code), code.slice(-4), valueCents, captain.id, encryptedCode, now());
  if (!client || !isReady) {
    db.prepare("UPDATE support_tickets SET status='in_progress',admin_reply=?,updated_at=? WHERE id=?").run(`تم إصدار البطاقة #${card.lastInsertRowid}، وتنتظر اتصال WhatsApp للإرسال.`, now(), ticketId);
    return res.status(503).json({ error: "تم إصدار البطاقة لكن WhatsApp غير جاهز للإرسال حاليًا", cardId: card.lastInsertRowid });
  }
  try {
    const appUrl = captainAppUrl(captainInviteBaseUrl(req));
    const caption = brandedMessage("بطاقة شحن الرصيد", [`الكابتن: ${captain.name}`, `القيمة: ${money(valueCents)} JOD`, "هذه البطاقة مخصصة لرقمك وتُستخدم مرة واحدة فقط.", `الدخول: ${appUrl}`, "افتح البوابة، اضغط زر التشغيل، اختر دخول الكابتن، ثم أدخل الرمز لإضافة الرصيد مباشرة."]);
    const media = await renderTopupCardMedia({ cardId: card.lastInsertRowid, code, valueCents, captainName: captain.name, appUrl });
    const sent = await withTimeout(client.sendMessage(`${phone}@c.us`, media, { caption }), 30000, null);
    if (!sent) throw new Error("send timeout");
    db.prepare("UPDATE topup_cards SET sent_at=? WHERE id=?").run(now(), card.lastInsertRowid);
    db.prepare("UPDATE support_tickets SET status='resolved',admin_reply=?,updated_at=? WHERE id=?").run(`تم إصدار وإرسال بطاقة الشحن #${card.lastInsertRowid} إلى WhatsApp.`, now(), ticketId);
    audit("support.topup_request.fulfilled", "support_ticket", ticketId, { cardId: card.lastInsertRowid, captainId: captain.id });
    void notifyOperations({ event: "topup_card.sent", title: "تأكيد إصدار بطاقة شحن", lines: [`الكابتن: ${captain.name}`, `القيمة: ${money(valueCents)} JOD`, `رقم البطاقة الداخلي: #${card.lastInsertRowid}`, "تم توليد البطاقة وإرسالها عبر WhatsApp.", "يُضاف الرصيد عند إدخال الرمز في بوابة الكابتن."], ownersOnly: true });
    res.json({ success: true, status: "resolved", cardId: card.lastInsertRowid });
  } catch (error) {
    db.prepare("UPDATE support_tickets SET status='in_progress',admin_reply=?,updated_at=? WHERE id=?").run(`تم إصدار البطاقة #${card.lastInsertRowid} لكن فشل الإرسال؛ يمكن إعادة المحاولة بعد اتصال WhatsApp.`, now(), ticketId);
    res.status(502).json({ error: "تم إصدار البطاقة لكن تعذر إرسالها عبر WhatsApp", cardId: card.lastInsertRowid });
  }
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
  const pendingConfirmation = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status='open' AND pending_message_id IS NOT NULL").get().count;
  const company = companyUser();
  const wallets = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role!='company'").get().count;
  const ledgerMoves = db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count;
  const issuedCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards").get().count;
  const redeemedCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE status='redeemed'").get().count;
  const voidCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE status='void'").get().count;
  const customerLeads = db.prepare("SELECT COUNT(*) AS count FROM customer_leads WHERE state NOT IN ('cancelled')").get().count;
  const companyEarnings = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='commission_company' THEN amount_cents ELSE 0 END),0) AS cents, COUNT(CASE WHEN type='commission_company' THEN 1 END) AS entries FROM wallet_ledger WHERE user_id=?").get(company.id);
  res.json({ orders, accepted, pendingConfirmation, customerLeads, companyBalance: money(company.wallet_cents), companyEarnings: { total: money(companyEarnings.cents), entries: companyEarnings.entries }, wallets, ledgerMoves, cards: { issued: issuedCards, redeemed: redeemedCards, void: voidCards }, groupId: getSetting("group_id", null), rules: { regular: { captainWalletDeduction: "15%", producerGross: "15%", companyFromProducer: "15%", producerNet: "12.75% من قيمة الطلب" }, order: { captainWalletDeduction: "20%", producerGross: "20%", companyFromProducer: "20%", producerNet: "16% من قيمة الطلب" }, fare: "لا تُضاف قيمة الرحلة الكاملة إلى محفظة المنفّذ" }, confirmation: { method: "لايك المنتج على رسالة تم", settlementAfterConfirmation: true } });
});
app.get("/api/admin/leads", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id,phone,name,direction,travel_mode,travel_date,travelers_count,state,created_at,updated_at FROM customer_leads ORDER BY updated_at DESC LIMIT 200").all();
  res.json({ leads: rows });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT o.*, p.name AS producer_name, c.name AS captain_name FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id LEFT JOIN users c ON c.id=o.captain_user_id ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ orders: rows.map((row) => ({ ...row, price: money(row.price_cents), company: money(row.company_cents), producerGross: money(row.producer_cents), producer: money(row.producer_cents - row.company_cents), captain: money(row.captain_cents), captainFee: money(row.producer_cents), orderType: row.order_kind === "order" ? "أوردر محدد" : "طلب عادي" })) });
});
app.post("/api/admin/orders/remove-test", requireAdmin, async (req, res) => {
  if (String(req.body?.confirm || "") !== "TEST-3001") return res.status(400).json({ error: "Explicit TEST-3001 confirmation is required" });
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupName = `pre-test-order-delete-${Date.now()}.sqlite`;
  const backupPath = path.join(backupDir, backupName);
  await db.backup(backupPath);
  const result = db.prepare("DELETE FROM orders WHERE raw_text LIKE 'TEST-3001 %'").run();
  audit("test_order.removed", "order", "TEST-3001", { deleted: result.changes, backupName });
  res.json({ success: true, deleted: result.changes, backupName });
});
app.get("/api/admin/orders/confirmed", requireAdmin, (req, res) => {
  const requestedLimit = Number(req.query.limit || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  const groupId = String(req.query.groupId || "").trim();
  const rows = groupId
    ? db.prepare(`SELECT o.*, p.name AS producer_name, p.phone AS producer_phone, c.name AS captain_name, c.phone AS captain_phone
        FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id LEFT JOIN users c ON c.id=o.captain_user_id
        WHERE o.status IN ('accepted','completed') AND o.group_id=? ORDER BY o.accepted_at DESC, o.id DESC LIMIT ?`).all(groupId, limit)
    : db.prepare(`SELECT o.*, p.name AS producer_name, p.phone AS producer_phone, c.name AS captain_name, c.phone AS captain_phone
        FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id LEFT JOIN users c ON c.id=o.captain_user_id
        WHERE o.status IN ('accepted','completed') ORDER BY o.accepted_at DESC, o.id DESC LIMIT ?`).all(limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    count: rows.length,
    groupId: groupId || null,
    orders: rows.map((row) => ({
      ...row,
      price: money(row.price_cents),
      company: money(row.company_cents),
      producerGross: money(row.producer_cents),
      producer: money(row.producer_cents - row.company_cents),
      captain: money(row.captain_cents),
      captainFee: money(row.producer_cents),
      orderType: row.order_kind === "order" ? "أوردر محدد" : "طلب عادي",
      confirmationMethod: row.accepted_message_id ? "group_reaction" : "recorded_confirmation",
    })),
  });
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
app.get("/api/admin/whatsapp/clear-session", requireAdmin, async (req, res) => {
  if (String(req.query.execute || "") !== "1") return res.status(405).json({ error: "Explicit execute=1 is required" });
  try {
    await withTimeout(destroyClient(), 15000, null);
    qrCodeData = null;
    if (fs.existsSync(AUTH_PATH)) fs.rmSync(AUTH_PATH, { recursive: true, force: true });
    scheduleReconnect();
    res.redirect(303, "/qr?session=cleared");
  } catch (error) { res.status(500).json({ error: "Unable to clear WhatsApp session" }); }
});
app.post("/api/admin/group/apply-identity", requireAdmin, async (req, res) => {
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 3)) return res.status(429).json({ error: "Too many group identity actions; try again later" });
  if (req.body.confirm !== true) return res.status(400).json({ error: "Owner confirmation is required" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "No configured group" });
  try {
    const chat = await withTimeout(client.getChatById(groupId), 25000, null);
    if (!chat || !chat.isGroup) return res.status(404).json({ error: "Configured chat is not a group" });
    const media = await withTimeout(MessageMedia.fromUrl(GROUP_BRAND_IMAGE_URL, { unsafeMime: true }), 30000, null);
    if (!media) return res.status(502).json({ error: "Unable to load group identity image" });
    const updated = { picture: await chat.setPicture(media), subject: await chat.setSubject(GROUP_BRAND_NAME), description: await chat.setDescription(GROUP_BRAND_DESCRIPTION) };
    const sent = await chat.sendMessage(GROUP_BRAND_WELCOME);
    audit("group.identity_applied", "group", groupId, { messageId: sent.id._serialized });
    res.json({ success: true, updated: { ...updated, welcomeMessageId: sent.id._serialized } });
  } catch (error) {
    audit("group.identity_failed", "group", groupId, { error: error.message });
    res.status(502).json({ error: "Unable to apply group identity", details: error.message });
  }
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
  const messageId = sent && sent.id && sent.id._serialized ? sent.id._serialized : null;
  audit("message.sent", "chat", chatId, { messageId, responseObject: Boolean(sent) });
  const parsed = chatId.endsWith("@g.us") ? parseOrder(message) : null;
  let order = null;
  if (parsed && parsed.isOrder && isConfiguredGroup(chatId)) {
    const producer = botEmployeeUser();
    const sourceMessageId = messageId || `admin-send-${Date.now()}-${crypto.randomUUID()}`;
    order = createOrderRecord({ messageId: sourceMessageId, groupId: chatId, body: message, producer, parsed });
    if (order) {
      await sendGroupBrandedMessage(chatId, "تم تسجيل الطلب", [`🆔 رقم الطلب: #${order.order_no}`, `🛣️ المسار: ${parsed.origin || "غير محدد"} ← ${parsed.destination || "غير محدد"}`, `💰 القيمة: ${money(order.price_cents)} JOD`, parsed.tripTime ? `🕒 الموعد: ${parsed.tripTime}` : "", "⏳ بانتظار رد الكابتن بكلمة «تم»."].filter(Boolean)).catch((error) => console.error("[WhatsApp] admin order acknowledgement send:", error.message));
    }
  }
  res.json({ success: true, messageId, order: order ? { id: order.id, orderNo: order.order_no, status: order.status } : null });
});
function reconcileConfiguredGroupFromEnvironment() {
  if (!WHATSAPP_GROUP_ID) return;
  if (!WHATSAPP_GROUP_ID.endsWith("@g.us")) throw new Error("WHATSAPP_GROUP_ID must end with @g.us");
  const storedGroupId = getSetting("group_id", null);
  const legacyGroupId = getSetting("active_group_id", null);
  if (storedGroupId === WHATSAPP_GROUP_ID && legacyGroupId === WHATSAPP_GROUP_ID && isConfiguredGroup(WHATSAPP_GROUP_ID)) return;
  configureGroupId(WHATSAPP_GROUP_ID, configuredGroup(WHATSAPP_GROUP_ID)?.group_name || WHATSAPP_GROUP_NAME);
  console.log(`[Config] synchronized active WhatsApp group from environment: ${WHATSAPP_GROUP_ID}`);
}

reconcileConfiguredGroupFromEnvironment();

app.listen(PORT, () => {
  console.log(`[HTTP] listening on ${PORT}`);
  console.log(`[Config] phone=${BOT_PHONE} data=${DATA_DIR}`);
  initializeWhatsApp();
  if (BAILEYS_ENABLED) initializeBaileys();
});

function isRecoverableBrowserLifecycleError(error) {
  const message = String(error && error.message || error || "");
  return /Execution context was destroyed|Target closed|Session closed|Protocol error/i.test(message);
}
process.on("unhandledRejection", (reason) => {
  if (!isRecoverableBrowserLifecycleError(reason)) {
    console.error("[Process] unhandled rejection:", reason);
    return;
  }
  whatsappLastError = "WhatsApp browser context restarted; controlled reconnect scheduled";
  whatsappLastEvent = "browser_context_reset";
  isReady = false;
  console.warn("[Process] recoverable WhatsApp browser lifecycle error; scheduling reconnect");
  scheduleReconnect();
});
process.on("uncaughtException", (error) => {
  if (!isRecoverableBrowserLifecycleError(error)) {
    console.error("[Process] uncaught exception:", error);
    process.exit(1);
  }
  whatsappLastError = "WhatsApp browser context restarted; controlled reconnect scheduled";
  whatsappLastEvent = "browser_context_reset";
  isReady = false;
  console.warn("[Process] recoverable WhatsApp browser lifecycle error; keeping server alive");
  scheduleReconnect();
});
process.on("SIGTERM", async () => { await destroyClient(); db.close(); process.exit(0); });
process.on("SIGINT", async () => { await destroyClient(); db.close(); process.exit(0); });
