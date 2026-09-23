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
const applyWhatsAppMediaPatch = require("./scripts/patch-whatsapp-web-media");
const whatsappMediaPatchState = applyWhatsAppMediaPatch();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const sharp = require("sharp");
sharp.concurrency(1);
sharp.cache({ memory: 8, files: 0, items: 4 });
const { calculateSettlement } = require("./finance");
const { isBotGeneratedMessage, isBotReactionSender, isBotFinancialRole } = require("./message_guardrails");

const app = express();
app.set("trust proxy", 1);
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
const PUBLIC_REPORT_ORIGIN = process.env.PUBLIC_REPORT_ORIGIN || "https://jrahreport-nkgxsmah.manus.space";
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
const CAPTAIN_SUBSCRIPTION_CENTS = 100;
const configuredLargeDirectCreditJod = Number(process.env.DIRECT_WALLET_LARGE_CREDIT_THRESHOLD_JOD || 10);
const DIRECT_WALLET_LARGE_CREDIT_THRESHOLD_CENTS = Math.max(1, Math.round((Number.isFinite(configuredLargeDirectCreditJod) ? configuredLargeDirectCreditJod : 10) * 100));
const CAPTAIN_SUBSCRIPTION_START = "2026-09-18T00:00:00.000Z";
const CAPTAIN_SUBSCRIPTION_PERIOD_DAYS = 7;
const CAPTAIN_SUBSCRIPTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CAPTAIN_DAILY_CHARGE_CENTS = 10;
const CAPTAIN_DAILY_CHARGE_INTERVAL_MS = 60 * 60 * 1000;
// Daily 0.10 JOD captain debit is disabled by owner policy for all accounts.
// Keep this hard-off until a future code change explicitly re-enables the policy.
const CAPTAIN_DAILY_CHARGE_ENABLED = false;
const COMPANY_BRAND_NAME = "وصلني الآن";
const COMPANY_BRAND_ENGLISH = "WASLNI NOW";
// The operational bot 0779110123 is always settled through the internal company wallet.
const BOT_FINANCIAL_MODE = "company";
const WHATSAPP_CLIENT_ID = process.env.WHATSAPP_CLIENT_ID?.trim() || "aljarah-main-v2";
// Approved immutable settlement policy: the value after "السعر" is external;
// 12% goes to the captain who posted the order, 3% to the company, and both
// are charged to the confirming captain (15% total). The fare never credits B.
const COMPANY_RATE_BPS = 300;
const PRODUCER_RATE_BPS = 1200;
const SPECIAL_ORDER_RATE_BPS = 1200;
const COMPANY_FROM_PRODUCER_RATE_BPS = 300;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 120);
const QR_RATE_LIMIT_MAX = Number(process.env.QR_RATE_LIMIT_MAX || 3000);
const WHATSAPP_INIT_TIMEOUT_MS = Number(process.env.WHATSAPP_INIT_TIMEOUT_MS || 300000);
const WHATSAPP_PROTOCOL_TIMEOUT_MS = Math.max(120000, Math.min(600000, Number(process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS || 300000)));
const WHATSAPP_GROUP_CREATE_TIMEOUT_MS = Number(process.env.WHATSAPP_GROUP_CREATE_TIMEOUT_MS || 180000);
const ADMIN_SEND_TIMEOUT_MS = Math.max(5000, Math.min(60000, Number(process.env.ADMIN_SEND_TIMEOUT_MS || 20000)));
const ADMIN_SEND_OBSERVATION_TIMEOUT_MS = Math.max(10000, Math.min(120000, Number(process.env.ADMIN_SEND_OBSERVATION_TIMEOUT_MS || 30000)));
const ADMIN_SEND_RESULT_TTL_MS = Math.max(60000, Math.min(6 * 60 * 60 * 1000, Number(process.env.ADMIN_SEND_RESULT_TTL_MS || 2 * 60 * 60 * 1000)));
const WHATSAPP_RECONNECT_BASE_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_BASE_DELAY_MS || 5000);
const WHATSAPP_RECONNECT_MAX_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS || 120000);
const WHATSAPP_RECONNECT_MAX_ATTEMPTS = Number(process.env.WHATSAPP_RECONNECT_MAX_ATTEMPTS || 20);
const WHATSAPP_WATCHDOG_INTERVAL_MS = Number(process.env.WHATSAPP_WATCHDOG_INTERVAL_MS || 300000);
const WHATSAPP_REACTION_SCAN_INTERVAL_MS = Number(process.env.WHATSAPP_REACTION_SCAN_INTERVAL_MS || 15000);
const WHATSAPP_REACTION_SCAN_LIMIT = Number(process.env.WHATSAPP_REACTION_SCAN_LIMIT || 100);
const WHATSAPP_HISTORICAL_CANDIDATE_RECOVERY_INTERVAL_MS = Math.max(15000, Number(process.env.WHATSAPP_HISTORICAL_CANDIDATE_RECOVERY_INTERVAL_MS || 60000));
const GROUP_BRAND_NAME = "وصلني الآن | شبكة التشغيل اللوجستي";
const GROUP_BRAND_DESCRIPTION = "قروب التشغيل الرسمي لوصلني الآن للنقل والخدمات اللوجستية. هنا تُنشر الطلبات، يستلم الكابتن الرحلة، ويجري التوثيق وفق النظام.";
const GROUP_BRAND_IMAGE_URL = process.env.GROUP_BRAND_IMAGE_URL || "https://3000-igl6dwmxr017cr8770kph-08c34cbc.sg1.manus.computer/manus-storage/aljarah-group-avatar-final_cebe4f44.png";
const GROUP_BRAND_WELCOME = "أهلًا بكم في شبكة التشغيل اللوجستي لوصلني الآن.\n\nالطلبات والرحلات والمحافظ تُدار بمسار واضح وموثق. يرجى الالتزام بصيغة الطلب المعتمدة، وعدم إرسال أي طلب ناقص التفاصيل.\n\nخدمة العملاء جاهزة للمساعدة داخل النظام.";
const pendingAdminSends = new Map();
const adminSendResults = new Map();
const loginRate = new Map();
const redeemRate = new Map();
const adminActionRate = new Map();
const whatsappAuthRate = new Map();
const apiRate = new Map();
const qrRate = new Map();
const cardDeliveryInFlight = new Set();
const balanceNotificationBroadcasts = new Map();
const captainAnnouncementBroadcasts = new Map();
const bulkTopupRuns = new Map();
const bulkPinRuns = new Map();
const negativeBalanceWarningRuns = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
const PERSISTED_ADMIN_TOKEN_PATH = path.join(DATA_DIR, "admin-token");
let activeAdminToken = ADMIN_TOKEN;
if (!activeAdminToken) {
  try {
    activeAdminToken = fs.readFileSync(PERSISTED_ADMIN_TOKEN_PATH, "utf8").trim();
  } catch {}
}
app.disable("x-powered-by");
app.use(cors({
  credentials: false,
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = [CORS_ORIGIN, PUBLIC_REPORT_ORIGIN].filter(Boolean);
    return callback(null, allowed.includes(origin) ? origin : false);
  },
}));
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
  registration_name TEXT,
  role TEXT NOT NULL CHECK(role IN ('company','producer','captain')),
  wallet_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('accountant','operations')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
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
CREATE TABLE IF NOT EXISTS reaction_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sender_key TEXT NOT NULL DEFAULT '',
  sender_id TEXT,
  sender_phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE(message_id, emoji, sender_key)
);
CREATE INDEX IF NOT EXISTS idx_reaction_evidence_message ON reaction_evidence(message_id, emoji, active);
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
CREATE TABLE IF NOT EXISTS order_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_message_id TEXT NOT NULL UNIQUE,
  group_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  origin TEXT,
  destination TEXT,
  trip_time TEXT,
  order_kind TEXT NOT NULL DEFAULT 'normal' CHECK(order_kind IN ('normal','order')),
  producer_user_id INTEGER NOT NULL,
  producer_phone_snapshot TEXT,
  producer_name_snapshot TEXT,
  status TEXT NOT NULL CHECK(status IN ('candidate','pending','finalized','cancelled')) DEFAULT 'candidate',
  pending_captain_user_id INTEGER,
  pending_message_id TEXT,
  pending_at TEXT,
  final_order_id INTEGER,
  finalized_at TEXT,
  lifecycle_stage TEXT NOT NULL DEFAULT 'candidate_created',
  lifecycle_blocker TEXT,
  lifecycle_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(producer_user_id) REFERENCES users(id),
  FOREIGN KEY(pending_captain_user_id) REFERENCES users(id),
  FOREIGN KEY(final_order_id) REFERENCES orders(id)
);
CREATE TABLE IF NOT EXISTS order_confirmation_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  group_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed')) DEFAULT 'pending',
  message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
CREATE TABLE IF NOT EXISTS order_candidate_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  captain_user_id INTEGER NOT NULL,
  acceptance_message_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','selected','rejected','cancelled')) DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES order_candidates(id),
  FOREIGN KEY(captain_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_candidate_acceptances_candidate_status ON order_candidate_acceptances(candidate_id,status);
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
  idempotency_key TEXT,
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
  source_message_id TEXT,
  idempotency_key TEXT,
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
CREATE TABLE IF NOT EXISTS captain_phone_aliases (
  phone TEXT PRIMARY KEY,
  captain_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(captain_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whatsapp_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  whatsapp_lid TEXT NOT NULL UNIQUE,
  whatsapp_pn TEXT,
  source TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_identities_phone ON whatsapp_identities(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_identities_user ON whatsapp_identities(user_id);
CREATE TABLE IF NOT EXISTS captain_auth_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captain_user_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(captain_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS captain_merge_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_captain_id INTEGER NOT NULL,
  target_captain_id INTEGER NOT NULL,
  source_phone TEXT NOT NULL,
  target_phone TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','applied','reversed')) DEFAULT 'pending',
  idempotency_key TEXT NOT NULL UNIQUE,
  captain_user_id INTEGER NOT NULL,
  producer_user_id INTEGER,
  charged_user_id INTEGER,
  price_cents INTEGER NOT NULL,
  company_cents INTEGER NOT NULL,
  producer_cents INTEGER NOT NULL,
  captain_fee_cents INTEGER NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(captain_user_id) REFERENCES users(id),
  FOREIGN KEY(producer_user_id) REFERENCES users(id),
  FOREIGN KEY(charged_user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS captain_subscription_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('applied','skipped_debt_limit','ineligible')),
  ledger_id INTEGER,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  details_json TEXT,
  UNIQUE(user_id, period_start),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(ledger_id) REFERENCES wallet_ledger(id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_charges_period ON captain_subscription_charges(period_start,status);
CREATE TABLE IF NOT EXISTS captain_daily_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  charge_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  ledger_id INTEGER,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  details_json TEXT,
  UNIQUE(user_id, charge_date),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(ledger_id) REFERENCES wallet_ledger(id)
);
CREATE INDEX IF NOT EXISTS idx_captain_daily_charges_date ON captain_daily_charges(charge_date);
`);
const existingNotificationColumns = db.prepare("PRAGMA table_info(notifications)").all().map((column) => column.name);
if (!existingNotificationColumns.includes("source_message_id")) db.exec("ALTER TABLE notifications ADD COLUMN source_message_id TEXT");
if (!existingNotificationColumns.includes("idempotency_key")) db.exec("ALTER TABLE notifications ADD COLUMN idempotency_key TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''");
db.exec("CREATE INDEX IF NOT EXISTS idx_notifications_source_message ON notifications(source_message_id)");
const existingInviteColumns = db.prepare("PRAGMA table_info(captain_invites)").all().map((column) => column.name);
if (!existingInviteColumns.includes("token_ciphertext")) db.exec("ALTER TABLE captain_invites ADD COLUMN token_ciphertext TEXT");
const existingLedgerColumns = db.prepare("PRAGMA table_info(wallet_ledger)").all().map((column) => column.name);
if (!existingLedgerColumns.includes("details_json")) db.exec("ALTER TABLE wallet_ledger ADD COLUMN details_json TEXT");
if (!existingLedgerColumns.includes("idempotency_key")) db.exec("ALTER TABLE wallet_ledger ADD COLUMN idempotency_key TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_idempotency ON wallet_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''");
db.exec("CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created ON wallet_ledger(user_id, created_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created ON audit_logs(entity_type, entity_id, created_at DESC)");
const existingSettlementColumns = db.prepare("PRAGMA table_info(order_settlements)").all().map((column) => column.name);
if (!existingSettlementColumns.includes("charged_user_id")) db.exec("ALTER TABLE order_settlements ADD COLUMN charged_user_id INTEGER REFERENCES users(id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_order_settlements_charged_user ON order_settlements(charged_user_id)");
const existingUserColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!existingUserColumns.includes("registration_name")) db.exec("ALTER TABLE users ADD COLUMN registration_name TEXT");
db.prepare("UPDATE users SET registration_name=name WHERE registration_name IS NULL OR TRIM(registration_name)='' ").run();
if (!existingUserColumns.includes("is_bot")) db.exec("ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0");
if (!existingUserColumns.includes("captain_pin_hash")) db.exec("ALTER TABLE users ADD COLUMN captain_pin_hash TEXT");
if (!existingUserColumns.includes("captain_pin_ciphertext")) db.exec("ALTER TABLE users ADD COLUMN captain_pin_ciphertext TEXT");
if (!existingUserColumns.includes("captain_auth_method")) db.exec("ALTER TABLE users ADD COLUMN captain_auth_method TEXT NOT NULL DEFAULT 'pin'");
if (!existingUserColumns.includes("captain_whatsapp_verified_at")) db.exec("ALTER TABLE users ADD COLUMN captain_whatsapp_verified_at TEXT");
if (!existingUserColumns.includes("captain_last_login_at")) db.exec("ALTER TABLE users ADD COLUMN captain_last_login_at TEXT");
if (!existingUserColumns.includes("account_status")) db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'");
if (!existingUserColumns.includes("approved_at")) db.exec("ALTER TABLE users ADD COLUMN approved_at TEXT");
if (!existingUserColumns.includes("activated_at")) db.exec("ALTER TABLE users ADD COLUMN activated_at TEXT");
if (!existingUserColumns.includes("merged_into_user_id")) db.exec("ALTER TABLE users ADD COLUMN merged_into_user_id INTEGER");
const existingInviteAuthColumns = db.prepare("PRAGMA table_info(captain_invites)").all().map((column) => column.name);
if (!existingInviteAuthColumns.includes("auth_method")) db.exec("ALTER TABLE captain_invites ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'pin'");
const existingOrderColumns = db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name);
if (!existingOrderColumns.includes("order_kind")) db.exec("ALTER TABLE orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'normal'");
if (!existingOrderColumns.includes("pending_captain_user_id")) db.exec("ALTER TABLE orders ADD COLUMN pending_captain_user_id INTEGER");
if (!existingOrderColumns.includes("pending_message_id")) db.exec("ALTER TABLE orders ADD COLUMN pending_message_id TEXT");
if (!existingOrderColumns.includes("pending_at")) db.exec("ALTER TABLE orders ADD COLUMN pending_at TEXT");
if (!existingOrderColumns.includes("producer_phone_snapshot")) db.exec("ALTER TABLE orders ADD COLUMN producer_phone_snapshot TEXT");
if (!existingOrderColumns.includes("producer_name_snapshot")) db.exec("ALTER TABLE orders ADD COLUMN producer_name_snapshot TEXT");
if (!existingOrderColumns.includes("captain_phone_snapshot")) db.exec("ALTER TABLE orders ADD COLUMN captain_phone_snapshot TEXT");
if (!existingOrderColumns.includes("captain_name_snapshot")) db.exec("ALTER TABLE orders ADD COLUMN captain_name_snapshot TEXT");
if (!existingOrderColumns.includes("confirmed_by_phone")) db.exec("ALTER TABLE orders ADD COLUMN confirmed_by_phone TEXT");
if (!existingOrderColumns.includes("settlement_state")) db.exec("ALTER TABLE orders ADD COLUMN settlement_state TEXT NOT NULL DEFAULT 'pending'");
if (!existingOrderColumns.includes("import_source")) db.exec("ALTER TABLE orders ADD COLUMN import_source TEXT NOT NULL DEFAULT 'live'");
if (!existingOrderColumns.includes("archive_state")) db.exec("ALTER TABLE orders ADD COLUMN archive_state TEXT NOT NULL DEFAULT 'active'");
if (!existingOrderColumns.includes("archived_at")) db.exec("ALTER TABLE orders ADD COLUMN archived_at TEXT");
if (!existingOrderColumns.includes("archive_reason")) db.exec("ALTER TABLE orders ADD COLUMN archive_reason TEXT");
const existingCandidateColumns = db.prepare("PRAGMA table_info(order_candidates)").all().map((column) => column.name);
if (!existingCandidateColumns.includes("lifecycle_stage")) db.exec("ALTER TABLE order_candidates ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'candidate_created'");
if (!existingCandidateColumns.includes("lifecycle_blocker")) db.exec("ALTER TABLE order_candidates ADD COLUMN lifecycle_blocker TEXT");
if (!existingCandidateColumns.includes("lifecycle_updated_at")) db.exec("ALTER TABLE order_candidates ADD COLUMN lifecycle_updated_at TEXT");
db.exec(`
  UPDATE order_candidates
  SET lifecycle_stage=CASE
    WHEN status='finalized' THEN 'settled'
    WHEN status='pending' THEN 'acceptance_pending'
    WHEN status='cancelled' THEN 'cancelled'
    ELSE COALESCE(NULLIF(lifecycle_stage,''),'candidate_created')
  END,
  lifecycle_updated_at=COALESCE(lifecycle_updated_at,updated_at)
  WHERE lifecycle_updated_at IS NULL OR lifecycle_stage IS NULL OR lifecycle_stage='';
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_pending_message ON orders(pending_message_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_order_candidates_pending_message ON order_candidates(pending_message_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_order_candidates_source_message ON order_candidates(source_message_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_order_candidates_lifecycle ON order_candidates(lifecycle_stage,updated_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_captain_phone_snapshot ON orders(captain_phone_snapshot)");
db.exec("CREATE INDEX IF NOT EXISTS idx_captain_auth_challenges_phone ON captain_auth_challenges(phone,created_at)");
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
db.exec(`
  UPDATE users SET account_status=CASE WHEN active=1 THEN 'active' ELSE 'suspended' END
  WHERE account_status IS NULL OR account_status NOT IN ('pending','approved','active','suspended','merged','rejected');
  UPDATE orders SET
    producer_phone_snapshot=COALESCE(producer_phone_snapshot,(SELECT phone FROM users WHERE users.id=orders.producer_user_id)),
    producer_name_snapshot=COALESCE(producer_name_snapshot,(SELECT name FROM users WHERE users.id=orders.producer_user_id)),
    captain_phone_snapshot=COALESCE(captain_phone_snapshot,(SELECT phone FROM users WHERE users.id=orders.captain_user_id)),
    captain_name_snapshot=COALESCE(captain_name_snapshot,(SELECT name FROM users WHERE users.id=orders.captain_user_id))
  WHERE producer_phone_snapshot IS NULL OR captain_phone_snapshot IS NULL;
  UPDATE orders SET settlement_state='settled'
  WHERE status IN ('accepted','completed') AND EXISTS(SELECT 1 FROM wallet_ledger WHERE wallet_ledger.order_id=orders.id);
`);

const now = () => new Date().toISOString();
const cleanPhone = (value = "") => String(value).replace(/[^0-9]/g, "").replace(/^00/, "");
const phoneWithCountry = (value = "") => {
  const raw = cleanPhone(value);
  if (raw.startsWith("0")) return "962" + raw.slice(1);
  return raw;
};
async function resolveWhatsAppRecipientId(phoneValue) {
  const phone = phoneWithCountry(phoneValue);
  if (!phone || !client || !isReady || typeof client.getNumberId !== "function") return null;
  const persisted = db.prepare("SELECT whatsapp_lid FROM whatsapp_identities WHERE phone=? AND active=1 ORDER BY last_seen_at DESC LIMIT 1").get(phone);
  if (persisted?.whatsapp_lid) return String(persisted.whatsapp_lid).trim();
  const resolved = await withTimeout(client.getNumberId(phone), 20000, null);
  const serialized = String(resolved?._serialized || "").trim();
  if (/@(c\.us|lid)$/.test(serialized)) return serialized;
  const contact = await withTimeout(client.getContactById(`${phone}@c.us`), 10000, null);
  const contactId = String(contact?.id?._serialized || contact?.id || "").trim();
  if (/@(c\.us|lid)$/.test(contactId)) return contactId;
  const registered = typeof client.isRegisteredUser === "function"
    ? await withTimeout(client.isRegisteredUser(phone), 10000, false)
    : false;
  return registered ? `${phone}@c.us` : null;
}
const cents = (value) => Math.round(Number(value || 0) * 100);
const money = (value) => (Number(value || 0) / 100).toFixed(2);

function settlementFinancials(row) {
  const value = (primary, fallback = 0) => row[primary] === null || row[primary] === undefined
    ? Number(row[fallback] || 0)
    : Number(row[primary] || 0);
  const externalOrderValueCents = Number(row.price_cents || 0);
  const companyCents = value("settlement_company_cents", "company_cents");
  const producerCents = value("settlement_producer_cents", "producer_cents");
  const captainFeeCents = row.settlement_captain_fee_cents === null || row.settlement_captain_fee_cents === undefined
    ? producerCents + companyCents
    : Number(row.settlement_captain_fee_cents || 0);
  const executorWalletCreditCents = 0;
  return {
    price: money(externalOrderValueCents),
    externalOrderValue: money(externalOrderValueCents),
    externalOrderValueCents,
    company: money(companyCents),
    producerGross: money(producerCents),
    producer: money(producerCents),
    postedShare: money(producerCents),
    captain: money(executorWalletCreditCents),
    executorWalletCredit: money(executorWalletCreditCents),
    executorWalletCreditCents,
    captainFee: money(captainFeeCents),
    executorDebit: money(captainFeeCents),
    captainNet: money(executorWalletCreditCents - captainFeeCents),
    executorWalletNet: money(executorWalletCreditCents - captainFeeCents),
    settlementState: row.settlement_state || (row.settlement_status === "applied" ? "settled" : row.settlement_status || "pending"),
    settlementStatus: row.settlement_status || "pending",
    settlementId: row.settlement_id || null,
    settlementKey: row.settlement_key || null,
    settlementAppliedAt: row.settlement_applied_at || null,
    confirmationMethod: row.accepted_message_id ? "group_reaction" : "recorded_confirmation",
  };
}

function settlementRows(limit = 200) {
  const safeLimit = Number.isInteger(Number(limit)) ? Math.max(1, Math.min(Number(limit), 500)) : 200;
  return db.prepare(`SELECT
      s.id AS settlement_id,s.order_id,s.status AS settlement_status,s.idempotency_key AS settlement_key,
      s.captain_user_id AS settlement_captain_user_id,s.producer_user_id AS settlement_producer_user_id,s.charged_user_id AS settlement_charged_user_id,
      s.price_cents AS settlement_price_cents,s.company_cents AS settlement_company_cents,
      s.producer_cents AS settlement_producer_cents,s.captain_fee_cents AS settlement_captain_fee_cents,
      s.details_json AS settlement_details_json,s.created_at AS settlement_created_at,s.applied_at AS settlement_applied_at,
      o.order_no,o.status,o.order_kind,o.raw_text,o.source_message_id,o.group_id,o.origin,o.destination,o.trip_time,
      o.price_cents,o.company_cents,o.producer_cents,o.captain_cents,o.settlement_state,o.accepted_message_id,
      o.accepted_at,o.confirmed_by_phone,o.created_at,o.updated_at,
      p.id AS producer_id,p.name AS producer_name,p.phone AS producer_phone,
      c.id AS captain_id,c.name AS captain_name,c.phone AS captain_phone,
      w.id AS charged_wallet_id,w.name AS charged_wallet_name,w.phone AS charged_wallet_phone,w.role AS charged_wallet_role
    FROM order_settlements s
    JOIN orders o ON o.id=s.order_id
    LEFT JOIN users p ON p.id=COALESCE(s.producer_user_id,o.producer_user_id)
    LEFT JOIN users c ON c.id=COALESCE(s.captain_user_id,o.captain_user_id)
    LEFT JOIN users w ON w.id=COALESCE(s.charged_user_id,s.captain_user_id)
    WHERE s.status IN ('applied','reversed')
    ORDER BY COALESCE(s.applied_at,s.created_at) DESC,s.id DESC LIMIT ?`).all(safeLimit);
}

function maskSettlementPhone(value) {
  const phone = phoneWithCountry(value) || String(value || "");
  if (phone.length <= 6) return phone ? "***" : null;
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}

function logSettlementCompleted({ mode, orderId, orderNo, priceCents, producer, chargedWallet, settlement, settlementKey }) {
  const price = money(priceCents);
  const producerShare = money(settlement.producerNetCents);
  const companyShare = money(settlement.companyCents);
  const executorDebit = money(settlement.confirmingCaptainFeeCents);
  console.log(`[Settlement] COMPLETED mode=${mode} order=#${orderNo} id=${orderId} key=${settlementKey} external_order_value=${price} JOD executor_wallet_credit=0.00 JOD`);
  console.log(`[Settlement] CONFIRMED 12% downloader=${producerShare} JOD phone=${maskSettlementPhone(producer?.phone)} | 3% company=${companyShare} JOD | 15% executor_debit=${executorDebit} JOD phone=${maskSettlementPhone(chargedWallet?.phone)} | external_value_not_credited=true`);
}

function serializeSettlement(row, includeLedger = true) {
  const finance = settlementFinancials(row);
  const ledger = includeLedger
    ? db.prepare("SELECT user_id,type,amount_cents,balance_after_cents,reference,note,created_at FROM wallet_ledger WHERE order_id=? ORDER BY id ASC").all(row.order_id).map((entry) => ({
      ...entry,
      amount: money(entry.amount_cents),
      balanceAfter: money(entry.balance_after_cents),
    }))
    : undefined;
  return {
    id: row.settlement_id,
    orderId: row.order_id,
    orderNo: row.order_no,
    status: row.settlement_status,
    settlementKey: row.settlement_key,
    price: finance.price,
    companyShare: finance.company,
    postedShare: finance.postedShare,
    executorDebit: finance.executorDebit,
    captainCash: finance.captain,
    settlementState: finance.settlementState,
    appliedAt: finance.settlementAppliedAt,
    createdAt: row.settlement_created_at,
    downloader: { id: row.producer_id || row.settlement_producer_user_id || null, name: row.producer_name || "غير مسجل", phone: row.producer_phone || null },
    executor: { id: row.captain_id || row.settlement_captain_user_id || null, name: row.captain_name || "غير مسجل", phone: row.captain_phone || null },
    chargedWallet: { id: row.charged_wallet_id || row.settlement_charged_user_id || row.captain_id || null, name: row.charged_wallet_name || row.captain_name || "غير مسجل", phone: row.charged_wallet_phone || row.captain_phone || null, role: row.charged_wallet_role || "captain" },
    confirmation: { method: finance.confirmationMethod, confirmedByPhone: row.confirmed_by_phone || null, acceptedAt: row.accepted_at || null, messageId: row.accepted_message_id || null },
    route: { origin: row.origin || null, destination: row.destination || null, tripTime: row.trip_time || null },
    ledger,
  };
}
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
function normalizeCaptainAuthMethod(value) {
  return String(value || "pin").trim().toLowerCase() === "whatsapp" ? "whatsapp" : "pin";
}
function findCaptainByPhone(value, { activeOnly = false } = {}) {
  const phone = phoneWithCountry(value);
  if (!phone) return null;
  const activeClause = activeOnly ? " AND u.active=1 AND u.account_status='active'" : "";
  return db.prepare(`SELECT u.* FROM users u WHERE u.phone=? AND u.role='captain'${activeClause} LIMIT 1`).get(phone)
    || db.prepare(`SELECT u.* FROM captain_phone_aliases a JOIN users u ON u.id=a.captain_user_id WHERE a.phone=? AND u.role='captain'${activeClause} LIMIT 1`).get(phone);
}
function persistWhatsappIdentity(lidValue, phoneValue, source = "whatsapp_event") {
  if (typeof db === "undefined") return null;
  const lid = serializedWhatsappUserId(lidValue);
  const phone = phoneWithCountry(phoneValue);
  if (!/@lid$/i.test(lid) || !isValidJordanPhone(phone)) return null;
  const user = db.prepare("SELECT id,phone,active FROM users WHERE phone=? LIMIT 1").get(phone);
  if (!user) return null;
  const existingByLid = db.prepare("SELECT * FROM whatsapp_identities WHERE whatsapp_lid=? LIMIT 1").get(lid);
  const existingByPhone = db.prepare("SELECT * FROM whatsapp_identities WHERE phone=? LIMIT 1").get(phone);
  if ((existingByLid && existingByLid.user_id !== user.id) || (existingByPhone && existingByPhone.user_id !== user.id)) {
    console.warn(`[WhatsApp] refusing conflicting identity mapping for ${lid}`);
    return null;
  }
  const stamp = now();
  db.prepare(`INSERT INTO whatsapp_identities(user_id,phone,whatsapp_lid,whatsapp_pn,source,verified_at,last_seen_at,active)
    VALUES(?,?,?,?,?,?,?,1)
    ON CONFLICT(whatsapp_lid) DO UPDATE SET phone=excluded.phone,whatsapp_pn=excluded.whatsapp_pn,source=excluded.source,last_seen_at=excluded.last_seen_at,active=1`).run(
    user.id, phone, lid, `${phone}@c.us`, String(source || "whatsapp_event"), stamp, stamp,
  );
  return user;
}
async function auditActiveCaptainLidMappings({ groupId = getSetting("group_id", ""), chunkSize = 25 } = {}) {
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedGroupId || !isConfiguredGroup(normalizedGroupId)) return { status: "group_not_configured", groupId: normalizedGroupId || null, mappings: [], unresolved: [], conflicts: [] };
  if (!client || !isReady || typeof client.getContactLidAndPhone !== "function") return { status: "bot_not_ready_or_lid_api_unavailable", groupId: normalizedGroupId, mappings: [], unresolved: [], conflicts: [] };
  const captains = db.prepare("SELECT id,phone,name FROM users WHERE role='captain' AND is_bot=0 AND active=1 AND account_status='active' ORDER BY id").all();
  const mappings = [];
  const unresolved = [];
  const conflicts = [];
  const safeChunkSize = Math.max(1, Math.min(Number(chunkSize) || 25, 50));
  for (let offset = 0; offset < captains.length; offset += safeChunkSize) {
    const chunk = captains.slice(offset, offset + safeChunkSize);
    let resolved = [];
    try {
      resolved = await withTimeout(client.getContactLidAndPhone(chunk.map((captain) => `${phoneWithCountry(captain.phone)}@c.us`)), 20000, []);
    } catch (error) {
      console.warn(`[WhatsApp] captain LID audit chunk failed: ${String(error?.message || error)}`);
      resolved = [];
    }
    for (let index = 0; index < chunk.length; index += 1) {
      const captain = chunk[index];
      const mapping = Array.isArray(resolved) ? resolved[index] : null;
      const phone = phoneWithCountry(captain.phone);
      const mappedPhone = directJordanPhoneFromWhatsappValue(mapping?.pn || mapping?.phone);
      const lid = serializedWhatsappUserId(mapping?.lid);
      if (!/@lid$/i.test(lid) || !isValidJordanPhone(mappedPhone)) {
        unresolved.push({ captainId: captain.id, phone, name: captain.name, reason: "lid_not_returned" });
        continue;
      }
      if (mappedPhone !== phone) {
        conflicts.push({ captainId: captain.id, phone, mappedPhone, lid, reason: "phone_mismatch" });
        continue;
      }
      const user = persistWhatsappIdentity(lid, phone, "captain_lid_audit");
      if (!user) {
        conflicts.push({ captainId: captain.id, phone, lid, reason: "conflicting_identity_mapping" });
        continue;
      }
      mappings.push({ captainId: captain.id, phone, name: captain.name, lid, source: "captain_lid_audit" });
    }
  }
  return {
    status: "completed",
    groupId: normalizedGroupId,
    totalActiveCaptains: captains.length,
    resolvedCount: mappings.length,
    unresolvedCount: unresolved.length,
    conflictCount: conflicts.length,
    mappings,
    unresolved,
    conflicts,
    mutation: "identity_metadata_only",
    financialMutation: false,
  };
}
function findPersistedWhatsappPhone(lidValue) {
  if (typeof db === "undefined") return "";
  const lid = serializedWhatsappUserId(lidValue);
  if (!/@lid$/i.test(lid)) return "";
  const row = db.prepare("SELECT phone FROM whatsapp_identities WHERE whatsapp_lid=? AND active=1 LIMIT 1").get(lid);
  return row && isValidJordanPhone(row.phone) ? row.phone : "";
}
function captainAuthCodeHash(phone, code) {
  return crypto.createHmac("sha256", CAPTAIN_SESSION_SECRET).update(`${phone}:${String(code)}`).digest("hex");
}
function createCaptainWhatsappCode() {
  return String(crypto.randomInt(100000, 1000000));
}
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
const BLOCKED_PHONES = new Set(["+962792026321", "+962792026320", "+962775969880"]);
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
const WHATSAPP_SEND_TIMEOUT = Symbol("whatsapp_send_timeout");
async function sendWhatsAppAtMostOnce(to, content, options = undefined, timeoutMs = 20000) {
  if (!client || !isReady || typeof client.sendMessage !== "function") return { status: "unavailable", message: null, error: "whatsapp_not_ready" };
  try {
    const promise = options === undefined ? client.sendMessage(to, content) : client.sendMessage(to, content, options);
    const message = await withTimeoutStrict(promise, timeoutMs, WHATSAPP_SEND_TIMEOUT);
    if (message === WHATSAPP_SEND_TIMEOUT) return { status: "uncertain", message: null, error: "send_timeout_no_retry" };
    return { status: "sent", message: message || null, error: null };
  } catch (error) {
    return { status: "failed", message: null, error: String(error?.message || error).slice(0, 240) };
  }
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
    const sent = await withTimeout(client.sendMessage(to, text), 20000, null);
    return Boolean(sent);
  } catch (error) {
    console.error("[WhatsApp] raw message fallback:", error.message);
    return false;
  }
}
async function sendCompanyOperationsCard(to, title, lines, { returnMessage = false } = {}) {
  if (!client || !isReady) return false;
  const caption = brandedMessage(title, lines);
  try {
    const media = await withTimeout(renderOperationsMessageMedia(title, lines), 30000, null);
    if (!media) throw new Error("operations card render returned no media");
    const result = await sendWhatsAppAtMostOnce(to, media, { caption }, 30000);
    if (result.status !== "sent") {
      console.warn(`[WhatsApp] operations card delivery ${result.status}; no text fallback will be attempted`);
      return returnMessage ? { sent: false, uncertain: result.status === "uncertain", messageId: null } : false;
    }
    return returnMessage ? { sent: true, messageId: result.message?.id?._serialized || null } : true;
  } catch (error) {
    if (error?.message !== "operations card render returned no media") {
      console.error("[WhatsApp] operations card send failed; no retry to avoid duplicate delivery:", error.message);
      return returnMessage ? { sent: false, messageId: null } : false;
    }
    console.warn("[WhatsApp] operations card media failed; using text fallback");
    const result = await sendWhatsAppAtMostOnce(to, caption, undefined, 20000);
    return returnMessage ? { sent: result.status === "sent", uncertain: result.status === "uncertain", messageId: result.message?.id?._serialized || null } : result.status === "sent";
  }
}
async function sendBotText(to, text) {
  const phone = phoneWithCountry(String(to || "").replace(/@c\.us$/, ""));
  const customer = phone ? db.prepare("SELECT state FROM customer_leads WHERE phone=? LIMIT 1").get(phone) : null;
  if (customer && customer.state !== "booking_confirmed") {
    console.log(`[Policy] customer message blocked before booking confirmation: ${phone}`);
    return false;
  }
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 10);
  return sendCompanyOperationsCard(to, `رسالة رسمية من ${COMPANY_BRAND_NAME}`, lines);
}
const CAPTAIN_STATUS_NOTICE_MAX_LENGTH = 70;
// Emergency kill switch: captain onboarding/status text is paused until duplicate delivery is cleared.
const CAPTAIN_STATUS_NOTIFICATIONS_ENABLED = false;
const CAPTAIN_STATUS_TEST_CONFIRMATION = "SEND-ONE-CAPTAIN-NOTIFICATION";
// No live test exception remains enabled after the controlled verification attempt.
const CAPTAIN_STATUS_TEST_ALLOWLIST = new Set();
const captainStatusNotificationInFlight = new Set();
async function sendCaptainStatusText({ phone, event, title, text, idempotencyKey, sourceMessageId = null, testOverride = false, testCaptainId = null }) {
  const recipientPhone = phoneWithCountry(phone);
  const message = String(text || "").trim();
  const key = String(idempotencyKey || "").trim();
  if (!isValidJordanPhone(recipientPhone) || !event || !title || !message || message.length > CAPTAIN_STATUS_NOTICE_MAX_LENGTH || !key) {
    return { status: "invalid" };
  }
  const allowPausedTest = testOverride && event === "captain.approval_notification.test" && CAPTAIN_STATUS_TEST_ALLOWLIST.has(Number(testCaptainId));
  if (!CAPTAIN_STATUS_NOTIFICATIONS_ENABLED && !allowPausedTest) {
    audit(`notification.${event}.suppressed`, "user", recipientPhone, { deliveryStatus: "suppressed", idempotencyKey: key, reason: "captain_status_notifications_paused" });
    return { status: "suppressed", duplicate: false, reason: "captain_status_notifications_paused" };
  }
  if (captainStatusNotificationInFlight.has(key)) return { status: "pending", duplicate: true };
  const existing = db.prepare("SELECT id,delivery_status,message_id FROM notifications WHERE idempotency_key=? LIMIT 1").get(key);
  if (existing && ["sent", "delivered"].includes(existing.delivery_status)) return { status: existing.delivery_status, duplicate: true, notificationId: existing.id, messageId: existing.message_id || null };
  let row = existing;
  if (row) {
    db.prepare("UPDATE notifications SET recipient_phone=?,event=?,title=?,message=?,delivery_status='pending',source_message_id=? WHERE id=?").run(recipientPhone, event, title, message, sourceMessageId, row.id);
  } else {
    try {
      row = db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,source_message_id,idempotency_key,created_at) VALUES(?,'captain',?,?,?,'pending',?,?,?)").run(recipientPhone, event, title, message, sourceMessageId, key, now());
    } catch (error) {
      const duplicate = db.prepare("SELECT id,delivery_status,message_id FROM notifications WHERE idempotency_key=? LIMIT 1").get(key);
      if (duplicate) return { status: duplicate.delivery_status, duplicate: true, notificationId: duplicate.id, messageId: duplicate.message_id || null };
      throw error;
    }
  }
  const notificationId = row.lastInsertRowid || row.id;
  captainStatusNotificationInFlight.add(key);
  let deliveryStatus = "failed";
  let messageId = null;
  try {
    if (client && isReady) {
      const resolved = await resolveWhatsAppRecipientId(recipientPhone);
      const recipient = resolved || `${recipientPhone}@c.us`;
      const result = await sendWhatsAppAtMostOnce(recipient, message);
      if (result.status === "sent") {
        deliveryStatus = "sent";
        messageId = result.message?.id?._serialized || null;
      } else if (result.status === "uncertain") {
        deliveryStatus = "sent";
        audit(`notification.${event}.uncertain_ack`, "user", recipientPhone, { idempotencyKey: key, reason: result.error });
      }
    }
  } catch (_) {}
  captainStatusNotificationInFlight.delete(key);
  db.prepare("UPDATE notifications SET delivery_status=?,message_id=? WHERE id=?").run(deliveryStatus, messageId, notificationId);
  audit(`notification.${event}`, "user", recipientPhone, { deliveryStatus, idempotencyKey: key, sourceMessageId: sourceMessageId || null });
  return { status: deliveryStatus, notificationId, messageId };
}
async function retryCaptainStatusNotifications() {
  if (!CAPTAIN_STATUS_NOTIFICATIONS_ENABLED || !client || !isReady) return { attempted: 0, disabled: !CAPTAIN_STATUS_NOTIFICATIONS_ENABLED };
  const events = ["captain.join.received", "captain.approval", "captain.access_card.sent", "captain.access_card.delivered", "captain.wallet.credit_sent", "captain.wallet.credit_redeemed", "captain.activated", "captain.deactivated"];
  const placeholders = events.map(() => "?").join(",");
  const rows = db.prepare(`SELECT recipient_phone,event,title,message,idempotency_key,source_message_id FROM notifications WHERE recipient_role='captain' AND delivery_status IN ('pending','failed') AND event IN (${placeholders}) ORDER BY id DESC LIMIT 50`).all(...events);
  for (const row of rows) {
    await sendCaptainStatusText({ phone: row.recipient_phone, event: row.event, title: row.title, text: row.message, idempotencyKey: row.idempotency_key, sourceMessageId: row.source_message_id }).catch(() => null);
  }
  return { attempted: rows.length };
}
function sendCaptainOperationsCard(to, title, lines) {
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
    try {
      const recipient = await resolveWhatsAppRecipientId(phone);
      if (recipient && await sendCompanyOperationsCard(recipient, title, lines.filter(Boolean))) deliveryStatus = "sent";
    } catch (_) {}
    db.prepare("UPDATE notifications SET delivery_status=? WHERE id=?").run(deliveryStatus, row.lastInsertRowid);
    results.push({ id: row.lastInsertRowid, phone, recipientRole, deliveryStatus });
  }
  return results;
}
function balanceSnapshotMessage({ name, balance }) {
  return brandedMessage("كشف رصيد المحفظة", [
    `الكابتن: ${name || "حسابك"}`,
    `الرصيد الحالي في حسابك: ${money(balance)} JOD`,
    "هذه رسالة اطلاع فقط، ولا تغيّر الرصيد أو تنشئ بطاقة.",
  ]);
}
async function runBalanceNotificationBroadcast({ runKey, members }) {
  const run = balanceNotificationBroadcasts.get(runKey);
  if (!run) return;
  for (const member of members) {
    if (run.cancelled) break;
    const phone = phoneWithCountry(member.phone);
    const event = `captain.balance.snapshot.${runKey}`;
    const message = balanceSnapshotMessage({ name: member.name, balance: member.balanceCents });
    const existing = db.prepare("SELECT id,delivery_status FROM notifications WHERE recipient_phone=? AND recipient_role='captain' AND event=? LIMIT 1").get(phone, event);
    if (existing) {
      run.skipped += 1;
      if (existing.delivery_status === "sent") run.sent += 1;
      else if (existing.delivery_status === "failed") run.failed += 1;
      continue;
    }
    const row = db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,created_at) VALUES(?,'captain',?,?,?,'pending',?)").run(phone, event, "كشف رصيد المحفظة", message, now());
    let deliveryStatus = "failed";
    let messageId = null;
    try {
      const recipient = member.recipientId && /@(c\.us|lid)$/.test(String(member.recipientId)) ? String(member.recipientId) : await resolveWhatsAppRecipientId(phone);
      const sent = recipient && client && isReady ? await withTimeout(client.sendMessage(recipient, message), 15000, null) : null;
      if (sent) { deliveryStatus = "sent"; messageId = sent.id?._serialized || null; }
    } catch (_) {}
    db.prepare("UPDATE notifications SET delivery_status=?,message_id=? WHERE id=?").run(deliveryStatus, messageId, row.lastInsertRowid);
    run.processed += 1;
    if (deliveryStatus === "sent") run.sent += 1;
    else run.failed += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  run.status = run.cancelled ? "cancelled" : "completed";
  run.completedAt = now();
}
const CAPTAIN_COMPLETION_ANNOUNCEMENT_VERSION = "company-completion-v1";
const CAPTAIN_COMPLETION_ANNOUNCEMENT_CONFIRMATION = "SEND_COMPANY_COMPLETION_ANNOUNCEMENT";
function captainCompletionAnnouncementContent() {
  const title = "إعلان اكتمال شركة وصلني الآن";
  const lines = [
    "تم بحمد الله اكتمال تجهيز وتشغيل شركة وصلني الآن.",
    "تم تفعيل مسار الطلبات والتأكيد والتسوية المالية.",
    "طريقة العمل المعتمدة: يُنشر السعر في القروب الرسمي، ثم يرد الكابتن المنفّذ بكلمة «تم»، ويُستكمل اعتماد الحجز والتسوية حسب المسار المعتمد.",
    "ستصلكم الإشعارات الرسمية عند تسجيل العمليات المهمة.",
    `بوابة الكابتن: ${captainAppUrl(PUBLIC_APP_URL)}`,
    "شكرًا لتعاونكم مع وصلني الآن – Waslni Now.",
  ];
  return { title, lines, caption: brandedMessage(title, lines) };
}
async function runCaptainCompletionAnnouncement({ runKey, captains }) {
  const run = captainAnnouncementBroadcasts.get(runKey);
  if (!run) return;
  const { title, lines, caption } = captainCompletionAnnouncementContent();
  try {
    if (!client || !isReady) throw new Error("WhatsApp غير جاهز حاليًا");
    const media = await withTimeout(renderOperationsMessageMedia(title, lines), 30000, null);
    if (!media) throw new Error("announcement card render returned no media");
    for (const captain of captains) {
      const phone = phoneWithCountry(captain.phone);
      const event = `captain.company_completion.${runKey}`;
      const idempotencyKey = `COMPANY-COMPLETION-${runKey}-${captain.id}`.slice(0, 100);
      const existing = db.prepare("SELECT id,delivery_status,message_id FROM notifications WHERE recipient_phone=? AND recipient_role='captain' AND event=? LIMIT 1").get(phone, event);
      if (existing && ["sent", "delivered", "pending", "uncertain"].includes(existing.delivery_status)) {
        run.skipped += 1;
        if (["sent", "delivered"].includes(existing.delivery_status)) run.sent += 1;
        else if (existing.delivery_status === "uncertain") run.uncertain += 1;
        continue;
      }
      let row;
      if (existing) {
        db.prepare("UPDATE notifications SET title=?,message=?,delivery_status='pending',idempotency_key=? WHERE id=?").run(title, caption, idempotencyKey, existing.id);
        row = { lastInsertRowid: existing.id };
      } else {
        try {
          row = db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,idempotency_key,created_at) VALUES(?,'captain',?,?,?,'pending',?,?)").run(phone, event, title, caption, idempotencyKey, now());
        } catch (error) {
          const duplicate = db.prepare("SELECT id,delivery_status FROM notifications WHERE recipient_phone=? AND recipient_role='captain' AND event=? LIMIT 1").get(phone, event);
          if (duplicate) {
            run.skipped += 1;
            continue;
          }
          throw error;
        }
      }
      let deliveryStatus = "failed";
      let messageId = null;
      try {
        const recipient = await resolveWhatsAppRecipientId(phone);
        const result = recipient ? await sendWhatsAppAtMostOnce(recipient, media, { caption }, 30000) : { status: "failed" };
        if (result.status === "sent") {
          deliveryStatus = "sent";
          messageId = result.message?.id?._serialized || null;
        } else if (result.status === "uncertain") {
          deliveryStatus = "uncertain";
          run.uncertain += 1;
        }
      } catch (error) {
        run.lastError = String(error?.message || error).slice(0, 300);
      }
      db.prepare("UPDATE notifications SET delivery_status=?,message_id=? WHERE id=?").run(deliveryStatus, messageId, row.lastInsertRowid || row.id);
      audit("captain.company_completion_announcement", "user", captain.id, { runKey, deliveryStatus, messageId });
      run.processed += 1;
      if (deliveryStatus === "sent") run.sent += 1;
      else if (deliveryStatus === "failed") run.failed += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.lastError = String(error?.message || error).slice(0, 300);
  } finally {
    run.completedAt = now();
  }
}
async function notifyCaptainNegativeBalance({ captainId, balanceCents, reason, reference }) {
  if (!Number.isInteger(Number(captainId)) || Number(balanceCents) >= 0) return { status: "not_required" };
  const captain = db.prepare("SELECT id,phone,name,role,active,is_bot,account_status FROM users WHERE id=? LIMIT 1").get(Number(captainId));
  if (!captain || captain.role !== "captain" || captain.is_bot === 1 || !captain.active || captain.account_status !== "active") return { status: "ineligible" };
  const title = "تنبيه من وصلني الآن";
  const safeReference = String(reference || "WALLET").trim().slice(0, 100) || "WALLET";
  const lines = [
    `عزيزي الكابتن ${captain.name}،`,
    `أصبح رصيد محفظتك الحالي ${money(balanceCents)} JOD.`,
    `يرجى شحن مبلغ ${money(Math.abs(Number(balanceCents)))} JOD لتصفير الرصيد ومتابعة تنفيذ الطلبات.`,
    `سبب الحركة: ${String(reason || "حركة مالية").trim().slice(0, 160)}`,
    `يمكنك الدخول إلى بوابة الكابتن من هنا: ${captainAppUrl(PUBLIC_APP_URL)}`,
    "شكرًا لتعاونك مع وصلني الآن – Waslni Now.",
  ];
  const message = brandedMessage(title, lines);
  const existing = db.prepare("SELECT id,delivery_status FROM notifications WHERE recipient_phone=? AND recipient_role='captain' AND event='captain.wallet.negative' AND title=? AND message=? LIMIT 1").get(phoneWithCountry(captain.phone), title, message);
  if (existing) return { status: existing.delivery_status, duplicate: true, notificationId: existing.id };
  const row = db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,created_at) VALUES(?,'captain','captain.wallet.negative',?,?,'pending',?)").run(phoneWithCountry(captain.phone), title, message, now());
  let deliveryStatus = "failed";
  let messageId = null;
  try {
    const recipient = await resolveWhatsAppRecipientId(captain.phone);
    const sent = recipient ? await withTimeout(client.sendMessage(recipient, message), 30000, null) : null;
    if (sent) {
      deliveryStatus = "sent";
      messageId = sent.id?._serialized || null;
    }
  } catch (_) {}
  db.prepare("UPDATE notifications SET delivery_status=?,message_id=? WHERE id=?").run(deliveryStatus, messageId, row.lastInsertRowid);
  audit("captain.wallet.negative_notified", "user", captain.id, { balanceCents: Number(balanceCents), reference: safeReference, deliveryStatus });
  return { status: deliveryStatus, notificationId: row.lastInsertRowid };
}
function notifyCaptainCreditSent({ captain, valueCents, cardId = null }) {
  if (!captain?.phone) return;
  const key = cardId ? `CAPTAIN-WALLET-CARD-SENT-${cardId}` : `CAPTAIN-WALLET-CREDIT-SENT-${phoneWithCountry(captain.phone)}-${Date.now()}`;
  void sendCaptainStatusText({
    phone: captain.phone,
    event: "captain.wallet.credit_sent",
    title: "إرسال بطاقة الرصيد",
    text: "تم إرسال بطاقة الرصيد إلى واتسابك.",
    idempotencyKey: key,
  });
  void notifyOperations({ event: "captain.wallet.credit_sent", title: "تم إرسال الرصيد", captainPhone: captain.phone, lines: [`الكابتن: ${captain.name}`, `القيمة: ${money(valueCents)} JOD`, "تم إرسال بطاقة الرصيد."], ownersOnly: true });
}
async function notifyCaptainCreditRedeemed({ captain, valueCents, balanceCents, cardId }) {
  if (!captain?.phone || !cardId) return { status: "skipped" };
  return sendCaptainStatusText({
    phone: captain.phone,
    event: "captain.wallet.credit_redeemed",
    title: "استلام بطاقة الرصيد",
    text: "تم استلام البطاقة وإضافة الرصيد لمحفظتك.",
    idempotencyKey: `CAPTAIN-WALLET-CARD-REDEEMED-${cardId}`,
  });
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
    return;
  }
  const text = normalizeCustomerText(body);
  if (/^(الغاء|إلغاء|cancel)$/.test(text)) {
    updateCustomerLead(lead, { state: "cancelled", last_message_id: msg.id && msg.id._serialized, last_text: body });
    return;
  }
  if (lead.state === "cancelled" || lead.state === "completed") {
    lead = updateCustomerLead(lead, { state: "awaiting_direction", direction: null, travel_mode: null, travel_date: null, travelers_count: null, last_message_id: msg.id && msg.id._serialized, last_text: body });
  }
  if (lead.state === "awaiting_direction") {
    const direction = customerDirection(text);
    if (!direction) return;
    updateCustomerLead(lead, { direction, state: "awaiting_mode", last_message_id: msg.id && msg.id._serialized, last_text: body });
    return;
  }
  if (lead.state === "awaiting_mode") {
    const mode = customerMode(text);
    if (!mode) return;
    updateCustomerLead(lead, { travel_mode: mode, state: "awaiting_date", last_message_id: msg.id && msg.id._serialized, last_text: body });
    return;
  }
  if (lead.state === "awaiting_date") {
    updateCustomerLead(lead, { travel_date: body, state: "awaiting_passengers", last_message_id: msg.id && msg.id._serialized, last_text: body });
    return;
  }
  if (lead.state === "awaiting_passengers") {
    const count = Number((body.match(/\d+/) || [""])[0]);
    if (!Number.isInteger(count) || count < 1 || count > 50) return;
    lead = updateCustomerLead(lead, { travelers_count: count, state: "completed", last_message_id: msg.id && msg.id._serialized, last_text: body });
    audit("customer.lead.completed", "customer_lead", lead.id, { phone, direction: lead.direction, travelMode: lead.travel_mode, travelersCount: count });
  }
}
function ensureBlockedPhones() {
  const insert = db.prepare("INSERT OR IGNORE INTO blocked_phones(phone,note,created_at) VALUES(?,?,?)");
  for (const value of BLOCKED_PHONES) insert.run(phoneWithCountry(value), "مستبعد نهائيًا من القروب والنظام", now());
}
function sanitizeLegacyPhone() {
  const legacyPhone = phoneWithCountry("0775969880");
  const stamp = now();
  db.transaction(() => {
    db.prepare("UPDATE users SET active=0, is_bot=0, updated_at=? WHERE phone=? AND phone<>?").run(stamp, legacyPhone, phoneWithCountry(BOT_PHONE));
    db.prepare("UPDATE captain_invites SET status='cancelled' WHERE phone=? AND status IN ('issued','pending')").run(legacyPhone);
  })();
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
  // Every human subscriber is a captain. Only the internal company and bot
  // identities and the protected owner retain their operational roles.
  const legacyHumanProducers = db.prepare("SELECT id,phone,active FROM users WHERE is_bot=0 AND role='producer'").all();
  const promote = db.prepare("UPDATE users SET role='captain',account_status=CASE WHEN active=1 THEN 'active' ELSE 'suspended' END,updated_at=? WHERE id=?");
  for (const user of legacyHumanProducers) {
    if (!isProtectedOwnerIdentity(user.phone)) promote.run(stamp, user.id);
  }
  const company = db.prepare("SELECT id FROM users WHERE role='company' ORDER BY id LIMIT 1").get();
  if (!company) db.prepare("INSERT INTO users(phone,name,role,created_at,updated_at) VALUES(?,?,?,?,?)").run("system-company", COMPANY_BRAND_NAME, "company", stamp, stamp);
  const companyAccount = db.prepare("SELECT id FROM users WHERE role='company' ORDER BY id LIMIT 1").get();
  if (companyAccount) {
    db.prepare("UPDATE users SET name=?,updated_at=? WHERE id=?").run(COMPANY_BRAND_NAME, stamp, companyAccount.id);
    db.prepare("UPDATE orders SET producer_name_snapshot=?,updated_at=? WHERE producer_user_id=?").run(COMPANY_BRAND_NAME, stamp, companyAccount.id);
    db.prepare("UPDATE order_candidates SET producer_name_snapshot=?,updated_at=? WHERE producer_user_id=?").run(COMPANY_BRAND_NAME, stamp, companyAccount.id);
    db.prepare("UPDATE users SET wallet_cents=COALESCE(wallet_cents,0) WHERE role IN ('company','captain','producer')").run();
    db.prepare("UPDATE order_settlements SET charged_user_id=CASE WHEN captain_user_id IN (SELECT id FROM users WHERE is_bot=1) THEN ? ELSE captain_user_id END WHERE charged_user_id IS NULL").run(companyAccount.id);
  }
  // Normalize legacy deployments that still contain the former 15% settings.
  setSetting("company_rate_bps", COMPANY_RATE_BPS);
  setSetting("producer_rate_bps", PRODUCER_RATE_BPS);
  setSetting("special_order_rate_bps", SPECIAL_ORDER_RATE_BPS);
  setSetting("company_from_producer_rate_bps", COMPANY_FROM_PRODUCER_RATE_BPS);
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
  for (const row of ownerRows) update.run(`${COMPANY_BRAND_NAME} — مالك القروب والبوت`, stamp, row.id);
  const ownerIds = ownerRows.map((row) => row.id);
  if (ownerIds.length) db.prepare(`UPDATE users SET is_bot=0 WHERE id NOT IN (${ownerIds.map(() => "?").join(",")}) AND is_bot=1`).run(...ownerIds);
  return ownerRows.length;
}
ensureBlockedPhones();
sanitizeLegacyPhone();
ensureSystemUsers();

function isBotPhone(phone) {
  const normalized = phoneWithCountry(phone);
  return normalized === phoneWithCountry(BOT_PHONE) || normalized === phoneWithCountry(BOT_PHONE_INTL);
}
function botEmployeeUser() {
  const existing = db.prepare("SELECT * FROM users WHERE is_bot=1 LIMIT 1").get();
  if (existing) return existing;
  const stamp = now();
  const result = db.prepare("INSERT INTO users(phone,name,role,wallet_cents,active,is_bot,created_at,updated_at) VALUES(?,?,?,0,1,1,?,?)").run(phoneWithCountry(BOT_PHONE), `منتج موظف — بوت ${COMPANY_BRAND_NAME}`, "producer", stamp, stamp);
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
function companyWalletSummary() {
  const company = companyUser();
  if (!company) return null;
  const bot = db.prepare("SELECT id,phone,name FROM users WHERE is_bot=1 ORDER BY id LIMIT 1").get() || null;
  const credited = db.prepare("SELECT COALESCE(SUM(CASE WHEN amount_cents>0 THEN amount_cents ELSE 0 END),0) AS cents, COUNT(CASE WHEN amount_cents>0 THEN 1 END) AS entries FROM wallet_ledger WHERE user_id=?").get(company.id);
  const debited = db.prepare("SELECT COALESCE(SUM(CASE WHEN amount_cents<0 THEN -amount_cents ELSE 0 END),0) AS cents, COUNT(CASE WHEN amount_cents<0 THEN 1 END) AS entries FROM wallet_ledger WHERE user_id=?").get(company.id);
  const settlements = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(company_cents),0) AS company_cents, COALESCE(SUM(CASE WHEN charged_user_id=? THEN captain_fee_cents ELSE 0 END),0) AS bot_debits_cents FROM order_settlements WHERE status='applied'").get(company.id);
  const recentLedger = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 50").all(company.id).map((entry) => ({ ...entry, amount: money(entry.amount_cents), balanceAfter: money(entry.balance_after_cents) }));
  return {
    id: company.id,
    name: company.name,
    role: company.role,
    walletType: "company_internal",
    balance: money(company.wallet_cents),
    balanceCents: Number(company.wallet_cents || 0),
    operationalBotPhone: displayPhone(BOT_PHONE_INTL || BOT_PHONE),
    operationalBotUserId: bot ? bot.id : null,
    operationalBotName: bot ? bot.name : "هوية البوت التشغيلية",
    credited: money(credited.cents),
    debited: money(debited.cents),
    creditEntries: Number(credited.entries || 0),
    debitEntries: Number(debited.entries || 0),
    appliedSettlements: Number(settlements.count || 0),
    companyShareFromSettlements: money(settlements.company_cents),
    botWalletDebits: money(settlements.bot_debits_cents),
    recentLedger,
  };
}
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
function configuredRuntimeGroupId() {
  const candidates = [
    getSetting("active_group_id", getSetting("group_id", "")),
    WHATSAPP_GROUP_ID,
    db.prepare("SELECT group_id FROM groups_config WHERE active=1 ORDER BY updated_at DESC LIMIT 1").get()?.group_id,
  ];
  return candidates.map((value) => String(value || "").trim()).find((value) => value && isConfiguredGroup(value)) || "";
}
function findActiveRegisteredUser(phone) {
  const normalized = phoneWithCountry(phone);
  if (!normalized) return null;
  return db.prepare("SELECT * FROM users WHERE phone=? AND active=1 AND account_status='active' LIMIT 1").get(normalized)
    || findCaptainByPhone(normalized, { activeOnly: true })
    || db.prepare("SELECT * FROM users WHERE phone=? AND active=1 AND account_status='active' LIMIT 1").get(String(phone || "").trim());
}
function ensureProducerUser(phone, name) {
  return ensureCaptainUser(phone, name);
}
function ensureCaptainUser(phone, name) {
  const normalized = phoneWithCountry(phone);
  if (!normalized) return null;
  if (!isValidJordanPhone(normalized) || isBlockedPhone(normalized)) return null;
  const existing = findCaptainByPhone(normalized, { activeOnly: true }) || findActiveRegisteredUser(normalized);
  if (existing && (existing.role === "company" || existing.is_bot === 1)) return null;
  if (existing && existing.role !== "company" && existing.is_bot !== 1) return existing;
  const stamp = now();
  const displayName = captainDisplayName(name).slice(0, 100);
  const temporaryPin = createCaptainPin();
  try {
    const result = db.prepare("INSERT INTO users(phone,name,role,wallet_cents,active,is_bot,captain_pin_hash,captain_pin_ciphertext,account_status,approved_at,activated_at,captain_auth_method,created_at,updated_at) VALUES(?,?, 'captain',0,1,0,?,?, 'active',?,?, 'pin',?,?)").run(normalized, displayName, bcrypt.hashSync(temporaryPin, 10), cardEncryptionKey ? encryptCardCode(temporaryPin) : null, stamp, stamp, stamp, stamp);
    const captain = db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
    audit("captain.auto_registered_from_approved_group", "user", captain.id, { phone: normalized, source: "approved_group" });
    return captain;
  } catch (error) {
    if (!String(error?.message || error).includes("UNIQUE")) throw error;
    return findCaptainByPhone(normalized, { activeOnly: true }) || findActiveRegisteredUser(normalized);
  }
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
    : db.prepare("SELECT id,phone,name,role,active,captain_auth_method,captain_pin_hash FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
  if (current && captain && captain.temporaryPin) return { ...current, temporaryPin: captain.temporaryPin };
  if (current && normalizeCaptainAuthMethod(current.captain_auth_method) === "whatsapp") return { ...current, temporaryPin: null };
  if (!current || current.captain_pin_hash) return { ...(current || captain), temporaryPin: null };
  const temporaryPin = createCaptainPin();
  db.prepare("UPDATE users SET captain_pin_hash=?,captain_pin_ciphertext=NULL,updated_at=? WHERE id=? AND role='captain'").run(bcrypt.hashSync(temporaryPin, 10), now(), current.id);
  return { ...current, temporaryPin };
}
async function sendCaptainAppLink(captain, baseUrl = process.env.PUBLIC_BASE_URL || "") {
  const prepared = ensureCaptainAccessCredentials(captain);
  const phone = phoneWithCountry(prepared && prepared.phone);
  if (!isValidJordanPhone(phone)) return false;
  const whatsappAuth = normalizeCaptainAuthMethod(prepared.captain_auth_method) === "whatsapp";
  const lines = [
    `الكابتن: ${prepared.name || "حساب الكابتن"}`,
    "تم تسجيلك لدينا ككابتن، وحسابك جاهز للدخول.",
    `رابط الدخول المباشر: ${captainLoginUrl(baseUrl)}`,
    "الخطوة 1: افتح رابط الدخول المباشر المرفق.",
    whatsappAuth ? "الخطوة 2: اختر WhatsApp واطلب رمز التحقق على رقمك." : "الخطوة 2: أدخل رقم هاتفك والرقم السري.",
    "الخطوة 3: اضغط «دخول البوابة» للوصول إلى حسابك.",
    whatsappAuth ? "رمز WhatsApp صالح لمدة 10 دقائق ويُرسل عند الطلب." : (prepared.temporaryPin ? `الرقم السري المؤقت: ${prepared.temporaryPin}` : "الرقم السري محفوظ في النظام."),
    "لا تستخدم رابطًا آخر ولا تشارك رمز الدخول مع أي شخص."
  ];
  const cardResult = await sendCompanyOperationsCard(`${phone}@c.us`, "تم تجهيز دخول الكابتن", lines, { returnMessage: true }).catch(() => ({ sent: false, messageId: null }));
  const sent = Boolean(cardResult && cardResult.sent);
  if (sent) {
    const cardMessageId = cardResult.messageId || null;
    const statusNotice = await sendCaptainStatusText({
      phone,
      event: "captain.access_card.sent",
      title: "إرسال بطاقة الدخول",
      text: "تم إرسال بطاقة دخولك إلى واتساب.",
      idempotencyKey: `CAPTAIN-ACCESS-SENT-${prepared.id || phone}-${cardMessageId || Date.now()}`,
      sourceMessageId: cardMessageId,
    });
    void notifyOperations({ event: "captain.access_card.sent", title: "تأكيد بطاقة دخول كابتن", lines: [`الكابتن: ${prepared.name || "حساب الكابتن"}`, `رقم الهاتف: ${prepared.phone}`, `حالة الإشعار النصي: ${statusNotice.status}`], ownersOnly: true });
    const earlyAck = cardMessageId ? captainAccessCardAckCache.get(cardMessageId) : null;
    if (earlyAck) void handleCaptainAccessCardAck(cardMessageId, earlyAck.ack);
  }
  return sent;
}
function groupParticipantPhone(participant) {
  const raw = participant && participant.id ? (participant.id.user || participant.id._serialized || participant.id) : participant;
  return phoneWithCountry(String(raw || "").replace(/@c\.us$/, "").split(":")[0]);
}
function isProtectedOwnerIdentity(phone) {
  const normalized = phoneWithCountry(phone);
  return Boolean(normalized && (isBotPhone(normalized) || GROUP_SETUP_OWNER_PHONES.has(normalized)));
}
async function resolveGroupParticipantPhone(participant) {
  const rawId = participant?.id || participant;
  const direct = directJordanPhoneFromWhatsappValue(rawId) || (isValidJordanPhone(groupParticipantPhone(participant)) ? groupParticipantPhone(participant) : "");
  if (direct) return direct;
  const serialized = serializedWhatsappUserId(rawId);
  const contact = serialized && client && isReady
    ? await withTimeout(client.getContactById(serialized), 8000, null)
    : null;
  return resolveWhatsappUserPhone(contact, contact?.id, contact?._data?.id, contact?.number, serialized);
}
function activateHumanCaptainAccount({ phone, name, reactivate = false }) {
  const normalized = phoneWithCountry(phone);
  if (!isValidJordanPhone(normalized) || isBlockedPhone(normalized)) return { status: "skipped_invalid_or_blocked", phone: normalized || String(phone || "") };
  if (isProtectedOwnerIdentity(normalized)) return { status: "skipped_owner", phone: normalized };
  const stamp = now();
  const displayName = captainDisplayName(name).slice(0, 100);
  const existing = db.prepare("SELECT * FROM users WHERE phone=? LIMIT 1").get(normalized) || findCaptainByPhone(normalized);
  if (existing && (existing.is_bot === 1 || existing.role === "company")) return { status: "skipped_system", phone: normalized, userId: existing.id };
  if (existing) {
    if (existing.account_status === "merged") return { status: "skipped_merged", phone: normalized, userId: existing.id };
    if (!reactivate && (existing.active !== 1 || existing.account_status === "suspended")) return { status: "skipped_suspended", phone: normalized, userId: existing.id };
    const resolvedName = existing.name && !/^\+?\d+$/.test(String(existing.name).trim()) ? existing.name : displayName;
    db.prepare("UPDATE users SET name=?,role='captain',active=1,is_bot=0,account_status='active',captain_auth_method=COALESCE(NULLIF(captain_auth_method,''),'whatsapp'),approved_at=COALESCE(approved_at,?),activated_at=COALESCE(activated_at,?),updated_at=? WHERE id=?")
      .run(resolvedName, stamp, stamp, stamp, existing.id);
    return { status: existing.role === "captain" && existing.active === 1 && existing.account_status === "active" ? "existing_captain" : "activated_captain", phone: normalized, userId: existing.id, name: resolvedName };
  }
  const result = db.prepare("INSERT INTO users(phone,name,registration_name,role,wallet_cents,active,is_bot,captain_pin_hash,captain_pin_ciphertext,captain_auth_method,account_status,approved_at,activated_at,created_at,updated_at) VALUES(?,?,?, 'captain',0,1,0,NULL,NULL,'whatsapp','active',?,?,?,?)")
    .run(normalized, displayName, displayName, stamp, stamp, stamp, stamp);
  return { status: "registered", phone: normalized, userId: result.lastInsertRowid, name: displayName };
}
const REQUESTED_CAPTAIN_NAME = "محمود الجراح";
const REQUESTED_CAPTAIN_ACTIVATION_VERSION = "activate-mahmoud-aljarrah-captain-v1";
function activateRequestedCaptain() {
  if (getSetting("requested_captain_activation_version", "") === REQUESTED_CAPTAIN_ACTIVATION_VERSION) return { status: "already_completed" };
  const existing = db.prepare("SELECT phone,name FROM users WHERE name=? AND is_bot=0 AND role<>'company' ORDER BY id LIMIT 1").get(REQUESTED_CAPTAIN_NAME);
  if (!existing) return { status: "not_found", name: REQUESTED_CAPTAIN_NAME };
  const result = activateHumanCaptainAccount({ phone: existing.phone, name: existing.name, reactivate: true });
  if (["registered", "activated_captain", "existing_captain"].includes(result.status)) {
    setSetting("requested_captain_activation_version", REQUESTED_CAPTAIN_ACTIVATION_VERSION);
    audit("captain.requested_account_activated", "user", result.userId, { name: REQUESTED_CAPTAIN_NAME });
  }
  console.log(`[CaptainActivation] ${REQUESTED_CAPTAIN_NAME}: ${result.status}`);
  return result;
}
activateRequestedCaptain();
function normalizeExistingHumanUsersAsCaptains({ reactivate = false } = {}) {
  const rows = db.prepare("SELECT id,phone,name,role,active,account_status,is_bot FROM users WHERE is_bot=0 AND role<>'company' ORDER BY id").all();
  const results = rows.map((row) => activateHumanCaptainAccount({ phone: row.phone, name: row.name, reactivate }));
  return {
    total: rows.length,
    captains: results.filter((item) => ["registered", "activated_captain", "existing_captain"].includes(item.status)).length,
    activated: results.filter((item) => item.status === "activated_captain").length,
    skippedOwners: results.filter((item) => item.status === "skipped_owner").length,
    skipped: results.filter((item) => item.status.startsWith("skipped_")).length,
    results,
  };
}
let configuredGroupCaptainSyncTimer = null;
let configuredGroupCaptainSyncInFlight = false;
function scheduleConfiguredGroupCaptainSync(trigger = "group_activity") {
  if (!isReady || !client || configuredGroupCaptainSyncInFlight || configuredGroupCaptainSyncTimer) return;
  configuredGroupCaptainSyncTimer = setTimeout(async () => {
    configuredGroupCaptainSyncTimer = null;
    if (!isReady || !client || configuredGroupCaptainSyncInFlight) return;
    configuredGroupCaptainSyncInFlight = true;
    try {
      const result = await registerGroupMembersAsCaptains({ sendLinks: false, reactivate: true });
      const activated = (result.results || []).filter((item) => ["registered", "activated_captain"].includes(item.status));
      if (activated.length) {
        audit("captains.auto_activated_from_group", "group", result.groupId, { trigger, activated: activated.map((item) => ({ captainId: item.captainId, phone: item.phone })) });
        console.log(`[Captains] auto activation from configured group: trigger=${trigger} activated=${activated.length}`);
      }
    } catch (error) {
      console.error(`[Captains] auto activation failed (${trigger}):`, error.message);
    } finally {
      configuredGroupCaptainSyncInFlight = false;
    }
  }, 1500);
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
async function fetchGroupHistory(groupId, limit, { includeOutgoing = false } = {}) {
  let chat = await resolveReadableGroupChat(groupId);
  if (!chat) chat = await resolveGroupChat(groupId);
  if (chat) {
    const messages = await withTimeout(chat.fetchMessages(includeOutgoing ? { limit } : { limit, fromMe: false }), 90000, []);
    return { chat, messages: Array.isArray(messages) ? messages : [] };
  }
  if (!client?.pupPage) return { chat: null, messages: [] };
  const messages = await withTimeout(client.pupPage.evaluate(async (requestedId, requestedLimit, includeOutgoingMessages) => {
    try {
      const wid = window.require("WAWebWidFactory").createWid(requestedId);
      const collections = window.require("WAWebCollections");
      const chat = collections.Chat.get(wid) || (await window.require("WAWebFindChatAction").findOrCreateLatestChat(wid))?.chat;
      if (!chat?.msgs?.getModelsArray) return { chat: null, messages: [] };
      const filter = (message) => !message.isNotification && (includeOutgoingMessages || !message.id?.fromMe);
      let models = chat.msgs.getModelsArray().filter(filter);
      let loader = null;
      try { loader = window.require("WAWebChatLoadMessages"); } catch (_) { loader = null; }
      while (models.length < requestedLimit && loader?.loadEarlierMsgs) {
        const earlier = await loader.loadEarlierMsgs({ chat });
        if (!earlier?.length) break;
        models = [...earlier.filter(filter), ...models];
      }
      models.sort((a, b) => Number(a.t || 0) - Number(b.t || 0));
      models = models.slice(-requestedLimit);
      const serialize = async (message) => {
        const model = window.WWebJS?.getMessageModel ? window.WWebJS.getMessageModel(message) : message.serialize();
        model.__serializedId = message.id?._serialized || (typeof message.id?.toString === "function" ? message.id.toString() : null);
        model.__timestamp = Number(message.t || model.timestamp || 0) || null;
        model.fromMe = Boolean(message.id?.fromMe);
        model.__caption = String(message.caption || message.text || model.caption || "");
        try {
          const { toPn } = window.require("WAWebLidMigrationUtils");
          const authorId = message.author || message.id?.participant || null;
          const phoneId = authorId && toPn ? (toPn(authorId) || authorId) : authorId;
          model.__authorPhone = phoneId?.user ? String(phoneId.user) : String(phoneId?._serialized || "").split("@")[0].split(":")[0];
        } catch (_) { model.__authorPhone = null; }
        try {
          const quoted = window.require("WAWebQuotedMsgModelUtils").getQuotedMsgObj(message);
          if (quoted) {
            model.__quoted = window.WWebJS?.getMessageModel ? window.WWebJS.getMessageModel(quoted) : quoted.serialize();
            model.__quoted.__serializedId = quoted.id?._serialized || (typeof quoted.id?.toString === "function" ? quoted.id.toString() : null);
            model.__quoted.__timestamp = Number(quoted.t || model.__quoted.timestamp || 0) || null;
          }
        } catch (_) { model.__quoted = null; }
        try {
          const reactionCollection = await collections.Reactions.find(model.__serializedId);
          const directReactions = message.reactions?.serialize ? message.reactions.serialize() : (Array.isArray(message.reactions) ? message.reactions : []);
          const reactionRows = reactionCollection?.reactions?.serialize ? reactionCollection.reactions.serialize() : directReactions;
          const { toPn } = window.require("WAWebLidMigrationUtils");
          model.__hasReaction = Boolean(message.hasReaction || model.hasReaction || reactionRows.length);
          model.__reactions = (Array.isArray(reactionRows) ? reactionRows : []).map((reaction) => ({
            ...reaction,
            senders: (Array.isArray(reaction.senders) ? reaction.senders : []).map((sender) => {
              const senderId = sender.senderId || sender.id;
              const phoneId = senderId && toPn ? (toPn(senderId) || senderId) : senderId;
              return { ...sender, __senderPhone: phoneId?.user ? String(phoneId.user) : String(phoneId?._serialized || "").split("@")[0].split(":")[0] };
            }),
          }));
        } catch (_) { model.__reactions = []; model.__hasReaction = Boolean(message.hasReaction || model.hasReaction); }
        return model;
      };
      return { chat: { id: requestedId, isGroup: true }, messages: await Promise.all(models.map(serialize)) };
    } catch (error) {
      return { chat: null, messages: [], error: String(error?.message || error) };
    }
  }, groupId, limit, includeOutgoing), 20000, { chat: null, messages: [] });
  return messages;
}
async function fetchGroupOrderScanBatch(groupId, { before = 0, cutoff, batch = 25, includeOutgoing = false } = {}) {
  if (!client || !groupId) return { chat: null, messages: [], nextCursor: null, exhausted: true };
  const chat = await resolveReadableGroupChat(groupId);
  if (chat) {
    const messages = await withTimeout(chat.fetchMessages({ limit: Math.min(batch, 10), ...(includeOutgoing ? {} : { fromMe: false }) }), 8000, []);
      const rows = (Array.isArray(messages) ? messages : []).map((message) => ({
        id: serializedMessageId(message),
        timestamp: Number(message?.timestamp || 0) || null,
        from: message?.from || groupId,
        to: message?.to || null,
        fromMe: Boolean(message?.fromMe),
        author: message?.author || null,
        hasQuotedMsg: Boolean(message?.hasQuotedMsg),
        quotedMessageId: String(message?.quotedStanzaID || message?.quotedMessageId || message?._data?.quotedStanzaID || message?._data?.quotedMessageId || message?._data?.quotedMsgId || "").trim() || null,
        body: String(message?.body || "").trim(),
        type: message?.type || null,
      })).filter((message) => message.timestamp && message.timestamp * 1000 >= Number(cutoff || 0) && (!before || message.timestamp < before));
    rows.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    const selected = rows.slice(0, Math.min(batch, 10));
    const oldest = selected.length ? Number(selected[selected.length - 1].timestamp || 0) : 0;
    return { chat, messages: selected, nextCursor: selected.length === Math.min(batch, 10) && oldest ? oldest : null, exhausted: selected.length < Math.min(batch, 10), source: "chat.fetchMessages" };
  }
  if (!client.pupPage) return { chat: null, messages: [], nextCursor: null, exhausted: true };
  const result = await withTimeout(client.pupPage.evaluate(async (requestedId, options) => {
    try {
      const wid = window.require("WAWebWidFactory").createWid(requestedId);
      const collections = window.require("WAWebCollections");
      const chat = collections.Chat.get(wid) || (await window.require("WAWebFindChatAction").findOrCreateLatestChat(wid))?.chat;
      if (!chat?.msgs?.getModelsArray) return { chat: null, messages: [], nextCursor: null, exhausted: true };
      const includeOutgoingMessages = Boolean(options.includeOutgoing);
      const beforeTs = Number(options.before || 0);
      const cutoffTs = Number(options.cutoff || 0);
      const batchSize = Math.max(1, Math.min(Number(options.batch || 25), 50));
      const filter = (message) => !message.isNotification && (includeOutgoingMessages || !message.id?.fromMe);
      let models = chat.msgs.getModelsArray().filter(filter);
      let loader = null;
      try { loader = window.require("WAWebChatLoadMessages"); } catch (_) { loader = null; }
      let loads = 0;
      const eligible = () => models.filter((message) => {
        const timestamp = Number(message.t || 0);
        return timestamp > 0 && timestamp * 1000 >= cutoffTs && (!beforeTs || timestamp < beforeTs);
      });
      while (loader?.loadEarlierMsgs && loads < 1 && (eligible().length < batchSize || !models.some((message) => Number(message.t || 0) * 1000 < cutoffTs))) {
        const earlier = await loader.loadEarlierMsgs({ chat });
        loads += 1;
        if (!earlier?.length) break;
        models = [...earlier.filter(filter), ...models];
      }
      models.sort((a, b) => Number(b.t || 0) - Number(a.t || 0));
      const selected = models.filter((message) => {
        const timestamp = Number(message.t || 0);
        return timestamp > 0 && timestamp * 1000 >= cutoffTs && (!beforeTs || timestamp < beforeTs);
      }).slice(0, batchSize);
      const messages = selected.map((message) => ({
        id: message.id?._serialized || String(message.id || ""),
        timestamp: Number(message.t || 0) || null,
        from: message.from?._serialized || String(message.from || requestedId),
        to: message.to?._serialized || String(message.to || ""),
        fromMe: Boolean(message.id?.fromMe),
        author: message.author?._serialized || String(message.author || ""),
        hasQuotedMsg: Boolean(message.hasQuotedMsg || message.quotedStanzaID || message.quotedMessageId),
        quotedMessageId: String(message.quotedStanzaID || message.quotedMessageId || message._data?.quotedStanzaID || message._data?.quotedMessageId || message._data?.quotedMsgId || "").trim() || null,
        body: String(message.body || message.text || message.caption || "").trim(),
        type: message.type || null,
      }));
      const oldest = messages.length ? Number(messages[messages.length - 1].timestamp || 0) : 0;
      const hasOlder = models.some((message) => Number(message.t || 0) * 1000 >= cutoffTs && (!beforeTs || Number(message.t || 0) < beforeTs) && Number(message.t || 0) < oldest);
      return { chat: { id: requestedId, isGroup: true }, messages, nextCursor: hasOlder && oldest ? oldest : null, exhausted: !hasOlder };
    } catch (error) {
      return { chat: null, messages: [], nextCursor: null, exhausted: true, error: String(error?.message || error) };
    }
  }, groupId, { before, cutoff, batch, includeOutgoing }), 9000, { chat: null, messages: [], nextCursor: null, exhausted: true, timedOut: true });
  return result || { chat: null, messages: [], nextCursor: null, exhausted: true };
}
async function fetchExactGroupEvidenceMessages(groupId, sourceMessageId, acceptanceMessageId) {
  if (!client) return [];
  const ids = [...new Set([sourceMessageId, acceptanceMessageId].map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const linkSourceToAcceptance = (rows) => {
    const filtered = (Array.isArray(rows) ? rows : []).filter((message) => message && resolveGroupChatId(message) === groupId);
    const source = filtered.find((message) => serializedMessageId(message) === sourceMessageId) || filtered.find((message) => message.fromMe && parseOrder(message.body).isOrder);
    const acceptance = filtered.find((message) => serializedMessageId(message) === acceptanceMessageId);
    if (source && acceptance) {
      acceptance.__quoted = source;
      acceptance.__quotedMessageId = sourceMessageId;
    }
    return filtered;
  };
  const logged = db.prepare("SELECT message_id,group_id,sender_phone,sender_name,body,sent_at FROM messages WHERE message_id IN (?,?) AND group_id=?").all(sourceMessageId, acceptanceMessageId, groupId);
  const loggedById = new Map(logged.map((row) => [row.message_id, row]));
  if (loggedById.has(sourceMessageId) && loggedById.has(acceptanceMessageId)) {
    const sourceRow = loggedById.get(sourceMessageId);
    const acceptanceRow = loggedById.get(acceptanceMessageId);
    const source = { id: { _serialized: sourceRow.message_id }, __serializedId: sourceRow.message_id, from: groupId, to: groupId, fromMe: sourceRow.message_id.startsWith("true_"), body: sourceRow.body, __authorPhone: sourceRow.sender_phone, timestamp: Math.floor(new Date(sourceRow.sent_at).getTime() / 1000) };
    const acceptance = { id: { _serialized: acceptanceRow.message_id }, __serializedId: acceptanceRow.message_id, from: groupId, fromMe: false, body: acceptanceRow.body, author: { _serialized: `${acceptanceRow.sender_phone || ""}@c.us` }, __authorPhone: acceptanceRow.sender_phone, timestamp: Math.floor(new Date(acceptanceRow.sent_at).getTime() / 1000), __storedRecovery: true };
    const persistedReactionRows = storedReactionEvidence(acceptanceRow.message_id, "👍");
    acceptance.__hasReaction = persistedReactionRows.length > 0;
    acceptance.__reactions = persistedReactionRows.map((row) => ({ aggregateEmoji: row.emoji, reaction: row.emoji, senders: [{ __senderPhone: row.sender_phone || null, senderId: row.sender_id || row.sender_key || null }] }));
    if (client.pupPage) {
      acceptance.__hasReaction = await withTimeout(client.pupPage.evaluate(async (messageId) => {
        try {
          const row = await window.require("WAWebCollections").Reactions.find(messageId);
          return Boolean(row?.reactions?.length);
        } catch (_) { return false; }
      }, acceptanceMessageId), 4000, false);
    }
    acceptance.__quoted = source;
    acceptance.__quotedMessageId = sourceMessageId;
    return [source, acceptance];
  }
  if (client.pupPage) {
    const rows = await withTimeout(client.pupPage.evaluate(async (requestedIds) => {
      try {
        const collections = window.require("WAWebCollections");
        let models = requestedIds.map((id) => collections.Msg.get(id)).filter(Boolean);
        if (models.length < requestedIds.length && collections.Msg.getMessagesById) {
          const loaded = await collections.Msg.getMessagesById(requestedIds);
          models = [...models, ...(Array.isArray(loaded?.messages) ? loaded.messages : [])];
        }
        const unique = new Map();
        for (const message of models) {
          const model = window.WWebJS?.getMessageModel ? window.WWebJS.getMessageModel(message) : message.serialize();
          model.__serializedId = message.id?._serialized || (typeof message.id?.toString === "function" ? message.id.toString() : null);
          model.__timestamp = Number(message.t || model.timestamp || 0) || null;
          model.fromMe = Boolean(message.id?.fromMe);
          model.__caption = String(message.caption || message.text || model.caption || "");
          model.__quotedMessageId = String(message.quotedStanzaID || message.quotedMessageId || model.quotedMessageId || model.quotedStanzaID || "").trim() || null;
          try {
            const { toPn } = window.require("WAWebLidMigrationUtils");
            const authorId = message.author || message.id?.participant || null;
            const phoneId = authorId && toPn ? (toPn(authorId) || authorId) : authorId;
            model.__authorPhone = phoneId?.user ? String(phoneId.user) : String(phoneId?._serialized || "").split("@")[0].split(":")[0];
          } catch (_) { model.__authorPhone = null; }
          try {
            const quoted = window.require("WAWebQuotedMsgModelUtils").getQuotedMsgObj(message);
            if (quoted) {
              model.__quoted = window.WWebJS?.getMessageModel ? window.WWebJS.getMessageModel(quoted) : quoted.serialize();
              model.__quoted.__serializedId = quoted.id?._serialized || null;
              model.__quoted.__timestamp = Number(quoted.t || model.__quoted.timestamp || 0) || null;
            }
          } catch (_) { model.__quoted = null; }
          try {
            const reactionCollection = await collections.Reactions.find(model.__serializedId);
            const directReactions = message.reactions?.serialize ? message.reactions.serialize() : (Array.isArray(message.reactions) ? message.reactions : []);
            const reactionRows = reactionCollection?.reactions?.serialize ? reactionCollection.reactions.serialize() : directReactions;
            model.__hasReaction = Boolean(message.hasReaction || model.hasReaction || reactionRows.length);
            model.__reactions = Array.isArray(reactionRows) ? reactionRows : [];
          } catch (_) { model.__reactions = []; model.__hasReaction = Boolean(message.hasReaction || model.hasReaction); }
          if (model.__serializedId) unique.set(model.__serializedId, model);
        }
        return [...unique.values()];
      } catch (_) {
        return [];
      }
    }, ids), 15000, []);
    if (Array.isArray(rows) && rows.length) return linkSourceToAcceptance(rows);
  }
  const history = await fetchGroupHistory(groupId, 200, { includeOutgoing: true });
  return linkSourceToAcceptance(history.messages);
}
function createCaptainPin() {
  return String(crypto.randomInt(10000, 100000));
}
async function registerGroupMembersAsCaptains({ groupId = getSetting("group_id", null), sendLinks = false, baseUrl = process.env.PUBLIC_BASE_URL || "", inviteCode = "", reactivate = false } = {}) {
  if (!groupId || !isConfiguredGroup(groupId)) return { status: "group_not_configured", groupId: groupId || null, results: [] };
  if (!client || !isReady) return { status: "bot_not_ready", groupId, results: [] };
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId, inviteCode);
  if (!chat || !Array.isArray(chat.participants)) return { status: "group_unavailable", groupId, results: [] };
  const results = [];
  const resolvedParticipants = new Map();
  for (const participant of chat.participants) {
    const phone = await resolveGroupParticipantPhone(participant);
    if (!phone) {
      results.push({ phone: null, status: "skipped_unresolved_identity" });
      continue;
    }
    if (!resolvedParticipants.has(phone)) resolvedParticipants.set(phone, participant);
  }
  for (const [phone, participant] of resolvedParticipants) {
    if (isProtectedOwnerIdentity(phone)) {
      results.push({ phone, status: "skipped_owner" });
      continue;
    }
    const participantId = serializedWhatsappUserId(participant?.id);
    const contact = await withTimeout(client.getContactById(participantId || `${phone}@c.us`), 8000, null)
      || await withTimeout(client.getContactById(`${phone}@c.us`), 8000, null);
    const contactName = String(contact && (contact.pushname || contact.name || contact.shortName) || "").trim();
    const name = captainDisplayName(contactName).slice(0, 100);
    const normalized = activateHumanCaptainAccount({ phone, name, reactivate });
    const captain = normalized.userId ? db.prepare("SELECT * FROM users WHERE id=? AND role='captain'").get(normalized.userId) : null;
    if (normalized.status === "registered") audit("captain.registered_from_group", "user", normalized.userId, { phone, groupId });
    else if (normalized.status === "activated_captain") audit("captain.activated_from_group", "user", normalized.userId, { phone, groupId });
    const notified = sendLinks && captain ? await sendCaptainAppLink(captain, baseUrl) : false;
    results.push({ captainId: captain?.id || null, phone, name: captain?.name || name, status: normalized.status, notified, temporaryPinSent: false });
  }
  return { status: "completed", groupId, totalMembers: chat.participants.length, resolvedMembers: resolvedParticipants.size, results };
}
async function syncRegisteredCaptainNamesFromConfiguredGroup() {
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return { status: "group_not_configured", updated: [], skipped: [] };
  if (!client || !isReady) return { status: "bot_not_ready", updated: [], skipped: [] };
  const chat = await readGroupSnapshot(groupId);
  if (!chat || !Array.isArray(chat.participants)) return { status: "group_unavailable", updated: [], skipped: [] };
  const participants = new Map();
  for (const participant of chat.participants) {
    const phone = await resolveGroupParticipantPhone(participant);
    if (phone && !participants.has(phone)) participants.set(phone, participant);
  }
  const captains = db.prepare("SELECT id,phone,name FROM users WHERE role='captain' AND is_bot=0 AND account_status<>'merged'").all();
  const updated = [];
  const skipped = [];
  for (const captain of captains) {
    const phone = phoneWithCountry(captain.phone);
    const participant = participants.get(phone);
    if (!participant) {
      skipped.push({ id: captain.id, phone, reason: "not_in_configured_group" });
      continue;
    }
    const participantId = serializedWhatsappUserId(participant?.id);
    const contact = await withTimeout(client.getContactById(participantId || `${phone}@c.us`), 8000, null)
      || await withTimeout(client.getContactById(`${phone}@c.us`), 8000, null);
    const rawName = String(contact && (contact.pushname || contact.name || contact.shortName) || "").trim();
    const displayName = captainDisplayName(rawName).slice(0, 100);
    if (!rawName || displayName === "كابتن بدون اسم") {
      skipped.push({ id: captain.id, phone, reason: "whatsapp_name_unavailable" });
      continue;
    }
    if (captain.name === displayName) {
      skipped.push({ id: captain.id, phone, reason: "already_current", name: displayName });
      continue;
    }
    db.prepare("UPDATE users SET name=?,updated_at=? WHERE id=? AND role='captain'").run(displayName, now(), captain.id);
    updated.push({ id: captain.id, phone, previousName: captain.name, name: displayName });
  }
  return { status: "completed", groupId, totalRegistered: captains.length, updated, skipped };
}
const CAPTAIN_NORMALIZATION_VERSION = "all-group-members-captains-v1";
let captainNormalizationInFlight = false;
function reconcileCaptainLinksWithoutSettlement() {
  const rows = db.prepare("SELECT * FROM orders WHERE captain_phone_snapshot IS NOT NULL AND (captain_user_id IS NULL OR settlement_state='unlinked') ORDER BY id").all();
  const linked = [];
  const skipped = [];
  for (const order of rows) {
    const captain = findCaptainByPhone(order.captain_phone_snapshot, { activeOnly: true });
    if (!captain) {
      skipped.push({ orderNo: order.order_no, reason: "captain_not_registered" });
      continue;
    }
    db.prepare("UPDATE orders SET captain_user_id=?,captain_phone_snapshot=?,captain_name_snapshot=?,settlement_state=CASE WHEN settlement_state='unlinked' THEN 'pending' ELSE settlement_state END,updated_at=? WHERE id=?")
      .run(captain.id, captain.phone, captain.name, now(), order.id);
    linked.push({ orderNo: order.order_no, captainId: captain.id });
  }
  return { linked, skipped };
}
async function normalizeAllCaptains({ force = false, baseUrl = process.env.PUBLIC_BASE_URL || "" } = {}) {
  if (!force && getSetting("captain_normalization_version", "") === CAPTAIN_NORMALIZATION_VERSION) return { status: "already_completed" };
  if (captainNormalizationInFlight) return { status: "already_running" };
  captainNormalizationInFlight = true;
  try {
    const existingUsers = normalizeExistingHumanUsersAsCaptains({ reactivate: true });
    const groupMembers = await registerGroupMembersAsCaptains({ sendLinks: false, reactivate: true, baseUrl });
    if (groupMembers.status !== "completed") throw new Error(`Group captain synchronization did not complete: ${groupMembers.status}`);
    const reconciliation = reconcileCaptainLinksWithoutSettlement();
    const totals = db.prepare(`SELECT
      COUNT(*) AS all_users,
      SUM(CASE WHEN role='captain' AND is_bot=0 AND active=1 AND account_status='active' THEN 1 ELSE 0 END) AS active_captains,
      SUM(CASE WHEN role='company' OR is_bot=1 THEN 1 ELSE 0 END) AS protected_accounts
      FROM users`).get();
    const completedAt = now();
    setSetting("captain_normalization_version", CAPTAIN_NORMALIZATION_VERSION);
    setSetting("captain_normalization_at", completedAt);
    const summary = {
      status: "completed",
      completedAt,
      existingUsers,
      groupMembers,
      reconciliation,
      totals,
    };
    audit("captains.normalized_all_registered_users", "group", getSetting("group_id", null), {
      existingUsers: { total: existingUsers.total, captains: existingUsers.captains, activated: existingUsers.activated, skippedOwners: existingUsers.skippedOwners },
      groupMembers: { totalMembers: groupMembers.totalMembers || 0, resolvedMembers: groupMembers.resolvedMembers || 0, registered: (groupMembers.results || []).filter((item) => item.status === "registered").length, activated: (groupMembers.results || []).filter((item) => item.status === "activated_captain").length },
      reconciliation: { linked: reconciliation.linked.length, skipped: reconciliation.skipped.length, financialSettlementsApplied: 0 },
      totals,
    });
    console.log(`[CaptainNormalize] completed activeCaptains=${totals.active_captains || 0} groupMembers=${groupMembers.totalMembers || 0} resolvedMembers=${groupMembers.resolvedMembers || 0} linkedOrders=${reconciliation.linked.length} skippedOrders=${reconciliation.skipped.length}`);
    return summary;
  } finally {
    captainNormalizationInFlight = false;
  }
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
function adminSendMessageMatches(pending, message, observedAtMs = Date.now()) {
  if (!pending || pending.sendState !== "pending" || !message || message.fromMe !== true) return false;
  const chatIds = [
    message.from,
    message.to,
    message.id?.remote,
    message.id?._data?.remote,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const elapsedMs = observedAtMs - Number(pending.createdAtMs || 0);
  return chatIds.includes(String(pending.chatId || "").trim()) &&
    String(message.body || "").trim() === String(pending.message || "").trim() &&
    elapsedMs >= -5000 && elapsedMs <= Number(pending.observationTimeoutMs || ADMIN_SEND_OBSERVATION_TIMEOUT_MS);
}
function adminSendResponse(state) {
  const sendState = String(state?.sendState || "failed");
  return {
    success: sendState === "confirmed" || sendState === "observed",
    accepted: sendState === "pending",
    sendState,
    operationId: state?.operationId || null,
    messageId: state?.messageId || null,
    confirmationSource: state?.confirmationSource || null,
    order: state?.order ? { candidate: true, status: state.order.status } : null,
    retryAfterMs: sendState === "pending" ? 3000 : null,
    error: state?.error || null,
  };
}
function pruneAdminSendState(atMs = Date.now()) {
  for (const [operationId, state] of pendingAdminSends) {
    if (atMs <= Number(state.observationDeadlineMs || 0)) continue;
    pendingAdminSends.delete(operationId);
    if (state.sendState === "pending") {
      state.sendState = "failed";
      state.error = "لم يصل تأكيد message_create خلال المهلة المحددة";
      state.confirmationSource = null;
      state.updatedAt = new Date(atMs).toISOString();
      audit("message.send_failed_observation_timeout", "chat", state.chatId, { operationId, timeoutMs: state.observationTimeoutMs });
    }
    adminSendResults.set(operationId, state);
  }
  for (const [operationId, state] of adminSendResults) {
    if (atMs > Number(state.expiresAtMs || 0) && !pendingAdminSends.has(operationId)) adminSendResults.delete(operationId);
  }
}
function registerAdminSend({ operationId, chatId, message }) {
  pruneAdminSendState();
  const existing = adminSendResults.get(operationId);
  if (existing) return { state: existing, created: false };
  const createdAtMs = Date.now();
  const state = {
    operationId,
    chatId,
    message,
    createdAtMs,
    observationTimeoutMs: ADMIN_SEND_OBSERVATION_TIMEOUT_MS,
    observationDeadlineMs: createdAtMs + ADMIN_SEND_OBSERVATION_TIMEOUT_MS,
    expiresAtMs: createdAtMs + ADMIN_SEND_RESULT_TTL_MS,
    sendState: "pending",
    messageId: null,
    confirmationSource: null,
    order: null,
    error: null,
    updatedAt: new Date(createdAtMs).toISOString(),
  };
  pendingAdminSends.set(operationId, state);
  adminSendResults.set(operationId, state);
  return { state, created: true };
}
function completeAdminSend({ operationId, chatId, message, sent, confirmationSource = "sendMessage", late = false }) {
  const state = adminSendResults.get(operationId) || pendingAdminSends.get(operationId);
  const messageId = serializedMessageId(sent);
  if (!state || !messageId) return state || null;
  if (state.sendState === "confirmed" || state.sendState === "observed") return state;
  const finalized = finalizeAdminSentMessage({ chatId, message, sent, operationId, late, confirmationSource });
  state.sendState = confirmationSource === "message_create" ? "observed" : "confirmed";
  state.messageId = finalized.messageId;
  state.confirmationSource = confirmationSource;
  state.order = finalized.order;
  state.error = null;
  state.updatedAt = now();
  pendingAdminSends.delete(operationId);
  adminSendResults.set(operationId, state);
  return state;
}
function failAdminSend(operationId, error) {
  const state = adminSendResults.get(operationId) || pendingAdminSends.get(operationId);
  if (!state || state.sendState === "confirmed" || state.sendState === "observed") return state || null;
  state.sendState = "failed";
  state.error = String(error?.message || error || "WhatsApp send failed").slice(0, 240);
  state.updatedAt = now();
  pendingAdminSends.delete(operationId);
  adminSendResults.set(operationId, state);
  return state;
}
function observeAdminSentMessage(message) {
  pruneAdminSendState();
  for (const [operationId, state] of pendingAdminSends) {
    if (!adminSendMessageMatches(state, message)) continue;
    const observed = completeAdminSend({
      operationId,
      chatId: state.chatId,
      message: state.message,
      sent: message,
      confirmationSource: "message_create",
    });
    if (observed) {
      console.log(`[WhatsApp] admin send observed from message_create: operation=${operationId} message=${observed.messageId || "none"}`);
      return observed;
    }
  }
  return null;
}
function finalizeAdminSentMessage({ chatId, message, sent, operationId, late = false, confirmationSource = "sendMessage" }) {
  const messageId = serializedMessageId(sent);
  const auditAction = confirmationSource === "message_create" ? "message.sent_observed" : (late ? "message.sent_after_timeout" : "message.sent");
  audit(auditAction, "chat", chatId, { operationId, messageId, responseObject: Boolean(sent), late, confirmationSource });
  const parsed = chatId.endsWith("@g.us") ? parseOrder(message) : null;
  let order = null;
  if (parsed && parsed.isOrder && isConfiguredGroup(chatId) && messageId) {
    const producer = BOT_FINANCIAL_MODE === "company" ? companyUser() : botEmployeeUser();
    order = createOrderCandidate({ messageId, groupId: chatId, body: message, producer, parsed });
  }
  return { messageId, order };
}
function currentCaptainSubscriptionPeriod(stamp = now()) {
  const startMs = Date.parse(CAPTAIN_SUBSCRIPTION_START);
  const stampMs = Date.parse(stamp);
  if (!Number.isFinite(startMs) || !Number.isFinite(stampMs) || stampMs < startMs) return null;
  const periodMs = CAPTAIN_SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  const periodStartMs = startMs + Math.floor((stampMs - startMs) / periodMs) * periodMs;
  return { start: new Date(periodStartMs).toISOString(), end: new Date(periodStartMs + periodMs).toISOString() };
}
const CAPTAIN_ARABIC_DISPLAY_NAMES = {
  "Ahmad Ali": "أحمد علي",
  Ahmadalmomani: "أحمد المومني",
  BASHAR_ALBDOUR: "بشار البدور",
  "Ehab Battah.": "إيهاب بطاح",
  "Hamza Bataineh": "حمزة بطاينة",
  "Marwan Mhedat": "مروان مهدات",
  "Mohammad Sheyab ID6": "محمد شعيب ID6",
  "Mohammed Abusalem": "محمد أبو سلام",
  "Mohanad alomari": "مهند العمري",
  "Omar Shatnawi": "عمر الشطناوي",
  "Roshde Alawneh": "رشدي علاونة",
  atiahnimri: "عطية النمري",
  "m.alomari": "م. العمري",
};
function captainDisplayName(name) {
  const original = String(name || "").replace(/\u200f|\u200e/g, "").trim();
  const digits = original.replace(/[^0-9]/g, "");
  if (!original || (digits.length >= 8 && digits === original.replace(/[^0-9]/g, ""))) return "كابتن بدون اسم";
  return CAPTAIN_ARABIC_DISPLAY_NAMES[original] || original;
}
function applyCaptainSubscriptionCharges(stamp = now()) {
  const period = currentCaptainSubscriptionPeriod(stamp);
  if (!period) return { status: "before_start", applied: [], skipped: [] };
  const cutoff = new Date(Date.parse(stamp) - CAPTAIN_SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const captains = db.prepare(`SELECT id,phone,name,wallet_cents FROM users
    WHERE role='captain' AND active=1 AND is_bot=0 AND account_status='active'
    AND (EXISTS (SELECT 1 FROM orders o WHERE (o.producer_user_id=users.id OR o.captain_user_id=users.id) AND o.created_at>=? AND o.created_at<=?)
      OR EXISTS (SELECT 1 FROM order_candidates oc WHERE oc.producer_user_id=users.id AND oc.created_at>=? AND oc.created_at<=?))
    ORDER BY id`).all(cutoff, stamp, cutoff, stamp);
  const applied = [];
  const skipped = [];
  for (const captain of captains) {
    const reference = `SUB-${period.start.slice(0, 10)}-${captain.id}`;
    try {
      const result = db.transaction(() => {
        const existing = db.prepare("SELECT id,status,ledger_id FROM captain_subscription_charges WHERE user_id=? AND period_start=? LIMIT 1").get(captain.id, period.start);
        if (existing) return { state: "already_recorded", chargeId: existing.id, status: existing.status };
        const current = db.prepare("SELECT wallet_cents FROM users WHERE id=? AND role='captain' AND active=1 AND account_status='active'").get(captain.id);
        if (!current) return { state: "ineligible" };
        const nextBalance = Number(current.wallet_cents) - CAPTAIN_SUBSCRIPTION_CENTS;
        if (nextBalance < CAPTAIN_MIN_BALANCE_CENTS) {
          const charge = db.prepare("INSERT INTO captain_subscription_charges(user_id,period_start,period_end,amount_cents,status,reference,created_at,details_json) VALUES(?,?,?,?,?,?,?,?)")
            .run(captain.id, period.start, period.end, CAPTAIN_SUBSCRIPTION_CENTS, "skipped_debt_limit", reference, stamp, JSON.stringify({ reason: "debt_limit", balanceCents: current.wallet_cents, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS }));
          return { state: "skipped_debt_limit", chargeId: charge.lastInsertRowid };
        }
        db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain'").run(nextBalance, stamp, captain.id);
        const ledger = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(captain.id, "subscription_fee", -CAPTAIN_SUBSCRIPTION_CENTS, nextBalance, reference, "اشتراك أسبوعي للكابتن عن وجود حركة خلال آخر 7 أيام", stamp, JSON.stringify({ periodStart: period.start, periodEnd: period.end, activityWindowStart: cutoff, activityWindowEnd: stamp }), reference);
        const charge = db.prepare("INSERT INTO captain_subscription_charges(user_id,period_start,period_end,amount_cents,status,ledger_id,reference,created_at,applied_at,details_json) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(captain.id, period.start, period.end, CAPTAIN_SUBSCRIPTION_CENTS, "applied", ledger.lastInsertRowid, reference, stamp, stamp, JSON.stringify({ activityWindowStart: cutoff, activityWindowEnd: stamp }));
        audit("captain.subscription.charged", "user", captain.id, { phone: captain.phone, amountCents: CAPTAIN_SUBSCRIPTION_CENTS, balanceAfterCents: nextBalance, periodStart: period.start, periodEnd: period.end, reference }, null);
        return { state: "applied", chargeId: charge.lastInsertRowid, ledgerId: ledger.lastInsertRowid, balanceAfterCents: nextBalance };
      })();
      if (result.state === "applied") {
        applied.push({ ...captain, ...result, reference });
        if (Number(result.balanceAfterCents) < 0) void notifyCaptainNegativeBalance({ captainId: captain.id, balanceCents: result.balanceAfterCents, reason: "خصم الاشتراك الأسبوعي", reference });
      }
      else if (result.state === "skipped_debt_limit") skipped.push({ ...captain, ...result, reference });
    } catch (error) {
      console.error(`[Subscription] failed for captain ${captain.id}:`, error.message);
    }
  }
  if (applied.length || skipped.length) console.log(`[Subscription] period=${period.start} applied=${applied.length} skipped=${skipped.length}`);
  return { status: "completed", period, applied, skipped, eligibleCount: captains.length };
}
function applyCaptainDailyCharges(stamp = now()) {
  const chargeDate = String(stamp).slice(0, 10);
  const captains = db.prepare(`SELECT id,phone,name,wallet_cents,active,account_status FROM users
    WHERE role='captain' AND is_bot=0 AND COALESCE(account_status,'')<>'merged'
    ORDER BY id`).all();
  const applied = [];
  for (const captain of captains) {
    const reference = `DAILY-CAPTAIN-${chargeDate}-${captain.id}`;
    try {
      const result = db.transaction(() => {
        const existing = db.prepare("SELECT id,ledger_id FROM captain_daily_charges WHERE user_id=? AND charge_date=? LIMIT 1").get(captain.id, chargeDate);
        if (existing) return { state: "already_recorded", chargeId: existing.id, ledgerId: existing.ledger_id };
        const current = db.prepare("SELECT id,wallet_cents,role,is_bot,account_status FROM users WHERE id=? AND role='captain' AND is_bot=0 AND COALESCE(account_status,'')<>'merged'").get(captain.id);
        if (!current) return { state: "ineligible" };
        const nextBalance = Number(current.wallet_cents || 0) - CAPTAIN_DAILY_CHARGE_CENTS;
        const ledger = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(captain.id, "daily_captain_charge", -CAPTAIN_DAILY_CHARGE_CENTS, nextBalance, reference, "خصم يومي ثابت من محفظة الكابتن", stamp, JSON.stringify({ chargeDate, amountCents: CAPTAIN_DAILY_CHARGE_CENTS }), reference);
        const charge = db.prepare("INSERT INTO captain_daily_charges(user_id,charge_date,amount_cents,ledger_id,reference,created_at,details_json) VALUES(?,?,?,?,?,?,?)")
          .run(captain.id, chargeDate, CAPTAIN_DAILY_CHARGE_CENTS, ledger.lastInsertRowid, reference, stamp, JSON.stringify({ balanceAfterCents: nextBalance }));
        db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain'").run(nextBalance, stamp, captain.id);
        audit("captain.daily_charge.applied", "user", captain.id, { amountCents: CAPTAIN_DAILY_CHARGE_CENTS, chargeDate, balanceAfterCents: nextBalance, reference }, null);
        return { state: "applied", chargeId: charge.lastInsertRowid, ledgerId: ledger.lastInsertRowid, balanceAfterCents: nextBalance };
      })();
      if (result.state === "applied") applied.push({ ...captain, ...result, reference });
    } catch (error) {
      console.error(`[DailyCharge] failed for captain ${captain.id}:`, error.message);
    }
  }
  if (applied.length) console.log(`[DailyCharge] date=${chargeDate} applied=${applied.length} amountCents=${CAPTAIN_DAILY_CHARGE_CENTS}`);
  return { status: "completed", chargeDate, applied, eligibleCount: captains.length };
}
function startCaptainSubscriptionScheduler() {
  applyCaptainSubscriptionCharges();
  setInterval(() => applyCaptainSubscriptionCharges(), CAPTAIN_SUBSCRIPTION_INTERVAL_MS).unref();
  if (CAPTAIN_DAILY_CHARGE_ENABLED) {
    applyCaptainDailyCharges();
    setInterval(() => applyCaptainDailyCharges(), CAPTAIN_DAILY_CHARGE_INTERVAL_MS).unref();
  }
}
function parseOrder(text) {
  const normalized = String(text || "").replace(/\u200f|\u200e/g, "").trim();
  const startsWithPriceKeyword = /^السعر(?:\s|[:：]|$)/u.test(normalized);
  const digitPattern = "[0-9٠-٩۰-۹]";
  const normalizeDigits = (value) => String(value || "").replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  const numberPattern = digitPattern + "+(?:[.,٫]" + digitPattern + "{1,2})?";
  const numberValue = (value) => Number(normalizeDigits(value).replace(/[٫,]/g, "."));
  const rangeMatch = startsWithPriceKeyword ? normalized.match(new RegExp("^السعر\\s*[:：]?\\s*(?:من\\s*)?(" + numberPattern + ")\\s*(?:إلى|الى|ل|[-–—])\\s*(" + numberPattern + ")", "i")) : null;
  const singleMatch = startsWithPriceKeyword ? normalized.match(new RegExp("^السعر\\s*[:：]?\\s*(" + numberPattern + ")", "i")) : null;
  let priceMin = null;
  let priceMax = null;
  let price = null;
  if (rangeMatch) {
    const minimum = numberValue(rangeMatch[1]);
    const maximum = numberValue(rangeMatch[2]);
    if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > 0 && maximum >= minimum) {
      priceMin = minimum;
      priceMax = maximum;
      price = (minimum + maximum) / 2;
    }
  } else if (singleMatch) {
    const single = numberValue(singleMatch[1]);
    if (Number.isFinite(single) && single > 0) {
      priceMin = single;
      priceMax = single;
      price = single;
    }
  }
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const routeLine = lines.find((line) => /من\s+.+\s+(?:إلى|الى)\s+|من\s+.+\s+ل(?:ـ)?\s*/i.test(line)) || "";
  const route = routeLine.match(/من\s+(.+?)\s+إلى\s+(.+)/i) || routeLine.match(/من\s+(.+?)\s+الى\s+(.+)/i) || routeLine.match(/من\s+(.+?)\s+ل(?:ـ)?\s*(.+)/i);
  const requestKindMatch = normalized.match(/(?:راكب(?:ة)?|ركاب|حمولة|سيارة(?:\s+كاملة)?|سياره(?:\s+كامله)?|استقبال\s+مطار|اوردر|order)/i);
  const requestKind = Boolean(requestKindMatch);
  return {
    // الصيغة التشغيلية المعتمدة: كلمة «السعر» يتبعها الرقم فقط؛ المسار/نوع الرحلة اختياري وغير معتمد للتمييز.
    isOrder: price !== null,
    price,
    priceMin,
    priceMax,
    requestKind: requestKindMatch ? requestKindMatch[0].trim() : null,
    origin: route ? route[1].trim() : null,
    destination: route ? route[2].trim() : null,
    tripTime: null,
    orderKind: /(?:^|\s)(?:اوردر|order)(?:$|\s)/i.test(normalized) ? "order" : "normal",
  };
}
function createOrderRecord({ messageId, groupId, body, producer, parsed }) {
  if (!messageId || !groupId || !body || !producer || !parsed || !parsed.isOrder) return null;
  const existingOrder = findEquivalentOrder(groupId, messageId);
  if (existingOrder) return existingOrder.archive_state === "archived" ? null : existingOrder;
  const recentCutoff = new Date(Date.now() - 120000).toISOString();
  const recentDuplicate = db.prepare("SELECT * FROM orders WHERE group_id=? AND producer_user_id=? AND raw_text=? AND created_at>=? ORDER BY id DESC LIMIT 1").get(groupId, producer.id, body, recentCutoff);
  if (recentDuplicate) return recentDuplicate;
  const stamp = now();
  const orderNo = Number(db.prepare("SELECT COALESCE(MAX(order_no),0)+1 AS next FROM orders").get().next);
  const result = db.prepare("INSERT INTO orders(order_no,source_message_id,group_id,raw_text,price_cents,origin,destination,trip_time,order_kind,producer_user_id,producer_phone_snapshot,producer_name_snapshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(orderNo, messageId, groupId, body, cents(parsed.price), parsed.origin, parsed.destination, parsed.tripTime, parsed.orderKind, producer.id, phoneWithCountry(producer.phone), producer.name || null, "open", stamp, stamp);
  audit("order.created", "order", result.lastInsertRowid, { orderNo, groupId, producerPhone: producer.phone });
  console.log(`[Order] #${orderNo} created from ${groupId}`);
  return db.prepare("SELECT * FROM orders WHERE id=?").get(result.lastInsertRowid);
}
function createOrderCandidate({ messageId, groupId, body, producer, parsed }) {
  if (!messageId || !groupId || !body || !producer || !parsed || !parsed.isOrder) return null;
  const existing = findEquivalentCandidate(groupId, messageId, ["candidate", "pending", "finalized", "cancelled"]);
  if (existing) return existing;
  const existingOrder = findEquivalentOrder(groupId, messageId);
  if (existingOrder) {
    logOrderTrace("order_candidate_blocked_existing_order", {
      groupKey: orderTraceKey(groupId),
      sourceKey: orderTraceKey(messageId),
      orderNo: existingOrder.order_no,
      archiveState: existingOrder.archive_state || "active",
    });
    return null;
  }
  const recentCutoff = new Date(Date.now() - 120000).toISOString();
  const recentDuplicate = db.prepare("SELECT * FROM order_candidates WHERE group_id=? AND producer_user_id=? AND raw_text=? AND created_at>=? ORDER BY id DESC LIMIT 1").get(groupId, producer.id, body, recentCutoff);
  if (recentDuplicate) return recentDuplicate;
  const stamp = now();
  const result = db.prepare("INSERT INTO order_candidates(source_message_id,group_id,raw_text,price_cents,origin,destination,trip_time,order_kind,producer_user_id,producer_phone_snapshot,producer_name_snapshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'candidate',?,?)").run(messageId, groupId, body, cents(parsed.price), parsed.origin, parsed.destination, parsed.tripTime, parsed.orderKind, producer.id, phoneWithCountry(producer.phone), producer.name || null, stamp, stamp);
  db.prepare("UPDATE order_candidates SET lifecycle_stage='candidate_created',lifecycle_blocker=NULL,lifecycle_updated_at=? WHERE id=?").run(stamp, result.lastInsertRowid);
  audit("order.candidate.created", "order_candidate", result.lastInsertRowid, { groupId, producerPhone: producer.phone });
  console.log(`[OrderCandidate] candidate created from ${groupId}`);
  return db.prepare("SELECT * FROM order_candidates WHERE id=?").get(result.lastInsertRowid);
}
function updateOrderCandidateLifecycle(candidateId, stage, blocker = null, extra = {}) {
  if (!candidateId) return null;
  const stamp = now();
  const result = db.prepare("UPDATE order_candidates SET lifecycle_stage=?,lifecycle_blocker=?,lifecycle_updated_at=?,updated_at=? WHERE id=?").run(String(stage || "candidate_created"), blocker ? String(blocker) : null, stamp, stamp, candidateId);
  if (result.changes) {
    audit(`order.lifecycle.${String(stage || "candidate_created")}`, "order_candidate", candidateId, { blocker: blocker || null, ...extra });
  }
  return result;
}
function notifyOrderLifecycleBlocker(candidateId, blocker, details = {}) {
  if (!candidateId || !blocker) return;
  const event = `order.lifecycle.blocked.${candidateId}.${String(blocker)}`;
  if (db.prepare("SELECT id FROM notifications WHERE event=? LIMIT 1").get(event)) return;
  const candidate = db.prepare("SELECT id,price_cents,group_id,source_message_id FROM order_candidates WHERE id=? LIMIT 1").get(candidateId);
  if (!candidate) return;
  void notifyOperations({
    event,
    title: "توقف آلي يحتاج متابعة",
    lines: [`المرشح: #${candidate.id}`, `القيمة: ${money(candidate.price_cents)} JOD`, `السبب: ${String(blocker).slice(0, 80)}`, "لم تُنفذ أي حركة مالية بسبب هذا العائق.", details.acceptanceMessageId ? `رسالة القبول: ${orderTraceKey(details.acceptanceMessageId)}` : ""],
    ownersOnly: true,
  });
}
function findPendingAcceptanceByMessage(groupId, acceptanceMessageId) {
  if (!groupId || !acceptanceMessageId) return null;
  const exact = db.prepare("SELECT a.*,c.* FROM order_candidate_acceptances a JOIN order_candidates c ON c.id=a.candidate_id WHERE c.group_id=? AND c.status='pending' AND a.acceptance_message_id=? AND a.status IN ('pending','selected') LIMIT 1").get(groupId, acceptanceMessageId);
  if (exact) return exact;
  const rows = db.prepare("SELECT a.*,c.* FROM order_candidate_acceptances a JOIN order_candidates c ON c.id=a.candidate_id WHERE c.group_id=? AND c.status='pending' AND a.status IN ('pending','selected') ORDER BY a.updated_at DESC,a.id DESC LIMIT 200").all(groupId);
  return rows.find((row) => sourceMessageIdsEqual(row.acceptance_message_id, acceptanceMessageId)) || null;
}
function registerQuotedAcceptance({ groupId, messageId, senderPhone, senderName, candidate }) {
  if (!groupId || !messageId || !senderPhone || !candidate) return { state: "invalid" };
  const captain = isBotPhone(senderPhone) ? botEmployeeUser() : ensureCaptainUser(senderPhone, senderName);
  if (!captain || captain.active !== 1 || captain.account_status !== "active" || (captain.is_bot === 1 && !isBotPhone(senderPhone))) {
    return { state: "captain_ineligible", captain: null };
  }
  const producer = db.prepare("SELECT * FROM users WHERE id=?").get(candidate.producer_user_id);
  if (!producer || captain.id === producer.id) return { state: "producer_missing_or_same_captain", captain, producer };
  for (const identityValue of [candidate.acceptance_author, candidate.acceptance_author_lid]) {
    if (/@lid$/i.test(serializedWhatsappUserId(identityValue))) persistWhatsappIdentity(identityValue, senderPhone, "accepted_message_sender");
  }
  const recorded = db.transaction(() => {
    const stamp = now();
    const inserted = db.prepare("INSERT OR IGNORE INTO order_candidate_acceptances(candidate_id,captain_user_id,acceptance_message_id,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").run(candidate.id, captain.id, messageId, stamp, stamp);
    const acceptance = db.prepare("SELECT * FROM order_candidate_acceptances WHERE candidate_id=? AND acceptance_message_id=? LIMIT 1").get(candidate.id, messageId);
    if (!acceptance) return { state: "not_recorded", captain, producer };
    if (!inserted.changes) {
      db.prepare("UPDATE order_candidates SET lifecycle_stage='acceptance_pending',lifecycle_blocker='awaiting_authorized_thumb',lifecycle_updated_at=?,updated_at=? WHERE id=? AND status IN ('candidate','pending')").run(stamp, stamp, candidate.id);
      return { state: "duplicate", acceptance, captain, producer };
    }
    const current = db.prepare("SELECT * FROM order_candidates WHERE id=?").get(candidate.id);
    if (!current || !["candidate", "pending"].includes(current.status)) return { state: "transition_failed", acceptance, captain, producer };
    if (current.status === "candidate") {
      const result = db.prepare("UPDATE order_candidates SET status='pending',pending_captain_user_id=?,pending_message_id=?,pending_at=?,lifecycle_stage='acceptance_pending',lifecycle_blocker='awaiting_authorized_thumb',lifecycle_updated_at=?,updated_at=? WHERE id=? AND status='candidate'").run(captain.id, messageId, stamp, stamp, stamp, candidate.id);
      return result.changes === 1 ? { state: "recorded", acceptance, captain, producer } : { state: "transition_failed", acceptance, captain, producer };
    }
    const result = db.prepare("UPDATE order_candidates SET lifecycle_stage='acceptance_pending',lifecycle_blocker='awaiting_authorized_thumb',lifecycle_updated_at=?,updated_at=? WHERE id=? AND status='pending'").run(stamp, stamp, candidate.id);
    return result.changes === 1 ? { state: "recorded", acceptance, captain, producer } : { state: "transition_failed", acceptance, captain, producer };
  })();
  if (recorded.state !== "recorded") return recorded;
  const { acceptance } = recorded;
  audit("order.candidate.acceptance_recorded", "order_candidate", candidate.id, { captainId: captain.id, acceptanceMessageId: messageId });
  return { state: "recorded", acceptance, captain, producer };
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
    serializedMessageId(quoted) && parseOrder(quoted.body).isOrder
  );
}
function isCaptainAcceptance(text) {
  const normalized = String(text || "").replace(/\u200f|\u200e/g, "").trim();
  return /^تم(?:$|[\s،,:؛.!؟؟\-–—])/u.test(normalized);
}
function latestOpenOrder(groupId) {
  return db.prepare("SELECT * FROM orders WHERE group_id=? AND status='open' AND COALESCE(archive_state,'active')='active' AND pending_message_id IS NULL ORDER BY id DESC LIMIT 1").get(groupId);
}
function findOrderByQuotedId(groupId, quotedId) {
  if (!quotedId) return null;
  return findEquivalentCandidate(groupId, quotedId, ["candidate", "pending"]);
}
function findOrderByQuotedMessage(groupId, quoted) {
  const byId = findOrderByQuotedId(groupId, serializedMessageId(quoted));
  return byId && byId.group_id === groupId ? byId : null;
}
function findLatestStandaloneAcceptanceCandidate(groupId) {
  return db.prepare("SELECT * FROM order_candidates WHERE group_id=? AND status='candidate' AND pending_message_id IS NULL ORDER BY id DESC LIMIT 1").get(groupId);
}
function brandedMessage(title, lines = []) {
  return [
    `╭━━━ ✦ ${COMPANY_BRAND_ENGLISH} OPERATIONS NETWORK ✦ ━━━╮`,
    `┃ ${COMPANY_BRAND_NAME} | بوابة التشغيل الرسمية`,
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
  const safeName = escapeXml(captainName || `كابتن شبكة ${COMPANY_BRAND_NAME}`);
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
    <text x="245" y="101" fill="#f6c84c" font-size="28" font-family="Arial, sans-serif" font-weight="700">${COMPANY_BRAND_ENGLISH} LOGISTICS</text>
    <text x="245" y="139" fill="#ffffff" font-size="23" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">${COMPANY_BRAND_NAME} للنقل والخدمات اللوجستية</text>
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
  const cardBlue = "#4da3ff";
  const logo = logoData ? `<image href="data:image/png;base64,${logoData}" x="424" y="288" width="232" height="232" preserveAspectRatio="xMidYMid meet" opacity=".48"/>` : `<text x="540" y="430" text-anchor="middle" fill="#ffe493" font-size="64" font-weight="700" opacity=".28">ج</text>`;
  const lineMarkup = visibleLines.map((line, index) => `<text x="86" y="${276 + index * 40}" fill="${cardBlue}" font-size="${index === visibleLines.length - 1 ? 20 : 23}" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="${index === visibleLines.length - 1 ? 700 : 500}">${escapeXml(line).slice(0, 88)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="760" viewBox="0 0 1080 760">
    <defs><linearGradient id="ops-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1722"/><stop offset=".58" stop-color="#162d42"/><stop offset="1" stop-color="#070f18"/></linearGradient><radialGradient id="glow"><stop offset="0" stop-color="#48d9d1" stop-opacity=".45"/><stop offset=".52" stop-color="#48d9d1" stop-opacity=".12"/><stop offset="1" stop-color="#48d9d1" stop-opacity="0"/></radialGradient><linearGradient id="ops-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b1"/><stop offset=".5" stop-color="#f2c34f"/><stop offset="1" stop-color="#9c6816"/></linearGradient></defs>
    ${portalData ? `<image href="data:image/png;base64,${portalData}" x="0" y="0" width="1080" height="760" preserveAspectRatio="xMidYMid slice" opacity=".30"/>` : ""}
    <rect width="1080" height="760" fill="#07121d" opacity=".72"/><rect x="18" y="18" width="1044" height="724" rx="42" fill="url(#ops-bg)" fill-opacity=".78" stroke="url(#ops-gold)" stroke-width="6"/>
    <path d="M42 138 H210 M42 138 V55 M1038 138 H870 M1038 138 V55 M42 622 H210 M42 622 V705 M1038 622 H870 M1038 622 V705" stroke="#f6c84c" stroke-opacity=".72" stroke-width="3"/>
    <path d="M24 186 H74 M24 186 V74 M1056 186 H1006 M1056 186 V74 M24 574 H74 M24 574 V686 M1056 574 H1006 M1056 574 V686" stroke="#48d9d1" stroke-opacity=".28" stroke-width="2"/>
    <path d="M25 505 C240 380 400 650 675 480 S920 390 1055 300 L1055 740 L25 740 Z" fill="#f6c84c" opacity=".08"/>
    <circle cx="540" cy="404" r="252" fill="url(#glow)" opacity=".50"/><circle cx="540" cy="404" r="178" fill="none" stroke="#48d9d1" stroke-opacity=".36" stroke-width="2"/><circle cx="540" cy="404" r="157" fill="none" stroke="#f6c84c" stroke-opacity=".40" stroke-width="2"/><circle cx="540" cy="404" r="128" fill="#071522" fill-opacity=".84" stroke="#8fe9df" stroke-opacity=".32" stroke-width="2"/>
    ${logo}<circle cx="540" cy="226" r="9" fill="#62df99"/><circle cx="540" cy="226" r="22" fill="none" stroke="#62df99" stroke-opacity=".45" stroke-width="3"/><circle cx="540" cy="582" r="6" fill="#f6c84c"/><circle cx="358" cy="404" r="6" fill="#48d9d1"/><circle cx="722" cy="404" r="6" fill="#48d9d1"/>
    <text x="1000" y="83" text-anchor="end" fill="#f6c84c" font-size="25" font-family="Arial, sans-serif" font-weight="700" letter-spacing="2">${COMPANY_BRAND_ENGLISH} OPERATIONS NETWORK</text>
    <text x="352" y="122" fill="${cardBlue}" font-size="24" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">${COMPANY_BRAND_NAME} | بوابة التشغيل الرسمية</text>
    <rect x="80" y="64" width="238" height="48" rx="20" fill="#5b3e12" fill-opacity=".88" stroke="#ffcf72" stroke-width="2"/><text x="199" y="96" text-anchor="middle" fill="#ffe493" font-size="21" font-family="Arial, sans-serif" font-weight="700">OFFICIAL / VERIFIED</text>
    <rect x="64" y="164" width="952" height="474" rx="30" fill="#07131f" fill-opacity=".74" stroke="#8fe9df" stroke-opacity=".30" stroke-width="2"/>
    <text x="86" y="218" fill="${cardBlue}" font-size="30" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">${safeTitle}</text>
    <path d="M80 238 H1000" stroke="#f6c84c" stroke-opacity=".35" stroke-width="2"/>
    ${lineMarkup}
    <path d="M80 666 H1000" stroke="#48d9d1" stroke-opacity=".34" stroke-width="2"/>
    <text x="1000" y="708" text-anchor="end" fill="#8fe9df" font-size="20" font-family="Noto Sans Arabic, Noto Naskh Arabic, Arial, sans-serif" font-weight="700">نقل أسرع • تنظيم أدق • سجل موثّق</text>
    <text x="80" y="708" fill="#f6c84c" font-size="18" font-family="Arial, sans-serif">${COMPANY_BRAND_ENGLISH} / OFFICIAL</text>
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
function finalBookingConfirmationText({ orderNo, executorName, downloaderName, consumerName, priceCents }) {
  return `✅ تم تثبيت الطلب #${String(orderNo || "غير محدد")}`;
}
function finalBookingConfirmationOrderNo(body) {
  const text = String(body || "").trim();
  const shortMatch = text.match(/^✅ تم تثبيت الطلب\s*#(\d+)$/);
  if (shortMatch) return Number(shortMatch[1]);
  const legacyMatch = text.match(/رقم الرحلة:\s*#(\d+)/);
  return Number(legacyMatch?.[1] || 0);
}
function finalBookingCancellationText() {
  return [
    "❌ تم رفض أو إلغاء الطلب",
    "",
    "📌 الحالة: غير معتمد",
    "لا يتم احتساب أي عمولة أو تسوية مالية.",
  ].join("\n");
}
const confirmationDeliveryInFlight = new Set();
const CONFIRMATION_RETRY_BACKOFF_MS = 120000;
const MAX_CONFIRMATION_DELIVERY_ATTEMPTS = 3;
async function sendFinalBookingConfirmation(groupId, details) {
  const orderId = Number(details?.orderId || 0) || null;
  if (orderId && confirmationDeliveryInFlight.has(orderId)) return null;
  if (orderId) confirmationDeliveryInFlight.add(orderId);
  let delivery = null;
  if (orderId) {
    const stamp = now();
    delivery = db.transaction(() => {
      const existing = db.prepare("SELECT * FROM order_confirmation_deliveries WHERE order_id=? LIMIT 1").get(orderId);
      if (existing?.status === "sent") return existing;
      const updatedAtMs = Date.parse(String(existing?.updated_at || ""));
      const deliveryAgeMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Infinity;
      if (existing && (Number(existing.attempts || 0) >= MAX_CONFIRMATION_DELIVERY_ATTEMPTS || deliveryAgeMs < CONFIRMATION_RETRY_BACKOFF_MS)) {
        return { ...existing, retrySuppressed: true };
      }
      if (existing) {
        db.prepare("UPDATE order_confirmation_deliveries SET status='pending',attempts=attempts+1,last_error=NULL,updated_at=? WHERE order_id=?").run(stamp, orderId);
        return db.prepare("SELECT * FROM order_confirmation_deliveries WHERE order_id=? LIMIT 1").get(orderId);
      }
      db.prepare("INSERT INTO order_confirmation_deliveries(order_id,group_id,status,attempts,created_at,updated_at) VALUES(?,?, 'pending',1,?,?)").run(orderId, groupId, stamp, stamp);
      return db.prepare("SELECT * FROM order_confirmation_deliveries WHERE order_id=? LIMIT 1").get(orderId);
    })();
    if (delivery?.status === "sent") {
      confirmationDeliveryInFlight.delete(orderId);
      return null;
    }
    if (delivery?.retrySuppressed) {
      confirmationDeliveryInFlight.delete(orderId);
      return null;
    }
  }
  try {
    const sent = await withTimeout(client.sendMessage(groupId, finalBookingConfirmationText(details)), 15000, null);
    if (!sent) throw new Error("confirmation message was not acknowledged");
    if (orderId) db.prepare("UPDATE order_confirmation_deliveries SET status='sent',message_id=?,sent_at=?,updated_at=? WHERE order_id=?").run(sent.id?._serialized || null, now(), now(), orderId);
    return sent;
  } catch (error) {
    console.error("[WhatsApp] final booking confirmation not sent:", error.message);
    if (orderId) {
      db.prepare("UPDATE order_confirmation_deliveries SET status='failed',last_error=?,updated_at=? WHERE order_id=?").run(String(error?.message || error).slice(0, 240), now(), orderId);
      const alertEvent = `order.confirmation_message.failed.${orderId}`;
      if (!db.prepare("SELECT id FROM notifications WHERE event=? LIMIT 1").get(alertEvent)) {
        void notifyOperations({ event: alertEvent, title: "تعذر إرسال رسالة تثبيت الطلب", lines: [`رقم الطلب: #${details?.orderNo || "غير محدد"}`, "تمت التسوية المالية بشكل ذري، لكن رسالة التثبيت المختصرة لم تصل إلى القروب.", "سيعاد المحاولة تلقائيًا عند توفر الاتصال."], ownersOnly: true });
      }
    }
    return null;
  } finally {
    if (orderId) confirmationDeliveryInFlight.delete(orderId);
  }
}
function observeFinalBookingConfirmationMessage(message) {
  if (!message?.fromMe || !message?.from || !isConfiguredGroup(String(message.from))) return null;
  const body = String(message.body || "").trim();
  const orderNo = finalBookingConfirmationOrderNo(body);
  const messageId = serializedMessageId(message);
  if (!orderNo || !messageId) return null;
  const order = db.prepare("SELECT id FROM orders WHERE group_id=? AND order_no=? ORDER BY id DESC LIMIT 1").get(String(message.from), orderNo);
  if (!order) return null;
  const updated = db.prepare("UPDATE order_confirmation_deliveries SET status='sent',message_id=?,sent_at=COALESCE(sent_at,?),updated_at=?,last_error=NULL WHERE order_id=? AND status<>'sent'").run(messageId, now(), now(), order.id);
  if (updated.changes) console.log(`[WhatsApp] final booking confirmation observed order=${orderNo} message=${messageId}`);
  return { orderId: order.id, orderNo, messageId, updated: Boolean(updated.changes) };
}
async function sendFinalBookingCancellation(groupId) {
  if (!client || !groupId) return null;
  try {
    const sent = await withTimeout(client.sendMessage(groupId, finalBookingCancellationText()), 15000, null);
    if (!sent) throw new Error("cancellation message was not acknowledged");
    return sent;
  } catch (error) {
    console.error("[WhatsApp] final booking cancellation not sent:", error.message);
    void notifyOperations({ event: `order.cancellation_card.failed.${orderTraceKey(groupId)}`, title: "تعذر إرسال بطاقة إلغاء الطلب", lines: ["تم تسجيل إلغاء الطلب دون تسوية مالية، لكن رسالة الإلغاء لم تصل إلى القروب."], ownersOnly: true });
    return null;
  }
}
function formatAcceptance(order, captain, producer) {
  return brandedMessage("تم توثيق الرحلة", [
    `🆔 رقم الطلب: #${order.order_no}`,
    `👤 المنتج المعتمد: ${producer ? producer.name : "غير محدد"}`,
    `🚕 الكابتن المنفّذ: ${captain.name}`,
    `💰 القيمة الكاملة للرحلة: ${money(order.price_cents)} JOD`,
    `🧾 نوع الطلب: ${order.order_kind === "order" ? "أوردر محدد · خصم 15%" : "طلب عادي · خصم 15%"}`,
    `💼 المخصوم من رصيد المنفّذ: ${money(order.producer_cents)} JOD`,
    `📊 صافي حصة المنتج: ${money(order.producer_cents - order.company_cents)} JOD | حصة الشركة: ${money(order.company_cents)} JOD`,
    "✅ تم اعتماد الرحلة بإعجاب كابتن تنزيل الطلب، وتم تسجيل التسوية.",
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
let whatsappWatchdogTimer = null;
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
let lastOfficialGroupEventGroupId = null;
let lastOfficialGroupMessageTelemetry = null;
let lastIgnoredGroupEventGroupId = null;
let lastIgnoredGroupMessageTelemetry = null;
let whatsappSendDiagnostics = {
  installed: false,
  installedAt: null,
  generation: null,
  pageEvents: [],
  lastPageProbe: null,
};
const INDEXEDDB_WARNING_RATIO = 0.80;
const INDEXEDDB_CRITICAL_RATIO = 0.90;
const INDEXEDDB_MONITOR_INTERVAL_MS = 5 * 60 * 1000;
let whatsappStorageMonitorTimer = null;
let whatsappStoragePressure = {
  status: "unknown",
  blocked: false,
  reason: null,
  usageBytes: null,
  quotaBytes: null,
  usageRatio: null,
  databaseCount: null,
  lastCheckedAt: null,
  lastErrorAt: null,
  alertState: null,
  blockedAttempts: 0,
};
let baileysSocket = null;
let baileysReady = false;
let baileysQrCodeData = null;
let baileysInitializing = false;
let baileysReconnectTimer = null;
let baileysConnectionGeneration = 0;
let baileysModulePromise = null;

function boundedDiagnosticText(value, limit = 2400) {
  return String(value || "").replace(/\u0000/g, "").slice(0, limit);
}

function recordWhatsAppPageDiagnostic(type, payload = {}) {
  const event = {
    at: now(),
    type: boundedDiagnosticText(type, 80),
    ...payload,
  };
  whatsappSendDiagnostics.pageEvents.push(event);
  if (whatsappSendDiagnostics.pageEvents.length > 40) whatsappSendDiagnostics.pageEvents.splice(0, whatsappSendDiagnostics.pageEvents.length - 40);
  whatsappSendDiagnostics.lastPageProbe = event;
  console.warn(`[WhatsApp][PageDiagnostic] ${event.type}: ${event.message || event.text || "event"}`);
}

async function installWhatsAppSendDiagnostics(instance, generation) {
  const page = instance?.pupPage;
  whatsappSendDiagnostics = {
    installed: false,
    installedAt: null,
    generation,
    pageEvents: [],
    lastPageProbe: null,
  };
  if (!page || typeof page.evaluate !== "function") {
    recordWhatsAppPageDiagnostic("install_unavailable", { message: "WhatsApp page is not available" });
    return { installed: false, reason: "page_unavailable" };
  }
  const pageListener = (type, payload) => recordWhatsAppPageDiagnostic(type, payload);
  try {
    if (typeof page.on === "function") {
      page.on("pageerror", (error) => pageListener("pageerror", {
        name: boundedDiagnosticText(error?.name, 120),
        message: boundedDiagnosticText(error?.message || error, 1200),
        stack: boundedDiagnosticText(error?.stack, 2400),
      }));
      page.on("console", (message) => {
        let level = "";
        try { level = typeof message?.type === "function" ? message.type() : ""; } catch (_) { level = ""; }
        if (level !== "error") return;
        let text = "";
        try { text = typeof message?.text === "function" ? message.text() : String(message || ""); } catch (_) { text = String(message || ""); }
        pageListener("console_error", { text: boundedDiagnosticText(text, 1600) });
      });
    }
    const result = await withTimeout(page.evaluate(() => {
      const api = window.WWebJS;
      if (!api || typeof api.sendMessage !== "function") return { installed: false, reason: "WWebJS.sendMessage unavailable" };
      const existing = api.sendMessage.__waslniSendDiagnosticHook;
      if (existing) return { installed: true, alreadyInstalled: true, hookVersion: existing.version };
      const original = api.sendMessage;
      const pageState = window.__waslniSendDiagnostics || {
        hookVersion: 1,
        installedAt: new Date().toISOString(),
        calls: 0,
        successes: 0,
        failures: 0,
        lastCall: null,
        lastError: null,
      };
      window.__waslniSendDiagnostics = pageState;
      const hooked = async function (...args) {
        const chat = args[0];
        const content = args[1];
        const options = args[2];
        const call = {
          at: new Date().toISOString(),
          chatId: String(chat?._serialized || chat?.id?._serialized || chat?.id || "").slice(0, 120),
          contentType: content === null ? "null" : typeof content,
          contentLength: typeof content === "string" ? content.length : null,
          looksLikeOrder: typeof content === "string" && /(?:^|\s)السعر\s*[0-9٠-٩]+/i.test(content),
          optionKeys: options && typeof options === "object" ? Object.keys(options).slice(0, 40) : [],
        };
        pageState.calls += 1;
        pageState.lastCall = call;
        try {
          const result = await original.apply(this, args);
          pageState.successes += 1;
          pageState.lastResult = { at: new Date().toISOString(), hasResult: Boolean(result), resultType: typeof result };
          return result;
        } catch (error) {
          pageState.failures += 1;
          pageState.lastError = {
            at: new Date().toISOString(),
            name: String(error?.name || "").slice(0, 120),
            message: String(error?.message || error || "").slice(0, 1600),
            stack: String(error?.stack || "").slice(0, 3000),
          };
          throw error;
        }
      };
      Object.defineProperty(hooked, "__waslniSendDiagnosticHook", { value: { version: 1 }, configurable: false });
      Object.defineProperty(hooked, "__waslniOriginal", { value: original, configurable: false });
      api.sendMessage = hooked;
      return { installed: true, alreadyInstalled: false, hookVersion: 1 };
    }), 8000, { installed: false, reason: "page evaluation timeout" });
    whatsappSendDiagnostics.installed = Boolean(result?.installed);
    whatsappSendDiagnostics.installedAt = now();
    whatsappSendDiagnostics.installResult = result;
    console.log(`[WhatsApp][PageDiagnostic] sendMessage hook installed=${whatsappSendDiagnostics.installed} generation=${generation}`);
    return result;
  } catch (error) {
    recordWhatsAppPageDiagnostic("install_failed", { message: boundedDiagnosticText(error?.message || error, 1200), stack: boundedDiagnosticText(error?.stack, 2400) });
    return { installed: false, reason: boundedDiagnosticText(error?.message || error, 400) };
  }
}

async function readWhatsAppSendDiagnostics() {
  const pageState = client?.pupPage && typeof client.pupPage.evaluate === "function"
    ? await withTimeout(client.pupPage.evaluate(() => {
      const state = window.__waslniSendDiagnostics || null;
      return state ? JSON.parse(JSON.stringify(state)) : null;
    }), 5000, null)
    : null;
  return {
    capturedAt: now(),
    ready: Boolean(isReady),
    whatsappState,
    installed: Boolean(whatsappSendDiagnostics.installed),
    storagePressure: { ...whatsappStoragePressure },
    runtime: { ...whatsappSendDiagnostics, pageEvents: whatsappSendDiagnostics.pageEvents.slice(-20) },
    page: pageState,
  };
}

function indexedDbErrorIsActive(pageState) {
  const lastErrorAt = Date.parse(pageState?.lastError?.at || "");
  const lastResultAt = Date.parse(pageState?.lastResult?.at || "");
  if (!pageState?.lastError || !Number.isFinite(lastErrorAt)) return false;
  const errorText = [pageState.lastError.name, pageState.lastError.message, pageState.lastError.stack]
    .filter(Boolean)
    .join(" ");
  if (!/(QuotaExceededError|quota(?:\s|_|-)?exceeded|IndexedDB|storage\s+quota|database\s+full)/i.test(errorText)) return false;
  return !Number.isFinite(lastResultAt) || lastErrorAt >= lastResultAt;
}

function recordStoragePressureAlert(status, reason) {
  if (status !== "critical" || whatsappStoragePressure.alertState === "critical") return;
  whatsappStoragePressure.alertState = "critical";
  try {
    const ownerPhone = ownerNotificationPhones()[0] || "system";
    db.prepare("INSERT INTO notifications(recipient_phone,recipient_role,event,title,message,delivery_status,created_at) VALUES(?,'owner',? ,? ,?,'pending',?)")
      .run(ownerPhone, "whatsapp.indexeddb.quota", "تحذير مساحة WhatsApp Web", `تم إيقاف الإرسال الوقائيًا بسبب ضغط IndexedDB: ${reason}`, now());
  } catch (error) {
    console.warn("[WhatsApp][StoragePressure] could not persist owner alert:", error.message);
  }
}

function updateWhatsAppStoragePressure(snapshot) {
  const previousStatus = whatsappStoragePressure.status;
  const usageRatio = Number.isFinite(Number(snapshot?.usageRatio)) ? Number(snapshot.usageRatio) : null;
  const quotaError = indexedDbErrorIsActive(snapshot?.pageState);
  let status = "unknown";
  let reason = null;
  if (quotaError) {
    status = "critical";
    reason = "QuotaExceededError/IndexedDB send failure";
  } else if (usageRatio !== null && usageRatio >= INDEXEDDB_CRITICAL_RATIO) {
    status = "critical";
    reason = `IndexedDB usage ${(usageRatio * 100).toFixed(1)}%`;
  } else if (usageRatio !== null && usageRatio >= INDEXEDDB_WARNING_RATIO) {
    status = "warning";
    reason = `IndexedDB usage ${(usageRatio * 100).toFixed(1)}%`;
  } else if (usageRatio !== null) {
    status = "normal";
  }
  const blocked = status === "critical";
  whatsappStoragePressure = {
    ...whatsappStoragePressure,
    status,
    blocked,
    reason,
    usageBytes: Number.isFinite(Number(snapshot?.usageBytes)) ? Number(snapshot.usageBytes) : null,
    quotaBytes: Number.isFinite(Number(snapshot?.quotaBytes)) ? Number(snapshot.quotaBytes) : null,
    usageRatio,
    databaseCount: Number.isFinite(Number(snapshot?.databaseCount)) ? Number(snapshot.databaseCount) : null,
    lastCheckedAt: now(),
    lastErrorAt: snapshot?.pageState?.lastError?.at || null,
  };
  if (blocked && previousStatus !== "critical") {
    console.error(`[WhatsApp][StoragePressure] send guard enabled: ${reason}`);
    recordStoragePressureAlert(status, reason);
  } else if (!blocked && previousStatus === "critical") {
    whatsappStoragePressure.alertState = null;
    console.warn(`[WhatsApp][StoragePressure] send guard cleared: ${status}`);
  }
  if (previousStatus !== status) audit("whatsapp.indexeddb.pressure", "system", "whatsapp", { status, reason, usageRatio });
  return whatsappStoragePressure;
}

async function collectWhatsAppStoragePressure() {
  if (!client?.pupPage || !isReady) return updateWhatsAppStoragePressure({ pageState: null });
  const snapshot = await withTimeout(client.pupPage.evaluate(async () => {
    const estimate = await navigator.storage?.estimate?.().catch?.(() => null);
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases().catch(() => []) : [];
    const pageState = window.__waslniSendDiagnostics || null;
    const usageBytes = Number(estimate?.usage || 0);
    const quotaBytes = Number(estimate?.quota || 0);
    return {
      usageBytes,
      quotaBytes,
      usageRatio: quotaBytes > 0 ? usageBytes / quotaBytes : null,
      databaseCount: Array.isArray(databases) ? databases.length : null,
      pageState,
    };
  }), 8000, { pageState: null });
  return updateWhatsAppStoragePressure(snapshot);
}

function isWhatsAppStorageSendBlocked() {
  return Boolean(whatsappStoragePressure.blocked);
}

function installWhatsAppStorageSendGuard(instance) {
  if (!instance || typeof instance.sendMessage !== "function" || instance.__waslniStorageSendGuard) return;
  const originalSendMessage = instance.sendMessage.bind(instance);
  instance.sendMessage = async (...args) => {
    if (isWhatsAppStorageSendBlocked()) {
      whatsappStoragePressure.blockedAttempts += 1;
      const error = new Error("WhatsApp sending paused: IndexedDB storage pressure is critical");
      error.code = "WHATSAPP_INDEXEDDB_SEND_PAUSED";
      throw error;
    }
    return originalSendMessage(...args);
  };
  Object.defineProperty(instance, "__waslniStorageSendGuard", { value: true, configurable: false });
}

function stopWhatsAppStorageMonitor() {
  if (whatsappStorageMonitorTimer) clearInterval(whatsappStorageMonitorTimer);
  whatsappStorageMonitorTimer = null;
}

function startWhatsAppStorageMonitor(generation) {
  stopWhatsAppStorageMonitor();
  const check = async () => {
    if (generation !== connectionGeneration || !isReady) return;
    try { await collectWhatsAppStoragePressure(); }
    catch (error) { recordWhatsAppPageDiagnostic("storage_monitor_failed", { message: boundedDiagnosticText(error?.message || error, 1200) }); }
  };
  void check();
  whatsappStorageMonitorTimer = setInterval(check, INDEXEDDB_MONITOR_INTERVAL_MS);
  whatsappStorageMonitorTimer.unref?.();
}

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
  protocolTimeout: WHATSAPP_PROTOCOL_TIMEOUT_MS,
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
  stopWhatsAppStorageMonitor();
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

function startWhatsAppWatchdog() {
  if (whatsappWatchdogTimer || WHATSAPP_WATCHDOG_INTERVAL_MS <= 0) return;
  whatsappWatchdogTimer = setInterval(() => {
    if (isReady || initializing || reconnectTimer) return;
    if (qrCodeData || whatsappState === "qr" || whatsappState === "wrong_account") {
      console.warn(`[WhatsApp] watchdog waiting for operator action: state=${whatsappState}`);
      return;
    }
    console.warn(`[WhatsApp] watchdog restarting stalled connection: state=${whatsappState || "unknown"}`);
    void restartWhatsApp("automatic watchdog restart").catch((error) => console.error("[WhatsApp] watchdog restart:", error.message));
  }, WHATSAPP_WATCHDOG_INTERVAL_MS);
  whatsappWatchdogTimer.unref?.();
}
let whatsappReactionScanTimer = null;
let whatsappReactionScanRunning = false;
let whatsappHistoricalCandidateRecoveryAttempted = false;
let whatsappHistoricalCandidateRecoveryAt = 0;
let lastHistoricalRecovery = null;
let lastAcceptanceRecovery = null;
function setAcceptanceRecoveryStage(stage) {
  if (lastAcceptanceRecovery) lastAcceptanceRecovery.lastStage = String(stage || "");
}
function startWhatsAppReactionScanner() {
  if (whatsappReactionScanTimer || WHATSAPP_REACTION_SCAN_INTERVAL_MS <= 0) return;
  whatsappReactionScanTimer = setInterval(() => {
    if (!isReady || initializing || whatsappReactionScanRunning) return;
    void scanPendingAcceptanceReactions().catch((error) => console.error("[WhatsApp] reaction scanner:", error.message));
  }, WHATSAPP_REACTION_SCAN_INTERVAL_MS);
  whatsappReactionScanTimer.unref?.();
}
async function recoverHistoricalOrderCandidates(groupId) {
  if ((whatsappHistoricalCandidateRecoveryAttempted && Date.now() - whatsappHistoricalCandidateRecoveryAt < WHATSAPP_HISTORICAL_CANDIDATE_RECOVERY_INTERVAL_MS) || !client || !isReady || !groupId || !isConfiguredGroup(groupId)) return;
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const recovery = { startedAt: new Date().toISOString(), groupKey: orderTraceKey(groupId), scanned: 0, orderMessages: 0, candidatesCreated: 0, unresolved: 0, skipped: 0, source: null, finishedAt: null };
  lastHistoricalRecovery = recovery;
  const fastScan = await fetchGroupOrderScanBatch(groupId, { cutoff, batch: 50, includeOutgoing: true });
  const recoveredMessages = Array.isArray(fastScan.messages) ? fastScan.messages : [];
  recovery.source = "order-scan";
  whatsappHistoricalCandidateRecoveryAttempted = true;
  whatsappHistoricalCandidateRecoveryAt = Date.now();
  let recovered = 0;
  let unresolved = 0;
  const seenMessageIds = new Set();
  for (const message of recoveredMessages) {
    recovery.scanned += 1;
    if (!message || resolveGroupChatId(message) !== groupId || Number(message.timestamp || message.__timestamp || 0) * 1000 < cutoff) continue;
    const messageId = serializedMessageId(message);
    if (!messageId || seenMessageIds.has(messageId)) continue;
    seenMessageIds.add(messageId);
    const parsed = parseOrder(message.body);
    if (!messageId || !parsed.isOrder) continue;
    recovery.orderMessages += 1;
    const existingOrder = findEquivalentOrder(groupId, messageId);
    const existingCandidate = findEquivalentCandidate(groupId, messageId, ["candidate", "pending", "finalized", "cancelled"]);
    if (existingOrder || existingCandidate) { recovery.skipped += 1; continue; }
    const senderPhone = message.fromMe
      ? connectedBotPhone()
      : await resolveMessageSenderPhone(message);
    const senderName = message.fromMe
      ? `${COMPANY_BRAND_NAME} — المنتج الأساسي`
      : String(message.__notifyName || message.notifyName || message.author?.pushname || message.author?.name || displayPhone(senderPhone)).trim();
    const producer = message.fromMe
      ? companyUser()
      : ensureProducerUser(senderPhone, senderName);
    if (!producer || producer.active === 0) {
      unresolved += 1;
      recovery.unresolved += 1;
      logOrderTrace("historical_order_producer_unresolved", {
        groupKey: orderTraceKey(groupId),
        sourceKey: orderTraceKey(messageId),
        fromMe: Boolean(message.fromMe),
        senderKey: orderTraceKey(senderPhone),
      });
      continue;
    }
    const candidate = producer ? createOrderCandidate({ messageId, groupId, body: String(message.body || ""), producer, parsed }) : null;
    if (candidate) { recovered += 1; recovery.candidatesCreated += 1; }
  }
  recovery.finishedAt = new Date().toISOString();
  if (recovered || unresolved) console.log(`[WhatsApp] historical order recovery: recovered=${recovered} unresolved=${unresolved} source=${fastScan.chat ? "order-scan" : "history"}`);
}
async function recoverPendingAcceptanceMessages(groupId) {
  if (!client || !isReady || !groupId || !isConfiguredGroup(groupId)) return;
  const pendingCandidates = db.prepare("SELECT c.source_message_id FROM order_candidates c LEFT JOIN order_candidate_acceptances a ON a.candidate_id=c.id WHERE c.group_id=? AND c.status IN ('candidate','pending') AND a.id IS NULL AND c.source_message_id IS NOT NULL ORDER BY c.updated_at DESC LIMIT ?").all(groupId, WHATSAPP_REACTION_SCAN_LIMIT);
  lastAcceptanceRecovery = { startedAt: new Date().toISOString(), groupKey: orderTraceKey(groupId), pendingCandidates: pendingCandidates.length, scanned: 0, quoteLookupAttempts: 0, quoteFallbackMatches: 0, quotedMatches: 0, recovered: 0, errors: 0, lastError: null, lastStage: "started", finishedAt: null };
  if (!pendingCandidates.length) { lastAcceptanceRecovery.finishedAt = new Date().toISOString(); return; }
  const pendingSourceIds = new Set(pendingCandidates.map((row) => String(row.source_message_id || "")).filter(Boolean));
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const fastScan = await fetchGroupOrderScanBatch(groupId, { cutoff, batch: 50, includeOutgoing: true });
  const scan = { messages: Array.isArray(fastScan.messages) ? fastScan.messages : [] };
  let recovered = 0;
  for (const row of Array.isArray(scan.messages) ? scan.messages : []) {
    lastAcceptanceRecovery.scanned += 1;
    if (!row || row.fromMe || !row.id || !isCaptainAcceptance(row.body)) continue;
    const existing = db.prepare("SELECT 1 FROM order_candidate_acceptances WHERE acceptance_message_id=? LIMIT 1").get(row.id);
    if (existing) continue;
    const live = await withTimeout(client.getMessageById(row.id), 12000, null);
    const acceptance = live || row;
    if (!acceptance) continue;
    lastAcceptanceRecovery.quoteLookupAttempts += 1;
    const quoted = await getQuotedMessageWithFallback(acceptance);
    if (quoted) {
      acceptance.__quoted = quoted;
      acceptance.__quotedMessageId = serializedMessageId(quoted);
      lastAcceptanceRecovery.quoteFallbackMatches += 1;
    }
    const sourceId = serializedMessageId(quoted);
    const matchingPendingSourceId = sourceId && Array.from(pendingSourceIds).find((pendingSourceId) => sourceMessageIdsEqual(pendingSourceId, sourceId));
    if (!matchingPendingSourceId || !parseOrder(quoted?.body).isOrder) continue;
    lastAcceptanceRecovery.quotedMatches += 1;
    setAcceptanceRecoveryStage("before_handle_incoming_message");
    try {
      await handleIncomingMessage(acceptance, { allowSelf: true });
      setAcceptanceRecoveryStage("after_handle_incoming_message");
    } catch (error) {
      lastAcceptanceRecovery.errors = Number(lastAcceptanceRecovery.errors || 0) + 1;
      lastAcceptanceRecovery.lastError = String(error?.message || error).slice(0, 180);
      setAcceptanceRecoveryStage("handle_incoming_message_error");
    }
    const recorded = findPendingAcceptanceByMessage(groupId, row.id);
    if (recorded) { recovered += 1; lastAcceptanceRecovery.recovered += 1; }
  }
  lastAcceptanceRecovery.finishedAt = new Date().toISOString();
  if (recovered) console.log(`[WhatsApp] recovered ${recovered} quoted pending acceptance message(s)`);
}
async function scanPendingAcceptanceReactions() {
  if (!client || !isReady || whatsappReactionScanRunning) return;
  const groupId = configuredRuntimeGroupId();
  if (!groupId || !isConfiguredGroup(groupId)) return;
  whatsappReactionScanRunning = true;
  try {
    await recoverHistoricalOrderCandidates(groupId);
    await recoverPendingAcceptanceMessages(groupId);
    const rows = db.prepare("SELECT DISTINCT a.acceptance_message_id AS message_id FROM order_candidate_acceptances a JOIN order_candidates c ON c.id=a.candidate_id WHERE c.group_id=? AND c.status IN ('candidate','pending') AND a.status='pending' AND a.acceptance_message_id IS NOT NULL ORDER BY a.updated_at DESC LIMIT ?").all(groupId, WHATSAPP_REACTION_SCAN_LIMIT);
    for (const row of rows) {
      try { await reconcileStoredThumbReaction(row.message_id); } catch (error) { console.warn(`[WhatsApp] reaction scan message failed: ${String(row.message_id).slice(0, 80)} ${String(error?.message || error)}`); }
    }
    await retryFailedBookingConfirmations(groupId);
    if (rows.length) console.log(`[WhatsApp] stored reaction scan checked ${rows.length} pending acceptance message(s)`);
  } finally {
    whatsappReactionScanRunning = false;
  }
}
const recentMessageEventKeys = new Map();
const MESSAGE_EVENT_DEDUP_TTL_MS = 10 * 60 * 1000;
function shouldHandleMessageEvent(msg, eventName) {
  const serializedId = String(msg?.id?._serialized || msg?.id?.id || "").trim();
  if (!serializedId) return true;
  const key = `${String(eventName || "message")}:${serializedId}`;
  const currentTime = Date.now();
  for (const [storedKey, seenAt] of recentMessageEventKeys) {
    if (currentTime - seenAt > MESSAGE_EVENT_DEDUP_TTL_MS) recentMessageEventKeys.delete(storedKey);
  }
  if (recentMessageEventKeys.has(key)) {
    console.log(`[WhatsApp] duplicate ${eventName} event ignored`);
    return false;
  }
  recentMessageEventKeys.set(key, currentTime);
  if (recentMessageEventKeys.size > 5000) {
    const oldestKey = recentMessageEventKeys.keys().next().value;
    if (oldestKey) recentMessageEventKeys.delete(oldestKey);
  }
  return true;
}
const captainAccessCardAckCache = new Map();
async function handleCaptainAccessCardAck(messageOrId, ack) {
  const messageId = typeof messageOrId === "string" ? messageOrId : serializedMessageId(messageOrId);
  if (!messageId || Number(ack) < 2) return;
  const cardNotice = db.prepare("SELECT id,recipient_phone,source_message_id FROM notifications WHERE event='captain.access_card.sent' AND source_message_id=? ORDER BY id DESC LIMIT 1").get(messageId);
  if (!cardNotice) {
    captainAccessCardAckCache.set(messageId, { ack: Number(ack), at: Date.now() });
    for (const [key, value] of captainAccessCardAckCache) if (Date.now() - value.at > 10 * 60 * 1000) captainAccessCardAckCache.delete(key);
    return;
  }
  const notice = await sendCaptainStatusText({
    phone: cardNotice.recipient_phone,
    event: "captain.access_card.delivered",
    title: "تسليم بطاقة الدخول",
    text: "تم تسليم بطاقة الدخول إلى واتسابك.",
    idempotencyKey: `CAPTAIN-ACCESS-DELIVERED-${cardNotice.id}`,
    sourceMessageId: messageId,
  });
  db.prepare("UPDATE notifications SET delivery_status='delivered' WHERE id=? AND delivery_status IN ('sent','delivered')").run(cardNotice.id);
  audit("captain.access_card.delivered", "user", cardNotice.recipient_phone, { sourceMessageId: messageId, deliveryStatus: notice.status, ack: Number(ack) });
  captainAccessCardAckCache.delete(messageId);
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
    void installWhatsAppSendDiagnostics(instance, generation)
      .then(() => startWhatsAppStorageMonitor(generation))
      .catch((error) => {
        recordWhatsAppPageDiagnostic("install_unhandled_failure", { message: boundedDiagnosticText(error?.message || error, 1200), stack: boundedDiagnosticText(error?.stack, 2400) });
        startWhatsAppStorageMonitor(generation);
      });
    setTimeout(() => {
      if (generation !== connectionGeneration || !isReady) return;
      void normalizeAllCaptains()
        .then(async (normalization) => {
          if (normalization.status !== "already_completed") return normalization;
          const result = await registerGroupMembersAsCaptains({ sendLinks: false, reactivate: true });
          console.log(`[Captains] configured group sync completed: members=${result.resolvedMembers || 0} registered=${(result.results || []).filter((item) => item.status === "registered").length} activated=${(result.results || []).filter((item) => item.status === "activated_captain").length}`);
          return result;
        })
        .catch((error) => console.error("[Captains] configured group sync failed:", error.message));
      void retryCaptainStatusNotifications()
        .then((result) => { if (result.attempted) console.log(`[Captains] retried pending status notifications: ${result.attempted}`); })
        .catch((error) => console.error("[Captains] status notification retry failed:", error.message));
    }, 3000);
  });
  instance.on("auth_failure", (message) => {
    whatsappState = "auth_failure";
    whatsappLastEvent = "auth_failure";
    whatsappLastError = String(message || "authentication failure");
    if (generation !== connectionGeneration) return;
    stopWhatsAppStorageMonitor();
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
    stopWhatsAppStorageMonitor();
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
  instance.on("group_join", (notification) => {
    if (generation !== connectionGeneration || !notification || !isConfiguredGroup(notification.chatId)) return;
    scheduleConfiguredGroupCaptainSync("group_join");
    console.log(`[Captains] configured group member joined; activation sync scheduled recipients=${Array.isArray(notification.recipientIds) ? notification.recipientIds.length : 0}`);
  });
  instance.on("message_create", async (msg) => {
    if (generation !== connectionGeneration || !msg || !msg.fromMe || !shouldHandleMessageEvent(msg, "message_create")) return;
    observeAdminSentMessage(msg);
    observeFinalBookingConfirmationMessage(msg);
    recordGroupMessageTelemetry("message_create", msg);
    if (isConfiguredGroup(msg.from)) scheduleConfiguredGroupCaptainSync("message_create");
    try { await handleIncomingMessage(msg, { allowSelf: true }); } catch (error) { console.error("[WhatsApp] own message handler:", error); }
  });
  instance.on("message_ack", async (msg, ack) => {
    if (generation !== connectionGeneration) return;
    try { await handleCaptainAccessCardAck(msg, ack); } catch (error) { console.error("[WhatsApp] captain card ack:", error); }
  });
  instance.on("message", async (msg) => {
    if (generation !== connectionGeneration || !shouldHandleMessageEvent(msg, "message")) return;
    recordGroupMessageTelemetry("message", msg);
    if (isConfiguredGroup(msg.from)) scheduleConfiguredGroupCaptainSync("message");
    try { await handleIncomingMessage(msg, { allowSelf: true }); } catch (error) { console.error("[WhatsApp] message handler:", error); }
  });
  instance.on("message_reaction", async (reaction) => {
    if (generation !== connectionGeneration) return;
    try { await handleMessageReaction(reaction); } catch (error) { console.error("[WhatsApp] reaction handler:", error); }
    const reactionValue = String(reaction?.reaction || "").trim();
    if (reactionValue === "👍" || reactionValue === "❌") {
      for (const delay of [1500, 5000]) {
        setTimeout(() => {
          if (generation !== connectionGeneration || !isReady) return;
          void handleMessageReaction(reaction).catch((error) => console.error("[WhatsApp] reaction retry:", error));
          void reconcileStoredThumbReaction(reaction?.msgId).catch((error) => console.error("[WhatsApp] stored reaction retry:", error));
        }, delay);
      }
    }
  });
  installWhatsAppStorageSendGuard(instance);
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
  const serialize = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (value._serialized) return String(value._serialized);
    if (value.server && value.user) return `${value.user}@${value.server}`;
    return "";
  };
  const candidates = [message && message.from, message && message.to, message && message.id && message.id.remote, message && message.id?._data?.remote];
  return candidates.map(serialize).find((value) => value.endsWith("@g.us")) || "";
}
function serializedMessageId(message) {
  const raw = message && message.id;
  return String(
    message?.__serializedId ||
    (typeof raw === "string" ? raw : "") ||
    raw?._serialized ||
    raw?.id ||
    message?._data?.id ||
    message?._data?.key?.id ||
    ""
  ).trim() || null;
}
function messageIdCore(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const decorated = raw.match(/^(?:true|false)_([^_]+@g\.us)_([^_]+)(?:_|$)/i);
  return decorated ? decorated[2] : raw;
}
function sourceMessageIdsEqual(left, right) {
  const leftCore = messageIdCore(left);
  const rightCore = messageIdCore(right);
  return Boolean(leftCore && rightCore && leftCore === rightCore);
}
function findEquivalentCandidate(groupId, messageId, statuses = ["candidate", "pending"]) {
  if (!groupId || !messageId) return null;
  const placeholders = statuses.map(() => "?").join(",");
  const core = messageIdCore(messageId);
  if (!core) return null;
  const escapedCore = core.replace(/[\\%_]/g, "\\$&");
  const rows = db.prepare(`SELECT * FROM order_candidates
    WHERE group_id=? AND source_message_id LIKE ? ESCAPE '\\' AND status IN (${placeholders})
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, id DESC LIMIT 100`).all(groupId, `%${escapedCore}%`, ...statuses);
  return rows.find((row) => sourceMessageIdsEqual(row.source_message_id, messageId)) || null;
}
function findEquivalentOrder(groupId, messageId) {
  if (!groupId || !messageId) return null;
  const core = messageIdCore(messageId);
  if (!core) return null;
  const escapedCore = core.replace(/[\\%_]/g, "\\$&");
  const rows = db.prepare("SELECT * FROM orders WHERE group_id=? AND source_message_id LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 100").all(groupId, `%${escapedCore}%`);
  return rows.find((row) => sourceMessageIdsEqual(row.source_message_id, messageId)) || null;
}

function orderTraceKey(value) {
  const normalized = String(value || "").trim();
  return normalized ? crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 12) : null;
}

function logOrderTrace(event, details = {}) {
  const safeDetails = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
  console.log(`[OrderTrace] ${event} ${JSON.stringify(safeDetails)}`);
}

const whatsappLidPhoneCache = new Map();
function serializedWhatsappUserId(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (value._serialized) return String(value._serialized).trim();
  if (value.id) return serializedWhatsappUserId(value.id);
  if (value.user && value.server) return `${value.user}@${value.server}`;
  return "";
}
function directJordanPhoneFromWhatsappValue(value) {
  if (!value) return "";
  const serialized = serializedWhatsappUserId(value);
  if (/@lid$/i.test(serialized)) return "";
  const raw = typeof value === "object"
    ? (value.number || value.userid || value.phoneNumber?.user || value.phoneNumber?._serialized || serialized)
    : serialized;
  const normalized = phoneWithCountry(String(raw || "").split("@")[0].split(":")[0]);
  return isValidJordanPhone(normalized) ? normalized : "";
}
async function resolveWhatsappLidsFromConfiguredGroup(lidIds) {
  if (!client?.pupPage || !isReady || !Array.isArray(lidIds) || !lidIds.length) return [];
  const groupId = configuredRuntimeGroupId();
  if (!groupId || !isConfiguredGroup(groupId)) return [];
  await readGroupSnapshot(groupId);
  return withTimeout(client.pupPage.evaluate((requestedLids) => {
    try {
      const widFactory = window.require("WAWebWidFactory");
      const { toPn } = window.require("WAWebLidMigrationUtils");
      return requestedLids.map((lid) => {
        const lidWid = widFactory.createWid(lid);
        const phoneWid = toPn(lidWid) || null;
        const pn = phoneWid && (phoneWid._serialized || (phoneWid.user && phoneWid.server ? `${phoneWid.user}@${phoneWid.server}` : String(phoneWid)));
        return { lid, pn: pn || null };
      }).filter((mapping) => mapping.pn);
    } catch (_) {
      return [];
    }
  }, lidIds), 12000, []);
}
async function resolveWhatsappLidsDirectFromPage(lidIds) {
  if (!client?.pupPage || !isReady || !Array.isArray(lidIds) || !lidIds.length) return [];
  return withTimeout(client.pupPage.evaluate((requestedLids) => {
    try {
      const widFactory = window.require("WAWebWidFactory");
      const { toPn } = window.require("WAWebLidMigrationUtils");
      return requestedLids.map((lid) => {
        const lidWid = widFactory.createWid(lid);
        const phoneWid = toPn(lidWid) || null;
        const pn = phoneWid && (phoneWid._serialized || (phoneWid.user && phoneWid.server ? `${phoneWid.user}@${phoneWid.server}` : String(phoneWid)));
        return { lid, pn: pn || null };
      }).filter((mapping) => mapping.pn);
    } catch (_) {
      return [];
    }
  }, lidIds), 12000, []);
}
async function resolveWhatsappUserPhone(...values) {
  for (const value of values) {
    const direct = directJordanPhoneFromWhatsappValue(value);
    if (direct) return direct;
  }
  const lidIds = [...new Set(values.map(serializedWhatsappUserId).filter((id) => /@lid$/i.test(id)))];
  for (const lid of lidIds) {
    const persisted = typeof findPersistedWhatsappPhone === "function" ? findPersistedWhatsappPhone(lid) : "";
    if (persisted) {
      whatsappLidPhoneCache.set(lid, persisted);
      return persisted;
    }
    const cached = whatsappLidPhoneCache.get(lid);
    if (cached && isValidJordanPhone(cached)) return cached;
  }
  if (!client || !isReady || !lidIds.length) return "";
  if (typeof client.getContactLidAndPhone === "function") {
    try {
      const mappings = await withTimeout(client.getContactLidAndPhone(lidIds), 12000, []);
      for (let index = 0; index < lidIds.length; index += 1) {
        const mapping = Array.isArray(mappings) ? mappings[index] : null;
        const phone = directJordanPhoneFromWhatsappValue(mapping?.pn || mapping?.phone);
        if (!phone) continue;
        const lid = serializedWhatsappUserId(mapping?.lid) || lidIds[index];
        whatsappLidPhoneCache.set(lid, phone);
        whatsappLidPhoneCache.set(lidIds[index], phone);
        if (typeof persistWhatsappIdentity === "function") persistWhatsappIdentity(lid, phone, "getContactLidAndPhone");
        return phone;
      }
    } catch (error) {
      console.warn(`[WhatsApp] LID phone resolution failed: ${String(error?.message || error)}`);
    }
  }
  const directMappings = await resolveWhatsappLidsDirectFromPage(lidIds);
  for (const mapping of Array.isArray(directMappings) ? directMappings : []) {
    const phone = directJordanPhoneFromWhatsappValue(mapping?.pn || mapping?.phone);
    const lid = serializedWhatsappUserId(mapping?.lid);
    if (!phone || !lidIds.includes(lid)) continue;
    whatsappLidPhoneCache.set(lid, phone);
    if (typeof persistWhatsappIdentity === "function") persistWhatsappIdentity(lid, phone, "direct_toPn");
    console.log(`[WhatsApp] LID resolved directly with toPn: ${orderTraceKey(lid)}`);
    return phone;
  }
  const groupMappings = await resolveWhatsappLidsFromConfiguredGroup(lidIds);
  for (const mapping of Array.isArray(groupMappings) ? groupMappings : []) {
    const phone = directJordanPhoneFromWhatsappValue(mapping?.pn || mapping?.phone);
    const lid = serializedWhatsappUserId(mapping?.lid);
    if (!phone || !lidIds.includes(lid)) continue;
    whatsappLidPhoneCache.set(lid, phone);
    if (typeof persistWhatsappIdentity === "function") persistWhatsappIdentity(lid, phone, "configured_group_toPn");
    console.log(`[WhatsApp] LID resolved from configured group membership: ${orderTraceKey(lid)}`);
    return phone;
  }
  return "";
}
async function resolveMessageSenderPhone(message, knownContact = null) {
  if (message?.fromMe) return connectedBotPhone();
  let contact = knownContact;
  if (!contact && typeof message?.getContact === "function") {
    contact = await withTimeout(message.getContact(), 8000, null);
  }
  const resolved = await resolveWhatsappUserPhone(
    contact,
    contact?.number,
    contact?.id,
    contact?._data?.id,
    contact?._data?.userid,
    message?.__authorPhone,
    message?.author,
    message?._data?.author,
    message?.id?.participant,
    message?._data?.id?.participant,
    message?._data?.participant,
  );
  if (resolved) {
    for (const value of [contact?.id, contact?._data?.id, message?.author, message?._data?.author, message?.id?.participant]) {
      if (/@lid$/i.test(serializedWhatsappUserId(value)) && typeof persistWhatsappIdentity === "function") persistWhatsappIdentity(value, resolved, "message_sender");
    }
  }
  return resolved;
}

function recordGroupMessageTelemetry(event, msg) {
  const groupId = resolveGroupChatId(msg);
  if (!groupId) return;
  const configured = isConfiguredGroup(groupId);
  const telemetry = {
    at: now(),
    event,
    fromMe: Boolean(msg.fromMe),
    configured,
    hasQuotedMessage: Boolean(msg.hasQuotedMsg),
    messageId: String(msg?.id?._serialized || msg?.id?.id || msg?._data?.id || msg?._data?.key?.id || "").trim() || null,
    quotedMessageId: String(msg?.quotedMsg?.id?._serialized || msg?._data?.quotedMsg?.id?._serialized || "").trim() || null,
  };
  // Keep the general last-event fields for backward compatibility, but retain
  // separate official/ignored streams so an unrelated group cannot overwrite
  // the official group's diagnostic status.
  lastGroupEventGroupId = groupId;
  lastGroupMessageTelemetry = telemetry;
  if (configured) {
    lastOfficialGroupEventGroupId = groupId;
    lastOfficialGroupMessageTelemetry = telemetry;
  } else {
    lastIgnoredGroupEventGroupId = groupId;
    lastIgnoredGroupMessageTelemetry = telemetry;
  }
  console.log(`[GroupEvent] ${event} fromMe=${Boolean(msg.fromMe)} configured=${configured} quoted=${telemetry.hasQuotedMessage}`);
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

async function reactToCaptainAcceptance(message, messageId) {
  const liveMessage = client && isReady && messageId
    ? await withTimeout(client.getMessageById(messageId), 12000, null)
    : null;
  const target = liveMessage || message;
  if (!target || typeof target.react !== "function") return false;
  try {
    await withTimeout(target.react("👍"), 12000, null);
    return true;
  } catch (error) {
    console.error("[WhatsApp] captain acceptance reaction:", error.message);
    return false;
  }
}

async function approveBotOwnedAcceptance({ groupId, message, candidateId, acceptanceMessageId }) {
  // A booking published by the bot is approved by the bot itself. The app/dashboard
  // is only an observer here; settlement remains atomic and idempotent in the DB.
  const result = settlePendingOrder(candidateId, acceptanceMessageId, connectedBotPhone());
  if (result.state === "accepted") {
    const confirmationDetails = {
      orderNo: result.order?.order_no,
      orderId: result.order?.id,
      executorName: result.captain?.name,
      downloaderName: result.producer?.name,
      priceCents: result.order?.price_cents,
    };
    void sendFinalBookingConfirmation(groupId, confirmationDetails).catch((error) => {
      console.warn(`[Order] bot-owned confirmation card failed: ${String(error?.message || error)}`);
    });
    audit("order.bot_owned.accepted_directly", "order", result.order?.id, {
      candidateId,
      acceptanceMessageId,
      confirmedBy: connectedBotPhone(),
      confirmationText: finalBookingConfirmationText(confirmationDetails),
    });
    console.log(`[Order] bot-owned booking accepted directly #${result.order?.order_no || "?"}`);
  } else if (result.state !== "stale") {
    console.warn(`[Order] bot-owned booking approval blocked candidate=${candidateId} state=${result.state}`);
  }

  // Presentation only: failure to add 👍 must never undo or block an accepted settlement.
  if (result.state === "accepted") await reactToCaptainAcceptance(message, acceptanceMessageId);
  return result;
}

async function getQuotedMessageWithFallback(message) {
  let quoted = message?.hasQuotedMsg && typeof message.getQuotedMessage === "function"
    ? await withTimeout(message.getQuotedMessage(), 8000, null)
    : null;
  if (!quoted) quoted = message?.__quoted || message?.quotedMsg || message?._data?.quotedMsg || null;
  if (!quoted) {
    const quotedMessageId = String(
      message?.quotedStanzaID ||
      message?.quotedMessageId ||
      message?._data?.quotedStanzaID ||
      message?._data?.quotedMessageId ||
      message?._data?.quotedMsgId ||
      message?._data?.quotedMsg?.id?._serialized ||
      ""
    ).trim();
    if (quotedMessageId && client && typeof client.getMessageById === "function") {
      quoted = await withTimeout(client.getMessageById(quotedMessageId), 12000, null);
    }
  }
  if (!quoted && typeof client !== "undefined" && client?.pupPage) {
    const messageId = serializedMessageId(message);
    const quotedMessageId = String(
      message?.quotedStanzaID ||
      message?.quotedMessageId ||
      message?._data?.quotedStanzaID ||
      message?._data?.quotedMessageId ||
      message?._data?.quotedMsgId ||
      message?._data?.quotedMsg?.id?._serialized ||
      ""
    ).trim();
    if (messageId || quotedMessageId) {
      quoted = await withTimeout(client.pupPage.evaluate(async ({ messageId: requestedMessageId, quotedMessageId: requestedQuotedId }) => {
        try {
          const collections = window.require("WAWebCollections");
          const rawId = String(requestedMessageId || "").split("_").slice(2).join("_");
          const rawQuotedId = String(requestedQuotedId || "").split("_").slice(2).join("_");
          const ids = [...new Set([requestedMessageId, rawId, requestedQuotedId, rawQuotedId].filter(Boolean))];
          let model = null;
          for (const id of ids) {
            model = collections.Msg?.get?.(id) || null;
            if (model) break;
          }
          if (!model && collections.Msg?.getMessagesById) {
            const loaded = await collections.Msg.getMessagesById(ids);
            model = Array.isArray(loaded?.messages) ? loaded.messages[0] : null;
          }
          if (!model) return null;
          let quotedModel = null;
          try {
            quotedModel = window.require("WAWebQuotedMsgModelUtils").getQuotedMsgObj(model);
          } catch (_) {}
          if (!quotedModel) return null;
          const serialized = window.WWebJS?.getMessageModel
            ? window.WWebJS.getMessageModel(quotedModel)
            : (typeof quotedModel.serialize === "function" ? quotedModel.serialize() : quotedModel);
          if (!serialized) return null;
          serialized.__serializedId = quotedModel.id?._serialized || serialized.id?._serialized || serialized.id || null;
          serialized.__timestamp = Number(quotedModel.t || serialized.timestamp || 0) || null;
          serialized.fromMe = Boolean(quotedModel.id?.fromMe || serialized.fromMe);
          serialized.body = String(quotedModel.body || quotedModel.text || serialized.body || serialized.caption || "");
          serialized.from = quotedModel.from?._serialized || serialized.from || "";
          serialized.to = quotedModel.to?._serialized || serialized.to || "";
          return serialized;
        } catch (_) {
          return null;
        }
      }, { messageId, quotedMessageId }), 15000, null);
    }
  }
  return quoted;
}

async function handleIncomingMessage(msg, { allowSelf = false } = {}) {
  if (!msg || (msg.fromMe && !allowSelf)) return;
  const groupId = resolveGroupChatId(msg);
  const isGroup = Boolean(groupId);
  if (!isGroup) return msg.fromMe ? undefined : handleCustomerMessage(msg);
  const body = String(msg.body || "").trim();
  const configuredEnvironmentGroup = typeof WHATSAPP_GROUP_ID === "string" ? WHATSAPP_GROUP_ID : "";
  if (configuredEnvironmentGroup && groupId !== configuredEnvironmentGroup) return;
  const setupCommand = /^#(?:اعتماد|ربط|اعتمد)\s*(?:القروب|المجموعة)?$/i.test(body);
  const contact = msg.fromMe ? null : await withTimeout(msg.getContact(), 8000, null);
  const senderPhone = msg.fromMe ? connectedBotPhone() : await resolveMessageSenderPhone(msg, contact);
  const primarySender = Boolean(msg.fromMe) && senderPhone === connectedBotPhone();
  if (!isConfiguredGroup(groupId)) {
    if (setupCommand) {
      lastGroupSetupProbe = { at: now(), fromMe: Boolean(msg.fromMe), senderResolved: Boolean(senderPhone), primarySender, ownerSender: isGroupSetupOwner(senderPhone) };
      console.log(`[GroupSetup] setup command observed: fromMe=${Boolean(msg.fromMe)} senderResolved=${Boolean(senderPhone)} primary=${primarySender} owner=${isGroupSetupOwner(senderPhone)}`);
    }
    const selfSetup = primarySender || senderPhone === phoneWithCountry(BOT_PHONE);
    if (setupCommand && (selfSetup || isGroupSetupOwner(senderPhone))) {
      configureGroupId(groupId, `${COMPANY_BRAND_NAME} | شبكة التشغيل الرسمية`);
      console.log(`[GroupSetup] configured group from ${selfSetup ? "primary bot command" : "owner command"}: ${groupId}`);
    }
    return;
  }
  const botGenerated = isBotGeneratedMessage(msg);
  // رسائل البوت العادية ليست رسائل تشغيلية ولا تُحفظ؛ الطلب المنسّق فقط يُسجّل باسم الشركة.
  if (botGenerated && !parseOrder(body).isOrder) return;
  const captainAcceptance = isCaptainAcceptance(body);
  const senderName = msg.fromMe ? `${COMPANY_BRAND_NAME} — المنتج الأساسي` : ((contact && (contact.pushname || contact.name)) || msg._data?.notifyName || displayPhone(senderPhone));
  let insertedMessage = { changes: 0 };
  if (body) {
    const stamp = now();
    const messageId = String(msg?.id?._serialized || msg?.id?.id || msg?._data?.id || msg?._data?.key?.id || "").trim() || null;
    if (messageId) {
      insertedMessage = db.prepare("INSERT OR IGNORE INTO messages(message_id,group_id,sender_phone,sender_name,body,message_type,sent_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run(messageId, groupId, senderPhone, senderName, body, msg.type || "text", new Date(Number(msg.timestamp || Date.now() / 1000) * 1000).toISOString(), stamp);
    }
  }
  const quotedForRecovery = await getQuotedMessageWithFallback(msg);
  if (isQuotedOrderRecoveryCommand({ body, fromMe: Boolean(msg.fromMe), groupId, quoted: quotedForRecovery })) {
    const sourceMessageId = quotedForRecovery.id._serialized;
    const existing = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(sourceMessageId);
    if (existing) {
      return;
    }
    await handleIncomingMessage(quotedForRecovery, { allowSelf: true });
    const recovered = db.prepare("SELECT id,status FROM order_candidates WHERE source_message_id=? LIMIT 1").get(sourceMessageId);
    if (recovered) {
      audit("order.candidate.recovered_from_quoted_message", "order_candidate", recovered.id, { groupId, sourceMessageId });
    }
    return;
  }
  // Keep normal messages idempotent, but replay a stored «تم» so a late
  // reaction or a reconnect can still create its pending acceptance row.
  if (!insertedMessage.changes && !captainAcceptance) return;
  if (!insertedMessage.changes && captainAcceptance) {
    logOrderTrace("acceptance_message_replayed_after_duplicate_guard", {
      groupKey: orderTraceKey(groupId),
      senderKey: orderTraceKey(senderPhone),
    });
  }
  if (isBlockedPhone(senderPhone)) {
    console.warn(`[Policy] blocked phone ignored: ${senderPhone}`);
    return;
  }
  if (!body) return;
  const messageId = String(msg?.id?._serialized || msg?.id?.id || msg?._data?.id || msg?._data?.key?.id || "").trim() || null;
  if (!messageId) {
    if (captainAcceptance) {
      logOrderTrace("acceptance_missing_message_id", {
        groupKey: orderTraceKey(groupId),
        senderKey: orderTraceKey(senderPhone),
      });
    }
    return;
  }
  const parsed = parseOrder(body);
  if (parsed.isOrder) {
    const producer = botGenerated
      ? (BOT_FINANCIAL_MODE === "company" ? companyUser() : botEmployeeUser())
      : ensureProducerUser(senderPhone, senderName);
    if (!producer || producer.active === 0) return;
    const candidate = createOrderCandidate({ messageId, groupId, body, producer, parsed });
    if (!candidate) return;
    return;
  }
  if (!captainAcceptance) return;
  logOrderTrace("acceptance_received", {
    groupKey: orderTraceKey(groupId),
    acceptanceKey: orderTraceKey(messageId),
    senderKey: orderTraceKey(senderPhone),
    hasQuotedMsg: Boolean(msg.hasQuotedMsg),
  });
  // «تم» لا يُربط بآخر طلب بشكل تخميني؛ يجب أن يقتبس رسالة السعر نفسها.
  const quoted = await getQuotedMessageWithFallback(msg);
  if (!quoted) {
    logOrderTrace("acceptance_missing_quote", {
      groupKey: orderTraceKey(groupId),
      acceptanceKey: orderTraceKey(messageId),
      quotedLookupAttempted: Boolean(msg.hasQuotedMsg),
    });
    return;
  }
  const candidate = quoted ? findOrderByQuotedMessage(groupId, quoted) : null;
  if (!candidate) {
    logOrderTrace("acceptance_candidate_not_found", {
      groupKey: orderTraceKey(groupId),
      acceptanceKey: orderTraceKey(messageId),
      quotedKey: orderTraceKey(serializedMessageId(quoted)),
      quotedIsOrder: parseOrder(quoted.body).isOrder,
      quotedBodyKey: orderTraceKey(quoted.body),
    });
    return;
  }
  const acceptanceResult = registerQuotedAcceptance({
    groupId,
    messageId,
    senderPhone,
    senderName,
    candidate: {
      ...candidate,
      acceptance_author: msg?.author,
      acceptance_author_lid: msg?._data?.author || msg?.id?.participant || msg?._data?.id?.participant,
    },
  });
  if (["captain_ineligible", "producer_missing_or_same_captain", "not_recorded", "transition_failed"].includes(acceptanceResult.state)) {
    logOrderTrace(`acceptance_${acceptanceResult.state}`, {
      groupKey: orderTraceKey(groupId),
      acceptanceKey: orderTraceKey(messageId),
      candidateId: candidate.id,
      senderKey: orderTraceKey(senderPhone),
    });
    return;
  }
  if (acceptanceResult.state === "duplicate") {
    logOrderTrace("acceptance_duplicate_or_already_recorded", {
      groupKey: orderTraceKey(groupId),
      acceptanceKey: orderTraceKey(messageId),
      candidateId: candidate.id,
      captainId: acceptanceResult.captain?.id,
    });
    return;
  }
  const captain = acceptanceResult.captain;
  const producer = acceptanceResult.producer;
  const acceptanceMessageId = messageId;
  logOrderTrace("acceptance_recorded", {
    groupKey: orderTraceKey(groupId),
    acceptanceKey: orderTraceKey(acceptanceMessageId),
    candidateId: candidate.id,
    captainId: captain.id,
    producerId: producer.id,
  });
  if (producer.is_bot === 1 || producer.role === "company") {
    void approveBotOwnedAcceptance({ groupId, message: msg, candidateId: candidate.id, acceptanceMessageId })
      .catch((error) => console.error(`[WhatsApp] bot-owned acceptance settlement failed: ${error.message}`));
    return;
  }
  // Human-owned bookings still use the producer's 👍 on this exact quoted reply.
  if (msg.hasReaction || msg.__hasReaction || msg._data?.hasReaction) {
    void reconcileStoredThumbReaction(messageId);
  }
}

function reactionId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value._serialized || value.id || null;
}

function reactionEvidenceSenderKey(reaction, senderPhone = "") {
  const values = reactionSenderValues(reaction);
  return String(values[0] || senderPhone || "anonymous").trim() || "anonymous";
}

function reactionEvidenceMessageKey(messageId) {
  const normalized = serializedMessageId({ id: messageId }) || String(messageId || "").trim();
  return messageIdCore(normalized) || normalized;
}

function recordReactionEvidence({ messageId, groupId, emoji, reaction, senderPhone = "", source = "live-message-reaction" }) {
  const normalizedMessageId = reactionEvidenceMessageKey(messageId);
  const normalizedGroupId = String(groupId || "").trim();
  const normalizedEmoji = String(emoji || "").trim();
  if (!normalizedMessageId || !normalizedGroupId || !normalizedEmoji) return;
  const senderValues = reactionSenderValues(reaction);
  const senderId = senderValues.find((value) => /@(lid|c\.us)$/i.test(String(value))) || senderValues[0] || null;
  const senderKey = reactionEvidenceSenderKey(reaction, senderPhone);
  const capturedAt = now();
  try {
    db.prepare(`INSERT INTO reaction_evidence(message_id,group_id,emoji,sender_key,sender_id,sender_phone,active,source,captured_at)
      VALUES(?,?,?,?,?, ?,1,?,?)
      ON CONFLICT(message_id,emoji,sender_key) DO UPDATE SET group_id=excluded.group_id,sender_id=excluded.sender_id,sender_phone=excluded.sender_phone,active=1,source=excluded.source,captured_at=excluded.captured_at`).run(
      normalizedMessageId,
      normalizedGroupId,
      normalizedEmoji,
      senderKey,
      senderId,
      senderPhone ? phoneWithCountry(senderPhone) : null,
      source,
      capturedAt,
    );
  } catch (error) {
    console.warn(`[WhatsApp] reaction evidence persistence skipped: ${String(error?.message || error)}`);
  }
}

function deactivateReactionEvidence(messageId, groupId, emoji = "👍") {
  const normalizedMessageId = reactionEvidenceMessageKey(messageId);
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedMessageId || !normalizedGroupId) return;
  try {
    db.prepare("UPDATE reaction_evidence SET active=0,captured_at=? WHERE message_id=? AND group_id=? AND emoji=? AND active=1").run(now(), normalizedMessageId, normalizedGroupId, emoji);
  } catch (error) {
    console.warn(`[WhatsApp] reaction evidence deactivation skipped: ${String(error?.message || error)}`);
  }
}

function storedReactionEvidence(messageId, emoji = "👍") {
  const normalizedMessageId = reactionEvidenceMessageKey(messageId);
  if (!normalizedMessageId) return [];
  try {
    return db.prepare("SELECT * FROM reaction_evidence WHERE message_id=? AND emoji=? AND active=1 ORDER BY id DESC").all(normalizedMessageId, emoji);
  } catch (error) {
    console.warn(`[WhatsApp] reaction evidence lookup skipped: ${String(error?.message || error)}`);
    return [];
  }
}

function reactionSenderValues(reaction) {
  const values = [
    reaction?.__senderPhone,
    reaction?._data?.__senderPhone,
    reaction?.senderId,
    reaction?._data?.senderId,
    reaction?.senderUserJid,
    reaction?._data?.senderUserJid,
    reaction?.author,
    reaction?._data?.author,
    reaction?.sender,
    reaction?._data?.sender,
    reaction?.id?.participant,
    reaction?._data?.id?.participant,
  ].filter(Boolean);
  const flatten = (value) => {
    if (!value) return [];
    if (typeof value === "string") return [value.trim()];
    if (Array.isArray(value)) return value.flatMap(flatten);
    return [
      value.senderId,
      value.senderUserJid,
      value.author,
      value._serialized,
      value.id?._serialized,
      value.id,
      value.user && value.server ? `${value.user}@${value.server}` : null,
    ].flatMap(flatten);
  };
  return [...new Set(values.flatMap(flatten).map((value) => serializedWhatsappUserId(value) || String(value).trim()).filter(Boolean))];
}

function isConnectedBotReactionIdentity(value) {
  const direct = directJordanPhoneFromWhatsappValue(value);
  if (direct && phoneWithCountry(direct) === phoneWithCountry(connectedBotPhone())) return true;
  const serialized = serializedWhatsappUserId(value);
  const connectedWid = serializedWhatsappUserId(client?.info?.wid);
  return Boolean(serialized && connectedWid && serialized === connectedWid);
}

async function resolveReactionSenderPhone(reaction) {
  const reactionIsByCurrentAccount = reaction?.hasReactionByMe === true
    || reaction?._data?.hasReactionByMe === true
    || reaction?.isFromMe === true
    || reaction?._data?.isFromMe === true;
  if (reactionIsByCurrentAccount) {
    console.log("[WhatsApp] reaction sender mapped to connected bot from self-reaction evidence");
    return connectedBotPhone();
  }
  const rawValues = reactionSenderValues(reaction);
  for (const value of rawValues) {
    const direct = directJordanPhoneFromWhatsappValue(value);
    if (direct) {
      console.log(`[WhatsApp] reaction sender resolved from direct PN: ${maskSettlementPhone(direct)}`);
      return direct;
    }
    if (isConnectedBotReactionIdentity(value)) {
      console.log("[WhatsApp] reaction sender mapped to connected bot from sender identity");
      return connectedBotPhone();
    }
  }
  const serializedIds = [...new Set(rawValues.map((value) => reactionId(value) || serializedWhatsappUserId(value)).filter((value) => /@lid$/i.test(String(value))) )];
  if (!client || !isReady || !serializedIds.length) return "";
  for (const serialized of serializedIds) {
    const mapped = await resolveWhatsappUserPhone(serialized);
    if (mapped) {
      console.log(`[WhatsApp] reaction sender resolved from LID mapping: ${orderTraceKey(serialized)} -> ${maskSettlementPhone(mapped)}`);
      return mapped;
    }
  }
  for (const serialized of serializedIds) {
    try {
      const contact = await withTimeout(client.getContactById(serialized), 8000, null);
      const resolved = await resolveWhatsappUserPhone(contact, serialized);
      if (resolved) {
        console.log(`[WhatsApp] reaction sender resolved from contact fallback: ${orderTraceKey(serialized)} -> ${maskSettlementPhone(resolved)}`);
        return resolved;
      }
    } catch (error) {
      console.warn(`[WhatsApp] reaction contact lookup failed: ${String(error?.message || error)}`);
    }
  }
  console.warn(`[WhatsApp] reaction sender unresolved: ${JSON.stringify(serializedIds.map(orderTraceKey))}`);
  return "";
}

function cancelOrderForReactionRemoval(orderId, expectedMessageId, producerPhone) {
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (!current) return { state: "stale" };
    const producer = current.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.producer_user_id) : null;
    if (!producer || phoneWithCountry(producer.phone) !== phoneWithCountry(producerPhone)) return { state: "unauthorized" };
    const stamp = now();
    const pendingCaptain = current.pending_captain_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.pending_captain_user_id) : null;
    if (current.status === "open" && current.pending_message_id === expectedMessageId) {
      const changed = db.prepare("UPDATE orders SET status='cancelled',settlement_state='cancelled',pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,updated_at=? WHERE id=? AND status='open' AND COALESCE(archive_state,'active')='active' AND pending_message_id=?").run(stamp, orderId, expectedMessageId);
      if (!changed.changes) return { state: "stale" };
      audit("order.cancelled_downloader_removed_thumb", "order", orderId, { producerId: producer.id, pendingCaptainId: pendingCaptain?.id || null, messageId: expectedMessageId });
      return { state: "cancelled", order: current, producer, captain: pendingCaptain, reversed: false };
    }
    if (current.status !== "accepted" || current.accepted_message_id !== expectedMessageId || current.settlement_state !== "settled") return { state: "stale" };
    const settlement = db.prepare("SELECT * FROM order_settlements WHERE order_id=? AND status='applied' LIMIT 1").get(orderId);
    const captain = current.captain_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.captain_user_id) : null;
    const company = companyUser();
    if (!settlement || !captain || !company) return { state: "stale" };
    db.prepare("UPDATE users SET wallet_cents=wallet_cents-?,updated_at=? WHERE id=?").run(settlement.company_cents, stamp, company.id);
    const companyBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(company.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(company.id, orderId, "reversal_company", -settlement.company_cents, companyBalance, `ORDER-${current.order_no}-CANCEL`, "عكس حصة الشركة بعد إزالة 👍", stamp, settlement.details_json);
    db.prepare("UPDATE users SET wallet_cents=wallet_cents-?,updated_at=? WHERE id=?").run(settlement.producer_cents, stamp, producer.id);
    const producerBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(producer.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(producer.id, orderId, "reversal_producer", -settlement.producer_cents, producerBalance, `ORDER-${current.order_no}-CANCEL`, "عكس حصة كابتن تنزيل الطلب بعد إزالة 👍", stamp, settlement.details_json);
    db.prepare("UPDATE users SET wallet_cents=wallet_cents+?,updated_at=? WHERE id=?").run(settlement.captain_fee_cents, stamp, captain.id);
    const captainBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(captain.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(captain.id, orderId, "reversal_captain_fee", settlement.captain_fee_cents, captainBalance, `ORDER-${current.order_no}-CANCEL`, "إعادة خصم الكابتن بعد إزالة 👍", stamp, settlement.details_json);
    db.prepare("UPDATE order_settlements SET status='reversed' WHERE order_id=? AND status='applied'").run(orderId);
    db.prepare("UPDATE orders SET status='cancelled',settlement_state='reversed',updated_at=? WHERE id=? AND status='accepted' AND accepted_message_id=?").run(stamp, orderId, expectedMessageId);
    audit("order.cancelled_downloader_removed_thumb", "order", orderId, { producerId: producer.id, captainId: captain.id, reversed: true, messageId: expectedMessageId });
    return { state: "cancelled", order: current, producer, captain, reversed: true };
  })();
}

function cancelPendingOrderForProducerReaction(candidateId, expectedMessageId, producerPhone) {
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM order_candidates WHERE id=?").get(candidateId);
    if (!current || current.status !== "pending") return { state: "stale" };
    const producer = current.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.producer_user_id) : null;
    if (!producer || phoneWithCountry(producer.phone) !== phoneWithCountry(producerPhone)) return { state: "unauthorized" };
    const acceptance = db.prepare("SELECT * FROM order_candidate_acceptances WHERE candidate_id=? AND acceptance_message_id=? AND status='pending' LIMIT 1").get(candidateId, expectedMessageId);
    if (!acceptance) return { state: "stale" };
    const stamp = now();
    const cancelled = db.prepare("UPDATE order_candidate_acceptances SET status='cancelled',updated_at=? WHERE id=? AND status='pending'").run(stamp, acceptance.id);
    if (!cancelled.changes) return { state: "stale" };
    db.prepare("UPDATE order_candidate_acceptances SET status='rejected',updated_at=? WHERE candidate_id=? AND status='pending'").run(stamp, candidateId);
    const finalized = db.prepare("UPDATE order_candidates SET status='cancelled',pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,lifecycle_stage='cancelled',lifecycle_blocker='producer_cancelled',lifecycle_updated_at=?,updated_at=? WHERE id=? AND status='pending' AND pending_message_id=?").run(stamp, stamp, candidateId, expectedMessageId);
    if (!finalized.changes) return { state: "stale" };
    audit("order.cancelled_producer_x", "order_candidate", candidateId, { producerId: producer.id, captainId: acceptance.captain_user_id, messageId: expectedMessageId, financialMutation: false });
    return { state: "cancelled", candidate: current, producer, acceptance };
  })();
}

async function hasVisibleThumbReaction(messageId) {
  if (!client || !client.pupPage || !messageId) return false;
  return Boolean(await withTimeout(client.pupPage.evaluate((targetId) => {
    const rawId = String(targetId).split("_")[2] || String(targetId);
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(rawId) : rawId.replace(/["\\]/g, "\\$&");
    const node = document.querySelector(`[data-id*="${escaped}"]`);
    if (!node) return false;
    if (String(node.textContent || "").includes("👍")) return true;
    const reactionNodes = Array.from(node.querySelectorAll('[data-testid*="reaction"], [aria-label*="تفاعل"], [aria-label*="reaction"]'));
    return reactionNodes.some((item) => String(item.textContent || item.getAttribute("aria-label") || "").includes("👍"));
  }, messageId), 8000, false));
}

async function fetchInternalReactionRows(messageId) {
  if (!client?.pupPage || !messageId) return [];
  return await withTimeout(client.pupPage.evaluate(async (targetId) => {
    try {
      const collections = window.require("WAWebCollections");
      const rawId = String(targetId || "").split("_").slice(2).join("_");
      const messageIds = [...new Set([String(targetId || ""), rawId].filter(Boolean))];
      const asArray = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        try {
          if (typeof value.serialize === "function") {
            const serialized = value.serialize();
            if (Array.isArray(serialized)) return serialized;
          }
        } catch (_) {}
        if (Array.isArray(value.models)) return value.models;
        if (Array.isArray(value._models)) return value._models;
        return [];
      };
      for (const candidateId of messageIds) {
        try {
          const reactionCollection = await collections.Reactions.find(candidateId);
          const rows = asArray(reactionCollection?.reactions);
          if (rows.length) return rows;
        } catch (_) {}
      }
      const message = collections.Msg?.get?.(String(targetId || ""))
        || collections.Msg?.get?.(rawId)
        || (await collections.Msg?.getMessagesById?.(messageIds))?.messages?.[0];
      return asArray(message?.reactions || message?._data?.reactions);
    } catch (_) {
      return [];
    }
  }, messageId), 12000, []);
}

function normalizeReactionOwnerName(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\p{M}/gu, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function reactionOwnerNameMatches(visibleName, registeredName) {
  const visible = normalizeReactionOwnerName(visibleName);
  const registered = normalizeReactionOwnerName(registeredName);
  if (!visible || !registered) return false;
  if (visible === registered) return true;
  const visibleTokens = visible.split(/\s+/).filter(Boolean);
  const registeredTokens = registered.split(/\s+/).filter(Boolean);
  const shorter = visibleTokens.length <= registeredTokens.length ? visibleTokens : registeredTokens;
  const longer = visibleTokens.length <= registeredTokens.length ? registeredTokens : visibleTokens;
  return shorter.length >= 2 && shorter.every((token) => longer.includes(token));
}

async function resolveVisibleReactionSenderPhones(messageId, { emoji = "👍" } = {}) {
  if (!client?.pupPage || !messageId) return [];
  const rawId = String(messageId).split("_")[2] || String(messageId);
  const readVisibleDetails = () => client.pupPage.evaluate(async ({ rawId: targetId, emoji: targetEmoji }) => {
    const nodes = Array.from(document.querySelectorAll("[data-id]"))
      .filter((node) => String(node.getAttribute("data-id") || "").includes(targetId));
    const node = nodes[nodes.length - 1] || null;
    if (!node) return { names: [] };
    const readNames = () => Array.from(document.querySelectorAll('[data-testid="reactions-details-cell"]'))
      .map((cell) => String(cell.textContent || "").trim())
      .filter(Boolean);
    let names = readNames();
    if (!names.length) {
      const trigger = Array.from(node.querySelectorAll("[aria-label], [data-testid]"))
        .find((item) => `${item.getAttribute("aria-label") || ""} ${item.getAttribute("data-testid") || ""} ${item.textContent || ""}`.includes(targetEmoji));
      if (trigger && typeof trigger.click === "function") {
        trigger.click();
        await new Promise((resolve) => setTimeout(resolve, 350));
        names = readNames();
      }
    }
    return { names };
  }, { rawId, emoji });
  let visible = await withTimeout(readVisibleDetails(), 15000, { names: [] });
  if (!visible?.names?.length && client.interface && typeof client.interface.openChatWindowAt === "function") {
    await withTimeout(client.interface.openChatWindowAt(messageId), 12000, null);
    await new Promise((resolve) => setTimeout(resolve, 750));
    visible = await withTimeout(readVisibleDetails(), 15000, { names: [] });
  }
  const names = [...new Set((visible?.names || []).map(normalizeReactionOwnerName).filter(Boolean))];
  if (!names.length) return [];
  const captains = db.prepare("SELECT phone,name,registration_name FROM users WHERE role='captain' AND active=1 AND account_status='active'").all();
  const matches = captains.filter((captain) => {
    const values = [captain.name, captain.registration_name].filter(Boolean);
    return names.some((name) => values.some((value) => reactionOwnerNameMatches(name, value)));
  });
  const phones = [...new Set(matches.map((captain) => phoneWithCountry(captain.phone)).filter(isValidJordanPhone))];
  if (phones.length) {
    console.log(`[WhatsApp] reaction owner resolved from visible details: ${phones.length} active captain match(es)`);
  }
  return phones;
}

function settlePendingOrder(candidateId, expectedMessageId, confirmerPhone, { adminApproval = false } = {}) {
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM order_candidates WHERE id=?").get(candidateId);
    if (!current || current.status !== "pending") return { state: "stale" };
    const acceptance = db.prepare("SELECT * FROM order_candidate_acceptances WHERE candidate_id=? AND acceptance_message_id=? AND status IN ('pending','selected') LIMIT 1").get(candidateId, expectedMessageId);
    if (!acceptance) return { state: "stale" };
    const equivalentOrder = findEquivalentOrder(current.group_id, current.source_message_id);
    if (equivalentOrder?.archive_state === "archived") {
      const restored = settleHistoricalConfirmedOrder({
        orderId: equivalentOrder.id,
        captainId: acceptance.captain_user_id,
        acceptedMessageId: expectedMessageId,
        acceptedAt: now(),
        confirmedByPhone: adminApproval ? connectedBotPhone() : confirmerPhone,
        importSource: "admin_archived_candidate_recovery",
        allowArchivedRestore: true,
      });
      if (restored.state === "accepted") {
        const stamp = now();
        db.prepare("UPDATE order_candidate_acceptances SET status='selected',updated_at=? WHERE id=? AND status IN ('pending','selected')").run(stamp, acceptance.id);
        db.prepare("UPDATE order_candidate_acceptances SET status='rejected',updated_at=? WHERE candidate_id=? AND id<>? AND status='pending'").run(stamp, candidateId, acceptance.id);
        db.prepare("UPDATE order_candidates SET status='finalized',final_order_id=?,finalized_at=?,pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,lifecycle_stage='settled',lifecycle_blocker=NULL,lifecycle_updated_at=?,updated_at=? WHERE id=? AND status='pending' AND pending_message_id=?").run(restored.order.id, stamp, stamp, stamp, candidateId, expectedMessageId);
      }
      return restored;
    }
    if (equivalentOrder) return { state: "already_registered", order: equivalentOrder };
    db.prepare("UPDATE order_candidates SET pending_captain_user_id=?,pending_message_id=?,updated_at=? WHERE id=? AND status='pending'").run(acceptance.captain_user_id, expectedMessageId, now(), candidateId);
    const producer = current.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.producer_user_id) : null;
    const botCompanyConfirmation = !adminApproval && isBotPhone(confirmerPhone) && BOT_FINANCIAL_MODE === "company";
    const confirmer = adminApproval ? companyUser() : botCompanyConfirmation ? companyUser() : findActiveRegisteredUser(confirmerPhone);
    if (!producer || !confirmer || (!adminApproval && !botCompanyConfirmation && (confirmer.is_bot === 1 || confirmer.role === "company"))) return { state: "unauthorized" };
    const captain = acceptance.captain_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(acceptance.captain_user_id) : null;
    if (!captain) return { state: "stale" };
    if (captain.active !== 1 || captain.account_status !== "active") return { state: "unauthorized", captain };
    const settlement = calculateSettlement({
      priceCents: current.price_cents,
      orderKind: current.order_kind,
      regularProducerRateBps: PRODUCER_RATE_BPS,
      specialOrderProducerRateBps: SPECIAL_ORDER_RATE_BPS,
      companyFromProducerRateBps: COMPANY_FROM_PRODUCER_RATE_BPS,
      specialOrderCompanyFromProducerRateBps: COMPANY_FROM_PRODUCER_RATE_BPS,
    });
    const company = companyUser();
    const walletOwner = captain.is_bot === 1 && BOT_FINANCIAL_MODE === "company" ? company : captain;
    if (!walletOwner) return { state: "stale" };
    const projectedCaptainBalance = Number(walletOwner.wallet_cents || 0) - settlement.confirmingCaptainFeeCents;
    if (projectedCaptainBalance < CAPTAIN_MIN_BALANCE_CENTS) {
      db.prepare("UPDATE order_candidates SET lifecycle_stage='debt_limit',lifecycle_blocker='debt_limit',lifecycle_updated_at=?,updated_at=? WHERE id=? AND status='pending'").run(now(), now(), candidateId);
      audit("order.candidate_debt_limit", "order_candidate", candidateId, { captainId: captain.id, chargedWalletId: walletOwner.id, requiredCents: settlement.confirmingCaptainFeeCents, balanceCents: walletOwner.wallet_cents, projectedBalanceCents: projectedCaptainBalance, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS });
      return { state: "debt_limit", captain, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS };
    }
    if (projectedCaptainBalance < 0) {
      audit("order.candidate_debt_recorded", "order_candidate", candidateId, { captainId: captain.id, chargedWalletId: walletOwner.id, requiredCents: settlement.confirmingCaptainFeeCents, balanceCents: walletOwner.wallet_cents, projectedBalanceCents: projectedCaptainBalance });
    }
    const stamp = now();
    const companyWalletCharge = walletOwner.role === "company";
    const botEmployeeProducer = producer.is_bot === 1;
    const orderNo = Number(db.prepare("SELECT COALESCE(MAX(order_no),0)+1 AS next FROM orders").get().next);
    const ledgerDetails = JSON.stringify({ orderNo, sourceMessageId: current.source_message_id, priceCents: current.price_cents, origin: current.origin, destination: current.destination, tripTime: current.trip_time, orderKind: current.order_kind });
    const orderInsert = db.prepare("INSERT INTO orders(order_no,source_message_id,group_id,raw_text,price_cents,origin,destination,trip_time,order_kind,producer_user_id,producer_phone_snapshot,producer_name_snapshot,status,captain_user_id,captain_phone_snapshot,captain_name_snapshot,accepted_message_id,accepted_at,confirmed_by_phone,company_cents,producer_cents,captain_cents,settlement_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(orderNo, current.source_message_id, current.group_id, current.raw_text, current.price_cents, current.origin, current.destination, current.trip_time, current.order_kind, producer.id, phoneWithCountry(producer.phone), producer.name || null, "accepted", captain.id, phoneWithCountry(captain.phone), captain.name || null, expectedMessageId, stamp, phoneWithCountry(confirmerPhone), settlement.companyCents, settlement.producerFeeCents, settlement.executorWalletCreditCents, "settled", current.created_at || stamp, stamp);
    const orderId = orderInsert.lastInsertRowid;
    const settlementKey = `ORDER-${orderNo}-${orderId}`;
    const settlementInsert = db.prepare("INSERT OR IGNORE INTO order_settlements(order_id,status,idempotency_key,captain_user_id,producer_user_id,charged_user_id,price_cents,company_cents,producer_cents,captain_fee_cents,details_json,created_at) VALUES(?,'pending',?,?,?,?,?,?,?,?,?,?)").run(orderId, settlementKey, captain.id, producer.id, walletOwner.id, current.price_cents, settlement.companyCents, settlement.producerNetCents, settlement.confirmingCaptainFeeCents, ledgerDetails, stamp);
    if (!settlementInsert.changes) throw new Error("Unable to create idempotent settlement record");
    db.prepare("UPDATE users SET wallet_cents=wallet_cents+?,updated_at=? WHERE id=?").run(settlement.companyCents, stamp, company.id);
    const companyBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(company.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(company.id, orderId, "commission_company", settlement.companyCents, companyBalance, `ORDER-${orderNo}`, "3% من قيمة الطلب من محفظة الكابتن المؤكد", stamp, ledgerDetails);
    db.prepare("UPDATE users SET wallet_cents=wallet_cents+?,updated_at=? WHERE id=?").run(settlement.producerNetCents, stamp, producer.id);
    const producerBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(producer.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(producer.id, orderId, botEmployeeProducer ? "commission_bot_producer" : "commission_producer", settlement.producerNetCents, producerBalance, `ORDER-${orderNo}`, "12% من قيمة الطلب تضاف لمحفظة المنتج", stamp, ledgerDetails);
    db.prepare("UPDATE users SET wallet_cents=wallet_cents-?,updated_at=? WHERE id=?").run(settlement.confirmingCaptainFeeCents, stamp, walletOwner.id);
    const captainBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(walletOwner.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(walletOwner.id, orderId, companyWalletCharge ? "company_bot_fee" : "captain_fee", -settlement.confirmingCaptainFeeCents, captainBalance, `ORDER-${orderNo}`, companyWalletCharge ? "خصم 12% + 3% من محفظة الشركة لأن البوت نفذ الطلب" : "خصم 12% لصاحب تنزيل الطلب و3% للشركة من محفظة الكابتن الذي وضع تم (15% إجمالًا)", stamp, ledgerDetails);
    db.prepare("UPDATE order_settlements SET status='applied',applied_at=? WHERE order_id=? AND status='pending'").run(stamp, orderId);
    db.prepare("UPDATE order_candidate_acceptances SET status='selected',updated_at=? WHERE id=? AND status IN ('pending','selected')").run(stamp, acceptance.id);
    db.prepare("UPDATE order_candidate_acceptances SET status='rejected',updated_at=? WHERE candidate_id=? AND id<>? AND status='pending'").run(stamp, candidateId, acceptance.id);
    db.prepare("UPDATE order_candidates SET status='finalized',final_order_id=?,finalized_at=?,pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,lifecycle_stage='settled',lifecycle_blocker=NULL,lifecycle_updated_at=?,updated_at=? WHERE id=? AND status='pending' AND pending_message_id=?").run(orderId, stamp, stamp, stamp, candidateId, expectedMessageId);
    db.prepare("INSERT OR IGNORE INTO order_confirmation_deliveries(order_id,group_id,status,attempts,created_at,updated_at) VALUES(?,?, 'pending',0,?,?)").run(orderId, current.group_id, stamp, stamp);
    audit("order.accepted", "order", orderId, { captainId: captain.id, producerCaptainId: producer.id, orderKind: current.order_kind, externalOrderValueCents: settlement.externalOrderValueCents, companyCents: settlement.companyCents, producerFeeCents: settlement.producerFeeCents, producerNetCents: settlement.producerNetCents, confirmingCaptainFeeCents: settlement.confirmingCaptainFeeCents, executorWalletCreditCents: settlement.executorWalletCreditCents, confirmedBy: confirmer.phone });
    logSettlementCompleted({ mode: "live", orderId, orderNo, priceCents: current.price_cents, producer, chargedWallet: walletOwner, settlement, settlementKey });
    console.log(`[Order] accepted #${orderNo} group=${current.group_id} captain=${maskSettlementPhone(captain.phone)} confirmedBy=${maskSettlementPhone(confirmer.phone)}`);
    return {
      state: "accepted",
      order: { id: orderId, order_no: orderNo, price_cents: current.price_cents, status: "accepted", settlement_state: "settled" },
      captain: db.prepare("SELECT * FROM users WHERE id=?").get(captain.id),
      chargedWallet: db.prepare("SELECT * FROM users WHERE id=?").get(walletOwner.id),
      producer: db.prepare("SELECT * FROM users WHERE id=?").get(producer.id),
    };
  })();
}

function settleHistoricalConfirmedOrder({ orderId, captainId, acceptedMessageId, acceptedAt, confirmedByPhone, importSource = "group_history_24h", allowArchivedRestore = false }) {
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    const captain = db.prepare("SELECT * FROM users WHERE id=? AND active=1 AND account_status='active' AND (role='captain' OR is_bot=1)").get(captainId);
    if (!current || !captain) return { state: "unlinked" };
    if (current.archive_state === "archived" && !allowArchivedRestore) return { state: "archived", order: current, captain };
    const existingSettlement = db.prepare("SELECT id,status FROM order_settlements WHERE order_id=? LIMIT 1").get(orderId);
    if (existingSettlement && existingSettlement.status === "applied") return { state: "already_settled", order: current, captain };
    const producer = current.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(current.producer_user_id) : null;
    if (!producer) return { state: "missing_producer" };
    const settlement = calculateSettlement({
      priceCents: current.price_cents,
      orderKind: current.order_kind,
      regularProducerRateBps: PRODUCER_RATE_BPS,
      specialOrderProducerRateBps: SPECIAL_ORDER_RATE_BPS,
      companyFromProducerRateBps: COMPANY_FROM_PRODUCER_RATE_BPS,
      specialOrderCompanyFromProducerRateBps: COMPANY_FROM_PRODUCER_RATE_BPS,
    });
    const company = companyUser();
    const walletOwner = captain.is_bot === 1 && BOT_FINANCIAL_MODE === "company" ? company : captain;
    if (!walletOwner) return { state: "unlinked" };
    const projectedCaptainBalance = Number(walletOwner.wallet_cents || 0) - settlement.confirmingCaptainFeeCents;
    if (projectedCaptainBalance < CAPTAIN_MIN_BALANCE_CENTS) {
      audit("order.history.captain_debt_limit", "order", orderId, { captainId: captain.id, requiredCents: settlement.confirmingCaptainFeeCents, balanceCents: walletOwner.wallet_cents, projectedBalanceCents: projectedCaptainBalance, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS });
      return { state: "debt_limit", captain, debtLimitCents: CAPTAIN_MIN_BALANCE_CENTS };
    }
    const stamp = acceptedAt || now();
    const details = JSON.stringify({ orderNo: current.order_no, historical: true, priceCents: current.price_cents, origin: current.origin, destination: current.destination, orderKind: current.order_kind });
    const settlementKey = `HISTORY-${current.order_no}-${orderId}`;
    const inserted = db.prepare("INSERT OR IGNORE INTO order_settlements(order_id,status,idempotency_key,captain_user_id,producer_user_id,charged_user_id,price_cents,company_cents,producer_cents,captain_fee_cents,details_json,created_at) VALUES(?,'pending',?,?,?,?,?,?,?,?,?,?)").run(orderId, settlementKey, captain.id, producer.id, walletOwner.id, current.price_cents, settlement.companyCents, settlement.producerNetCents, settlement.confirmingCaptainFeeCents, details, now());
    if (!inserted.changes) return { state: "already_settled", order: current, captain };
    db.prepare("UPDATE orders SET status='accepted',archive_state='active',archived_at=NULL,archive_reason=NULL,captain_user_id=?,captain_phone_snapshot=?,captain_name_snapshot=?,accepted_message_id=?,accepted_at=?,confirmed_by_phone=?,company_cents=?,producer_cents=?,captain_cents=?,settlement_state='settled',import_source=?,pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,updated_at=? WHERE id=?").run(captain.id, captain.phone, captain.name, acceptedMessageId, stamp, phoneWithCountry(confirmedByPhone) || null, settlement.companyCents, settlement.producerFeeCents, settlement.executorWalletCreditCents, importSource, now(), orderId);
    db.prepare("UPDATE users SET wallet_cents=wallet_cents+?,updated_at=? WHERE id=?").run(settlement.companyCents, now(), company.id);
    const companyBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(company.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(company.id, orderId, "commission_company", settlement.companyCents, companyBalance, `ORDER-${current.order_no}`, "تسوية طلب مؤكد مستورد من سجل القروب", now(), details);
    db.prepare("UPDATE users SET wallet_cents=wallet_cents+?,updated_at=? WHERE id=?").run(settlement.producerNetCents, now(), producer.id);
    const producerBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(producer.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(producer.id, orderId, producer.is_bot === 1 ? "commission_bot_producer" : "commission_producer", settlement.producerNetCents, producerBalance, `ORDER-${current.order_no}`, "صافي حصة المنتج لطلب مؤكد مستورد", now(), details);
    db.prepare("UPDATE users SET wallet_cents=wallet_cents-?,updated_at=? WHERE id=?").run(settlement.confirmingCaptainFeeCents, now(), walletOwner.id);
    const captainBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(walletOwner.id).wallet_cents;
    db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json) VALUES(?,?,?,?,?,?,?,?,?)").run(walletOwner.id, orderId, captain.is_bot === 1 ? "company_bot_fee" : "captain_fee", -settlement.confirmingCaptainFeeCents, captainBalance, `ORDER-${current.order_no}`, captain.is_bot === 1 ? "خصم 12% + 3% من محفظة الشركة لطلب مؤكد مستورد" : "خصم 12% لصاحب تنزيل الطلب و3% للشركة من محفظة الكابتن المنفذ (15% إجمالًا)", now(), details);
    db.prepare("UPDATE order_settlements SET status='applied',applied_at=? WHERE order_id=?").run(now(), orderId);
    db.prepare("INSERT OR IGNORE INTO order_confirmation_deliveries(order_id,group_id,status,attempts,created_at,updated_at) VALUES(?,?, 'pending',0,?,?)").run(orderId, current.group_id, stamp, stamp);
    audit("order.history.settled", "order", orderId, { captainId, acceptedMessageId, confirmedByPhone, settlementKey });
    logSettlementCompleted({ mode: "historical", orderId, orderNo: current.order_no, priceCents: current.price_cents, producer, chargedWallet: walletOwner, settlement, settlementKey });
    return { state: "accepted", order: db.prepare("SELECT * FROM orders WHERE id=?").get(orderId), captain: db.prepare("SELECT * FROM users WHERE id=?").get(captain.id), chargedWallet: db.prepare("SELECT * FROM users WHERE id=?").get(walletOwner.id) };
  })();
}

function normalizeRecoveryText(value) {
  return String(value || "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ـ/g, "")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function recoveryPhoneMatches(actual, expected) {
  return Boolean(actual && expected && phoneWithCountry(actual) === phoneWithCountry(expected));
}

function recoveryExpectedMatches(evidence, expected = {}) {
  if (!evidence) return false;
  if (expected.sourceMessageId && evidence.orderMessageId !== String(expected.sourceMessageId).trim()) return false;
  if (expected.acceptanceMessageId && evidence.acceptanceMessageId !== String(expected.acceptanceMessageId).trim()) return false;
  if (expected.downloaderPhone && !recoveryPhoneMatches(evidence.producerPhone, expected.downloaderPhone)) return false;
  if (expected.executorPhone && !recoveryPhoneMatches(evidence.captainPhone, expected.executorPhone)) return false;
  if (expected.price !== undefined && expected.price !== null && expected.price !== "" && evidence.parsed?.price !== Number(expected.price)) return false;
  if (expected.origin && normalizeRecoveryText(evidence.parsed?.origin) !== normalizeRecoveryText(expected.origin)) return false;
  if (expected.destination && normalizeRecoveryText(evidence.parsed?.destination) !== normalizeRecoveryText(expected.destination)) return false;
  // وقت الرحلة ليس شرطًا للتثبيت؛ كلمة «السعر» والقيمة والهوية والتفاعل هي الأدلة التشغيلية.
  return true;
}

function recoveryEvidenceSummary(evidence) {
  if (!evidence) return null;
  return {
    match: Boolean(evidence.match),
    reason: evidence.reason || null,
    sourceMessageId: evidence.orderMessageId || null,
    acceptanceMessageId: evidence.acceptanceMessageId || null,
    downloaderPhone: evidence.producerPhone || null,
    executorPhone: evidence.captainPhone || null,
    executorName: evidence.captain?.name || evidence.captainName || null,
    price: evidence.parsed?.price ?? null,
    origin: evidence.parsed?.origin || null,
    destination: evidence.parsed?.destination || null,
    rawText: evidence.rawText || null,
    authorizedThumb: Boolean(evidence.authorizedThumb),
    reactionPresent: Boolean(evidence.reactionPresentOnAcceptance),
    reactionEvidenceMessageId: evidence.reactionEvidenceMessageId || evidence.acceptanceMessageId || null,
    persistedReactionEvidence: Array.isArray(evidence.persistedReactionEvidence) ? evidence.persistedReactionEvidence : [],
    existingOrderNo: evidence.existingOrder?.order_no || null,
    existingSettlementStatus: evidence.existingSettlement?.status || null,
  };
}

function buildStoredRecoveryMessages(groupId, hours = 168, limit = 1000) {
  const safeHours = Math.max(1, Math.min(Number(hours || 168), 168));
  const safeLimit = Math.max(1, Math.min(Number(limit || 1000), 2000));
  const cutoff = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `
    SELECT
      c.id AS candidate_id,
      c.source_message_id,
      c.group_id,
      c.raw_text,
      c.price_cents,
      c.origin,
      c.destination,
      c.trip_time,
      c.order_kind,
      c.created_at AS candidate_created_at,
      a.acceptance_message_id,
      a.created_at AS acceptance_created_at,
      p.phone AS producer_phone,
      p.name AS producer_name,
      p.is_bot AS producer_is_bot,
      cap.phone AS captain_phone,
      cap.name AS captain_name,
      sm.body AS source_body,
      sm.sent_at AS source_sent_at,
      am.body AS acceptance_body,
      am.sent_at AS acceptance_sent_at
    FROM order_candidates c
    JOIN order_candidate_acceptances a ON a.candidate_id = c.id
    JOIN users p ON p.id = c.producer_user_id
    JOIN users cap ON cap.id = a.captain_user_id
    LEFT JOIN messages sm ON sm.message_id = c.source_message_id AND sm.group_id = c.group_id
    LEFT JOIN messages am ON am.message_id = a.acceptance_message_id AND am.group_id = c.group_id
    WHERE c.group_id = ?
      AND c.status = 'pending'
      AND c.final_order_id IS NULL
      AND a.status IN ('pending','selected')
      AND datetime(a.created_at) >= datetime(?)
    ORDER BY a.id DESC
    LIMIT ?
  `
  ).all(groupId, cutoff, safeLimit);
  const reactions = db.prepare(
    "SELECT emoji,sender_key,sender_id,sender_phone,source FROM reaction_evidence WHERE message_id=? AND group_id=? AND emoji='👍' AND active=1 ORDER BY id DESC"
  );
  const toTimestamp = (value, fallback) => {
    const parsed = Date.parse(String(value || ''));
    const fallbackNumber = Number(fallback || 0);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : (fallbackNumber || Math.floor(Date.now() / 1000));
  };
  const messages = [];
  for (const row of rows) {
    const source = {
      id: { _serialized: row.source_message_id },
      __serializedId: row.source_message_id,
      from: groupId,
      to: groupId,
      fromMe: Boolean(row.producer_is_bot) || String(row.source_message_id || '').startsWith('true_'),
      body: String(row.source_body || row.raw_text || ''),
      __authorPhone: row.producer_phone || null,
      timestamp: toTimestamp(row.source_sent_at, row.candidate_created_at),
    };
    const reactionRows = reactions.all(row.acceptance_message_id, groupId);
    const acceptance = {
      id: { _serialized: row.acceptance_message_id },
      __serializedId: row.acceptance_message_id,
      from: groupId,
      to: groupId,
      fromMe: false,
      body: String(row.acceptance_body || 'تم'),
      author: { _serialized: String(row.captain_phone || '') + '@c.us' },
      __authorPhone: row.captain_phone || null,
      timestamp: toTimestamp(row.acceptance_sent_at, row.acceptance_created_at),
      __quoted: source,
      __quotedMessageId: row.source_message_id,
      __storedRecovery: true,
      __hasReaction: reactionRows.length > 0,
      __reactions: reactionRows.map((reaction) => ({
        aggregateEmoji: reaction.emoji,
        reaction: reaction.emoji,
        senders: [{
          __senderPhone: reaction.sender_phone || null,
          senderId: reaction.sender_id || reaction.sender_key || null,
        }],
      })),
    };
    messages.push(source, acceptance);
  }
  return { chat: { id: groupId, isGroup: true }, messages, rows: rows.length, source: 'database_candidates' };
}

function buildStoredRecoveryMessagesByIds(groupId, sourceMessageId, acceptanceMessageId) {
  const requested = new Set([sourceMessageId, acceptanceMessageId].map((value) => String(value || '').trim()).filter(Boolean));
  if (requested.size !== 2) return [];
  const stored = buildStoredRecoveryMessages(groupId, 168, 2000);
  const messages = stored.messages.filter((message) => requested.has(serializedMessageId(message)));
  return messages.length === requested.size ? messages : [];
}

async function inspectConfirmedRecoveryMessage(acceptance, messages, groupId) {
  const acceptanceMessageId = serializedMessageId(acceptance);
  if (!acceptanceMessageId) return { match: false, reason: "acceptance_without_message_id" };
  let liveAcceptance = acceptance;
  const storedRecovery = acceptance.__storedRecovery === true;
  if (resolveGroupChatId(liveAcceptance) !== groupId || liveAcceptance.fromMe || !isCaptainAcceptance(liveAcceptance.body)) {
    return { match: false, reason: "acceptance_not_in_configured_group" };
  }
  const quotedMessageIdHint = String(
    acceptance?.__quotedMessageId || acceptance?.quotedMessageId || acceptance?._data?.quotedStanzaID || acceptance?._data?.quotedMessageId || acceptance?._data?.quotedMsgId || ""
  ).trim();
  const indexedQuoted = quotedMessageIdHint
    ? (Array.isArray(messages) ? messages.find((message) => {
      const messageId = serializedMessageId(message) || "";
      return messageId === quotedMessageIdHint || messageId.endsWith(`_${quotedMessageIdHint}`) || messageId.split("_")[2] === quotedMessageIdHint;
    }) : null)
    : null;
  const archivedQuoted = indexedQuoted || acceptance.__quoted || null;
  let liveQuoted = archivedQuoted;
  if (!liveQuoted && !storedRecovery && client && typeof client.getMessageById === "function") {
    liveAcceptance = await withTimeout(client.getMessageById(acceptanceMessageId), 12000, null) || acceptance;
    liveQuoted = typeof liveAcceptance.getQuotedMessage === "function"
      ? await withTimeout(liveAcceptance.getQuotedMessage(), 12000, null)
      : liveAcceptance.__quoted || null;
  }
  if (!liveQuoted && !storedRecovery && client?.interface && typeof client.interface.openChatWindowAt === "function") {
    await withTimeout(client.interface.openChatWindowAt(acceptanceMessageId), 12000, null);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const hydratedAcceptance = typeof client.getMessageById === "function"
      ? await withTimeout(client.getMessageById(acceptanceMessageId), 12000, null)
      : null;
    if (hydratedAcceptance) liveAcceptance = hydratedAcceptance;
    liveQuoted = typeof liveAcceptance.getQuotedMessage === "function"
      ? await withTimeout(liveAcceptance.getQuotedMessage(), 12000, null)
      : null;
  }
  const quoted = liveQuoted || liveAcceptance.__quoted || archivedQuoted || acceptance.__quoted || null;
  const parsed = quoted ? parseOrder(quoted.body) : null;
  const orderMessageId = serializedMessageId(quoted);
  if (!quoted || !parsed?.isOrder || !orderMessageId || resolveGroupChatId(quoted) !== groupId) {
    return { match: false, reason: "not_a_quoted_order", acceptanceMessageId };
  }
  const botProducer = (indexedQuoted?.fromMe || quoted.fromMe) && BOT_FINANCIAL_MODE === "company";
  const rawReactionHint = Boolean(acceptance.hasReaction || acceptance.__hasReaction || acceptance._data?.hasReaction || acceptance._data?.reactions?.length);
  const archivedReactions = acceptance.__reactions || (Array.isArray(acceptance?._data?.reactions) ? acceptance._data.reactions : null) || ((!botProducer || !rawReactionHint) && typeof acceptance.getReactions === "function"
    ? await withTimeout(acceptance.getReactions(), 1500, null)
    : null);
  const archivedHasSenders = Array.isArray(archivedReactions)
    && archivedReactions.some((reaction) => Array.isArray(reaction?.senders) && reaction.senders.length);
  if (!storedRecovery && !botProducer && !archivedHasSenders && typeof client?.getMessageById === "function") {
    liveAcceptance = await withTimeout(client.getMessageById(acceptanceMessageId), 12000, null) || liveAcceptance;
  }
  const liveReactions = !storedRecovery && !botProducer && !archivedHasSenders && typeof liveAcceptance.getReactions === "function"
    ? await withTimeout(liveAcceptance.getReactions(), 12000, null)
    : null;
  const internalReactions = (!Array.isArray(liveReactions) || !liveReactions.length)
    && (!Array.isArray(archivedReactions) || !archivedReactions.length || !archivedHasSenders)
    ? await fetchInternalReactionRows(acceptanceMessageId)
    : [];
  const reactions = Array.isArray(liveReactions) && liveReactions.length
    ? liveReactions
    : (internalReactions.length && !archivedHasSenders
      ? internalReactions
      : (Array.isArray(archivedReactions) && archivedReactions.length
        ? archivedReactions
        : (internalReactions.length ? internalReactions : (liveAcceptance.__reactions || acceptance.__reactions || []))));
  const thumbs = (Array.isArray(reactions) ? reactions : []).filter((reaction) => reaction && (reaction.aggregateEmoji === "👍" || reaction.reaction === "👍"));
  let reactionPresentOnAcceptance = Boolean(thumbs.length);
  if (!storedRecovery && !reactionPresentOnAcceptance && (botProducer || rawReactionHint) && client?.pupPage) {
    if (client.interface && typeof client.interface.openChatWindowAt === "function") {
      await withTimeout(client.interface.openChatWindowAt(acceptanceMessageId), 12000, null);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    reactionPresentOnAcceptance = await hasVisibleThumbReaction(acceptanceMessageId);
  }
  const reactionPhones = [];
  let reactedByBot = thumbs.some((reaction) => reaction.hasReactionByMe === true);
  for (const reaction of botProducer ? [] : thumbs) {
    for (const sender of Array.isArray(reaction.senders) ? reaction.senders : []) {
      const senderPhone = directJordanPhoneFromWhatsappValue(sender?.__senderPhone) || await resolveReactionSenderPhone({ senderId: sender?.senderId || sender?.id?._serialized || sender?.id || "" });
      if (isValidJordanPhone(senderPhone)) reactionPhones.push(senderPhone);
    }
  }
  if (!storedRecovery && !botProducer && reactionPresentOnAcceptance && !reactionPhones.length) {
    reactionPhones.push(...await resolveVisibleReactionSenderPhones(acceptanceMessageId));
  }
  const persistedReactionRows = storedReactionEvidence(acceptanceMessageId, "👍");
  if (persistedReactionRows.length) reactionPresentOnAcceptance = true;
  for (const row of persistedReactionRows) {
    const persistedPhone = directJordanPhoneFromWhatsappValue(row.sender_phone);
    if (isValidJordanPhone(persistedPhone)) {
      reactionPhones.push(persistedPhone);
      continue;
    }
    if (row.sender_id) {
      const resolvedPhone = await resolveReactionSenderPhone({ senderId: row.sender_id });
      if (isValidJordanPhone(resolvedPhone)) reactionPhones.push(resolvedPhone);
    }
  }
  const botPhone = connectedBotPhone();
  if (reactionPhones.some((phone) => recoveryPhoneMatches(phone, botPhone))) reactedByBot = true;
  if (botProducer && reactionPresentOnAcceptance) reactedByBot = true;
  const quotedContact = !quoted.fromMe && typeof quoted.getContact === "function" ? await withTimeout(quoted.getContact(), 8000, null) : null;
  const producerPhone = (indexedQuoted?.fromMe || quoted.fromMe) ? botPhone : await resolveMessageSenderPhone(quoted, quotedContact);
  const captainPhone = await resolveWhatsappUserPhone(
    acceptance.__authorPhone,
    acceptance.author,
    acceptance?._data?.author,
    acceptance?.id?.participant,
    acceptance?._data?.id?.participant,
  ) || await resolveMessageSenderPhone(acceptance, null);
  const acceptanceContact = captainPhone || typeof acceptance.getContact !== "function"
    ? null
    : await withTimeout(acceptance.getContact(), 1500, null);
  const acceptanceTimestamp = Number(liveAcceptance.timestamp || acceptance.timestamp || acceptance.__timestamp || 0);
  const hasBotConfirmationCard = (Array.isArray(messages) ? messages : []).some((message) => {
    const timestamp = Number(message?.timestamp || message?.__timestamp || 0);
    const body = String(message?.__caption || message?.body || "");
    return Boolean(message?.fromMe) && timestamp >= acceptanceTimestamp && timestamp <= acceptanceTimestamp + 300 && /(تم تثبيت الطلب|تم توثيق الرحلة)/.test(body);
  });
  // Policy: human-owned bookings require a 👍 on the exact quoted «تم» reply.
  // Bot/company-owned bookings are approved by the valid quoted «تم» itself;
  // any bot 👍 is presentation-only and never becomes a settlement gate.
  const authorizedThumb = botProducer ? true : Boolean(reactionPresentOnAcceptance);
  const producer = botProducer ? companyUser() : (producerPhone ? findActiveRegisteredUser(producerPhone) : null);
  const captain = captainPhone ? findCaptainByPhone(captainPhone, { activeOnly: true }) : null;
  const existingOrder = db.prepare("SELECT * FROM orders WHERE source_message_id=? LIMIT 1").get(orderMessageId);
  const existingSettlement = existingOrder ? db.prepare("SELECT id,status FROM order_settlements WHERE order_id=? LIMIT 1").get(existingOrder.id) : null;
  const producerIdentityResolved = botProducer
    ? Boolean(producer && isValidJordanPhone(producerPhone) && recoveryPhoneMatches(producerPhone, botPhone))
    : Boolean(producer && isValidJordanPhone(producerPhone) && recoveryPhoneMatches(producer.phone, producerPhone));
  const captainIdentityResolved = Boolean(captain && isValidJordanPhone(captainPhone) && recoveryPhoneMatches(captain.phone, captainPhone));
  const phoneIdentityResolved = Boolean(producerIdentityResolved && captainIdentityResolved);
  const match = Boolean(phoneIdentityResolved && authorizedThumb);
  return {
    match,
    reason: match ? "confirmed" : (!phoneIdentityResolved ? "phone_identity_unresolved" : !authorizedThumb ? "missing_authorized_thumb_reaction" : "identity_unresolved"),
    acceptanceMessageId,
    orderMessageId,
    acceptedAt: new Date(acceptanceTimestamp * 1000 || Date.now()).toISOString(),
    rawText: String(quoted.body || ""),
    parsed,
    producerPhone,
    captainPhone,
    captainName: String(acceptanceContact?.pushname || acceptanceContact?.name || liveAcceptance?._data?.notifyName || acceptance?._data?.notifyName || displayPhone(captainPhone)).trim().slice(0, 100),
    producer,
    captain,
    authorizedThumb,
    reactionPresentOnAcceptance,
    reactedByBot,
    hasBotConfirmationCard,
    reactionPhones: [...new Set(reactionPhones)],
    reactionEvidenceMessageId: acceptanceMessageId,
    persistedReactionEvidence: persistedReactionRows.map((row) => ({ senderPhone: row.sender_phone || null, senderId: row.sender_id || null, source: row.source })),
    phoneIdentityResolved,
    existingOrder,
    existingSettlement,
  };
}

async function findAutomaticRecoveryEvidence({ groupId, hours = 168, limit = 1000, downloaderPhone, executorPhone, price, origin = "", destination = "" }) {
  const safeHours = Math.max(1, Math.min(Number(hours || 168), 168));
  const safeLimit = Number.isInteger(Number(limit)) ? Math.max(1, Math.min(Number(limit), 2000)) : 1000;
  const history = await fetchGroupHistory(groupId, safeLimit, { includeOutgoing: true });
  if (!history.chat) return { state: "unavailable", groupId, hours: safeHours, messages: [], matches: [] };
  const cutoff = Date.now() - safeHours * 60 * 60 * 1000;
  const expected = { downloaderPhone, executorPhone, price: Number(price), origin: String(origin || "").trim(), destination: String(destination || "").trim() };
  const acceptanceMessages = (Array.isArray(history.messages) ? history.messages : []).filter((message) => {
    const timestamp = Number(message?.timestamp || message?.__timestamp || 0) * 1000;
    return message && !message.fromMe && resolveGroupChatId(message) === groupId && isCaptainAcceptance(message.body) && timestamp >= cutoff;
  });
  const matches = [];
  for (let offset = 0; offset < acceptanceMessages.length; offset += 4) {
    const batch = acceptanceMessages.slice(offset, offset + 4);
    const evidenceRows = await Promise.all(batch.map((acceptance) => inspectConfirmedRecoveryMessage(acceptance, history.messages, groupId)));
    for (const evidence of evidenceRows) {
      if (recoveryExpectedMatches(evidence, expected)) matches.push(evidence);
    }
  }
  const deduped = [...new Map(matches.map((evidence) => [`${evidence.orderMessageId}:${evidence.acceptanceMessageId}`, evidence])).values()];
  const confirmed = deduped.filter((evidence) => evidence.match);
  return {
    state: confirmed.length === 1 ? "matched" : confirmed.length > 1 ? "ambiguous" : "not_found",
    groupId,
    hours: safeHours,
    scanned: Array.isArray(history.messages) ? history.messages.length : 0,
    messages: history.messages,
    matches: deduped,
    confirmed,
  };
}

async function handleMessageReaction(reaction) {
  const reactionValue = String(reaction?.reaction || "").trim();
  const removedThumb = reactionValue === "";
  const cancellationReaction = reactionValue === "❌";
  if (!reaction || (!removedThumb && !cancellationReaction && reactionValue !== "👍")) return;
  const messageId = reactionId(reaction.msgId);
  if (!messageId || !client || !isReady) return;
  const target = await withTimeout(client.getMessageById(messageId), 10000, null);
  if (!target || !target.from || !String(target.from).endsWith("@g.us")) return;
  if (!isConfiguredGroup(target.from)) return;
  if (!isCaptainAcceptance(target.body)) return;
  if (target.fromMe) return;
  let approverPhone = await resolveReactionSenderPhone(reaction);
  if (!approverPhone) {
    const visiblePhones = typeof resolveVisibleReactionSenderPhones === "function"
      ? await resolveVisibleReactionSenderPhones(messageId, { emoji: cancellationReaction ? "❌" : "👍" })
      : [];
    if (visiblePhones.length === 1) approverPhone = visiblePhones[0];
  }
  // WhatsApp may emit a LID-only sender on the live event while the full
  // reaction collection contains the sender identity that can be mapped to PN.
  if (!approverPhone && typeof target.getReactions === "function") {
    const storedReactions = await withTimeout(target.getReactions(), 12000, []);
    const storedReaction = (Array.isArray(storedReactions) ? storedReactions : [])
      .find((item) => item && (item.aggregateEmoji === (cancellationReaction ? "❌" : "👍") || item.reaction === (cancellationReaction ? "❌" : "👍")));
    if (storedReaction?.hasReactionByMe === true || storedReaction?._data?.hasReactionByMe === true) {
      approverPhone = connectedBotPhone();
    }
    for (const sender of (storedReaction?.senders || [])) {
      approverPhone = await resolveReactionSenderPhone({
        senderId: sender?.senderId || sender?.id?._serialized || sender?.id || sender,
        senderUserJid: sender?.senderUserJid,
        author: sender?.author,
        hasReactionByMe: storedReaction?.hasReactionByMe === true || storedReaction?._data?.hasReactionByMe === true,
      });
      if (approverPhone) break;
    }
  }
  if (removedThumb) {
    if (typeof deactivateReactionEvidence === "function") deactivateReactionEvidence(messageId, target.from, "👍");
  } else if (typeof recordReactionEvidence === "function") {
    recordReactionEvidence({
      messageId,
      groupId: target.from,
      emoji: reactionValue,
      reaction,
      senderPhone: approverPhone,
      source: "live-message-reaction",
    });
  }
  if (!approverPhone) {
    logOrderTrace("reaction_approver_identity_unresolved", {
      groupKey: orderTraceKey(target.from),
      reactionKey: orderTraceKey(messageId),
      senderKeys: reactionSenderValues(reaction).map(orderTraceKey),
      hasReactionByMe: Boolean(reaction?.hasReactionByMe || reaction?._data?.hasReactionByMe),
      targetHasReaction: Boolean(target.hasReaction || target._data?.hasReaction),
    });
  }
  if (cancellationReaction) {
    const pendingAcceptance = db.prepare("SELECT a.*,c.* FROM order_candidate_acceptances a JOIN order_candidates c ON c.id=a.candidate_id WHERE c.group_id=? AND c.status='pending' AND a.acceptance_message_id=? AND a.status='pending' LIMIT 1").get(target.from, messageId);
    if (pendingAcceptance) {
      const producer = pendingAcceptance.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(pendingAcceptance.producer_user_id) : null;
      const producerAuthorized = Boolean(producer && approverPhone && (phoneWithCountry(producer.phone) === phoneWithCountry(approverPhone) || ((producer.role === "company" || producer.is_bot === 1) && isBotPhone(approverPhone) && BOT_FINANCIAL_MODE === "company")));
      if (!producerAuthorized || isBlockedPhone(approverPhone)) {
        updateOrderCandidateLifecycle(pendingAcceptance.candidate_id, "awaiting_authorized_thumb", "producer_authorization", { acceptanceMessageId: messageId, reaction: "❌" });
        return;
      }
      const cancelled = cancelPendingOrderForProducerReaction(pendingAcceptance.candidate_id, messageId, approverPhone);
      if (cancelled.state === "cancelled") void sendFinalBookingCancellation(target.from).catch(() => null);
      return;
    }
    const acceptedOrder = db.prepare("SELECT * FROM orders WHERE group_id=? AND status IN ('accepted','completed') AND accepted_message_id=? ORDER BY id DESC LIMIT 1").get(target.from, messageId);
    if (!acceptedOrder) return;
    const producer = acceptedOrder.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(acceptedOrder.producer_user_id) : null;
    if (!producer || !approverPhone || phoneWithCountry(producer.phone) !== phoneWithCountry(approverPhone)) return;
    const cancelled = cancelOrderForReactionRemoval(acceptedOrder.id, messageId, approverPhone);
    if (cancelled.state === "cancelled") void sendFinalBookingCancellation(target.from).catch(() => null);
    return;
  }
  if (removedThumb) {
    const acceptance = db.prepare("SELECT a.*,c.* FROM order_candidate_acceptances a JOIN order_candidates c ON c.id=a.candidate_id WHERE c.group_id=? AND c.status='pending' AND a.acceptance_message_id=? AND a.status='pending' LIMIT 1").get(target.from, messageId);
    if (acceptance) {
      const producer = acceptance.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(acceptance.producer_user_id) : null;
      const producerAuthorized = Boolean(producer && approverPhone && (phoneWithCountry(producer.phone) === phoneWithCountry(approverPhone) || ((producer.role === "company" || producer.is_bot === 1) && isBotPhone(approverPhone) && BOT_FINANCIAL_MODE === "company")));
      if (!producerAuthorized || isBlockedPhone(approverPhone)) return;
      const cancelled = cancelPendingOrderForProducerReaction(acceptance.candidate_id, messageId, approverPhone);
      if (cancelled.state === "cancelled") void sendFinalBookingCancellation(target.from).catch(() => null);
      return;
    }
    const order = db.prepare("SELECT * FROM orders WHERE group_id=? AND status IN ('accepted','completed') AND accepted_message_id=? ORDER BY id DESC LIMIT 1").get(target.from, messageId);
    if (!order) return;
    const producer = order.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(order.producer_user_id) : null;
    if (!producer || !approverPhone || phoneWithCountry(producer.phone) !== phoneWithCountry(approverPhone)) return;
    const result = cancelOrderForReactionRemoval(order.id, messageId, approverPhone);
    if (result.state === "cancelled" && result.reversed && result.producer) {
      const producerBalance = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(result.producer.id)?.wallet_cents;
      if (Number(producerBalance) < 0) void notifyCaptainNegativeBalance({ captainId: result.producer.id, balanceCents: producerBalance, reason: "عكس حصة الطلب بعد إزالة التفاعل", reference: `ORDER-${order.order_no}-CANCEL` });
    }
    return;
  }
  let acceptance = findPendingAcceptanceByMessage(target.from, messageId);
  let quotedForTarget = null;
  if (!acceptance) {
    quotedForTarget = await getQuotedMessageWithFallback(target);
    const quoted = quotedForTarget;
    const sourceMessageId = serializedMessageId(quoted);
    const candidate = sourceMessageId && quoted && parseOrder(quoted.body)?.isOrder
      ? findEquivalentCandidate(target.from, sourceMessageId, ["candidate", "pending"])
      : null;
    if (candidate) {
      const captainPhone = await resolveMessageSenderPhone(target);
      const recovered = registerQuotedAcceptance({
        groupId: target.from,
        messageId,
        senderPhone: captainPhone,
        senderName: target?._data?.notifyName || target?.notifyName || displayPhone(captainPhone),
        candidate,
      });
      acceptance = findPendingAcceptanceByMessage(target.from, messageId);
      if (acceptance && ["recorded", "duplicate"].includes(recovered.state)) {
        logOrderTrace("reaction_acceptance_recovered_from_quoted_source", { groupKey: orderTraceKey(target.from), reactionKey: orderTraceKey(messageId), sourceKey: orderTraceKey(sourceMessageId), candidateId: candidate.id, captainId: acceptance.captain_user_id });
      }
    }
  }
  if (!acceptance) {
    const legacy = db.prepare("SELECT * FROM order_candidates WHERE group_id=? AND status='pending' AND pending_message_id=? LIMIT 1").get(target.from, messageId);
    if (legacy?.pending_captain_user_id) {
      const captain = db.prepare("SELECT * FROM users WHERE id=?").get(legacy.pending_captain_user_id);
      registerQuotedAcceptance({ groupId: target.from, messageId, senderPhone: captain?.phone, senderName: captain?.name, candidate: legacy });
      acceptance = findPendingAcceptanceByMessage(target.from, messageId);
    }
  }
  if (!acceptance) return;
  const pending = acceptance;
  const quotedReply = pending.acceptance_message_id === messageId ? (quotedForTarget || await getQuotedMessageWithFallback(target)) : null;
  const quotedReplyId = serializedMessageId(quotedReply);
  const quotedReplyIsOrder = Boolean(quotedReply && parseOrder(quotedReply.body)?.isOrder && quotedReplyId === pending.source_message_id);
  if (!quotedReplyIsOrder) {
    updateOrderCandidateLifecycle(pending.candidate_id, "awaiting_authorized_thumb", "quote_mismatch", { acceptanceMessageId: messageId, quotedMessageId: quotedReplyId || null });
    notifyOrderLifecycleBlocker(pending.candidate_id, "quote_mismatch", { acceptanceMessageId: messageId });
    logOrderTrace("reaction_target_not_selected_quoted_reply", {
      groupKey: orderTraceKey(target.from),
      reactionKey: orderTraceKey(messageId),
      candidateId: pending.candidate_id,
      hasQuotedMsg: Boolean(target.hasQuotedMsg),
      quotedKey: orderTraceKey(quotedReplyId),
      sourceKey: orderTraceKey(pending.source_message_id),
    });
    return;
  }
  const producer = pending.producer_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(pending.producer_user_id) : null;
  const acceptanceCaptain = pending.captain_user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(pending.captain_user_id) : null;
  if (!producer || !acceptanceCaptain || acceptanceCaptain.active !== 1 || acceptanceCaptain.account_status !== "active") {
    updateOrderCandidateLifecycle(pending.candidate_id, "awaiting_authorized_thumb", "captain_identity_unresolved", { acceptanceMessageId: messageId });
    notifyOrderLifecycleBlocker(pending.candidate_id, "captain_identity_unresolved", { acceptanceMessageId: messageId });
    return;
  }
  // Policy: any captain's 👍 on the exact quoted «تم» reply confirms the booking.
  // The reply captain is the executor; the reaction owner is not an authorization gate.
  const settlementConfirmerPhone = phoneWithCountry(acceptanceCaptain.phone);
  const result = settlePendingOrder(pending.candidate_id, pending.acceptance_message_id, settlementConfirmerPhone);
  if (result.state !== "accepted") {
    const blockedStage = result.state === "debt_limit" ? "debt_limit" : result.state === "archived" ? "archived" : "awaiting_authorized_thumb";
    updateOrderCandidateLifecycle(pending.candidate_id, blockedStage, result.state, { acceptanceMessageId: pending.acceptance_message_id });
    if (["debt_limit", "archived"].includes(result.state)) notifyOrderLifecycleBlocker(pending.candidate_id, result.state, { acceptanceMessageId: pending.acceptance_message_id });
    console.warn(`[Order] reaction approval blocked candidate=${pending.id} state=${result.state}`);
    return;
  }
  void sendFinalBookingConfirmation(target.from, { orderNo: result.order?.order_no, orderId: result.order?.id, executorName: result.captain?.name, downloaderName: result.producer?.name, priceCents: result.order?.price_cents }).catch(() => null);
  if (result.chargedWallet && Number(result.chargedWallet.wallet_cents) < 0) void notifyCaptainNegativeBalance({ captainId: result.captain.id, balanceCents: result.chargedWallet.wallet_cents, reason: "خصم حصة تسوية الطلب", reference: `ORDER-${result.order.order_no}` });
}

async function reconcileStoredThumbReaction(messageId) {
  if (!messageId || !client || !isReady || typeof client.getMessageById !== "function") return;
  const target = await withTimeout(client.getMessageById(messageId), 12000, null);
  if (!target || typeof target.getReactions !== "function") return;
  const targetGroupId = String(target.from || target._data?.from || "").trim();
  if (!targetGroupId.endsWith("@g.us") || !isConfiguredGroup(targetGroupId)) {
    logOrderTrace("reaction_scan_ignored_unconfigured_group", {
      groupKey: orderTraceKey(targetGroupId),
      reactionKey: orderTraceKey(messageId),
    });
    return;
  }
  let reactions = await withTimeout(target.getReactions(), 12000, []);
  if (!Array.isArray(reactions) || !reactions.length) {
    if (client.interface && typeof client.interface.openChatWindowAt === "function") {
      await withTimeout(client.interface.openChatWindowAt(messageId), 12000, null);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
	if (await hasVisibleThumbReaction(messageId)) {
	  const visiblePhones = typeof resolveVisibleReactionSenderPhones === "function"
	    ? await resolveVisibleReactionSenderPhones(messageId)
	    : [];
	  if (visiblePhones.length) {
	    for (const phone of visiblePhones) {
	      await handleMessageReaction({ reaction: "👍", msgId: messageId, __senderPhone: phone });
	    }
	  } else {
	    // The business signal is the visible 👍 on the exact quoted «تم» reply;
	    // WhatsApp may omit the reaction owner's phone from the collection.
	    await handleMessageReaction({ reaction: "👍", msgId: messageId });
	  }
	  return;
	}
    console.warn(`[WhatsApp] reaction exists but visible thumb was not confirmed: ${String(messageId).slice(0, 80)}`);
    return;
  }
  for (const reaction of Array.isArray(reactions) ? reactions : []) {
    if (!reaction) continue;
    const reactionEmoji = reaction.aggregateEmoji || reaction.reaction || "";
    if (reactionEmoji !== "👍" && reactionEmoji !== "❌") continue;
    const reactionIsByCurrentAccount = reaction.hasReactionByMe === true || reaction?._data?.hasReactionByMe === true;
    const senders = Array.isArray(reaction.senders) ? reaction.senders : [];
	if (!senders.length) {
	  await handleMessageReaction({ reaction: reactionEmoji, msgId: messageId, hasReactionByMe: reactionIsByCurrentAccount });
	  continue;
	}
    for (const sender of senders) {
      await handleMessageReaction({ reaction: reactionEmoji, msgId: messageId, senderId: sender.senderId || sender.id?._serialized || sender.id || sender, senderUserJid: sender?.senderUserJid, author: sender?.author, __senderPhone: sender?.__senderPhone, hasReactionByMe: reaction.hasReactionByMe === true || reaction?._data?.hasReactionByMe === true });
    }
  }
}
async function retryFailedBookingConfirmations(groupId) {
  // Do not replay historical failed cards automatically after a reconnect.
  // New confirmations still use sendFinalBookingConfirmation exactly once;
  // any failed delivery must be retried explicitly by an owner action.
  return { status: "disabled", reason: "manual_resend_only", groupId };
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
  const session = getWebAdminSession(req);
  return session?.role === "company";
}
function getWebAdminSession(req) {
  const header = String(req.headers.authorization || "");
  if (activeAdminToken && header.startsWith("Bearer ") && constantTimeEquals(header.slice(7), activeAdminToken)) return { role: "company", username: ADMIN_USERNAME, source: "admin_token" };
  if (!JWT_SECRET) return null;
  const token = parseCookies(req.headers.cookie || "").aljarah_session;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !["company", "accountant", "operations"].includes(payload.role)) return null;
    return payload;
  } catch { return null; }
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}
function requireStaff(req, res, next) {
  const session = getWebAdminSession(req);
  if (!session || !["company", "accountant", "operations"].includes(session.role)) return res.status(401).json({ error: "تسجيل دخول الموظف مطلوب" });
  req.staffSession = session;
  next();
}
function requireStaffRole(...roles) {
  return (req, res, next) => {
    const session = getWebAdminSession(req);
    if (!session || !roles.includes(session.role)) return res.status(403).json({ error: "هذه الصلاحية غير متاحة لهذا الحساب" });
    req.staffSession = session;
    next();
  };
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
  const notified = await sendBotText(`${phone}@c.us`, `دعوة التسجيل الأولى في وصلني الآن\n\nافتح بوابة التشغيل الرسمية، اضغط زر التشغيل الأصفر، ثم اختر «تسجيل كابتن جديد» لإدخال اسمك واختيار رقم سري من 5 أرقام.\nالرابط صالح لدعوة واحدة حتى ${expiresAt.slice(0, 10)}: ${inviteUrl}`);
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
  let invite = db.prepare("SELECT id,status,name,phone,auth_method,token_last8,created_at,updated_at,expires_at,submitted_at,decided_at,decision_note FROM captain_invites WHERE token_hash=? LIMIT 1").get(inviteTokenHash(req.params.token));
  if (!invite && publicToken && constantTimeEquals(req.params.token, publicToken)) invite = { id: 0, status: "issued", name: null, phone: null, token_last8: publicToken.slice(-8), created_at: now(), updated_at: now(), expires_at: null, submitted_at: null, decided_at: null, decision_note: null };
  if (!invite) return res.status(404).json({ error: "بطاقة الدعوة غير موجودة" });
  if (invite.status === "expired") return res.status(410).json({ error: "انتهت صلاحية بطاقة الدعوة" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ invite: { ...invite, canSubmit: invite.status === "issued" || invite.status === "pending" } });
});
app.post("/api/captain/invites/:token/apply", async (req, res) => {
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
  const authMethod = normalizeCaptainAuthMethod(req.body?.authMethod);
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "اسم الكابتن مطلوب" });
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم هاتف أردني صحيح مطلوب" });
  if (invite.phone && phoneWithCountry(invite.phone) !== phone) return res.status(403).json({ error: "هذه الدعوة مخصصة لرقم هاتف مختلف" });
  if (authMethod === "pin" && !validCaptainPin(pin)) return res.status(400).json({ error: "الرقم السري يجب أن يكون 5 أرقام" });
  const existing = db.prepare("SELECT id,role,active,account_status FROM users WHERE phone=? LIMIT 1").get(phone) || findCaptainByPhone(phone);
  if (existing) return res.status(409).json({ error: "هذا الرقم مسجل مسبقًا؛ لا يمكن إنشاء طلب كابتن جديد" });
  const openForPhone = db.prepare("SELECT id FROM captain_invites WHERE phone=? AND status='pending' AND id<>? LIMIT 1").get(phone, invite.id);
  if (openForPhone) return res.status(409).json({ error: "يوجد طلب موافقة مفتوح لهذا الرقم" });
  const stamp = now();
  const pinHash = authMethod === "pin" ? bcrypt.hashSync(pin, 10) : null;
  db.prepare("UPDATE captain_invites SET status='pending',name=?,phone=?,pin_hash=?,pin_ciphertext=NULL,auth_method=?,approved_user_id=NULL,submitted_at=COALESCE(submitted_at,?),decided_at=NULL,decision_note=?,updated_at=? WHERE id=? AND status IN ('issued','pending')")
    .run(name, phone, pinHash, authMethod, stamp, "بانتظار موافقة المالك؛ لم يُنشأ الحساب بعد", stamp, invite.id);
  audit("captain.join.requested", "captain_invite", invite.id, { name, phone, authMethod, status: "pending" }, null);
  void sendCaptainStatusText({
    phone,
    event: "captain.join.received",
    title: "استلام طلب الكابتن",
    text: "تم استلام طلب تسجيلك، وبانتظار موافقة الشركة.",
    idempotencyKey: `CAPTAIN-REQUEST-RECEIVED-${invite.id}`,
  });
  void notifyOperations({ event: "captain.join.requested", title: "طلب تسجيل كابتن جديد بانتظار الموافقة", lines: [`الاسم: ${name}`, `الهاتف: ${phone}`, "لم يُنشأ الحساب ولم يُفعّل الدخول. يجب اعتماد الطلب من زر الموافقة في لوحة المالك."], ownersOnly: true });
  res.status(202).json({ success: true, status: "pending", activated: false, accountCreated: false, token: createdInviteToken || req.params.token, message: "تم إرسال طلب التسجيل إلى الشركة. لا يمكن الدخول أو استخدام الحساب قبل موافقة المالك." });
});
app.get("/api/admin/captain-invites", requireAdmin, (req, res) => {
  expireCaptainInvites();
  const invites = db.prepare("SELECT id,status,name,phone,auth_method,token_last8,token_ciphertext,created_at,updated_at,expires_at,submitted_at,decided_at,decision_note FROM captain_invites ORDER BY id DESC LIMIT 100").all().map((invite) => {
    let inviteUrl = null;
    if (invite.token_ciphertext) { try { inviteUrl = captainGatewayUrl(captainInviteBaseUrl(req), decryptCardCode(invite.token_ciphertext)); } catch {} }
    const { token_ciphertext: _tokenCiphertext, ...safeInvite } = invite;
    return { ...safeInvite, inviteUrl };
  });
  res.json({ invites });
});
async function issueApprovalTopupCard({ captain, approvalId, req }) {
  const amountCents = Number.parseInt(process.env.AUTO_APPROVAL_TOPUP_CENTS || "0", 10);
  const allowedAmounts = new Set([500, 1000, 1500, 2000]);
  if (amountCents === 0) return { status: "disabled" };
  if (!allowedAmounts.has(amountCents)) return { status: "disabled_invalid_value" };
  if (!captain || captain.role !== "captain" || captain.active !== 1 || captain.account_status !== "active" || captain.is_bot === 1) return { status: "ineligible" };
  const issueIdempotencyKey = `APPROVAL-TOPUP-${approvalId}`.slice(0, 100);
  let card = db.prepare("SELECT * FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueIdempotencyKey);
  if (!card) {
    let code = randomCode();
    while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
    const result = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,?,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), amountCents, captain.id, issueIdempotencyKey, encryptCardCode(code), now());
    card = db.prepare("SELECT * FROM topup_cards WHERE id=?").get(result.lastInsertRowid);
    audit("topup_card.issued", "topup_card", card.id, { valueCents: amountCents, captainId: captain.id, issueIdempotencyKey, source: "captain_approval_auto" });
  }
  if (card.sent_at) return { status: "sent", cardId: card.id, reused: true };
  if (!client || !isReady) return { status: "pending", cardId: card.id, reason: "whatsapp_not_ready" };
  if (cardDeliveryInFlight.has(card.id)) return { status: "pending", cardId: card.id, reason: "delivery_in_flight" };
  cardDeliveryInFlight.add(card.id);
  try {
    const recipient = await resolveWhatsAppRecipientId(captain.phone);
    if (!recipient) return { status: "pending", cardId: card.id, reason: "recipient_unresolved" };
    const code = decryptCardCode(card.code_ciphertext);
    const appUrl = captainAppUrl(captainInviteBaseUrl(req));
    const text = topupCardTextMessage({ cardId: card.id, code, valueCents: amountCents, captainName: captain.name, appUrl });
    const sent = await withTimeout(client.sendMessage(recipient, text), 30000, null);
    if (!sent) return { status: "pending", cardId: card.id, reason: "delivery_timeout" };
    const deliveryIdempotencyKey = `APPROVAL-TOPUP-DELIVERY-${approvalId}`.slice(0, 100);
    const updated = db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), deliveryIdempotencyKey, card.id);
    if (!updated.changes) return { status: "sent", cardId: card.id, reused: true };
    audit("topup_card.sent_text_fallback", "topup_card", card.id, { captainId: captain.id, source: "captain_approval_auto", deliveryIdempotencyKey, deliveryMode: "text" });
    void notifyOperations({ event: "captain.approval_topup.sent", title: "تأكيد بطاقة رصيد بعد الموافقة", lines: [`الكابتن: ${captain.name}`, `القيمة: ${money(amountCents)} JOD`, `رقم البطاقة الداخلي: #${card.id}`, "أُرسلت البطاقة نصيًا بعد الموافقة.", "لا يُضاف الرصيد إلا عند الاسترداد."], ownersOnly: true });
    return { status: "sent", cardId: card.id };
  } catch (_) {
    audit("topup_card.delivery_failed", "topup_card", card.id, { captainId: captain.id, source: "captain_approval_auto", deliveryMode: "text" });
    return { status: "pending", cardId: card.id, reason: "delivery_failed" };
  } finally { cardDeliveryInFlight.delete(card.id); }
}
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
    const notified = invite.phone ? await sendBotText(`${phoneWithCountry(invite.phone)}@c.us`, `تم رفض طلب الانضمام إلى وصلني الآن.\\n${note ? `السبب: ${note}` : "يمكنك التواصل مع الشركة للاستفسار."}`) : false;
    void notifyOperations({ event: "captain.join.rejected", title: "تأكيد رفض طلب انضمام", lines: [`الاسم: ${invite.name || "غير محدد"}`, `الهاتف: ${invite.phone || "غير محدد"}`, note ? `السبب: ${note}` : "تم رفض الطلب من الشركة."], ownersOnly: true });
    return res.json({ success: true, status: "rejected", notified });
  }
  const authMethod = normalizeCaptainAuthMethod(invite.auth_method);
  if ((authMethod === "pin" && !invite.pin_hash) || !invite.phone || !invite.name) return res.status(409).json({ error: "بيانات طلب الكابتن غير مكتملة" });
  let existing = db.prepare("SELECT * FROM users WHERE phone=? LIMIT 1").get(invite.phone) || findCaptainByPhone(invite.phone);
  if (existing && (existing.is_bot === 1 || existing.role === "company" || isProtectedOwnerIdentity(invite.phone))) return res.status(409).json({ error: "هذا الرقم مخصص لحساب المالك أو النظام" });
  if (existing && existing.role !== "captain") {
    const normalized = activateHumanCaptainAccount({ phone: invite.phone, name: invite.name, reactivate: true });
    existing = normalized.userId ? db.prepare("SELECT * FROM users WHERE id=? LIMIT 1").get(normalized.userId) : null;
  }
  let captainId;
  if (existing) {
    db.prepare("UPDATE users SET name=?,role='captain',active=1,is_bot=0,account_status='active',captain_auth_method=?,captain_pin_hash=?,captain_pin_ciphertext=NULL,approved_at=COALESCE(approved_at,?),activated_at=COALESCE(activated_at,?),updated_at=? WHERE id=?").run(invite.name, authMethod, authMethod === "pin" ? invite.pin_hash : null, stamp, stamp, stamp, existing.id);
    captainId = existing.id;
  } else {
    captainId = db.prepare("INSERT INTO users(phone,name,registration_name,role,wallet_cents,active,is_bot,captain_pin_hash,captain_pin_ciphertext,captain_auth_method,account_status,approved_at,activated_at,created_at,updated_at) VALUES(?,?,?,\'captain\',0,1,0,?,NULL,?,'active',?,?,?,?)").run(invite.phone, invite.name, invite.name, authMethod === "pin" ? invite.pin_hash : null, authMethod, stamp, stamp, stamp, stamp).lastInsertRowid;
  }
  db.prepare("UPDATE captain_invites SET status='approved',approved_user_id=?,decision_note=?,decided_at=?,updated_at=? WHERE id=? AND status='pending'").run(captainId, note || "تمت الموافقة", stamp, stamp, id);
  audit("captain.join.approved", "captain_invite", id, { captainId, phone: invite.phone });
  const approvalNotice = invite.phone ? await sendCaptainStatusText({
    phone: invite.phone,
    event: "captain.approval",
    title: "اعتماد الكابتن",
    text: "تمت موافقة الشركة على الكابتن الجديد وتفعيل حسابك.",
    idempotencyKey: `CAPTAIN-APPROVAL-${id}`,
  }) : { status: "skipped" };
  const notified = approvalNotice.status === "sent";
  const captain = db.prepare("SELECT id,phone,name FROM users WHERE id=? AND role='captain' LIMIT 1").get(captainId);
  const autoTopup = await issueApprovalTopupCard({ captain: { ...captain, role: "captain", active: 1, account_status: "active", is_bot: 0 }, approvalId: id, req });
  const membership = await addCaptainToConfiguredGroup(captain).catch((error) => ({ status: "failed", error: error.message }));
  audit("captain.group_membership.sync", "user", captainId, { membership });
  void notifyOperations({ event: "captain.join.approved", title: "تأكيد اعتماد كابتن", lines: [`الكابتن: ${invite.name}`, `الهاتف: ${invite.phone}`, "تم اعتماد التسجيل وإرسال بطاقة الدخول.", `حالة القروب: ${membership.status || "غير محددة"}`], ownersOnly: true });
  res.json({ success: true, status: "approved", captainId, notified, membership, autoTopup });
});
app.post("/api/admin/captains/:id/approval-notification-test", requireAdmin, async (req, res) => {
  const captainId = Number(req.params.id);
  const idempotencyKey = String(req.get("X-Idempotency-Key") || req.body?.idempotencyKey || "").trim();
  const confirmation = String(req.body?.confirmation || "").trim();
  if (!Number.isInteger(captainId) || captainId < 1 || req.body?.test !== true || idempotencyKey.length < 16 || idempotencyKey.length > 120) return res.status(400).json({ error: "معرف الكابتن ومفتاح الاختبار والتأكيد مطلوبون" });
  if (confirmation !== CAPTAIN_STATUS_TEST_CONFIRMATION || !CAPTAIN_STATUS_TEST_ALLOWLIST.has(captainId)) return res.status(403).json({ error: "اختبار الإشعار محصور مؤقتًا بالكابتن المصرح له", code: "CAPTAIN_STATUS_TEST_NOT_ALLOWED", mutation: "none", walletChanged: false });
  if (!consumeRateLimit(adminActionRate, `approval-notification-test:${clientAddress(req)}:${captainId}`, 2)) return res.status(429).json({ error: "تم إرسال اختبارات كثيرة لهذا الكابتن؛ حاول بعد قليل" });
  const captain = db.prepare("SELECT id,phone,name,role,active,is_bot,account_status,approved_at FROM users WHERE id=? LIMIT 1").get(captainId);
  if (!captain || captain.role !== "captain" || captain.is_bot === 1 || !captain.active || captain.account_status !== "active" || !captain.approved_at) return res.status(409).json({ error: "يجب اختيار كابتن مسجل ومعتمد ونشط" });
  const previous = db.prepare("SELECT id,delivery_status,message_id FROM notifications WHERE recipient_phone=? AND recipient_role='captain' AND event='captain.approval_notification.test' AND message_id=? LIMIT 1").get(phoneWithCountry(captain.phone), idempotencyKey);
  if (previous) return res.json({ success: true, duplicate: true, status: previous.delivery_status, messageId: previous.message_id });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز للإرسال حاليًا" });
  const title = "إشعار اختبار الموافقة";
  const message = "تمت موافقة الشركة على الكابتن الجديد وتفعيل حسابك.";
  const notice = await sendCaptainStatusText({
    phone: captain.phone,
    event: "captain.approval_notification.test",
    title,
    text: message,
    idempotencyKey,
    testOverride: true,
    testCaptainId: captain.id,
  });
  audit("captain.approval_notification.test", "user", captain.id, { deliveryStatus: notice.status, idempotencyKey, duplicate: Boolean(notice.duplicate) });
  if (!['sent', 'delivered'].includes(notice.status)) return res.status(502).json({ error: "تعذر إرسال إشعار الاختبار", status: notice.status, mutation: "none", walletChanged: false });
  res.json({ success: true, status: notice.status, duplicate: Boolean(notice.duplicate), messageId: notice.messageId || null, message: "تم إرسال إشعار الاختبار دون تغيير حالة الحساب أو الرصيد" });
});
app.post("/api/captain/login", (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  const rawPhone = String(req.body?.phone || "").replace(/[^0-9]/g, "");
  const phone = phoneWithCountry(rawPhone) || rawPhone;
  if (!phone) return res.status(400).json({ error: "رقم هاتف الكابتن مطلوب" });
  if (!consumeRateLimit(loginRate, `${clientAddress(req)}:${phone}`, 10)) return res.status(429).json({ error: "محاولات كثيرة؛ حاول لاحقًا" });
  const user = findCaptainByPhone(phone) || findCaptainByPhone(rawPhone);
  if (!user) {
    const invite = db.prepare("SELECT status FROM captain_invites WHERE phone=? ORDER BY id DESC LIMIT 1").get(phone) || db.prepare("SELECT status FROM captain_invites WHERE phone=? ORDER BY id DESC LIMIT 1").get(rawPhone);
    if (invite?.status === "pending") return res.status(409).json({ error: "تسجيلك قيد مراجعة الشركة؛ لا يمكن الدخول قبل اعتماد الكابتن" });
    if (invite?.status === "issued") return res.status(409).json({ error: "أكمل تسجيل الكابتن لأول مرة من رابط التسجيل قبل محاولة الدخول" });
    if (invite?.status === "rejected") return res.status(403).json({ error: "تم رفض طلب تسجيل الكابتن؛ راجع الشركة لإعادة التفعيل" });
    return res.status(404).json({ error: "لا يوجد حساب كابتن بهذا الرقم؛ تأكد من رقم الهاتف أو سجّل الكابتن لأول مرة" });
  }
  if (normalizeCaptainAuthMethod(user.captain_auth_method) !== "pin") return res.status(409).json({ error: "هذا الحساب يستخدم رمز تحقق WhatsApp" });
  const pinValid = Boolean(user.captain_pin_hash) && validCaptainPin(pin) && bcrypt.compareSync(pin, user.captain_pin_hash);
  if (!pinValid) return res.status(401).json({ error: "الرقم السري أو بيانات دخول الكابتن غير صحيحة" });
  if (!user.active || user.account_status !== "active") return res.status(403).json({ error: "حساب الكابتن غير مفعل" });
  const token = jwt.sign({ role: "captain", userId: user.id, phone: user.phone }, CAPTAIN_SESSION_SECRET, { expiresIn: "7d" });
  db.prepare("UPDATE users SET captain_last_login_at=?,updated_at=? WHERE id=?").run(now(), now(), user.id);
  setCaptainSessionCookie(res, token);
  res.json({ success: true, authMethod: "pin", user: { id: user.id, phone: user.phone, name: user.name, role: user.role, active: Boolean(user.active) } });
});
app.post("/api/captain/whatsapp/request-code", async (req, res) => {
  const phone = phoneWithCountry(String(req.body?.phone || ""));
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم هاتف أردني صحيح مطلوب" });
  if (!consumeRateLimit(whatsappAuthRate, `${clientAddress(req)}:${phone}`, 4)) return res.status(429).json({ error: "تم طلب عدة رموز؛ حاول بعد قليل" });
  const user = findCaptainByPhone(phone, { activeOnly: true });
  if (!user) return res.status(404).json({ error: "لا يوجد حساب كابتن مفعل بهذا الرقم" });
  if (normalizeCaptainAuthMethod(user.captain_auth_method) !== "whatsapp") return res.status(409).json({ error: "هذا الحساب يستخدم الرقم السري من 5 أرقام" });
  const code = createCaptainWhatsappCode();
  const stamp = now();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM captain_auth_challenges WHERE captain_user_id=? AND verified_at IS NULL").run(user.id);
    db.prepare("INSERT INTO captain_auth_challenges(captain_user_id,phone,code_hash,attempts,expires_at,created_at) VALUES(?,?,?,?,?,?)").run(user.id, user.phone, captainAuthCodeHash(user.phone, code), 0, expiresAt, stamp);
  })();
  const sent = await sendBotText(`${user.phone}@c.us`, `رمز دخول بوابة الكابتن في وصلني الآن: ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`);
  if (!sent) {
    db.prepare("DELETE FROM captain_auth_challenges WHERE captain_user_id=? AND verified_at IS NULL").run(user.id);
    return res.status(503).json({ error: "تعذر إرسال رمز WhatsApp حاليًا" });
  }
  audit("captain.whatsapp_code.sent", "user", user.id, { phone: user.phone, expiresAt });
  res.json({ success: true, expiresAt, message: "تم إرسال رمز التحقق إلى رقم WhatsApp المسجل" });
});
app.post("/api/captain/whatsapp/verify", (req, res) => {
  const phone = phoneWithCountry(String(req.body?.phone || ""));
  const code = String(req.body?.code || "").trim();
  if (!isValidJordanPhone(phone) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "رقم الهاتف ورمز التحقق مطلوبان" });
  const user = findCaptainByPhone(phone, { activeOnly: true });
  if (!user || normalizeCaptainAuthMethod(user.captain_auth_method) !== "whatsapp") return res.status(401).json({ error: "تعذر التحقق من الحساب" });
  const challenge = db.prepare("SELECT * FROM captain_auth_challenges WHERE captain_user_id=? AND verified_at IS NULL ORDER BY id DESC LIMIT 1").get(user.id);
  if (!challenge || challenge.expires_at <= now() || challenge.attempts >= 5) return res.status(410).json({ error: "انتهت صلاحية رمز التحقق؛ اطلب رمزًا جديدًا" });
  db.prepare("UPDATE captain_auth_challenges SET attempts=attempts+1 WHERE id=?").run(challenge.id);
  if (!constantTimeEquals(challenge.code_hash, captainAuthCodeHash(user.phone, code))) return res.status(401).json({ error: "رمز التحقق غير صحيح" });
  const stamp = now();
  db.prepare("UPDATE captain_auth_challenges SET verified_at=? WHERE id=?").run(stamp, challenge.id);
  db.prepare("UPDATE users SET captain_whatsapp_verified_at=?,captain_last_login_at=?,updated_at=? WHERE id=?").run(stamp, stamp, stamp, user.id);
  const token = jwt.sign({ role: "captain", userId: user.id, phone: user.phone }, CAPTAIN_SESSION_SECRET, { expiresIn: "7d" });
  setCaptainSessionCookie(res, token);
  audit("captain.whatsapp_login.verified", "user", user.id, { phone: user.phone });
  res.json({ success: true, authMethod: "whatsapp", user: { id: user.id, phone: user.phone, name: user.name, role: user.role, active: true } });
});
app.post("/api/captain/logout", (req, res) => {
  clearCaptainSessionCookie(res);
  res.json({ success: true });
});
app.get("/api/captain/overview", requireCaptain, (req, res) => {
  const user = db.prepare("SELECT id,phone,name,role,wallet_cents,active,account_status,captain_auth_method,captain_last_login_at,updated_at FROM users WHERE id=? AND role='captain' LIMIT 1").get(req.captainSession.userId);
  if (!user || !user.active || user.account_status !== "active") return res.status(403).json({ error: "Captain account is inactive" });
  const entries = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 100").all(user.id).map((entry) => ({ ...entry, amount: money(entry.amount_cents), balanceAfter: money(entry.balance_after_cents), details: entry.details_json ? JSON.parse(entry.details_json) : null }));
  const trips = db.prepare(`SELECT o.id,o.order_no,o.status,o.price_cents,o.origin,o.destination,o.trip_time,o.order_kind,o.company_cents,o.producer_cents,o.captain_cents,o.settlement_state,o.producer_user_id,o.captain_user_id,o.accepted_message_id,o.accepted_at,o.confirmed_by_phone,o.created_at,o.updated_at,
      s.id AS settlement_id,s.status AS settlement_status,s.idempotency_key AS settlement_key,s.company_cents AS settlement_company_cents,s.producer_cents AS settlement_producer_cents,s.captain_fee_cents AS settlement_captain_fee_cents,s.applied_at AS settlement_applied_at,
      p.name AS producer_name,c.name AS captain_name
    FROM orders o LEFT JOIN order_settlements s ON s.order_id=o.id LEFT JOIN users p ON p.id=COALESCE(s.producer_user_id,o.producer_user_id) LEFT JOIN users c ON c.id=COALESCE(s.captain_user_id,o.captain_user_id)
    WHERE o.producer_user_id=? OR o.captain_user_id=? OR s.producer_user_id=? OR s.captain_user_id=? ORDER BY o.id DESC LIMIT 100`).all(user.id, user.id, user.id, user.id).map((trip) => {
      const finalized = ['accepted', 'completed'].includes(trip.status) && trip.settlement_status === 'applied';
      const postedShareCents = finalized && Number(trip.producer_user_id || trip.settlement_producer_user_id) === Number(user.id) ? Number(trip.settlement_producer_cents ?? trip.producer_cents ?? 0) : 0;
      const executedDebitCents = finalized && Number(trip.captain_user_id || trip.settlement_captain_user_id) === Number(user.id) ? Number(trip.settlement_captain_fee_cents ?? ((trip.producer_cents || 0) + (trip.company_cents || 0))) : 0;
      const role = postedShareCents ? 'downloader' : executedDebitCents ? 'executor' : 'participant';
      return { ...trip, ...settlementFinancials(trip), grossEarnings: money(postedShareCents), walletFee: money(executedDebitCents), postedShare: money(postedShareCents), executedDebit: money(executedDebitCents), netEarnings: money(postedShareCents - executedDebitCents), role, roleLabel: role === 'downloader' ? 'كابتن تنزيل الطلب' : role === 'executor' ? 'كابتن التنفيذ' : 'مشارك' };
    });
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN s.producer_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN s.producer_cents ELSE 0 END),0) AS posted_share_cents,
    COALESCE(SUM(CASE WHEN s.captain_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN s.captain_fee_cents ELSE 0 END),0) AS executed_debit_cents,
    COALESCE(SUM(CASE WHEN s.producer_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN 1 ELSE 0 END),0) AS posted_orders,
    COALESCE(SUM(CASE WHEN s.captain_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN 1 ELSE 0 END),0) AS executed_orders
    FROM order_settlements s JOIN orders o ON o.id=s.order_id`).get(user.id, user.id, user.id, user.id);
  const topupCards = db.prepare("SELECT id,value_cents,status,sent_at,redeemed_at,created_at FROM topup_cards WHERE assigned_captain_id=? ORDER BY id DESC LIMIT 20").all(user.id).map((card) => ({ id: card.id, value: money(card.value_cents), status: card.status, sentAt: card.sent_at, redeemedAt: card.redeemed_at, createdAt: card.created_at }));
  res.setHeader("Cache-Control", "no-store");
  res.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, active: Boolean(user.active), accountStatus: user.account_status, authMethod: normalizeCaptainAuthMethod(user.captain_auth_method), lastLoginAt: user.captain_last_login_at },
    wallet: { currency: "JOD", balance: money(user.wallet_cents), balanceCents: user.wallet_cents },
    earnings: { gross: money(totals?.posted_share_cents || 0), fees: money(totals?.executed_debit_cents || 0), net: money(Number(totals?.posted_share_cents || 0) - Number(totals?.executed_debit_cents || 0)), postedShare: money(totals?.posted_share_cents || 0), executedDebit: money(totals?.executed_debit_cents || 0), postedOrders: Number(totals?.posted_orders || 0), executedOrders: Number(totals?.executed_orders || 0), policy: { postedRate: '12%', companyRate: '3%', executorDebit: '15%' } },
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
app.post("/api/auth/staff-login", (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const account = db.prepare("SELECT id,username,name,role,password_hash,active FROM staff_accounts WHERE username=? LIMIT 1").get(username);
  if (!JWT_SECRET || !account || !account.active || !bcrypt.compareSync(password, account.password_hash)) return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
  db.prepare("UPDATE staff_accounts SET last_login_at=?,updated_at=? WHERE id=?").run(now(), now(), account.id);
  setSessionCookie(res, jwt.sign({ role: account.role, staffId: account.id, username: account.username, name: account.name }, JWT_SECRET, { expiresIn: "12h" }));
  res.json({ success: true, role: account.role, name: account.name, username: account.username });
});
app.post("/api/auth/logout", (req, res) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `aljarah_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  res.json({ success: true });
});
app.get("/api/staff/me", requireStaff, (req, res) => res.json({ user: { role: req.staffSession.role, username: req.staffSession.username, name: req.staffSession.name || req.staffSession.username } }));
app.get("/api/staff/overview", requireStaff, (req, res) => {
  const totals = db.prepare("SELECT COUNT(*) AS total, 0 AS open, SUM(CASE WHEN o.status='accepted' THEN 1 ELSE 0 END) AS accepted, SUM(CASE WHEN o.status='completed' THEN 1 ELSE 0 END) AS completed FROM orders o JOIN order_settlements s ON s.order_id=o.id AND s.status='applied' WHERE o.status IN ('accepted','completed') AND o.settlement_state='settled'").get();
  res.json({ whatsapp: { ready: Boolean(isReady), state: whatsappState }, orders: totals, companyWallet: req.staffSession.role === "accountant" ? companyWalletSummary() : null, role: req.staffSession.role });
});
app.get("/api/staff/orders", requireStaff, (req, res) => {
  const rows = db.prepare(`SELECT o.id,o.order_no,o.status,o.order_kind,o.origin,o.destination,o.trip_time,o.price_cents,o.company_cents,o.producer_cents,o.captain_cents,o.settlement_state,o.accepted_message_id,o.accepted_at,o.confirmed_by_phone,o.created_at,
    s.id AS settlement_id,s.status AS settlement_status,s.idempotency_key AS settlement_key,s.company_cents AS settlement_company_cents,s.producer_cents AS settlement_producer_cents,s.captain_fee_cents AS settlement_captain_fee_cents,s.applied_at AS settlement_applied_at,
    p.name AS producer_name,c.name AS captain_name
    FROM orders o JOIN order_settlements s ON s.order_id=o.id AND s.status='applied' LEFT JOIN users p ON p.id=COALESCE(s.producer_user_id,o.producer_user_id) LEFT JOIN users c ON c.id=COALESCE(s.captain_user_id,o.captain_user_id)
    WHERE o.status IN ('accepted','completed') AND o.settlement_state='settled' ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ orders: rows.map((row) => ({ ...row, ...settlementFinancials(row), producer_name: row.producer_name || 'غير مسجل', captain_name: row.captain_name || 'غير مسجل', companyShare: settlementFinancials(row).company, settlement: 'applied' })) });
});
app.get("/api/staff/captains", requireStaffRole("operations"), (req, res) => {
  const captains = db.prepare("SELECT id,phone,name,active,account_status,created_at,captain_last_login_at FROM users WHERE role='captain' AND account_status<>'merged' ORDER BY active DESC,name").all().map((row) => ({ ...row, lastLoginAt: row.captain_last_login_at }));
  res.json({ captains });
});
app.get("/api/staff/wallets", requireStaffRole("accountant"), (req, res) => {
  const users = db.prepare(`SELECT u.id,u.phone,u.name,u.role,u.wallet_cents,u.active,u.account_status,u.updated_at,
    COALESCE((SELECT SUM(s.producer_cents) FROM order_settlements s JOIN orders p ON p.id=s.order_id WHERE s.producer_user_id=u.id AND s.status='applied' AND p.status IN ('accepted','completed')),0) AS posted_share_cents,
    COALESCE((SELECT SUM(s.captain_fee_cents) FROM order_settlements s JOIN orders e ON e.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND e.status IN ('accepted','completed')),0) AS executed_debit_cents,
    COALESCE((SELECT SUM(s.company_cents) FROM order_settlements s JOIN orders e ON e.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND e.status IN ('accepted','completed')),0) AS company_share_cents
    FROM users u WHERE u.role IN ('captain','producer') ORDER BY u.role,u.name`).all();
  res.json({ wallets: users.map((user) => ({ ...user, balance: money(user.wallet_cents), postedShare: money(user.posted_share_cents), executedDebit: money(user.executed_debit_cents), companyShare: money(user.company_share_cents), netMovement: money(Number(user.posted_share_cents || 0) - Number(user.executed_debit_cents || 0)) })), companyWallet: companyWalletSummary() });
});
app.get("/api/admin/staff", requireAdmin, (req, res) => {
  const accounts = db.prepare("SELECT id,username,name,role,active,last_login_at,created_at,updated_at FROM staff_accounts ORDER BY role,name,id").all();
  res.json({ accounts });
});
app.post("/api/admin/staff", requireAdmin, (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim();
  const role = String(req.body?.role || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || !name || name.length > 100 || !["accountant", "operations"].includes(role) || password.length < 10) return res.status(400).json({ error: "بيانات الموظف غير صالحة؛ كلمة المرور 10 أحرف على الأقل" });
  try {
    const stamp = now();
    const result = db.prepare("INSERT INTO staff_accounts(username,name,role,password_hash,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run(username, name, role, bcrypt.hashSync(password, 12), stamp, stamp);
    audit("staff.account.created", "staff_account", result.lastInsertRowid, { username, role });
    res.status(201).json({ success: true, id: result.lastInsertRowid, username, name, role });
  } catch (error) { res.status(409).json({ error: error.code === "SQLITE_CONSTRAINT_UNIQUE" ? "اسم المستخدم مستخدم مسبقًا" : "تعذر إنشاء الحساب" }); }
});
app.patch("/api/admin/staff/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare("SELECT * FROM staff_accounts WHERE id=? LIMIT 1").get(id);
  if (!account) return res.status(404).json({ error: "حساب الموظف غير موجود" });
  const name = req.body.name === undefined ? account.name : String(req.body.name).trim();
  const role = req.body.role === undefined ? account.role : String(req.body.role).trim().toLowerCase();
  const active = req.body.active === undefined ? account.active : (req.body.active ? 1 : 0);
  const password = req.body.password === undefined ? "" : String(req.body.password);
  if (!name || name.length > 100 || !["accountant", "operations"].includes(role) || (password && password.length < 10)) return res.status(400).json({ error: "بيانات التعديل غير صالحة" });
  const stamp = now();
  if (password) db.prepare("UPDATE staff_accounts SET name=?,role=?,active=?,password_hash=?,updated_at=? WHERE id=?").run(name, role, active, bcrypt.hashSync(password, 12), stamp, id);
  else db.prepare("UPDATE staff_accounts SET name=?,role=?,active=?,updated_at=? WHERE id=?").run(name, role, active, stamp, id);
  audit("staff.account.updated", "staff_account", id, { name, role, active, passwordChanged: Boolean(password) });
  res.json({ success: true });
});
app.delete("/api/admin/staff/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare("SELECT id,username,role FROM staff_accounts WHERE id=? LIMIT 1").get(id);
  if (!account) return res.status(404).json({ error: "حساب الموظف غير موجود" });
  db.prepare("DELETE FROM staff_accounts WHERE id=?").run(id);
  audit("staff.account.deleted", "staff_account", id, { username: account.username, role: account.role });
  res.json({ success: true, deleted: id });
});
app.get("/api/public/operations-feed", (req, res) => {
  const redact = (value) => String(value || "")
    .replace(/(?:\+?962|0)?7\d{8,9}/g, "رقم مخفي")
    .replace(/Bearer\s+\S+/gi, "Bearer مخفي")
    .slice(0, 280);
  const groupId = getSetting("group_id", null) || getSetting("active_group_id", null);
  const recentNotifications = db.prepare("SELECT id,event,title,message,delivery_status,created_at FROM notifications WHERE recipient_role='owner' ORDER BY id DESC LIMIT 12").all().map((row) => ({
    id: `notification-${row.id}`,
    type: /error|failed|debt|unlinked|pending/i.test(`${row.event} ${row.title}`) ? "warning" : /info|backup|settings/i.test(`${row.event} ${row.title}`) ? "info" : "success",
    label: row.delivery_status === "sent" ? "تنبيه تشغيلي" : "يتطلب متابعة",
    title: redact(row.title),
    text: redact(row.message),
    time: row.created_at,
  }));
  const recentSettlements = settlementRows(10).filter((row) => row.settlement_status === "applied").map((row) => {
    const finance = settlementFinancials(row);
    return {
      orderNo: row.order_no,
      status: row.status,
      settlementState: finance.settlementState,
      settlementStatus: row.settlement_status,
      price: finance.price,
      companyShare: finance.company,
      producerShare: finance.postedShare,
      executorDebit: finance.executorDebit,
      captainCash: finance.captain,
      updatedAt: row.updated_at,
    };
  });
  const groupReceiverReady = Boolean(isReady || baileysReady);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({
    success: true,
    generatedAt: now(),
    refreshAfterMs: 30000,
    status: { ready: Boolean(isReady), groupReceiverReady, groupConfigured: Boolean(groupId && isConfiguredGroup(groupId)), groupSuffix: groupId ? `…${groupId.replace(/\D/g, "").slice(-4)}` : null, whatsappState },
    updates: recentNotifications,
    settlements: recentSettlements,
    policy: { producerWalletRate: "12%", companyWalletRate: "3%", confirmingCaptainWalletRate: "-15% (12% downloader + 3% company)", captainCashRate: "100%", debtLimit: "-2.00 JOD", idempotent: true },
  });
});

app.get("/status", (req, res) => {
  const configuredGroupId = configuredRuntimeGroupId() || null;
  const groupReceiverReady = Boolean(isReady || baileysReady);
  const userRoles = db.prepare("SELECT phone,role,active,account_status,is_bot FROM users").all();
  const activeCaptains = userRoles.filter((user) => user.role === "captain" && user.is_bot !== 1 && user.active === 1 && user.account_status === "active").length;
  const nonCaptainHumans = userRoles.filter((user) => user.is_bot !== 1 && user.role !== "company" && user.role !== "captain" && !isProtectedOwnerIdentity(user.phone)).length;
  const orderLinkStats = db.prepare(`SELECT
    SUM(CASE WHEN status='open' AND COALESCE(archive_state,'active')='active' AND captain_user_id IS NULL THEN 1 ELSE 0 END) AS open_unassigned,
    SUM(CASE WHEN status='open' AND COALESCE(archive_state,'active')='active' AND pending_captain_user_id IS NOT NULL THEN 1 ELSE 0 END) AS pending_confirmation,
    SUM(CASE WHEN status IN ('accepted','completed') AND (captain_user_id IS NULL OR settlement_state='unlinked') THEN 1 ELSE 0 END) AS accepted_unlinked
    FROM orders`).get();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ready: Boolean(isReady),
    phone: connectedBotPhone(),
    groupConfigured: Boolean(configuredGroupId && isConfiguredGroup(configuredGroupId)),
    groupId: configuredGroupId || null,
    groupReceiverReady,
    groupReceiverMode: baileysReady ? "webjs+baileys" : (isReady ? "webjs" : "offline"),
    lastGroupEventGroupId,
    lastGroupEventAt: lastGroupMessageTelemetry?.at || null,
    lastGroupEventMatched: lastGroupMessageTelemetry ? Boolean(lastGroupMessageTelemetry.configured) : null,
    lastOfficialGroupEventGroupId,
    lastOfficialGroupEventAt: lastOfficialGroupMessageTelemetry?.at || null,
    lastOfficialGroupEventMatched: lastOfficialGroupMessageTelemetry ? Boolean(lastOfficialGroupMessageTelemetry.configured) : null,
    lastIgnoredGroupEventGroupId,
    lastIgnoredGroupEventAt: lastIgnoredGroupMessageTelemetry?.at || null,
    qrAvailable: Boolean(qrCodeData || baileysQrCodeData),
    whatsappState,
    whatsappLastEvent,
    whatsappLastError,
    whatsappInitializing: Boolean(initializing),
    whatsappStoragePressure: { ...whatsappStoragePressure },
    captains: {
      activeRegistered: activeCaptains,
      nonCaptainHumanAccounts: nonCaptainHumans,
      normalizationVersion: getSetting("captain_normalization_version", null),
      normalizedAt: getSetting("captain_normalization_at", null),
    },
    orders: {
      openUnassigned: Number(orderLinkStats.open_unassigned || 0),
      pendingConfirmation: Number(orderLinkStats.pending_confirmation || 0),
      acceptedUnlinked: Number(orderLinkStats.accepted_unlinked || 0),
    },
    historicalRecovery: lastHistoricalRecovery,
    acceptanceRecovery: lastAcceptanceRecovery,
  });
});
app.get("/api/admin/system/health", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, health: runtimeHealth() });
});
app.get("/api/admin/whatsapp/send-diagnostics", requireAdmin, async (req, res) => {
  try {
    const diagnostics = await readWhatsAppSendDiagnostics();
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({ success: true, mutation: "none", ...diagnostics });
  } catch (error) {
    res.status(503).json({ success: false, mutation: "none", error: boundedDiagnosticText(error?.message || error, 500) });
  }
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
    mediaPatch: {
      package: "whatsapp-web.js",
      strategy: "remove-private-media-id-collision",
      appliedAtStartup: true,
      alreadyPatchedBeforeStartup: Boolean(whatsappMediaPatchState.alreadyPatched),
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
app.get("/api/admin/diagnostics/last-group-event", requireAdmin, (req, res) => res.json({
  groupId: lastGroupEventGroupId,
  telemetry: lastGroupMessageTelemetry,
  official: { groupId: lastOfficialGroupEventGroupId, telemetry: lastOfficialGroupMessageTelemetry },
  ignored: { groupId: lastIgnoredGroupEventGroupId, telemetry: lastIgnoredGroupMessageTelemetry },
}));
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
    const chatId = await resolveWhatsAppRecipientId(card.captain_phone);
    if (!chatId) return res.status(409).json({ error: "Captain WhatsApp account could not be resolved; card remains unsent" });
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
function handleVoidTopupCard(req, res) {
  const cardId = Number(req.params.id);
  const reason = String(req.body?.reason || "").trim();
  const voidIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isInteger(cardId) || cardId < 1 || reason.length < 3 || reason.length > 240 || voidIdempotencyKey.length < 16 || voidIdempotencyKey.length > 100) return res.status(400).json({ error: "Valid card id, reason, and idempotencyKey are required" });
  const card = db.prepare("SELECT id,status,sent_at,void_idempotency_key FROM topup_cards WHERE id=? LIMIT 1").get(cardId);
  if (!card) return res.status(404).json({ error: "Card not found" });
  if (card.void_idempotency_key && card.void_idempotency_key !== voidIdempotencyKey) return res.status(409).json({ error: "Card cancellation is already recorded with another idempotency key" });
  if (card.status === "void") return res.json({ success: true, cardId, status: "void", alreadyVoided: true });
  if (card.status !== "issued") return res.status(409).json({ error: `Card cannot be cancelled while status is ${card.status}` });
  if (card.sent_at) return res.status(409).json({ error: "A delivered card cannot be cancelled from this recovery action" });
  const stamp = now();
  const update = db.prepare("UPDATE topup_cards SET status='void',void_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(voidIdempotencyKey, cardId);
  if (!update.changes) return res.json({ success: true, cardId, status: "void", alreadyVoided: true });
  audit("topup_card.voided", "topup_card", cardId, { reason, voidIdempotencyKey });
  res.json({ success: true, cardId, status: "void", cancelledAt: stamp });
}
app.post("/api/dashboard/cards/:id/void", requireDashboardApi, handleVoidTopupCard);
app.post("/api/admin/cards/:id/void", requireAdmin, handleVoidTopupCard);

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

app.post("/api/dashboard/captains/:id/wallet-adjustment", requireDashboardApi, async (req, res) => {
  const id = Number(req.params.id);
  const captain = db.prepare("SELECT id,phone,name,wallet_cents,active FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const direction = String(req.body?.direction || "").toLowerCase();
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || "").trim();
  const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!["credit", "debit"].includes(direction) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || reason.length < 3 || reason.length > 240 || idempotencyKey.length < 16 || idempotencyKey.length > 100) return res.status(400).json({ error: "Direction, positive amount, reason, and unique idempotencyKey are required" });
  const amountCents = Math.round(amount * 100);
  if (direction === "credit" && creditMode === "direct") {
    const existing = db.prepare("SELECT id,amount_cents,balance_after_cents,reference FROM wallet_ledger WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
    if (existing) return res.status(409).json({ error: "هذه الحركة مسجلة مسبقًا", ledgerId: existing.id, reference: existing.reference });
    if (!captain.active || captain.account_status !== "active") return res.status(409).json({ error: "حساب الكابتن غير نشط أو غير معتمد" });
    const nextBalance = captain.wallet_cents + amountCents;
    const reference = "ADMIN-DIRECT-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
    const stamp = now();
    const ledgerId = db.transaction(() => {
      db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain'").run(nextBalance, stamp, id);
      const result = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)").run(id, "admin_credit", amountCents, nextBalance, reference, reason, stamp, JSON.stringify({ idempotencyKey, direction, creditMode, amount, amountCents, reason, actor: "owner", source: "company_direct" }), idempotencyKey);
      audit("captain.wallet.credited_direct", "user", id, { phone: captain.phone, amountCents, reason, reference, balanceAfterCents: nextBalance, actor: "owner", source: "company_direct" });
      return result.lastInsertRowid;
    })();
    void notifyOperations({ event: "captain.wallet.credited_direct", title: "تأكيد إضافة رصيد مباشرة", captainPhone: captain.phone, lines: ["الكابتن: " + captain.name, "تمت إضافة: " + money(amountCents) + " JOD", "الرصيد الحالي: " + money(nextBalance) + " JOD", "السبب: " + reason, "تم تسجيل الحركة المباشرة في دفتر الشركة."], ownersOnly: true });
    return res.status(201).json({ success: true, mode: "direct", ledgerId, reference, balance: money(nextBalance), balanceCents: nextBalance, credited: money(amountCents) });
  }
  if (direction === "credit") {
    if (!cardEncryptionKey) return res.status(503).json({ error: "تشفير بطاقات الشحن غير مهيأ" });
    if (!captain.active) return res.status(409).json({ error: "حساب الكابتن غير نشط" });
    const issueIdempotencyKey = `WALLET-${idempotencyKey}`.slice(0, 100);
    let card = db.prepare("SELECT * FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueIdempotencyKey);
    if (card && (Number(card.assigned_captain_id) !== captain.id || Number(card.value_cents) !== amountCents)) return res.status(409).json({ error: "مفتاح العملية مستخدم لبطاقة مختلفة" });
    if (card && card.status !== "issued") return res.status(409).json({ error: `البطاقة حالتها ${card.status} ولا يمكن إصدارها مجددًا` });
    if (!card) {
      let code = randomCode();
      while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
      const result = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,?,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), amountCents, captain.id, issueIdempotencyKey, encryptCardCode(code), now());
      card = db.prepare("SELECT * FROM topup_cards WHERE id=?").get(result.lastInsertRowid);
      audit("topup_card.issued", "topup_card", card.id, { valueCents: amountCents, captainId: captain.id, issueIdempotencyKey, source: "company_direct_transfer" });
    }
    if (!client || !isReady) return res.status(503).json({ error: "تم إصدار بطاقة الرصيد لكن WhatsApp غير جاهز للإرسال حاليًا", cardId: card.id, status: "issued" });
    try {
      const code = decryptCardCode(card.code_ciphertext);
      const appUrl = captainAppUrl(captainInviteBaseUrl(req));
      const caption = brandedMessage("بطاقة شحن رسمية", [`الكابتن: ${captain.name}`, `القيمة: ${money(amountCents)} JOD`, "هذه البطاقة مخصصة لرقمك وتُستخدم مرة واحدة فقط.", `الدخول: ${appUrl}`, "أدخل رمز البطاقة في بوابة التشغيل لإضافة الرصيد مباشرة."]);
      const media = await renderTopupCardMedia({ cardId: card.id, code, valueCents: amountCents, captainName: captain.name, appUrl });
      const recipient = await resolveWhatsAppRecipientId(captain.phone);
      if (!recipient) return res.status(409).json({ error: "تعذر حل حساب WhatsApp للكابتن؛ البطاقة محفوظة ولم تُرسل", cardId: card.id, status: "issued" });
      const sent = await withTimeout(client.sendMessage(recipient, media, { caption }), 30000, null);
      if (!sent) return res.status(504).json({ error: "تم إصدار البطاقة لكن انتهت مهلة إرسالها", cardId: card.id, status: "issued" });
      db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), `WALLET-DELIVERY-${idempotencyKey}`.slice(0, 100), card.id);
      audit("topup_card.sent", "topup_card", card.id, { captainId: captain.id, source: "company_direct_transfer" });
      notifyCaptainCreditSent({ captain, valueCents: amountCents, cardId: card.id });
      void notifyOperations({ event: "topup_card.sent", title: "تأكيد تحويل رصيد عبر بطاقة", lines: [`الكابتن: ${captain.name}`, `القيمة: ${money(amountCents)} JOD`, `رقم البطاقة الداخلي: #${card.id}`, "تم إصدار بطاقة الرصيد من الشركة وإرسالها للكابتن.", "يُضاف الرصيد عند استرداد البطاقة من الكابتن."], ownersOnly: true });
      return res.status(201).json({ success: true, cardId: card.id, status: "sent", balance: money(captain.wallet_cents), credited: "0.00", message: "تم إصدار بطاقة الرصيد وإرسالها للكابتن؛ سيُضاف الرصيد عند إدخال رمز البطاقة." });
    } catch (error) {
      audit("topup_card.delivery_failed", "topup_card", card.id, { captainId: captain.id, source: "company_direct_transfer", error: String(error?.message || error) });
      return res.status(502).json({ error: "تم إصدار البطاقة لكن تعذر إرسالها عبر WhatsApp", cardId: card.id, status: "issued" });
    }
  }
  const signedAmount = direction === "credit" ? amountCents : -amountCents;
  const existing = db.prepare("SELECT id,amount_cents,balance_after_cents,reference FROM wallet_ledger WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
  if (existing) return res.status(409).json({ error: "This adjustment was already recorded", ledgerId: existing.id, reference: existing.reference });
  const nextBalance = captain.wallet_cents + signedAmount;
  if (direction === "debit" && nextBalance < CAPTAIN_MIN_BALANCE_CENTS) return res.status(409).json({ error: `Debit exceeds the captain debt limit (${money(CAPTAIN_MIN_BALANCE_CENTS)})` });
  const reference = `DASH-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const stamp = now();
  const ledgerId = db.transaction(() => {
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain'").run(nextBalance, stamp, id);
    const result = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)").run(id, direction === "credit" ? "admin_credit" : "admin_debit", signedAmount, nextBalance, reference, reason, stamp, JSON.stringify({ idempotencyKey, direction, amount, amountCents, reason, actor: "dashboard" }), idempotencyKey);
    audit(direction === "credit" ? "captain.wallet.credited" : "captain.wallet.debited", "user", id, { phone: captain.phone, amountCents, reason, reference, balanceAfterCents: nextBalance, actor: "dashboard" });
    return result.lastInsertRowid;
  })();
  if (direction === "debit" && nextBalance < 0) void notifyCaptainNegativeBalance({ captainId: id, balanceCents: nextBalance, reason, reference });
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
  const groupName = String(req.body?.groupName || "وصلني الآن — شبكة التشغيل الرسمية").trim().slice(0, 100) || "وصلني الآن — شبكة التشغيل الرسمية";
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
  const groupName = String(req.body?.groupName || "وصلني الآن — شبكة التشغيل الرسمية").trim().slice(0, 100) || "وصلني الآن — شبكة التشغيل الرسمية";
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
      "تم تسجيل رقمك ضمن أعضاء شبكة وصلني الآن التشغيلية.",
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
  const groupName = String(req.query.groupName || "وصلني الآن — شبكة التشغيل الرسمية").trim().slice(0, 100) || "وصلني الآن — شبكة التشغيل الرسمية";
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
  const groupName = String(req.body?.groupName || "وصلني الآن — شبكة التشغيل الرسمية").trim().slice(0, 100) || "وصلني الآن — شبكة التشغيل الرسمية";
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
  const groupName = String(req.query.groupName || "وصلني الآن — شبكة التشغيل الرسمية").trim().slice(0, 100) || "وصلني الآن — شبكة التشغيل الرسمية";
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
  const groupName = String(req.body.groupName || "وصلني الآن للنقل والخدمات اللوجستية — الطلبات الرسمية").trim();
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

app.get("/api/admin/users", requireAdmin, (req, res) => {
  normalizeBotIdentity();
  const users = db.prepare(`SELECT u.id,u.phone,u.name,u.role,u.wallet_cents,u.active,u.is_bot,u.account_status,u.captain_auth_method,u.created_at,u.updated_at,
    COALESCE((SELECT SUM(c.value_cents) FROM topup_cards c WHERE c.assigned_captain_id=u.id),0) AS cards_issued_cents,
    COALESCE((SELECT SUM(c.value_cents) FROM topup_cards c WHERE c.assigned_captain_id=u.id AND c.sent_at IS NOT NULL),0) AS cards_sent_cents,
    COALESCE((SELECT SUM(c.value_cents) FROM topup_cards c WHERE c.assigned_captain_id=u.id AND c.status='redeemed'),0) AS cards_redeemed_cents,
    COALESCE((SELECT SUM(c.value_cents) FROM topup_cards c WHERE c.assigned_captain_id=u.id AND c.status='issued' AND c.sent_at IS NULL),0) AS cards_pending_cents
    FROM users u ORDER BY u.is_bot DESC,u.role,u.name,u.id`).all();
  res.json({ users: users.map((user) => ({ ...user, balance: money(user.wallet_cents), cardsIssued: money(user.cards_issued_cents), cardsSent: money(user.cards_sent_cents), cardsRedeemed: money(user.cards_redeemed_cents), cardsPending: money(user.cards_pending_cents), protected: Boolean(user.is_bot || user.role === "company") })) });
});
app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id=? LIMIT 1").get(id);
  if (!Number.isInteger(id) || !user) return res.status(404).json({ error: "المستخدم غير موجود" });
  if (user.is_bot || user.role === "company") return res.status(403).json({ error: "حساب النظام محمي ولا يمكن تغيير دوره أو حذفه" });
  const name = req.body.name === undefined ? user.name : String(req.body.name).trim();
  const phone = req.body.phone === undefined ? user.phone : phoneWithCountry(String(req.body.phone));
  const role = req.body.role === undefined ? user.role : String(req.body.role).trim().toLowerCase();
  const active = req.body.active === undefined ? Number(user.active) : (req.body.active ? 1 : 0);
  const pin = req.body.pin === undefined ? null : String(req.body.pin || "").trim();
  if (!name || name.length > 100) return res.status(400).json({ error: "اسم المستخدم غير صالح" });
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم هاتف أردني صحيح مطلوب" });
  if (role !== "captain") return res.status(400).json({ error: "كل المستخدمين البشريين يُعاملون ككابتن" });
  const duplicate = db.prepare("SELECT id FROM users WHERE phone=? AND id<>? LIMIT 1").get(phone, id);
  if (duplicate) return res.status(409).json({ error: "رقم الهاتف مستخدم لحساب آخر" });
  if (pin && !validCaptainPin(pin)) return res.status(400).json({ error: "الرمز السري يجب أن يكون 5 أرقام" });
  const stamp = now();
  const pinHash = pin ? bcrypt.hashSync(pin, 10) : user.captain_pin_hash;
  const authMethod = user.captain_auth_method || "pin";
  db.prepare("UPDATE users SET phone=?,name=?,role=?,active=?,account_status=?,captain_pin_hash=?,captain_pin_ciphertext=NULL,captain_auth_method=?,updated_at=? WHERE id=?")
    .run(phone, name, role, active, active ? "active" : "suspended", pinHash, authMethod, stamp, id);
  audit("admin.user.updated", "user", id, { phone, name, role, active, pinChanged: Boolean(pin) });
  res.json({ success: true, user: db.prepare("SELECT id,phone,name,role,wallet_cents,active,is_bot,account_status,captain_auth_method,created_at,updated_at FROM users WHERE id=?").get(id) });
});
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT id,phone,name,role,wallet_cents,active,is_bot FROM users WHERE id=? LIMIT 1").get(id);
  if (!Number.isInteger(id) || !user) return res.status(404).json({ error: "المستخدم غير موجود" });
  if (user.is_bot || user.role === "company") return res.status(403).json({ error: "حساب النظام محمي ولا يمكن حذفه" });
  const refs = {
    orders: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE producer_user_id=? OR captain_user_id=? OR pending_captain_user_id=?").get(id, id, id).count,
    ledger: db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=?").get(id).count,
    settlements: db.prepare("SELECT COUNT(*) AS count FROM order_settlements WHERE captain_user_id=? OR producer_user_id=?").get(id, id).count,
    cards: db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE redeemed_by=? OR assigned_captain_id=?").get(id, id).count,
  };
  if (Object.values(refs).some((count) => Number(count) > 0) || Number(user.wallet_cents) !== 0) return res.status(409).json({ error: "لا يمكن حذف مستخدم مرتبط بطلبات أو محاسبة أو بطاقات أو رصيد. استخدم الإيقاف بدل الحذف.", reasons: { ...refs, balance: money(user.wallet_cents) } });
  db.transaction(() => {
    db.prepare("DELETE FROM captain_phone_aliases WHERE captain_user_id=?").run(id);
    db.prepare("DELETE FROM captain_auth_challenges WHERE captain_user_id=?").run(id);
    db.prepare("UPDATE captain_invites SET approved_user_id=NULL WHERE approved_user_id=?").run(id);
    db.prepare("DELETE FROM users WHERE id=?").run(id);
  })();
  audit("admin.user.deleted", "user", id, { phone: user.phone, name: user.name, role: user.role });
  res.json({ success: true, deleted: id });
});
app.get("/api/admin/captains", requireAdmin, (req, res) => {
  normalizeBotIdentity();
  const rows = db.prepare(`SELECT u.id,u.phone,u.name,COALESCE(NULLIF(u.registration_name,''),u.name) AS registration_name,u.role,u.wallet_cents,u.active,u.account_status,u.captain_auth_method,u.captain_whatsapp_verified_at,u.captain_last_login_at,u.is_bot,u.created_at,u.updated_at,
    COALESCE((SELECT COUNT(*) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.producer_user_id=u.id AND s.status='applied' AND o.status IN ('accepted','completed')),0) AS posted_orders,
    COALESCE((SELECT COUNT(*) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND o.status IN ('accepted','completed')),0) AS executed_orders,
    COALESCE((SELECT SUM(s.price_cents) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND o.status IN ('accepted','completed')),0) AS gross_fares_cents,
    COALESCE((SELECT SUM(s.captain_fee_cents) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND o.status IN ('accepted','completed')),0) AS captain_fee_cents,
    COALESCE((SELECT SUM(s.company_cents) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND o.status IN ('accepted','completed')),0) AS company_commission_cents,
    COALESCE((SELECT SUM(s.producer_cents) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.producer_user_id=u.id AND s.status='applied' AND o.status IN ('accepted','completed')),0) AS posted_share_cents,
    COALESCE((SELECT SUM(s.captain_fee_cents) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND o.status IN ('accepted','completed')),0) AS executed_debit_cents,
    (SELECT MAX(o.accepted_at) FROM order_settlements s JOIN orders o ON o.id=s.order_id WHERE (s.producer_user_id=u.id OR s.captain_user_id=u.id) AND s.status='applied' AND o.status IN ('accepted','completed')) AS last_confirmed_at
    FROM users u WHERE u.role='captain' AND u.account_status<>'merged'
    ORDER BY u.active DESC,u.id DESC`).all();
  res.json({ captains: rows.map((row) => ({
    ...row,
    registrationName: row.registration_name || row.name,
    displayName: captainDisplayName(row.registration_name || row.name),
    authMethod: normalizeCaptainAuthMethod(row.captain_auth_method),
    balance: money(row.wallet_cents),
    grossFares: money(row.gross_fares_cents),
    captainFees: money(row.captain_fee_cents),
    companyCommission: money(row.company_commission_cents),
    postedShare: money(row.posted_share_cents),
    executedDebit: money(row.executed_debit_cents),
    postedOrders: Number(row.posted_orders || 0),
    executedOrders: Number(row.executed_orders || 0),
    netEarnings: money(Number(row.posted_share_cents || 0) - Number(row.executed_debit_cents || 0)),
  })) });
});
app.post("/api/admin/group/sync-captains", requireAdmin, async (req, res) => {
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const sendLinks = req.body?.sendLinks === true;
  const results = await syncActiveCaptainsToConfiguredGroup({ sendLinks, baseUrl: captainInviteBaseUrl(req) });
  audit("captains.group_membership.bulk_sync", "group", groupId, { count: results.length, sendLinks });
  void notifyOperations({ event: "captains.group_membership.bulk_sync", title: "تأكيد مزامنة الكباتن", lines: [`عدد الحسابات التي تمت مزامنتها: ${results.length}`, `إرسال بطاقات الدخول: ${sendLinks ? "مفعّل" : "متوقف"}`, "تم تسجيل نتيجة المزامنة في النظام."], ownersOnly: true });
  res.json({ success: true, groupId, sendLinks, results });
});
app.post("/api/admin/captains/normalize-all", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const result = await normalizeAllCaptains({ force: true, baseUrl: captainInviteBaseUrl(req) });
  res.json({ success: true, ...result });
});
app.post("/api/admin/captains/sync-names", requireAdmin, async (req, res) => {
  const result = await syncRegisteredCaptainNamesFromConfiguredGroup();
  if (result.status !== "completed") return res.status(503).json(result);
  audit("captains.names.synced_from_configured_group", "group", result.groupId, { updated: result.updated.length, skipped: result.skipped.length });
  res.json({ success: true, ...result });
});
app.get("/api/admin/captains/sync-names/run", requireAdmin, async (req, res) => {
  if (String(req.query.run || "") !== "1") return res.status(400).json({ error: "Add ?run=1 to execute the name sync" });
  const result = await syncRegisteredCaptainNamesFromConfiguredGroup();
  if (result.status !== "completed") return res.status(503).json(result);
  audit("captains.names.synced_from_configured_group", "group", result.groupId, { updated: result.updated.length, skipped: result.skipped.length, via: "admin_run_link" });
  res.json({ success: true, ...result });
});
app.post("/api/admin/group/register-members", requireAdmin, async (req, res) => {
  const groupId = getSetting("group_id", null);
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const sendLinks = req.body?.sendLinks === true;
  const result = await registerGroupMembersAsCaptains({ groupId, sendLinks, reactivate: req.body?.reactivate === true, baseUrl: captainInviteBaseUrl(req) });
  audit("group.members.registered_as_captains", "group", groupId, { totalMembers: result.totalMembers || 0, registered: (result.results || []).filter((item) => item.status === "registered").length, sendLinks });
  void notifyOperations({ event: "group.members.registered_as_captains", title: "تأكيد تسجيل أعضاء القروب", lines: [`إجمالي الأعضاء: ${result.totalMembers || 0}`, `الحسابات المسجلة: ${(result.results || []).filter((item) => item.status === "registered").length}`, `إرسال بطاقات الدخول: ${sendLinks ? "مفعّل" : "متوقف"}`], ownersOnly: true });
  res.json({ success: true, ...result, sendLinks });
});
app.post("/api/admin/captains", requireAdminOrDashboardApi, (req, res) => {
  const phone = phoneWithCountry(String(req.body.phone || ""));
  const name = String(req.body.name || "").trim();
  const authMethod = normalizeCaptainAuthMethod(req.body?.authMethod || "whatsapp");
  const pin = String(req.body?.pin || "").trim();
  if (!/^\d{8,15}$/.test(phone) || !name || name.length > 100) return res.status(400).json({ error: "Captain name and a valid phone are required" });
  if (authMethod === "pin" && !validCaptainPin(pin)) return res.status(400).json({ error: "PIN must contain exactly 5 digits" });
  let existing = db.prepare("SELECT * FROM users WHERE phone=? LIMIT 1").get(phone) || findCaptainByPhone(phone);
  if (existing && (existing.is_bot === 1 || existing.role === "company" || isProtectedOwnerIdentity(phone))) return res.status(409).json({ error: "Owner and system identities cannot be registered as captains" });
  if (existing && existing.role !== "captain") {
    const normalized = activateHumanCaptainAccount({ phone, name, reactivate: true });
    existing = normalized.userId ? db.prepare("SELECT * FROM users WHERE id=? LIMIT 1").get(normalized.userId) : null;
  }
  const stamp = now();
  const pinHash = authMethod === "pin" ? bcrypt.hashSync(pin, 10) : null;
  if (existing) {
    db.prepare("UPDATE users SET name=?,role='captain',active=1,is_bot=0,account_status='active',captain_auth_method=?,captain_pin_hash=?,captain_pin_ciphertext=NULL,approved_at=COALESCE(approved_at,?),activated_at=COALESCE(activated_at,?),updated_at=? WHERE id=?").run(name, authMethod, pinHash, stamp, stamp, stamp, existing.id);
    audit("captain.reactivated", "user", existing.id, { phone, name, authMethod });
    void addCaptainToConfiguredGroup({ phone, name });
    void sendCaptainAppLink({ phone, name }, captainInviteBaseUrl(req));
    return res.json({ success: true, id: existing.id, reactivated: true, accountLinkSent: true });
  }
  const result = db.prepare("INSERT INTO users(phone,name,registration_name,role,wallet_cents,active,is_bot,captain_pin_hash,captain_auth_method,account_status,approved_at,activated_at,created_at,updated_at) VALUES(?,?,?, 'captain',0,1,0,?,?,'active',?,?,?,?)").run(phone, name, name, pinHash, authMethod, stamp, stamp, stamp, stamp);
  audit("captain.created", "user", result.lastInsertRowid, { phone, name, authMethod });
  void addCaptainToConfiguredGroup({ phone, name });
  void sendCaptainAppLink({ phone, name }, captainInviteBaseUrl(req));
  res.status(201).json({ success: true, id: result.lastInsertRowid, accountLinkSent: true });
});
app.get("/api/admin/captains/:id/profile", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid captain id" });
  const captain = db.prepare("SELECT id,phone,name,role,wallet_cents,active,account_status,captain_auth_method,captain_whatsapp_verified_at,captain_last_login_at,is_bot,created_at,updated_at FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const orders = db.prepare(`SELECT o.id,o.order_no,o.status,o.order_kind,o.raw_text,o.price_cents,o.origin,o.destination,o.trip_time,o.company_cents,o.producer_cents,o.captain_cents,o.producer_user_id,o.captain_user_id,o.accepted_message_id,o.confirmed_by_phone,o.accepted_at,o.settlement_state,o.created_at,o.updated_at,
    s.id AS settlement_id,s.status AS settlement_status,s.idempotency_key AS settlement_key,s.company_cents AS settlement_company_cents,s.producer_cents AS settlement_producer_cents,s.captain_fee_cents AS settlement_captain_fee_cents,s.applied_at AS settlement_applied_at,
    p.name AS producer_name,c.name AS captain_name
    FROM orders o LEFT JOIN order_settlements s ON s.order_id=o.id LEFT JOIN users p ON p.id=COALESCE(s.producer_user_id,o.producer_user_id) LEFT JOIN users c ON c.id=COALESCE(s.captain_user_id,o.captain_user_id)
    WHERE o.producer_user_id=? OR o.captain_user_id=? OR s.producer_user_id=? OR s.captain_user_id=? ORDER BY o.id DESC LIMIT 200`).all(id, id, id, id);
  const ledger = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 200").all(id).map((entry) => ({ ...entry, details: entry.details_json ? JSON.parse(entry.details_json) : null }));
  const totals = db.prepare(`SELECT COUNT(*) AS trips,
    COALESCE(SUM(CASE WHEN s.producer_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN s.producer_cents ELSE 0 END),0) AS posted_share_cents,
    COALESCE(SUM(CASE WHEN s.captain_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN s.captain_fee_cents ELSE 0 END),0) AS executed_debit_cents,
    COALESCE(SUM(CASE WHEN s.producer_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN 1 ELSE 0 END),0) AS posted_orders,
    COALESCE(SUM(CASE WHEN s.captain_user_id=? AND s.status='applied' AND o.status IN ('accepted','completed') THEN 1 ELSE 0 END),0) AS executed_orders,
    COALESCE(SUM(CASE WHEN s.captain_user_id=? AND s.status='applied' AND o.status='completed' THEN 1 ELSE 0 END),0) AS completed,
    COALESCE(SUM(CASE WHEN s.captain_user_id=? AND s.status='applied' AND o.status='accepted' THEN 1 ELSE 0 END),0) AS accepted
    FROM order_settlements s JOIN orders o ON o.id=s.order_id`).get(id, id, id, id, id, id);
  const companyCommissionCents = db.prepare("SELECT COALESCE(SUM(company_cents),0) AS cents FROM order_settlements WHERE captain_user_id=? AND status='applied'").get(id).cents;
  res.json({ captain: { ...captain, authMethod: normalizeCaptainAuthMethod(captain.captain_auth_method), balance: money(captain.wallet_cents) }, summary: { trips: totals.trips, completed: totals.completed, accepted: totals.accepted, postedOrders: Number(totals.posted_orders || 0), executedOrders: Number(totals.executed_orders || 0), postedShare: money(totals.posted_share_cents), executedDebit: money(totals.executed_debit_cents), grossEarnings: money(totals.posted_share_cents), captainFees: money(totals.executed_debit_cents), companyCommission: money(companyCommissionCents), netEarnings: money(Number(totals.posted_share_cents || 0) - Number(totals.executed_debit_cents || 0)), earnings: money(Number(totals.posted_share_cents || 0) - Number(totals.executed_debit_cents || 0)) }, orders: orders.map((order) => {
    const finalized = ['accepted','completed'].includes(order.status) && order.settlement_status === 'applied';
    const postedShareCents = finalized && Number(order.producer_user_id) === id ? Number(order.settlement_producer_cents ?? order.producer_cents ?? 0) : 0;
    const executedDebitCents = finalized && Number(order.captain_user_id) === id ? Number(order.settlement_captain_fee_cents ?? ((order.producer_cents || 0) + (order.company_cents || 0))) : 0;
    return { ...order, ...settlementFinancials(order), producer_name: order.producer_name || 'غير مسجل', captain_name: order.captain_name || 'غير مسجل', earnings: money(postedShareCents), captainFee: money(executedDebitCents), postedShare: money(postedShareCents), executedDebit: money(executedDebitCents), netEarnings: money(postedShareCents - executedDebitCents), role: postedShareCents ? 'downloader' : executedDebitCents ? 'executor' : 'participant', orderType: order.order_kind === "order" ? "أوردر محدد" : "طلب عادي" };
  }), ledger });
});
app.patch("/api/admin/captains/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const captain = db.prepare("SELECT id,phone,name,active FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const name = req.body.name === undefined ? captain.name : String(req.body.name).trim();
  const active = req.body.active === undefined ? captain.active : (req.body.active ? 1 : 0);
  if (!name || name.length > 100) return res.status(400).json({ error: "Captain name is invalid" });
  const stamp = now();
  const statusChange = db.prepare("UPDATE users SET name=?,active=?,account_status=?,updated_at=? WHERE id=? AND role='captain' AND active<>?").run(name, active, active ? "active" : "suspended", stamp, id, active);
  if (!statusChange.changes) {
    db.prepare("UPDATE users SET name=?,updated_at=? WHERE id=? AND role='captain'").run(name, stamp, id);
    audit("captain.updated", "user", id, { phone: captain.phone, name, active, statusChanged: false, notificationSent: false });
    return res.json({ success: true, id, active, name, statusChanged: false, notificationSent: false });
  }
  audit(active ? "captain.activated" : "captain.deactivated", "user", id, { phone: captain.phone, name, statusChanged: true });
  void sendCaptainStatusText({
    phone: captain.phone,
    event: active ? "captain.activated" : "captain.deactivated",
    title: active ? "تفعيل حساب الكابتن" : "إيقاف حساب الكابتن",
    text: active ? "تم تفعيل حسابك ويمكنك استخدام بوابة التشغيل." : "تم إيقاف حسابك مؤقتًا؛ راجع الشركة.",
    idempotencyKey: `CAPTAIN-STATUS-${id}-${active ? "ACTIVE" : "SUSPENDED"}-${stamp}`,
  });
  void notifyOperations({ event: active ? "captain.activated" : "captain.deactivated", title: active ? "تأكيد تفعيل حساب الكابتن" : "تأكيد إيقاف حساب الكابتن", lines: [`الكابتن: ${name}`, `الحالة: ${active ? "نشط" : "موقوف"}`], ownersOnly: true });
  res.json({ success: true, id, active, name, statusChanged: true, notificationSent: true });
});
app.delete("/api/admin/captains/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid captain id" });
  const captain = db.prepare("SELECT id,phone,name,wallet_cents FROM users WHERE id=? AND role='captain'").get(id);
  if (!captain) return res.status(404).json({ error: "Captain not found" });
  const trips = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE captain_user_id=?").get(id).count;
  const ledger = db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=?").get(id).count;
  const cards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE redeemed_by=? OR assigned_captain_id=?").get(id, id).count;
  const aliases = db.prepare("SELECT COUNT(*) AS count FROM captain_phone_aliases WHERE captain_user_id=?").get(id).count;
  if (captain.wallet_cents !== 0 || trips || ledger || cards || aliases) return res.status(409).json({ error: "لا يمكن حذف كابتن لديه رحلات أو حركات مالية أو رصيد أو أسماء بديلة مرتبطة. استخدم الإيقاف عن العمل بدلًا من الحذف.", reasons: { balance: money(captain.wallet_cents), trips, ledger, cards, aliases } });
  db.transaction(() => { db.prepare("DELETE FROM captain_invites WHERE approved_user_id=?").run(id); db.prepare("DELETE FROM users WHERE id=? AND role='captain'").run(id); })();
  audit("captain.deleted", "user", id, { phone: captain.phone, name: captain.name });
  res.json({ success: true, deleted: id });
});
app.get("/api/admin/captains/:id/merge-preview", requireAdmin, (req, res) => {
  const sourceId = Number(req.params.id);
  const targetId = Number(req.query.targetId);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId === targetId) return res.status(400).json({ error: "Source and target captain ids are required" });
  const source = db.prepare("SELECT id,phone,name,wallet_cents,active,account_status FROM users WHERE id=? AND role='captain'").get(sourceId);
  const target = db.prepare("SELECT id,phone,name,wallet_cents,active,account_status FROM users WHERE id=? AND role='captain'").get(targetId);
  if (!source || !target) return res.status(404).json({ error: "Captain account not found" });
  const references = {
    captainOrders: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE captain_user_id=? OR pending_captain_user_id=?").get(sourceId, sourceId).count,
    producerOrders: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE producer_user_id=?").get(sourceId).count,
    ledger: db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=?").get(sourceId).count,
    cards: db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE assigned_captain_id=? OR redeemed_by=?").get(sourceId, sourceId).count,
    aliases: db.prepare("SELECT COUNT(*) AS count FROM captain_phone_aliases WHERE captain_user_id=?").get(sourceId).count,
  };
  res.json({ source: { ...source, balance: money(source.wallet_cents) }, target: { ...target, balance: money(target.wallet_cents) }, references, resultingBalance: money(Number(source.wallet_cents || 0) + Number(target.wallet_cents || 0)), confirmation: `MERGE ${sourceId} INTO ${targetId}` });
});
app.post("/api/admin/captains/:id/merge", requireAdmin, async (req, res) => {
  const sourceId = Number(req.params.id);
  const targetId = Number(req.body?.targetId);
  const reason = String(req.body?.reason || "").trim().slice(0, 240);
  const confirmation = String(req.body?.confirmation || "").trim();
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId === targetId || confirmation !== `MERGE ${sourceId} INTO ${targetId}` || !reason) return res.status(400).json({ error: "Target, reason, and exact merge confirmation are required" });
  const source = db.prepare("SELECT * FROM users WHERE id=? AND role='captain'").get(sourceId);
  const target = db.prepare("SELECT * FROM users WHERE id=? AND role='captain'").get(targetId);
  if (!source || !target) return res.status(404).json({ error: "Captain account not found" });
  if (source.account_status === "merged" || target.account_status === "merged") return res.status(409).json({ error: "A merged account cannot be merged again" });
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupName = `pre-captain-merge-${sourceId}-into-${targetId}-${Date.now()}.sqlite`;
  await db.backup(path.join(backupDir, backupName));
  const stamp = now();
  const details = db.transaction(() => {
    const counts = {
      captainOrders: db.prepare("UPDATE orders SET captain_user_id=?,captain_phone_snapshot=?,captain_name_snapshot=?,updated_at=? WHERE captain_user_id=?").run(targetId, target.phone, target.name, stamp, sourceId).changes,
      pendingOrders: db.prepare("UPDATE orders SET pending_captain_user_id=?,updated_at=? WHERE pending_captain_user_id=?").run(targetId, stamp, sourceId).changes,
      producerOrders: db.prepare("UPDATE orders SET producer_user_id=?,producer_phone_snapshot=?,producer_name_snapshot=?,updated_at=? WHERE producer_user_id=?").run(targetId, target.phone, target.name, stamp, sourceId).changes,
      ledger: db.prepare("UPDATE wallet_ledger SET user_id=? WHERE user_id=?").run(targetId, sourceId).changes,
      cardsAssigned: db.prepare("UPDATE topup_cards SET assigned_captain_id=? WHERE assigned_captain_id=?").run(targetId, sourceId).changes,
      cardsRedeemed: db.prepare("UPDATE topup_cards SET redeemed_by=? WHERE redeemed_by=?").run(targetId, sourceId).changes,
      invites: db.prepare("UPDATE captain_invites SET approved_user_id=? WHERE approved_user_id=?").run(targetId, sourceId).changes,
      settlementsCaptain: db.prepare("UPDATE order_settlements SET captain_user_id=? WHERE captain_user_id=?").run(targetId, sourceId).changes,
      settlementsProducer: db.prepare("UPDATE order_settlements SET producer_user_id=? WHERE producer_user_id=?").run(targetId, sourceId).changes,
    };
    db.prepare("UPDATE captain_phone_aliases SET captain_user_id=? WHERE captain_user_id=?").run(targetId, sourceId);
    db.prepare("INSERT INTO captain_phone_aliases(phone,captain_user_id,created_at) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET captain_user_id=excluded.captain_user_id").run(source.phone, targetId, stamp);
    const mergedPhone = `merged:${sourceId}:${source.phone}`;
    const targetBalance = Number(target.wallet_cents || 0) + Number(source.wallet_cents || 0);
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=?").run(targetBalance, stamp, targetId);
    db.prepare("UPDATE users SET phone=?,wallet_cents=0,active=0,account_status='merged',merged_into_user_id=?,captain_pin_hash=NULL,captain_pin_ciphertext=NULL,updated_at=? WHERE id=?").run(mergedPhone, targetId, stamp, sourceId);
    db.prepare("DELETE FROM captain_auth_challenges WHERE captain_user_id=?").run(sourceId);
    db.prepare("INSERT INTO captain_merge_history(source_captain_id,target_captain_id,source_phone,target_phone,details_json,created_at) VALUES(?,?,?,?,?,?)").run(sourceId, targetId, source.phone, target.phone, JSON.stringify({ reason, counts, sourceBalanceCents: source.wallet_cents, targetBalanceBeforeCents: target.wallet_cents, targetBalanceAfterCents: targetBalance, backupName }), stamp);
    audit("captain.merged", "user", targetId, { sourceId, sourcePhone: source.phone, targetPhone: target.phone, reason, counts, backupName });
    return { counts, targetBalance };
  })();
  res.json({ success: true, sourceId, targetId, backupName, ...details, balance: money(details.targetBalance) });
});
app.post("/api/admin/captains/resend-access-card", requireAdmin, async (req, res) => {
  const phone = phoneWithCountry(String(req.body?.phone || "").replace(/[^0-9]/g, ""));
  const deletePreviousPlain = req.body?.deletePreviousPlain === true;
  if (!isValidJordanPhone(phone) || isBlockedPhone(phone)) return res.status(400).json({ error: "رقم كابتن أردني صحيح مطلوب" });
  const captain = db.prepare("SELECT id,phone,name,active,captain_auth_method,captain_pin_hash FROM users WHERE phone=? AND role='captain' LIMIT 1").get(phone);
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
        return message?.fromMe && !message?.hasMedia && /(تمت الموافقة على طلبك|بوابة التشغيل الرسمية|تم تسجيل حسابك داخل شبكة وصلني الآن)/.test(body);
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
async function handleAdminWalletAdjustment(req, res) {
  const id = Number(req.params.id);
  const captain = db.prepare("SELECT id,phone,name,wallet_cents,active,role,account_status,is_bot FROM users WHERE id=? AND role='captain' AND is_bot=0 AND account_status<>'merged'").get(id);
  if (!captain) return res.status(404).json({ error: "المستخدم البشري غير موجود أو غير مؤهل لمحفظة كابتن" });
  const direction = String(req.body.direction || "").toLowerCase();
  const creditMode = String(req.body.creditMode || "card").toLowerCase();
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || "").trim();
  const idempotencyKey = String(req.body.idempotencyKey || "").trim();
  if (!["credit", "debit"].includes(direction) || (direction === "credit" && !["card", "direct"].includes(creditMode)) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !reason || reason.length > 240 || !idempotencyKey || idempotencyKey.length > 100) {
    return res.status(400).json({ error: "نوع الحركة والمبلغ والسبب ومفتاح idempotency مطلوبة" });
  }
  const amountCents = Math.round(amount * 100);
  if (amountCents < 1) return res.status(400).json({ error: "المبلغ صغير جدًا" });
  if (direction === "credit") {
    if (!cardEncryptionKey) return res.status(503).json({ error: "تشفير بطاقات الشحن غير مهيأ" });
    if (!captain.active || captain.account_status !== "active") return res.status(409).json({ error: "حساب الكابتن غير نشط أو غير معتمد" });
    const issueIdempotencyKey = `ADMIN-WALLET-${idempotencyKey}`.slice(0, 100);
    let card = db.prepare("SELECT * FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueIdempotencyKey);
    if (card && (Number(card.assigned_captain_id) !== captain.id || Number(card.value_cents) !== amountCents)) return res.status(409).json({ error: "مفتاح العملية مستخدم لبطاقة مختلفة" });
    if (card && card.status !== "issued") return res.status(409).json({ error: `البطاقة حالتها ${card.status} ولا يمكن إصدارها مجددًا` });
    if (!card) {
      let code = randomCode();
      while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
      const result = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,?,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), amountCents, captain.id, issueIdempotencyKey, encryptCardCode(code), now());
      card = db.prepare("SELECT * FROM topup_cards WHERE id=?").get(result.lastInsertRowid);
      audit("topup_card.issued", "topup_card", card.id, { valueCents: amountCents, captainId: captain.id, issueIdempotencyKey, source: "company_direct_transfer" });
    }
    if (!client || !isReady) return res.status(503).json({ error: "تم إصدار بطاقة الرصيد لكن WhatsApp غير جاهز للإرسال حاليًا", cardId: card.id, status: "issued" });
    if (card.sent_at) return res.status(201).json({ success: true, cardId: card.id, status: "sent", alreadySent: true, balance: money(captain.wallet_cents), credited: "0.00" });
    if (cardDeliveryInFlight.has(card.id)) return res.status(409).json({ error: "إرسال البطاقة قيد التنفيذ", cardId: card.id, status: "issued" });
    cardDeliveryInFlight.add(card.id);
    try {
      const code = decryptCardCode(card.code_ciphertext);
      const appUrl = captainAppUrl(captainInviteBaseUrl(req));
      const recipient = await resolveWhatsAppRecipientId(captain.phone);
      if (!recipient) return res.status(409).json({ error: "تعذر حل حساب WhatsApp للكابتن؛ البطاقة محفوظة ولم تُرسل", cardId: card.id, status: "issued" });
      const text = topupCardTextMessage({ cardId: card.id, code, valueCents: amountCents, captainName: captain.name, appUrl });
      const sent = await withTimeout(client.sendMessage(recipient, text), 30000, null);
      if (!sent) return res.status(504).json({ error: "تم إصدار البطاقة لكن انتهت مهلة إرسالها", cardId: card.id, status: "issued" });
      const deliveryIdempotencyKey = `ADMIN-WALLET-DELIVERY-${idempotencyKey}`.slice(0, 100);
      const updated = db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), deliveryIdempotencyKey, card.id);
      if (!updated.changes) return res.status(201).json({ success: true, cardId: card.id, status: "sent", alreadySent: true, balance: money(captain.wallet_cents), credited: "0.00" });
      audit("topup_card.sent_text_fallback", "topup_card", card.id, { captainId: captain.id, source: "company_direct_transfer", deliveryMode: "text", deliveryIdempotencyKey });
      notifyCaptainCreditSent({ captain, valueCents: amountCents, cardId: card.id });
      void notifyOperations({ event: "topup_card.sent_text_fallback", title: "تأكيد تحويل رصيد عبر بطاقة", lines: [`الكابتن: ${captain.name}`, `القيمة: ${money(amountCents)} JOD`, `رقم البطاقة الداخلي: #${card.id}`, "تم إصدار بطاقة الرصيد وإرسالها نصيًا للكابتن.", "يُضاف الرصيد عند استرداد البطاقة من الكابتن."], ownersOnly: true });
      return res.status(201).json({ success: true, cardId: card.id, status: "sent", deliveryMode: "text", balance: money(captain.wallet_cents), credited: "0.00", message: "تم إصدار بطاقة الرصيد وإرسالها للكابتن؛ سيُضاف الرصيد عند إدخال رمز البطاقة." });
    } catch (error) {
      audit("topup_card.delivery_failed", "topup_card", card.id, { captainId: captain.id, source: "company_direct_transfer", deliveryMode: "text" });
      return res.status(502).json({ error: "تم إصدار البطاقة لكن تعذر إرسالها عبر WhatsApp", cardId: card.id, status: "issued" });
    } finally { cardDeliveryInFlight.delete(card.id); }
  }
  const signedAmount = -amountCents;
  const existing = db.prepare("SELECT id,amount_cents,balance_after_cents,reference FROM wallet_ledger WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
  if (existing) return res.status(409).json({ error: "هذه الحركة مسجلة مسبقًا", ledgerId: existing.id, reference: existing.reference });
  const nextBalance = captain.wallet_cents + signedAmount;
  if (nextBalance < CAPTAIN_MIN_BALANCE_CENTS) return res.status(409).json({ error: `الخصم يتجاوز حد دين الكابتن (${money(CAPTAIN_MIN_BALANCE_CENTS)})` });
  const reference = `ADMIN-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const details = { idempotencyKey, direction, amount, amountCents, reason, actor: "admin" };
  const stamp = now();
  const apply = db.transaction(() => {
    db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain'").run(nextBalance, stamp, id);
    const result = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)").run(id, "admin_debit", signedAmount, nextBalance, reference, reason, stamp, JSON.stringify(details), idempotencyKey);
    audit("captain.wallet.debited", "user", id, { phone: captain.phone, amountCents, reason, reference, balanceAfterCents: nextBalance });
    return result.lastInsertRowid;
  });
  const ledgerId = apply();
  if (nextBalance < 0) void notifyCaptainNegativeBalance({ captainId: id, balanceCents: nextBalance, reason, reference });
  void notifyOperations({ event: "captain.wallet.debited", title: "تأكيد خصم من محفظة", captainPhone: captain.phone, lines: [`الكابتن: ${captain.name}`, `تم خصم: ${money(amountCents)} JOD`, `الرصيد الحالي: ${money(nextBalance)} JOD`, `السبب: ${reason}`, "تم تسجيل الحركة في دفتر الشركة." ] });
  res.status(201).json({ success: true, ledgerId, reference, balance: money(nextBalance), balanceCents: nextBalance });
}
function handleAdminDirectWalletCredit(req, res) {
  const id = Number(req.params.id);
  const captain = db.prepare("SELECT id,phone,name,wallet_cents,active,role,account_status,is_bot FROM users WHERE id=? AND role='captain' AND is_bot=0 AND account_status<>'merged'").get(id);
  if (!captain) return res.status(404).json({ error: "المستخدم البشري غير موجود أو غير مؤهل لمحفظة كابتن" });
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || "").trim();
  const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || reason.length < 3 || reason.length > 240 || idempotencyKey.length < 16 || idempotencyKey.length > 100) return res.status(400).json({ error: "المبلغ والسبب ومفتاح منع التكرار مطلوبة" });
  const amountCents = Math.round(amount * 100);
  if (amountCents < 1) return res.status(400).json({ error: "المبلغ صغير جدًا" });
  if (!captain.active || captain.account_status !== "active") return res.status(409).json({ error: "حساب الكابتن غير نشط أو غير معتمد" });
  const existing = db.prepare("SELECT id,user_id,amount_cents,balance_after_cents,reference FROM wallet_ledger WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
  if (existing) {
    if (Number(existing.user_id) !== id || Number(existing.amount_cents) !== amountCents) return res.status(409).json({ error: "مفتاح العملية مستخدم لحركة مختلفة" });
    return res.json({ success: true, mode: "direct", alreadyApplied: true, ledgerId: existing.id, reference: existing.reference, balance: money(existing.balance_after_cents), balanceCents: existing.balance_after_cents, credited: money(amountCents), delivery: "wallet_only" });
  }
  const nextBalance = Number(captain.wallet_cents) + amountCents;
  const reference = "ADMIN-DIRECT-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
  const stamp = now();
  const details = { idempotencyKey, direction: "credit", amount, amountCents, reason, actor: "owner", source: "company_direct", delivery: "wallet_only" };
  const ledgerId = db.transaction(() => {
    const updated = db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain' AND is_bot=0 AND account_status='active'").run(nextBalance, stamp, id);
    if (!updated.changes) throw new Error("تعذر تحديث محفظة الكابتن؛ أعد المحاولة بعد تحديث البيانات");
    const result = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)").run(id, "admin_credit", amountCents, nextBalance, reference, reason, stamp, JSON.stringify(details), idempotencyKey);
    audit("captain.wallet.credited_direct", "user", id, { phone: captain.phone, amountCents, reason, reference, balanceAfterCents: nextBalance, actor: "owner", source: "company_direct", delivery: "wallet_only" });
    return result.lastInsertRowid;
  })();
  const isLargeDirectCredit = amountCents >= DIRECT_WALLET_LARGE_CREDIT_THRESHOLD_CENTS;
  void notifyOperations({
    event: isLargeDirectCredit ? "captain.wallet.large_credit_alert" : "captain.wallet.credited_direct",
    title: isLargeDirectCredit ? "تنبيه عاجل: إضافة رصيد كبيرة" : "تأكيد إضافة رصيد مباشرة",
    captainPhone: captain.phone,
    lines: [
      isLargeDirectCredit ? "يرجى مراجعة هذه الحركة الكبيرة فورًا." : null,
      "الكابتن: " + captain.name,
      "تمت إضافة: " + money(amountCents) + " JOD",
      isLargeDirectCredit ? "عتبة التنبيه: " + money(DIRECT_WALLET_LARGE_CREDIT_THRESHOLD_CENTS) + " JOD" : null,
      "الرصيد الحالي: " + money(nextBalance) + " JOD",
      "السبب: " + reason,
      "إضافة داخلية مباشرة دون إنشاء بطاقة أو إرسال WhatsApp للكابتن."
    ],
    ownersOnly: true
  });
  return res.status(201).json({ success: true, mode: "direct", alreadyApplied: false, ledgerId, reference, balance: money(nextBalance), balanceCents: nextBalance, credited: money(amountCents), delivery: "wallet_only" });
}
app.post("/api/admin/users/:id/direct-credit", requireBotWalletOwner, handleAdminDirectWalletCredit);
app.post("/api/admin/captains/:id/direct-credit", requireBotWalletOwner, handleAdminDirectWalletCredit);
app.post("/api/admin/captains/:id/wallet-adjustment", requireAdmin, handleAdminWalletAdjustment);
app.post("/api/admin/users/:id/wallet-adjustment", requireAdmin, handleAdminWalletAdjustment);
app.get("/api/admin/wallet/:phone", requireBotWalletOwner, (req, res) => {
  const phone = phoneWithCountry(req.params.phone || "");
  const user = db.prepare("SELECT id,phone,name,role,wallet_cents,active,is_bot,created_at,updated_at FROM users WHERE phone=? LIMIT 1").get(phone);
  if (!user) return res.status(404).json({ error: "Subscriber wallet not found" });
  const entries = db.prepare("SELECT id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json FROM wallet_ledger WHERE user_id=? ORDER BY id DESC").all(user.id).map((entry) => ({ ...entry, details: entry.details_json ? JSON.parse(entry.details_json) : null }));
  res.json({ user, wallet: { currency: "JOD", balance: money(user.wallet_cents), balanceCents: user.wallet_cents, entries } });
});

app.post("/api/admin/group", requireAdmin, (req, res) => {
  const groupId = String(req.body.groupId || "").trim();
  const groupName = String(req.body.groupName || "قروب وصلني الآن").trim();
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
  const expectedName = "وصلني الآن — شبكة التشغيل الرسمية";
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
  const groupName = String(req.body.groupName || "قروب وصلني الآن").trim();
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
  const groupName = String(chat.name || "قروب وصلني الآن").trim().slice(0, 160) || "قروب وصلني الآن";
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
app.post("/api/admin/group/send-balance-notifications", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const runKey = String(req.body?.runKey || "").trim();
  const expectedCount = Number(req.body?.expectedCount);
  if (confirmation !== "SEND_PRIVATE_BALANCE_NOTICES_TO_GROUP_MEMBERS" || !/^[A-Z0-9-]{16,100}$/.test(runKey) || !Number.isInteger(expectedCount)) return res.status(400).json({ error: "تأكيد الإرسال ومفتاح العملية والعدد المتوقع مطلوبة" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  if (balanceNotificationBroadcasts.has(runKey)) return res.json({ success: true, started: true, runKey, ...balanceNotificationBroadcasts.get(runKey) });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "القروب الرسمي غير مضبوط" });
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup) return res.status(404).json({ error: "القروب الرسمي غير متاح" });
  const normalize = (value) => phoneWithCountry(String(value || "").replace(/@c\.us$/, "").split(":")[0]);
  const memberEntries = (chat.participants || []).map((participant) => ({
    phone: normalize(groupParticipantPhone(participant)),
    recipientId: participant && participant.id && (participant.id._serialized || String(participant.id)) || null,
  })).filter((entry) => entry.phone && !isBotPhone(entry.phone));
  const memberPhones = [...new Set(memberEntries.map((entry) => entry.phone))];
  const captains = db.prepare("SELECT id,phone,name,wallet_cents,active,account_status,is_bot FROM users WHERE role='captain' AND account_status<>'merged' AND is_bot=0").all();
  const byPhone = new Map(captains.map((captain) => [normalize(captain.phone), captain]));
  const members = memberEntries.map((entry) => {
    const captain = byPhone.get(entry.phone);
    return captain ? { phone: captain.phone, name: captain.name, balanceCents: Number(captain.wallet_cents || 0), recipientId: entry.recipientId } : null;
  }).filter(Boolean);
  if (members.length !== expectedCount) return res.status(409).json({ error: "تغير عدد الأعضاء أو الحسابات منذ المعاينة؛ أعد المعاينة", expectedCount, matchedCount: members.length, memberCount: memberPhones.length });
  const run = { runKey, status: "running", total: members.length, processed: 0, sent: 0, failed: 0, skipped: 0, startedAt: now(), completedAt: null, cancelled: false };
  balanceNotificationBroadcasts.set(runKey, run);
  void runBalanceNotificationBroadcast({ runKey, members }).catch(() => { run.status = "failed"; run.completedAt = now(); });
  res.status(202).json({ success: true, started: true, ...run });
});
app.get("/api/admin/group/balance-notifications/:runKey", requireAdmin, (req, res) => {
  const runKey = String(req.params.runKey || "").trim();
  const run = balanceNotificationBroadcasts.get(runKey);
  if (!run) return res.status(404).json({ error: "عملية البث غير موجودة في الذاكرة الحالية" });
  res.json({ success: true, ...run, cancelled: undefined });
});
app.post("/api/admin/captains/announce-completion", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const version = String(req.body?.version || "");
  const runKey = String(req.body?.runKey || "").trim();
  const expectedCount = Number(req.body?.expectedCount);
  if (confirmation !== CAPTAIN_COMPLETION_ANNOUNCEMENT_CONFIRMATION || version !== CAPTAIN_COMPLETION_ANNOUNCEMENT_VERSION || !/^[A-Z0-9-]{16,100}$/.test(runKey) || !Number.isInteger(expectedCount)) {
    return res.status(400).json({ error: "تأكيد الإعلان والإصدار ومفتاح العملية والعدد المتوقع مطلوبة" });
  }
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  if (captainAnnouncementBroadcasts.has(runKey)) return res.json({ success: true, started: true, runKey, ...captainAnnouncementBroadcasts.get(runKey) });
  const captains = db.prepare("SELECT id,phone,name FROM users WHERE role='captain' AND is_bot=0 AND active=1 AND account_status='active' AND phone IS NOT NULL AND phone<>'' ORDER BY id DESC").all();
  if (captains.length !== expectedCount) return res.status(409).json({ error: "تغير عدد الكباتن النشطين منذ المعاينة؛ أعد المعاينة", expectedCount, currentCount: captains.length });
  const run = { runKey, version, status: "running", total: captains.length, processed: 0, sent: 0, failed: 0, uncertain: 0, skipped: 0, startedAt: now(), completedAt: null, lastError: null };
  captainAnnouncementBroadcasts.set(runKey, run);
  audit("captain.company_completion_announcement_started", "system", runKey, { version, recipientCount: captains.length });
  void runCaptainCompletionAnnouncement({ runKey, captains });
  res.status(202).json({ success: true, started: true, ...run });
});
app.get("/api/admin/captains/announce-completion/:runKey", requireAdmin, (req, res) => {
  const runKey = String(req.params.runKey || "").trim();
  const run = captainAnnouncementBroadcasts.get(runKey);
  if (!run) return res.status(404).json({ error: "عملية إعلان الكباتن غير موجودة في الذاكرة الحالية" });
  res.json({ success: true, ...run });
});
app.get("/api/admin/captains/cleanup-preview", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).type("text/plain").send(Buffer.from(JSON.stringify({ error: "Bot not ready" }), "utf8").toString("base64"));
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).type("text/plain").send(Buffer.from(JSON.stringify({ error: "No configured production group" }), "utf8").toString("base64"));
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup) return res.status(404).type("text/plain").send(Buffer.from(JSON.stringify({ error: "Configured chat is not a group" }), "utf8").toString("base64"));
  const normalize = (value) => phoneWithCountry(String(value || "").replace(/@c\.us$/, "").split(":")[0]);
  const memberPhones = new Set((chat.participants || []).map(groupParticipantPhone).map(normalize).filter(Boolean));
  const memberCount = memberPhones.size;
  const captains = db.prepare("SELECT id,phone,name,registration_name,wallet_cents,active,account_status,is_bot FROM users WHERE role='captain' AND account_status<>'merged' AND is_bot=0 ORDER BY id").all();
  const orderRefs = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE producer_user_id=? OR captain_user_id=? OR pending_captain_user_id=?");
  const candidateRefs = db.prepare("SELECT COUNT(*) AS count FROM order_candidates WHERE producer_user_id=? OR pending_captain_user_id=?");
  const acceptanceRefs = db.prepare("SELECT COUNT(*) AS count FROM order_candidate_acceptances WHERE captain_user_id=?");
  const auditRefs = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE actor_user_id=?");
  const ledgerRefs = db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=?");
  const settlementRefs = db.prepare("SELECT COUNT(*) AS count FROM order_settlements WHERE captain_user_id=? OR producer_user_id=?");
  const cardRefs = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE redeemed_by=? OR assigned_captain_id=?");
  const subscriptionRefs = db.prepare("SELECT COUNT(*) AS count FROM captain_subscription_charges WHERE user_id=?");
  const candidates = captains.map((user) => {
    const phone = normalize(user.phone);
    const refs = {
      orders: Number(orderRefs.get(user.id, user.id, user.id).count || 0),
      candidates: Number(candidateRefs.get(user.id, user.id).count || 0),
      acceptances: Number(acceptanceRefs.get(user.id).count || 0),
      audit: Number(auditRefs.get(user.id).count || 0),
      ledger: Number(ledgerRefs.get(user.id).count || 0),
      settlements: Number(settlementRefs.get(user.id, user.id).count || 0),
      cards: Number(cardRefs.get(user.id, user.id).count || 0),
      subscriptions: Number(subscriptionRefs.get(user.id).count || 0),
      balance: money(user.wallet_cents),
    };
    const inGroup = memberPhones.has(phone);
    const protectedIdentity = isProtectedOwnerIdentity(phone);
    const deletable = !inGroup && !protectedIdentity && refs.orders === 0 && refs.candidates === 0 && refs.acceptances === 0 && refs.audit === 0 && refs.ledger === 0 && refs.settlements === 0 && refs.cards === 0 && refs.subscriptions === 0 && Number(user.wallet_cents || 0) === 0;
    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      registrationName: user.registration_name || user.name,
      active: Boolean(user.active),
      accountStatus: user.account_status,
      inConfiguredGroup: inGroup,
      protectedIdentity,
      refs,
      safeDisposition: inGroup ? "keep" : (protectedIdentity ? "protected_keep" : (deletable ? "delete_empty_account" : "suspend_preserve_history")),
    };
  });
  const keep = candidates.filter((candidate) => candidate.inConfiguredGroup);
  const remove = candidates.filter((candidate) => !candidate.inConfiguredGroup);
  const payload = {
    mutation: "none",
    generatedAt: now(),
    groupId,
    groupName: chat.name || null,
    memberCount,
    registeredCaptainCount: candidates.length,
    keepCount: keep.length,
    removeCount: remove.length,
    deletableEmptyCount: remove.filter((candidate) => candidate.safeDisposition === "delete_empty_account").length,
    preserveHistoryCount: remove.filter((candidate) => candidate.safeDisposition === "suspend_preserve_history").length,
    keep,
    remove,
  };
  res.set("Cache-Control", "no-store");
  res.type("text/plain").send(Buffer.from(JSON.stringify(payload), "utf8").toString("base64"));
});
app.post("/api/admin/captains/cleanup-execute", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const expectedConfirmation = "DELETE_EMPTY_OUTSIDE_GROUP_AND_SUSPEND_LINKED";
  if (confirmation !== expectedConfirmation) return res.status(400).json({ error: "Explicit cleanup confirmation is required" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "No configured production group" });
  const expected = {
    keepCount: Number(req.body?.expectedKeepCount),
    removeCount: Number(req.body?.expectedRemoveCount),
    deletableEmptyCount: Number(req.body?.expectedDeletableEmptyCount),
    preserveHistoryCount: Number(req.body?.expectedPreserveHistoryCount),
  };
  if (![expected.keepCount, expected.removeCount, expected.deletableEmptyCount, expected.preserveHistoryCount].every(Number.isInteger)) return res.status(400).json({ error: "Expected preview counts are required" });
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup) return res.status(404).json({ error: "Configured chat is not a group" });
  const normalize = (value) => phoneWithCountry(String(value || "").replace(/@c\.us$/, "").split(":")[0]);
  const memberPhones = new Set((chat.participants || []).map(groupParticipantPhone).map(normalize).filter(Boolean));
  const captains = db.prepare("SELECT id,phone,name,registration_name,wallet_cents,active,account_status,is_bot FROM users WHERE role='captain' AND account_status<>'merged' AND is_bot=0 ORDER BY id").all();
  const orderRefs = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE producer_user_id=? OR captain_user_id=? OR pending_captain_user_id=?");
  const candidateRefs = db.prepare("SELECT COUNT(*) AS count FROM order_candidates WHERE producer_user_id=? OR pending_captain_user_id=?");
  const acceptanceRefs = db.prepare("SELECT COUNT(*) AS count FROM order_candidate_acceptances WHERE captain_user_id=?");
  const auditRefs = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE actor_user_id=?");
  const ledgerRefs = db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=?");
  const settlementRefs = db.prepare("SELECT COUNT(*) AS count FROM order_settlements WHERE captain_user_id=? OR producer_user_id=?");
  const cardRefs = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE redeemed_by=? OR assigned_captain_id=?");
  const subscriptionRefs = db.prepare("SELECT COUNT(*) AS count FROM captain_subscription_charges WHERE user_id=?");
  const candidates = captains.map((user) => {
    const phone = normalize(user.phone);
    const refs = {
      orders: Number(orderRefs.get(user.id, user.id, user.id).count || 0),
      candidates: Number(candidateRefs.get(user.id, user.id).count || 0),
      acceptances: Number(acceptanceRefs.get(user.id).count || 0),
      audit: Number(auditRefs.get(user.id).count || 0),
      ledger: Number(ledgerRefs.get(user.id).count || 0),
      settlements: Number(settlementRefs.get(user.id, user.id).count || 0),
      cards: Number(cardRefs.get(user.id, user.id).count || 0),
      subscriptions: Number(subscriptionRefs.get(user.id).count || 0),
      balance: Number(user.wallet_cents || 0),
    };
    const inGroup = memberPhones.has(phone);
    const protectedIdentity = isProtectedOwnerIdentity(phone);
    const deletable = !inGroup && !protectedIdentity && refs.orders === 0 && refs.candidates === 0 && refs.acceptances === 0 && refs.audit === 0 && refs.ledger === 0 && refs.settlements === 0 && refs.cards === 0 && refs.subscriptions === 0 && refs.balance === 0;
    return { user, phone, refs, inGroup, protectedIdentity, deletable };
  });
  const keep = candidates.filter((candidate) => candidate.inGroup);
  const remove = candidates.filter((candidate) => !candidate.inGroup && !candidate.protectedIdentity);
  const deletable = remove.filter((candidate) => candidate.deletable);
  const preserveHistory = remove.filter((candidate) => !candidate.deletable);
  const currentCounts = { keepCount: keep.length, removeCount: remove.length, deletableEmptyCount: deletable.length, preserveHistoryCount: preserveHistory.length };
  if (JSON.stringify(currentCounts) !== JSON.stringify(expected)) return res.status(409).json({ error: "Live group/account data changed since preview; generate a new preview", currentCounts, expected });
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupName = `pre-captain-cleanup-${Date.now()}.sqlite`;
  const backupPath = path.join(backupDir, backupName);
  await db.backup(backupPath);
  const stamp = now();
  const deleted = [];
  const suspended = [];
  db.transaction(() => {
    for (const candidate of deletable) {
      const id = candidate.user.id;
      db.prepare("DELETE FROM captain_phone_aliases WHERE captain_user_id=?").run(id);
      db.prepare("DELETE FROM captain_auth_challenges WHERE captain_user_id=?").run(id);
      db.prepare("DELETE FROM whatsapp_identities WHERE user_id=?").run(id);
      db.prepare("UPDATE captain_invites SET approved_user_id=NULL WHERE approved_user_id=?").run(id);
      const result = db.prepare("DELETE FROM users WHERE id=? AND role='captain' AND account_status<>'merged' AND is_bot=0").run(id);
      if (result.changes === 1) deleted.push({ id, phone: candidate.user.phone, name: candidate.user.registration_name || candidate.user.name });
    }
    for (const candidate of preserveHistory) {
      const id = candidate.user.id;
      const result = db.prepare("UPDATE users SET active=0,account_status='suspended',updated_at=? WHERE id=? AND role='captain' AND account_status<>'merged' AND is_bot=0").run(stamp, id);
      if (result.changes === 1) suspended.push({ id, phone: candidate.user.phone, name: candidate.user.registration_name || candidate.user.name });
    }
  })();
  audit("captains.cleanup.applied", "group", groupId, { backupName, memberCount: memberPhones.size, deletedCount: deleted.length, suspendedCount: suspended.length, expected });
  void notifyOperations({ event: "captains.cleanup.applied", title: "تأكيد تنظيف حسابات الكباتن", lines: [`القروب: ${chat.name || groupId}`, `تم حذف حسابات فارغة: ${deleted.length}`, `تم إيقاف حسابات مرتبطة مع حفظ السجل: ${suspended.length}`, `النسخة الاحتياطية: ${backupName}`], ownersOnly: true });
  res.json({ success: true, mutation: "applied", groupId, groupName: chat.name || null, backupName, memberCount: memberPhones.size, deletedCount: deleted.length, suspendedCount: suspended.length, deleted, suspended });
});
app.get("/api/admin/group/live-messages", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const requestedLimit = Number(req.query.limit || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  const includeOutgoing = String(req.query.includeOutgoing || "") === "1";
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found" });
  await readGroupSnapshot(groupId);
  const { chat, messages } = await fetchGroupHistory(groupId, limit, { includeOutgoing });
  if (!chat) return res.status(404).json({ error: "Configured chat is not readable through WhatsApp" });
  const rows = (Array.isArray(messages) ? messages : []).map((message) => {
    const body = String(message?.body || "").trim();
    return {
      id: serializedMessageId(message),
      timestamp: message?.timestamp || message?.__timestamp || null,
      from: message?.from || null,
      to: message?.to || null,
      fromMe: Boolean(message?.fromMe),
      author: message?.author || null,
      body,
      caption: message?.__caption || null,
      type: message?.type || null,
      hasMedia: Boolean(message?.hasMedia),
      hasQuotedMessage: Boolean(message?.hasQuotedMsg || message?.__quoted),
      quotedMessageId: serializedMessageId(message?.__quoted),
      hasReaction: Boolean(message?.hasReaction || message?.__hasReaction),
      reactions: (Array.isArray(message?.__reactions) ? message.__reactions : []).map((reaction) => ({ emoji: reaction.aggregateEmoji || reaction.reaction || null, hasReactionByMe: Boolean(reaction.hasReactionByMe), senderPhones: (Array.isArray(reaction.senders) ? reaction.senders : []).map((sender) => sender.__senderPhone || null).filter(Boolean) })),
      parsedOrder: parseOrder(body),
      captainAcceptance: isCaptainAcceptance(body),
    };
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, groupId, includeOutgoing, count: rows.length, messages: rows });
});
app.get("/api/admin/group/order-scan", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready", mutation: "none" });
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const hours = Math.max(1, Math.min(Number(req.query.hours || 12), 168));
  const batch = Math.max(1, Math.min(Number(req.query.batch || 25), 50));
  const before = Math.max(0, Number(req.query.cursor || 0));
  const includeOutgoing = String(req.query.includeOutgoing || "") === "1";
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found", mutation: "none" });
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const result = await fetchGroupOrderScanBatch(groupId, { before, cutoff, batch, includeOutgoing });
  if (!result.chat) return res.status(result.timedOut ? 504 : 502).json({ error: result.timedOut ? "Group scan timed out; retry with the returned batch size" : "Configured group is not readable", mutation: "none", retryable: true });
  const messages = (Array.isArray(result.messages) ? result.messages : []).map((message) => ({
    ...message,
    parsedOrder: parseOrder(message.body),
    captainAcceptance: isCaptainAcceptance(message.body),
  }));
  const orders = messages.filter((message) => message.parsedOrder?.isOrder).map((message) => ({
    sourceMessageId: message.id,
    timestamp: message.timestamp,
    from: message.from,
    body: message.body,
    parsedOrder: message.parsedOrder,
    evidence: "price_message_only",
    mutation: "none",
  }));
  const acceptances = messages.filter((message) => message.captainAcceptance).map((message) => ({
    acceptanceMessageId: message.id,
    timestamp: message.timestamp,
    from: message.from,
    body: message.body,
    evidence: "acceptance_message_only",
    mutation: "none",
  }));
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, groupId, hours, cutoff, batch, cursor: before || null, nextCursor: result.nextCursor, hasMore: Boolean(result.nextCursor), exhausted: Boolean(result.exhausted), scanned: messages.length, orders, acceptances, messages, mutation: "none", readOnly: true });
});
app.get("/api/admin/group/resolve-identity", requireAdmin, async (req, res) => {
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const requested = String(req.query.lid || req.query.id || "").trim();
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(404).json({ error: "Configured group not found", mutation: "none" });
  if (!/@lid$/i.test(requested)) return res.status(400).json({ error: "A WhatsApp LID ending with @lid is required", mutation: "none" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready", mutation: "none" });
  const phone = await resolveWhatsappUserPhone(requested);
  const captain = phone ? db.prepare("SELECT id,phone,name,active,account_status,role FROM users WHERE phone=? AND role='captain' AND account_status<>'merged' LIMIT 1").get(phone) : null;
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, groupId, lid: requested, phone: phone || null, captain: captain || null, resolved: Boolean(phone && captain), mutation: "none", readOnly: true });
});
app.get("/api/admin/group/audit-lid-mappings", requireAdmin, async (req, res) => {
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const result = await auditActiveCaptainLidMappings({ groupId, chunkSize: req.query.chunkSize });
  if (result.status === "group_not_configured") return res.status(409).json(result);
  if (result.status !== "completed") return res.status(503).json(result);
  audit("captains.lid_mappings.audited", "group", groupId, { totalActiveCaptains: result.totalActiveCaptains, resolvedCount: result.resolvedCount, unresolvedCount: result.unresolvedCount, conflictCount: result.conflictCount, financialMutation: false, method: "GET" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, ...result, mutation: "none", readOnly: true });
});
app.post("/api/admin/group/audit-lid-mappings", requireAdmin, async (req, res) => {
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const result = await auditActiveCaptainLidMappings({ groupId, chunkSize: req.body?.chunkSize });
  if (result.status === "group_not_configured") return res.status(409).json(result);
  if (result.status !== "completed") return res.status(503).json(result);
  audit("captains.lid_mappings.audited", "group", groupId, { totalActiveCaptains: result.totalActiveCaptains, resolvedCount: result.resolvedCount, unresolvedCount: result.unresolvedCount, conflictCount: result.conflictCount, financialMutation: false });
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, ...result });
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
    .filter((message) => message && !message.fromMe && String(message?.from?._serialized || message.from || "") === groupId && parseOrder(message.body).isOrder)
    .sort((a, b) => Number(a.timestamp || a.__timestamp || 0) - Number(b.timestamp || b.__timestamp || 0));
  const imported = [];
  const skipped = [];
  for (const message of candidates) {
    const messageId = serializedMessageId(message);
    if (!messageId) { skipped.push({ reason: "missing_message_id" }); continue; }
    const existing = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(messageId);
    if (existing) { skipped.push({ messageId, reason: "already_registered", orderNo: existing.order_no }); continue; }
    const parsed = parseOrder(message.body);
    const senderPhone = await resolveMessageSenderPhone(message);
    const producer = senderPhone ? findActiveRegisteredUser(senderPhone) : null;
    const order = producer ? createOrderRecord({ messageId, groupId, body: String(message.body || ""), producer, parsed }) : null;
    if (order) {
      imported.push({ messageId, orderNo: order.order_no, status: order.status, historical: true, needsCaptainLink: true });
      audit("order.imported_from_group_history", "order", order.id, { groupId, sourceMessageId: messageId, historical: true, needsCaptainLink: true });
    } else skipped.push({ messageId, reason: "not_created" });
  }
  res.status(201).json({ success: true, groupId, scanned: messages.length, candidates: candidates.length, imported, skipped });
});
app.post("/api/admin/group/confirmed-preview", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const hours = Math.max(1, Math.min(Number(req.body?.hours || 168), 168));
  const requestedLimit = Number(req.body?.limit || 1000);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 2000)) : 1000;
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "No configured production group" });
  let chat;
  let messages;
  let historySource = "whatsapp_history";
  const expected = {
    sourceMessageId: String(req.body?.sourceMessageId || "").trim(),
    acceptanceMessageId: String(req.body?.acceptanceMessageId || "").trim(),
    downloaderPhone: String(req.body?.downloaderPhone || "").trim(),
    executorPhone: String(req.body?.executorPhone || "").trim(),
    price: req.body?.price === undefined || req.body?.price === "" ? "" : Number(req.body.price),
    origin: String(req.body?.origin || "").trim(),
    destination: String(req.body?.destination || "").trim(),
    tripTime: String(req.body?.tripTime || "").trim(),
  };
  const exactEvidenceRequested = Boolean(expected.sourceMessageId && expected.acceptanceMessageId);
  const exactMessages = exactEvidenceRequested
    ? await fetchExactGroupEvidenceMessages(groupId, expected.sourceMessageId, expected.acceptanceMessageId)
    : [];
  if (exactEvidenceRequested) {
    chat = exactMessages.length ? { id: groupId, isGroup: true } : null;
    messages = exactMessages;
  } else {
    const history = await fetchGroupHistory(groupId, limit, { includeOutgoing: true });
    if (history.chat && Array.isArray(history.messages) && history.messages.length) {
      chat = history.chat;
      messages = history.messages;
    } else {
      const stored = buildStoredRecoveryMessages(groupId, hours, limit);
      chat = history.chat || stored.chat;
      messages = stored.messages;
      historySource = "database_candidates";
    }
  }
  if (!chat) return res.status(504).json({ error: "Unable to read configured group" });
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const acceptanceMessages = (Array.isArray(messages) ? messages : []).filter((message) => {
    const timestamp = Number(message?.timestamp || message?.__timestamp || 0) * 1000;
    return message && !message.fromMe && resolveGroupChatId(message) === groupId && isCaptainAcceptance(message.body) && timestamp >= cutoff;
  });
  const matches = [];
  for (let offset = 0; offset < acceptanceMessages.length; offset += 4) {
    const batch = acceptanceMessages.slice(offset, offset + 4);
    const evidenceRows = await Promise.all(batch.map((acceptance) => inspectConfirmedRecoveryMessage(acceptance, messages, groupId)));
    for (const evidence of evidenceRows) {
      if (recoveryExpectedMatches(evidence, expected)) matches.push(recoveryEvidenceSummary(evidence));
    }
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, groupId, hours, scanned: messages.length, acceptanceMessages: acceptanceMessages.length, matches, filters: expected, source: historySource, mutation: "none" });
});
async function deleteWhatsAppMessageForEveryone(messageId) {
  if (!client?.pupPage || !messageId) return { ok: false, reason: "page_unavailable_or_missing_id" };
  return withTimeout(client.pupPage.evaluate(async (targetId) => {
    const id = String(targetId || "").trim();
    if (!id) return { ok: false, reason: "missing_id" };
    try {
      const collections = window.require("WAWebCollections");
      const message = collections.Msg.get(id) || (await collections.Msg.getMessagesById([id]))?.messages?.[0];
      if (!message) return { ok: false, reason: "message_not_found" };
      const chat = collections.Chat.get(message.id.remote) || (await collections.Chat.find(message.id.remote));
      if (!chat) return { ok: false, reason: "chat_not_found" };
      const capability = window.require("WAWebMsgActionCapability");
      const canSenderRevoke = Boolean(capability?.canSenderRevokeMsg?.(message));
      const canAdminRevoke = Boolean(capability?.canAdminRevokeMsg?.(message));
      if (!canSenderRevoke && !canAdminRevoke) return { ok: false, reason: "revoke_not_permitted", canSenderRevoke, canAdminRevoke };
      const { Cmd } = window.require("WAWebCmd");
      const modern = window.WWebJS.compareWwebVersions(window.Debug.VERSION, ">=", "2.3000.0");
      if (modern) await Cmd.sendRevokeMsgs(chat, { list: [message], type: "message" }, { clearMedia: true });
      else await Cmd.sendRevokeMsgs(chat, [message], { clearMedia: true, type: message.id.fromMe ? "Sender" : "Admin" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const current = collections.Msg.get(id) || message;
      const revoked = Boolean(current.isRevoked || current.revoked || current.type === "revoked");
      return { ok: revoked, requested: true, canSenderRevoke, canAdminRevoke, revoked, currentType: current.type || null, currentBody: String(current.body || current.text || "").trim() };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error).slice(0, 240), stack: String(error?.stack || "").slice(0, 800) };
    }
  }, String(messageId)), 30000, { ok: false, reason: "page_evaluation_timeout" });
}
app.all("/api/admin/group/delete-duplicate-confirmations", requireAdmin, async (req, res) => {
  if (req.method === "GET" && String(req.query?.confirm || "") !== "KEEP_LATEST_DELETE_OTHERS") {
    return res.status(400).json({ error: "Explicit cleanup confirmation is required", mutation: "none" });
  }
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready", mutation: "none" });
  const groupId = String(req.body?.groupId || req.query?.groupId || getSetting("group_id", "")).trim();
  const orderNo = Number(req.body?.orderNo || req.query?.orderNo || 0);
  const keepMessageId = String(req.body?.keepMessageId || req.query?.keepMessageId || "").trim();
  const limit = Math.max(20, Math.min(Number(req.body?.limit || req.query?.limit || 200), 500));
  if (!groupId || !isConfiguredGroup(groupId) || !Number.isInteger(orderNo) || orderNo < 1) {
    return res.status(400).json({ error: "configured groupId and positive integer orderNo are required", mutation: "none" });
  }
  const history = await fetchGroupHistory(groupId, limit, { includeOutgoing: true });
  if (!history.chat) return res.status(504).json({ error: "Unable to read configured group", mutation: "none" });
  const matches = history.messages
    .filter((message) => {
      const body = String(message?.body || "").trim();
      const messageOrderNo = finalBookingConfirmationOrderNo(body);
      return message?.fromMe === true && resolveGroupChatId(message) === groupId && messageOrderNo === orderNo;
    })
    .sort((a, b) => Number(a.timestamp || a.__timestamp || 0) - Number(b.timestamp || b.__timestamp || 0));
  if (!matches.length) return res.status(404).json({ error: "No deletable confirmation messages found", groupId, orderNo, mutation: "none" });
  if (String(req.query?.preview || "") === "1") {
    return res.json({ success: true, mutation: "none", groupId, orderNo, matched: matches.length, messages: matches.map((message) => ({ id: serializedMessageId(message), timestamp: message.timestamp || message.__timestamp || null })) });
  }
  const requestedKeep = keepMessageId ? matches.find((message) => serializedMessageId(message) === keepMessageId) : null;
  const keep = requestedKeep || matches[matches.length - 1];
  const deleted = [];
  const failed = [];
  for (const message of matches) {
    const messageId = serializedMessageId(message);
    if (!messageId || messageId === serializedMessageId(keep)) continue;
    try {
      const deletion = await deleteWhatsAppMessageForEveryone(messageId);
      if (deletion.ok) deleted.push(messageId);
      else failed.push({ messageId, reason: deletion.reason || "delete_not_confirmed", diagnostics: deletion });
    } catch (error) {
      failed.push({ messageId, reason: String(error?.message || error).slice(0, 160) });
    }
  }
  const keptMessageId = serializedMessageId(keep);
  const order = db.prepare("SELECT id FROM orders WHERE group_id=? AND order_no=? ORDER BY id DESC LIMIT 1").get(groupId, orderNo);
  if (order && keptMessageId) {
    db.prepare("UPDATE order_confirmation_deliveries SET status='sent',message_id=?,sent_at=COALESCE(sent_at,?),updated_at=?,last_error=NULL WHERE order_id=?").run(keptMessageId, now(), now(), order.id);
  }
  audit("order.confirmation_duplicates_deleted", "order", order?.id || null, { groupId, orderNo, matched: matches.length, deleted, failed, keptMessageId });
  res.json({ success: failed.length === 0, mutation: "messages_deleted", groupId, orderNo, matched: matches.length, keptMessageId, deleted, failed });
});
app.post("/api/admin/group/delete-duplicate-text", requireBotWalletOwner, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready", mutation: "none" });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const expectedBody = String(req.body?.expectedBody || "").trim();
  const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const keepMessageId = String(req.body?.keepMessageId || "").trim();
  if (!groupId || !isConfiguredGroup(groupId) || !expectedBody || !messageIds.length || messageIds.length > 50 || !keepMessageId || messageIds.includes(keepMessageId)) {
    return res.status(400).json({ error: "configured groupId, expectedBody, messageIds, and a distinct keepMessageId are required", mutation: "none" });
  }
  const history = await fetchGroupHistory(groupId, Math.max(50, Math.min(Number(req.body?.limit || 200), 500)), { includeOutgoing: true });
  if (!history.chat) return res.status(504).json({ error: "Unable to read configured group", mutation: "none" });
  const requested = new Set(messageIds);
  const isMatchingOutgoingText = (message) => message?.fromMe === true && resolveGroupChatId(message) === groupId && String(message?.body || "").trim() === expectedBody;
  const matches = history.messages.filter((message) => requested.has(serializedMessageId(message)) && isMatchingOutgoingText(message));
  const matchedIds = new Set(matches.map((message) => serializedMessageId(message)));
  const keep = history.messages.find((message) => serializedMessageId(message) === keepMessageId && isMatchingOutgoingText(message));
  const missing = messageIds.filter((messageId) => !matchedIds.has(messageId));
  if (missing.length || !keep) return res.status(409).json({ error: "Requested messages changed or failed validation; no messages were deleted", mutation: "none", groupId, expectedBody, missing, keepMessageId, keepValidated: Boolean(keep) });
  const deleted = [];
  const failed = [];
  for (const message of matches) {
    const messageId = serializedMessageId(message);
    try {
      const deletion = await deleteWhatsAppMessageForEveryone(messageId);
      if (deletion.ok) deleted.push(messageId);
      else failed.push({ messageId, reason: deletion.reason || "delete_not_confirmed", diagnostics: deletion });
    } catch (error) {
      failed.push({ messageId, reason: String(error?.message || error).slice(0, 160) });
    }
  }
  audit("group.duplicate_text_messages_deleted", "group", groupId, { expectedBody, requested: messageIds, keepMessageId, deleted, failed });
  res.json({ success: failed.length === 0, mutation: "messages_deleted", groupId, expectedBody, keptMessageId: keepMessageId, requested: messageIds.length, deleted, failed });
});
app.post("/api/admin/group/confirm-one", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  let sourceMessageId = String(req.body?.sourceMessageId || "").trim();
  let acceptanceMessageId = String(req.body?.acceptanceMessageId || "").trim();
  const downloaderPhone = String(req.body?.downloaderPhone || "").trim();
  const executorPhone = String(req.body?.executorPhone || "").trim();
  const autoMatchRequested = !sourceMessageId && !acceptanceMessageId;
  const suppliedPrice = req.body?.price === undefined || req.body?.price === "" ? "" : Number(req.body.price);
  if (!groupId || !isConfiguredGroup(groupId) || !downloaderPhone || !executorPhone || (autoMatchRequested && (!Number.isFinite(suppliedPrice) || suppliedPrice <= 0))) {
    return res.status(400).json({ error: autoMatchRequested ? "groupId, downloaderPhone, executorPhone, and a positive price are required; message IDs are resolved automatically" : "groupId, downloaderPhone, executorPhone, and both internal evidence IDs are required when exact evidence is supplied" });
  }
  let messages;
  let evidence;
  if (autoMatchRequested) {
    const automatic = await findAutomaticRecoveryEvidence({
      groupId,
      hours: req.body?.hours,
      limit: req.body?.limit,
      downloaderPhone,
      executorPhone,
      price: suppliedPrice,
      origin: req.body?.origin,
      destination: req.body?.destination,
    });
    if (automatic.state === "unavailable") return res.status(504).json({ error: "Unable to read the configured group", mutation: "none" });
    if (automatic.state === "ambiguous") return res.status(409).json({ error: "More than one confirmed booking matches these phone numbers and price; narrow the time or route", matches: automatic.matches.map(recoveryEvidenceSummary), mutation: "none" });
    if (automatic.state !== "matched") return res.status(409).json({ error: "No single confirmed booking matched the two phone numbers and price", matches: automatic.matches.map(recoveryEvidenceSummary), mutation: "none" });
    evidence = automatic.confirmed[0];
    sourceMessageId = evidence.orderMessageId;
    acceptanceMessageId = evidence.acceptanceMessageId;
    messages = automatic.messages;
  } else {
    if (!sourceMessageId || !acceptanceMessageId) return res.status(400).json({ error: "Provide both internal evidence IDs or omit both so the system resolves them automatically" });
    messages = buildStoredRecoveryMessagesByIds(groupId, sourceMessageId, acceptanceMessageId);
    if (messages.length < 2) messages = await fetchExactGroupEvidenceMessages(groupId, sourceMessageId, acceptanceMessageId);
    if (!messages.length) return res.status(504).json({ error: "Unable to read the supplied group messages", mutation: "none" });
    const acceptance = (Array.isArray(messages) ? messages : []).find((message) => serializedMessageId(message) === acceptanceMessageId) || { id: { _serialized: acceptanceMessageId }, from: groupId, body: "تم", fromMe: false };
    evidence = await inspectConfirmedRecoveryMessage(acceptance, messages, groupId);
  }
  const expected = {
    sourceMessageId,
    acceptanceMessageId,
    downloaderPhone,
    executorPhone,
    price: suppliedPrice,
    origin: String(req.body?.origin || "").trim(),
    destination: String(req.body?.destination || "").trim(),
    tripTime: String(req.body?.tripTime || "").trim(),
  };
  if (!evidence?.match || !recoveryExpectedMatches(evidence, expected)) {
    return res.status(409).json({ error: "Group evidence does not match the requested booking", evidence: recoveryEvidenceSummary(evidence), mutation: "none" });
  }
  if (evidence.existingSettlement?.status === "applied") {
    return res.json({ success: true, state: "already_settled", evidence: recoveryEvidenceSummary(evidence), confirmationText: null, mutation: "none" });
  }
  let order = evidence.existingOrder;
  if (!order) order = createOrderRecord({ messageId: sourceMessageId, groupId, body: evidence.rawText, producer: evidence.producer, parsed: evidence.parsed });
  if (!order) return res.status(409).json({ error: "Unable to create the matched order record", mutation: "none" });
  const confirmedByPhone = recoveryPhoneMatches(evidence.producerPhone, connectedBotPhone()) ? connectedBotPhone() : evidence.producerPhone;
  const result = settleHistoricalConfirmedOrder({ orderId: order.id, captainId: evidence.captain.id, acceptedMessageId: acceptanceMessageId, acceptedAt: evidence.acceptedAt, confirmedByPhone, importSource: "admin_exact_group_recovery" });
  if (result.state === "accepted") {
    const confirmationDetails = { orderId: result.order?.id, orderNo: result.order?.order_no, executorName: result.captain?.name, downloaderName: result.producer?.name, priceCents: result.order?.price_cents };
    void sendFinalBookingConfirmation(groupId, confirmationDetails).catch(() => null);
    audit("order.exact_group_recovery.completed", "order", order.id, { sourceMessageId, acceptanceMessageId, downloaderPhone: evidence.producerPhone, executorPhone: evidence.captainPhone, confirmationText: finalBookingConfirmationText(confirmationDetails) });
    return res.status(201).json({ success: true, state: result.state, order: result.order, chargedWallet: result.chargedWallet, evidence: recoveryEvidenceSummary(evidence), confirmationText: finalBookingConfirmationText(confirmationDetails), mutation: "applied_once" });
  }
  res.status(result.state === "debt_limit" ? 409 : 422).json({ success: false, state: result.state, evidence: recoveryEvidenceSummary(evidence), mutation: "none" });
});
app.post("/api/admin/group/confirm-verified-bot-booking", requireAdmin, async (req, res) => {
  const verified = {
    groupId: "120363426604560611@g.us",
    sourceMessageId: "true_120363426604560611@g.us_2A122A1AF1FEF641E079_27153336946853@lid",
    acceptanceMessageId: "false_120363426604560611@g.us_AC4CCC435CEB830CA5404E899A626840_60206985818354@lid",
    downloaderPhone: "962779110123",
    executorPhone: "962786856851",
    price: 10,
    origin: "اربد",
    destination: "المنارة",
    rawText: "السعر 10 دنانير\n\nبنت من اربد إلى المنارة",
  };
  const supplied = {
    groupId: String(req.body?.groupId || "").trim(),
    sourceMessageId: String(req.body?.sourceMessageId || "").trim(),
    acceptanceMessageId: String(req.body?.acceptanceMessageId || "").trim(),
    downloaderPhone: phoneWithCountry(String(req.body?.downloaderPhone || "")),
    executorPhone: phoneWithCountry(String(req.body?.executorPhone || "")),
    price: Number(req.body?.price),
    origin: normalizeRecoveryText(String(req.body?.origin || "")).trim(),
    destination: normalizeRecoveryText(String(req.body?.destination || "")).trim(),
  };
  const exact = supplied.groupId === verified.groupId && supplied.sourceMessageId === verified.sourceMessageId && supplied.acceptanceMessageId === verified.acceptanceMessageId && recoveryPhoneMatches(supplied.downloaderPhone, verified.downloaderPhone) && recoveryPhoneMatches(supplied.executorPhone, verified.executorPhone) && supplied.price === verified.price && supplied.origin === verified.origin && supplied.destination === verified.destination;
  if (!exact) return res.status(409).json({ error: "Verified booking fields do not match the recorded evidence", mutation: "none" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready", mutation: "none" });
  if (app.locals.verifiedBotBookingRecoveryInProgress) return res.status(202).json({ success: true, state: "processing", mutation: "queued" });
  app.locals.verifiedBotBookingRecoveryInProgress = true;
  res.status(202).json({ success: true, state: "processing", mutation: "queued" });
  setTimeout(() => { void (async () => {
    try {
      const existingOrder = db.prepare("SELECT * FROM orders WHERE source_message_id=? LIMIT 1").get(verified.sourceMessageId);
      const existingSettlement = existingOrder ? db.prepare("SELECT id,status FROM order_settlements WHERE order_id=? LIMIT 1").get(existingOrder.id) : null;
      if (existingSettlement?.status === "applied") return;
      const producer = companyUser();
      const captain = findCaptainByPhone(verified.executorPhone, { activeOnly: true });
      const parsed = parseOrder(verified.rawText);
      if (!producer || !captain || !parsed?.isOrder) throw new Error("Verified company producer, active executor, or order data is unavailable");
      const order = existingOrder || createOrderRecord({ messageId: verified.sourceMessageId, groupId: verified.groupId, body: verified.rawText, producer, parsed });
      if (!order) throw new Error("Unable to create verified order record");
      const result = settleHistoricalConfirmedOrder({ orderId: order.id, captainId: captain.id, acceptedMessageId: verified.acceptanceMessageId, acceptedAt: now(), confirmedByPhone: verified.downloaderPhone, importSource: "admin_verified_bot_booking" });
      if (result.state !== "accepted") {
        audit("order.verified_bot_booking.blocked", "order", order.id, { state: result.state, sourceMessageId: verified.sourceMessageId, acceptanceMessageId: verified.acceptanceMessageId });
        return;
      }
      const confirmationDetails = { orderId: result.order?.id, orderNo: result.order?.order_no, executorName: result.captain?.name, downloaderName: result.producer?.name, priceCents: result.order?.price_cents };
      void sendFinalBookingConfirmation(verified.groupId, confirmationDetails).catch(() => null);
      audit("order.verified_bot_booking.completed", "order", order.id, { sourceMessageId: verified.sourceMessageId, acceptanceMessageId: verified.acceptanceMessageId, downloaderPhone: verified.downloaderPhone, executorPhone: verified.executorPhone, confirmationText: finalBookingConfirmationText(confirmationDetails) });
    } catch (error) {
      audit("order.verified_bot_booking.error", "order", null, { error: String(error?.message || error).slice(0, 200), sourceMessageId: verified.sourceMessageId, acceptanceMessageId: verified.acceptanceMessageId });
    } finally {
      app.locals.verifiedBotBookingRecoveryInProgress = false;
    }
  })(); }, 10000);
});
app.post(["/api/admin/group/send-verified-bot-booking-card", "/api/admin/group/send-verified-bot-booking-card-v2"], requireAdmin, (req, res) => {
  res.status(410).json({ error: "Image booking cards are disabled; use the short text confirmation", mutation: "none" });
});
app.post("/api/admin/group/import-confirmed-orders", requireAdmin, async (req, res) => {
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const hours = Math.max(1, Math.min(Number(req.body?.hours || 24), 168));
  const requestedLimit = Number(req.body?.limit || 1000);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 2000)) : 1000;
  if (!groupId || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "No configured production group" });
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupName = `pre-confirmed-orders-import-${Date.now()}.sqlite`;
  await db.backup(path.join(backupDir, backupName));
  if (client.interface && typeof client.interface.openChatWindow === "function") {
    await withTimeout(client.interface.openChatWindow(groupId), 15000, null);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const { chat, messages } = await fetchGroupHistory(groupId, limit, { includeOutgoing: true });
  if (!chat) return res.status(504).json({ error: "Unable to read configured group", backupName });
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const acceptanceMessages = (Array.isArray(messages) ? messages : []).filter((message) => {
    const timestamp = Number(message?.timestamp || message?.__timestamp || 0) * 1000;
    const fromGroup = String(message?.from?._serialized || message?.from || "");
    return message && !message.fromMe && fromGroup === groupId && isCaptainAcceptance(message.body) && timestamp >= cutoff;
  });
  const imported = [];
  const unlinked = [];
  const skipped = [];
  for (const acceptance of acceptanceMessages) {
    const acceptanceMessageId = serializedMessageId(acceptance);
    if (!acceptanceMessageId) { skipped.push({ reason: "acceptance_without_message_id" }); continue; }
    if (client.interface && typeof client.interface.openChatWindowAt === "function") {
      await withTimeout(client.interface.openChatWindowAt(acceptanceMessageId), 12000, null);
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    const visibleThumbReaction = await hasVisibleThumbReaction(acceptanceMessageId);
    const liveAcceptance = (client && typeof client.getMessageById === "function") ? await withTimeout(client.getMessageById(acceptanceMessageId), 12000, null) || acceptance : acceptance;
    const quoted = typeof liveAcceptance.getQuotedMessage === "function"
      ? await withTimeout(liveAcceptance.getQuotedMessage(), 12000, null) || acceptance.__quoted || null
      : acceptance.__quoted || null;
    const parsed = quoted ? parseOrder(quoted.body) : null;
    if (!quoted || !parsed?.isOrder) { skipped.push({ messageId: acceptanceMessageId, reason: "not_a_quoted_order" }); continue; }
    const reactions = typeof liveAcceptance.getReactions === "function" ? await withTimeout(liveAcceptance.getReactions(), 12000, acceptance.__reactions || []) : (acceptance.__reactions || []);
    const thumbs = (Array.isArray(reactions) ? reactions : []).filter((reaction) => reaction && (reaction.aggregateEmoji === "👍" || reaction.reaction === "👍"));
    const reactionPhones = [];
    let reactedByBot = thumbs.some((reaction) => reaction.hasReactionByMe === true);
    for (const reaction of thumbs) {
      for (const sender of Array.isArray(reaction.senders) ? reaction.senders : []) {
        const senderPhone = directJordanPhoneFromWhatsappValue(sender?.__senderPhone) || await resolveReactionSenderPhone({ senderId: sender?.senderId || sender?.id?._serialized || sender?.id || "" });
        if (isValidJordanPhone(senderPhone)) reactionPhones.push(senderPhone);
      }
    }
    if (!reactedByBot && reactionPhones.some((phone) => isBotReactionSender(phone, connectedBotPhone()))) reactedByBot = true;
    const orderMessageId = serializedMessageId(quoted);
    const quotedContact = !quoted.fromMe && typeof quoted.getContact === "function" ? await withTimeout(quoted.getContact(), 8000, null) : null;
    const producerPhone = quoted.fromMe ? connectedBotPhone() : await resolveMessageSenderPhone(quoted, quotedContact);
    const acceptanceTimestamp = Number(liveAcceptance.timestamp || acceptance.timestamp || acceptance.__timestamp || 0);
    const hasBotConfirmationCard = (Array.isArray(messages) ? messages : []).some((message) => {
      const timestamp = Number(message?.timestamp || message?.__timestamp || 0);
      const body = String(message?.__caption || message?.body || "");
      return Boolean(message?.fromMe) && timestamp >= acceptanceTimestamp && timestamp <= acceptanceTimestamp + 300 && /(تم تثبيت الطلب|تم توثيق الرحلة)/.test(body);
    });
    const persistedThumbEvidence = storedReactionEvidence(acceptanceMessageId, "👍");
    const reactionPresentOnAcceptance = Boolean(thumbs.length || visibleThumbReaction || persistedThumbEvidence.length);
    const confirmedByPhone = quoted.fromMe ? connectedBotPhone() : producerPhone;
    if (!reactionPresentOnAcceptance) { skipped.push({ messageId: acceptanceMessageId, reason: "missing_thumb_reaction", reactions: Array.isArray(reactions) ? reactions.length : 0, thumbs: thumbs.length, validReactionPhones: reactionPhones.length, reactedByBot, hasBotConfirmationCard, visibleThumbReaction }); continue; }
    const acceptanceContact = typeof liveAcceptance.getContact === "function" ? await withTimeout(liveAcceptance.getContact(), 8000, null) : null;
    const captainPhone = await resolveMessageSenderPhone(liveAcceptance, acceptanceContact) || await resolveMessageSenderPhone(acceptance);
    const captainName = String(acceptanceContact?.pushname || acceptanceContact?.name || liveAcceptance?._data?.notifyName || acceptance?._data?.notifyName || displayPhone(captainPhone)).trim().slice(0, 100);
    const captain = findCaptainByPhone(captainPhone, { activeOnly: true });
    const producer = quoted.fromMe && BOT_FINANCIAL_MODE === "company" ? companyUser() : (quoted.fromMe ? botEmployeeUser() : findActiveRegisteredUser(producerPhone));
    let order = db.prepare("SELECT * FROM orders WHERE source_message_id=? LIMIT 1").get(orderMessageId);
    if (!order) {
      if (producer) order = createOrderRecord({ messageId: orderMessageId, groupId, body: String(quoted.body || ""), producer, parsed });
      else {
        const stamp = new Date(Number(quoted.timestamp || 0) * 1000 || Date.now()).toISOString();
        const orderNo = Number(db.prepare("SELECT COALESCE(MAX(order_no),0)+1 AS next FROM orders").get().next);
        const created = db.prepare("INSERT INTO orders(order_no,source_message_id,group_id,raw_text,price_cents,origin,destination,trip_time,order_kind,producer_user_id,producer_phone_snapshot,producer_name_snapshot,status,settlement_state,import_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'unlinked','group_history_24h',?,?)").run(orderNo, orderMessageId, groupId, String(quoted.body || ""), cents(parsed.price), parsed.origin, parsed.destination, parsed.tripTime, parsed.orderKind, null, producerPhone || null, quoted?._data?.notifyName || null, "open", stamp, stamp);
        order = db.prepare("SELECT * FROM orders WHERE id=?").get(created.lastInsertRowid);
      }
    }
    if (!order || (order.status === "accepted" && order.settlement_state === "settled")) { skipped.push({ messageId: acceptanceMessageId, reason: "already_registered_and_settled", orderNo: order?.order_no }); continue; }
    if (order.archive_state === "archived") { skipped.push({ messageId: acceptanceMessageId, reason: "order_archived", orderNo: order.order_no }); continue; }
    const acceptedAt = new Date(Number(liveAcceptance.timestamp || acceptance.timestamp || acceptance.__timestamp || 0) * 1000 || Date.now()).toISOString();
    if (!captain || !producer) {
      db.prepare("UPDATE orders SET status='accepted',captain_user_id=?,captain_phone_snapshot=?,captain_name_snapshot=?,accepted_message_id=?,accepted_at=?,confirmed_by_phone=?,settlement_state='unlinked',import_source='group_history_24h',updated_at=? WHERE id=?").run(captain?.id || null, captainPhone || null, captain?.name || captainName || null, acceptanceMessageId, acceptedAt, confirmedByPhone, now(), order.id);
      unlinked.push({ orderNo: order.order_no, captainPhone: captainPhone || null, captainName: captainName || "غير مسجل", reason: !captain ? "captain_not_registered" : "producer_not_registered" });
      continue;
    }
    const result = settleHistoricalConfirmedOrder({ orderId: order.id, captainId: captain.id, acceptedMessageId: acceptanceMessageId, acceptedAt, confirmedByPhone });
    if (result.state === "accepted") imported.push({ orderNo: order.order_no, captainId: captain.id, captainPhone: captain.phone });
    else skipped.push({ orderNo: order.order_no, reason: result.state });
  }
  audit("orders.confirmed_history.imported", "group", groupId, { hours, scanned: messages.length, acceptanceMessages: acceptanceMessages.length, imported: imported.length, unlinked: unlinked.length, skipped: skipped.length, backupName });
  res.status(201).json({ success: true, groupId, hours, scanned: messages.length, confirmedCandidates: acceptanceMessages.length, imported, unlinked, skipped, backupName });
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
  const existingOrder = db.prepare("SELECT id,order_no,status FROM orders WHERE source_message_id=? LIMIT 1").get(candidate.id._serialized);
  if (existingOrder) return res.json({ success: true, recovered: false, alreadyRegistered: true, orderNo: existingOrder.order_no, status: existingOrder.status });
  const existingCandidate = db.prepare("SELECT id,status FROM order_candidates WHERE source_message_id=? LIMIT 1").get(candidate.id._serialized);
  if (existingCandidate) return res.json({ success: true, recovered: false, alreadyStaged: true, candidateId: existingCandidate.id, status: existingCandidate.status });
  await handleIncomingMessage(candidate, { allowSelf: true });
  const staged = db.prepare("SELECT id,status FROM order_candidates WHERE source_message_id=? LIMIT 1").get(candidate.id._serialized);
  if (!staged) return res.status(502).json({ error: "Eligible message was not staged as a private candidate" });
  audit("order.candidate.recovered_from_group_history", "order_candidate", staged.id, { groupId, sourceMessageId: candidate.id._serialized });
  res.status(201).json({ success: true, recovered: true, candidateId: staged.id, status: staged.status });
});
app.get("/api/admin/cards", requireAdmin, (req, res) => {
  const requestedLimit = Number(req.query.limit || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 50;
  const cards = db.prepare("SELECT c.id,c.code_last4,c.value_cents,c.status,c.assigned_captain_id,c.sent_at,c.redeemed_at,c.created_at,u.name AS captain_name,u.phone AS captain_phone FROM topup_cards c LEFT JOIN users u ON u.id=c.assigned_captain_id ORDER BY c.id DESC LIMIT ?").all(limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, cards: cards.map((card) => ({ ...card, value: money(card.value_cents), deliveryStatus: card.sent_at ? "sent" : "pending" })) });
});
app.get("/api/admin/bulk-topup/preview", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id,phone,name,registration_name,wallet_cents,active,account_status,is_bot FROM users WHERE role='captain' AND active=1 AND account_status='active' AND is_bot=0 AND wallet_cents<>0 ORDER BY id").all();
  const maskPhone = (phone) => {
    const value = phoneWithCountry(phone) || String(phone || "");
    return value.length > 6 ? `${value.slice(0, 5)}${"*".repeat(Math.max(3, value.length - 8))}${value.slice(-3)}` : "***";
  };
  const captains = rows.map((row) => {
    const balanceCents = Number(row.wallet_cents || 0);
    const cardValueCents = Math.abs(balanceCents);
    return {
      captainId: row.id,
      name: captainDisplayName(row.registration_name || row.name),
      phoneMasked: maskPhone(row.phone),
      currentBalance: money(balanceCents),
      cardValue: money(cardValueCents),
      direction: balanceCents < 0 ? "negative_coverage" : "positive_copy",
      active: true,
      eligible: true,
    };
  });
  const sum = (predicate) => captains.filter(predicate).reduce((total, row) => total + Math.round(Number(row.cardValue) * 100), 0);
  const summary = {
    success: true,
    readOnly: true,
    policy: "abs_current_balance",
    eligibleCount: captains.length,
    positiveCount: captains.filter((row) => row.direction === "positive_copy").length,
    negativeCount: captains.filter((row) => row.direction === "negative_coverage").length,
    totalValue: money(captains.reduce((total, row) => total + Math.round(Number(row.cardValue) * 100), 0)),
    positiveTotal: money(sum((row) => row.direction === "positive_copy")),
    negativeCoverageTotal: money(sum((row) => row.direction === "negative_coverage")),
  };
  if (String(req.query.compact || "") === "1") return res.json(summary);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ...summary, captains });
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
function topupCardTextMessage({ cardId, code, valueCents, captainName, appUrl }) {
  return brandedMessage("بطاقة شحن رسمية", [
    `الكابتن: ${captainName || "حسابك"}`,
    `القيمة: ${money(valueCents)} JOD`,
    "هذه البطاقة مخصصة لرقمك وتُستخدم مرة واحدة فقط.",
    `رمز البطاقة: ${code}`,
    `الدخول: ${appUrl}`,
    "افتح البوابة، اضغط زر التشغيل، اختر دخول الكابتن، ثم أدخل رمز البطاقة واضغط Enter لإضافة الرصيد مباشرة.",
    `رقم البطاقة الداخلي: #${cardId}`,
    "لا تشارك رمز البطاقة مع أي شخص.",
  ]);
}
async function handleStoredTopupCardDelivery(req, res, deliveryMode = "media") {
  const cardId = Number(req.params.id);
  const deliveryIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
  if (!Number.isInteger(cardId) || cardId < 1 || deliveryIdempotencyKey.length < 16 || deliveryIdempotencyKey.length > 100) return res.status(400).json({ error: "معرف البطاقة ومفتاح idempotency مطلوبان" });
  const card = db.prepare("SELECT c.*,u.phone AS captain_phone,u.name AS captain_name,u.active AS captain_active FROM topup_cards c LEFT JOIN users u ON u.id=c.assigned_captain_id WHERE c.id=? LIMIT 1").get(cardId);
  if (!card) return res.status(404).json({ error: "البطاقة غير موجودة" });
  if (card.sent_at) return res.json({ success: true, alreadySent: true, status: "sent" });
  if (card.delivery_idempotency_key && card.delivery_idempotency_key !== deliveryIdempotencyKey) return res.status(409).json({ error: "إرسال البطاقة مسجل بمفتاح مختلف" });
  if (!card.captain_phone || !card.captain_active) return res.status(409).json({ error: "المستفيد غير نشط أو غير معتمد" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا؛ البطاقة محفوظة ولم تُرسل" });
  if (!cardEncryptionKey || !card.code_ciphertext) return res.status(503).json({ error: "تشفير البطاقة غير مهيأ" });
  if (cardDeliveryInFlight.has(cardId)) return res.status(409).json({ error: "إرسال البطاقة قيد التنفيذ" });
  cardDeliveryInFlight.add(cardId);
  try {
    const code = decryptCardCode(card.code_ciphertext);
    const appUrl = captainAppUrl(captainInviteBaseUrl(req));
    const caption = brandedMessage("بطاقة شحن رسمية", [`الكابتن: ${card.captain_name || "حسابك"}`, `القيمة: ${money(card.value_cents)} JOD`, "هذه البطاقة مخصصة لرقمك وتُستخدم مرة واحدة فقط.", `الدخول: ${appUrl}`, "افتح البوابة، اضغط زر التشغيل، اختر دخول الكابتن، ثم أدخل رمز البطاقة واضغط Enter لإضافة الرصيد مباشرة."]);
    const recipient = await resolveWhatsAppRecipientId(card.captain_phone);
    if (!recipient) return res.status(409).json({ error: "تعذر حل حساب WhatsApp للكابتن؛ البطاقة محفوظة ولم تُرسل" });
    let sent = null;
    if (deliveryMode === "text") {
      const text = topupCardTextMessage({ cardId, code, valueCents: card.value_cents, captainName: card.captain_name, appUrl });
      sent = await withTimeout(client.sendMessage(recipient, text), 30000, null);
    } else {
      const media = await renderTopupCardMedia({ cardId, code, valueCents: card.value_cents, captainName: card.captain_name, appUrl });
      sent = await withTimeout(client.sendMessage(recipient, media, { caption }), 30000, null);
    }
    if (!sent) return res.status(504).json({ error: "انتهت مهلة إرسال البطاقة" });
    const update = db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), deliveryIdempotencyKey, cardId);
    if (!update.changes) return res.json({ success: true, alreadySent: true, status: "sent" });
    const event = deliveryMode === "text" ? "topup_card.sent_text_fallback" : "topup_card.sent";
    audit(event, "topup_card", cardId, { captainId: card.assigned_captain_id, messageId: sent.id?._serialized || null, deliveryIdempotencyKey, deliveryMode });
    void notifyOperations({ event, title: "تأكيد إرسال بطاقة شحن", lines: [`الكابتن: ${card.captain_name}`, `القيمة: ${money(card.value_cents)} JOD`, `رقم البطاقة الداخلي: #${cardId}`, deliveryMode === "text" ? "تم إرسال البطاقة نصيًا إلى الكابتن عبر المسار الاحتياطي." : "تم إرسال البطاقة المصوّرة إلى الكابتن.", "يُضاف الرصيد عند إدخال الرمز من بوابة التشغيل."], ownersOnly: true });
    res.json({ success: true, status: "sent", deliveryMode });
  } catch (_) { audit("topup_card.delivery_failed", "topup_card", cardId, { deliveryIdempotencyKey, deliveryMode }); res.status(502).json({ error: "تعذر إرسال بطاقة الرصيد عبر WhatsApp" }); }
  finally { cardDeliveryInFlight.delete(cardId); }
}
app.post("/api/admin/cards/:id/send", requireAdmin, async (req, res) => handleStoredTopupCardDelivery(req, res, "media"));
app.post("/api/admin/cards/:id/send-text", requireAdmin, async (req, res) => handleStoredTopupCardDelivery(req, res, "text"));
app.post("/api/admin/bulk-topup/zero-balance-5", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const runKey = String(req.body?.runKey || "").trim();
  const expectedCount = Number(req.body?.expectedCount);
  if (confirmation !== "ISSUE_ZERO_BALANCE_5_JOD_ACTIVE_GROUP_CAPTAINS" || !/^ZERO5-[A-Z0-9-]{12,80}$/.test(runKey) || expectedCount !== 49) return res.status(400).json({ error: "تأكيد العملية ومفتاحها والعدد المتوقع 49 مطلوبة" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  if (!cardEncryptionKey) return res.status(503).json({ error: "تشفير بطاقات الشحن غير مهيأ" });
  if (bulkTopupRuns.has(runKey)) return res.json({ success: true, started: true, ...bulkTopupRuns.get(runKey) });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "القروب الرسمي غير متاح" });
  const normalize = (value) => phoneWithCountry(String(value || "").replace(/@c\.us$/, "").split(":")[0]);
  const entries = (chat.participants || []).map((participant) => ({ phone: normalize(groupParticipantPhone(participant)), recipientId: participant?.id?._serialized || String(participant?.id || "") })).filter((entry) => entry.phone && !isBotPhone(entry.phone));
  const captains = db.prepare("SELECT id,phone,name,wallet_cents,active,account_status,is_bot FROM users WHERE role='captain' AND account_status='active' AND active=1 AND is_bot=0 AND wallet_cents=0").all();
  const memberPhones = new Set(entries.map((entry) => entry.phone));
  const recipients = captains.map((captain) => ({ ...captain, recipientId: entries.find((entry) => entry.phone === normalize(captain.phone))?.recipientId || null })).filter((captain) => memberPhones.has(normalize(captain.phone)));
  if (recipients.length !== expectedCount) return res.status(409).json({ error: "تغيرت قائمة القروب أو الأرصدة؛ أعد المعاينة", matchedCount: recipients.length, expectedCount });
  const appUrl = captainAppUrl(captainInviteBaseUrl(req));
  const run = { runKey, status: "running", total: recipients.length, issued: 0, reused: 0, sent: 0, failed: 0, startedAt: now(), completedAt: null };
  bulkTopupRuns.set(runKey, run);
  void (async () => {
    for (const captain of recipients) {
      const issueKey = `ZERO5-JOD-${captain.id}`;
      try {
        let card = db.prepare("SELECT * FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueKey);
        if (!card) {
          let code = randomCode();
          while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
          const created = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,500,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), captain.id, issueKey, encryptCardCode(code), now());
          card = db.prepare("SELECT * FROM topup_cards WHERE id=?").get(created.lastInsertRowid);
          run.issued += 1;
          audit("topup_card.issued", "topup_card", card.id, { valueCents: 500, captainId: captain.id, issueIdempotencyKey: issueKey, bulkRunKey: runKey });
        } else run.reused += 1;
        if (card.sent_at) { run.sent += 1; continue; }
        if (cardDeliveryInFlight.has(card.id)) { run.failed += 1; continue; }
        cardDeliveryInFlight.add(card.id);
        try {
          const code = decryptCardCode(card.code_ciphertext);
          const recipient = captain.recipientId && /@(c\.us|lid)$/.test(captain.recipientId) ? captain.recipientId : await resolveWhatsAppRecipientId(captain.phone);
          const text = topupCardTextMessage({ cardId: card.id, code, valueCents: 500, captainName: captain.name, appUrl });
          const sent = recipient ? await withTimeout(client.sendMessage(recipient, text), 30000, null) : null;
          if (!sent) throw new Error("delivery_failed");
          db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), `BULK-${runKey}-${captain.id}`, card.id);
          run.sent += 1;
          void notifyOperations({ event: "topup_card.sent_text_fallback", title: "تأكيد إرسال بطاقة شحن جماعية", lines: [`الكابتن: ${captain.name}`, "القيمة: 5.00 JOD", `رقم البطاقة الداخلي: #${card.id}`, "تم إرسال بطاقة الرصيد نصيًا.", "يُضاف الرصيد عند استرداد البطاقة."], ownersOnly: true });
        } finally { cardDeliveryInFlight.delete(card.id); }
      } catch (_) { run.failed += 1; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    run.status = "completed";
    run.completedAt = now();
  })().catch(() => { run.status = "failed"; run.completedAt = now(); });
  res.status(202).json({ success: true, started: true, ...run });
});
app.get("/api/admin/bulk-topup/zero-balance-5/:runKey", requireAdmin, (req, res) => {
  const run = bulkTopupRuns.get(String(req.params.runKey || ""));
  if (!run) return res.status(404).json({ error: "عملية البطاقات غير موجودة في الذاكرة الحالية" });
  res.json({ success: true, ...run });
});
app.post("/api/admin/bulk-topup/negative-one-3", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const runKey = String(req.body?.runKey || "").trim();
  if (confirmation !== "ISSUE_NEGATIVE_ONE_3_JOD_ACTIVE_GROUP_CAPTAINS" || !/^NEG3-[A-Z0-9-]{12,80}$/.test(runKey)) return res.status(400).json({ error: "تأكيد العملية ومفتاحها مطلوبان" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  if (!cardEncryptionKey) return res.status(503).json({ error: "تشفير بطاقات الشحن غير مهيأ" });
  if (bulkTopupRuns.has(runKey)) return res.json({ success: true, started: true, ...bulkTopupRuns.get(runKey) });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "القروب الرسمي غير متاح" });
  const normalize = (value) => phoneWithCountry(String(value || "").replace(/@c\.us$/, "").split(":")[0]);
  const entries = (chat.participants || []).map((participant) => ({ phone: normalize(groupParticipantPhone(participant)), recipientId: participant?.id?._serialized || String(participant?.id || "") })).filter((entry) => entry.phone && !isBotPhone(entry.phone));
  const captains = db.prepare("SELECT id,phone,name,wallet_cents,active,account_status,is_bot FROM users WHERE role='captain' AND account_status='active' AND active=1 AND is_bot=0 AND wallet_cents=-100").all();
  const byPhone = new Map(entries.map((entry) => [entry.phone, entry.recipientId]));
  const recipients = captains.map((captain) => ({ ...captain, recipientId: byPhone.get(normalize(captain.phone)) || null })).filter((captain) => captain.recipientId);
  if (recipients.length !== 19) return res.status(409).json({ error: "تغيرت قائمة القروب أو الأرصدة؛ أعد المعاينة", matchedCount: recipients.length, expectedCount: 19 });
  const appUrl = captainAppUrl(captainInviteBaseUrl(req));
  const run = { runKey, status: "running", total: recipients.length, issued: 0, reused: 0, sent: 0, failed: 0, startedAt: now(), completedAt: null };
  bulkTopupRuns.set(runKey, run);
  void (async () => {
    for (const captain of recipients) {
      const issueKey = `NEG3-JOD-${captain.id}`;
      try {
        let card = db.prepare("SELECT * FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueKey);
        if (!card) {
          let code = randomCode();
          while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
          const created = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,300,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), captain.id, issueKey, encryptCardCode(code), now());
          card = db.prepare("SELECT * FROM topup_cards WHERE id=?").get(created.lastInsertRowid);
          run.issued += 1;
          audit("topup_card.issued", "topup_card", card.id, { valueCents: 300, captainId: captain.id, issueIdempotencyKey: issueKey, bulkRunKey: runKey });
        } else run.reused += 1;
        if (card.sent_at) { run.sent += 1; continue; }
        if (cardDeliveryInFlight.has(card.id)) { run.failed += 1; continue; }
        cardDeliveryInFlight.add(card.id);
        try {
          const code = decryptCardCode(card.code_ciphertext);
          const text = topupCardTextMessage({ cardId: card.id, code, valueCents: 300, captainName: captain.name, appUrl });
          const sent = await withTimeout(client.sendMessage(captain.recipientId, text), 30000, null);
          if (!sent) throw new Error("delivery_failed");
          db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), `BULK-${runKey}-${captain.id}`, card.id);
          run.sent += 1;
          void notifyOperations({ event: "topup_card.sent_text_fallback", title: "تأكيد إرسال بطاقة شحن", lines: [`الكابتن: ${captain.name}`, "القيمة: 3.00 JOD", `رقم البطاقة الداخلي: #${card.id}`, "تم إرسال بطاقة الرصيد نصيًا.", "يُضاف الرصيد عند استرداد البطاقة."], ownersOnly: true });
        } finally { cardDeliveryInFlight.delete(card.id); }
      } catch (_) { run.failed += 1; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    run.status = "completed";
    run.completedAt = now();
  })().catch(() => { run.status = "failed"; run.completedAt = now(); });
  res.status(202).json({ success: true, started: true, ...run });
});
app.get("/api/admin/bulk-topup/negative-one-3/:runKey", requireAdmin, (req, res) => {
  const run = bulkTopupRuns.get(String(req.params.runKey || ""));
  if (!run) return res.status(404).json({ error: "عملية البطاقات غير موجودة في الذاكرة الحالية" });
  res.json({ success: true, ...run });
});
app.post("/api/admin/group/reset-active-captain-pins", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const runKey = String(req.body?.runKey || "").trim();
  if (confirmation !== "RESET_ACTIVE_GROUP_CAPTAIN_PINS_TO_00000" || !/^PIN5-[A-Z0-9-]{12,80}$/.test(runKey)) return res.status(400).json({ error: "تأكيد العملية ومفتاحها مطلوبان" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  if (bulkPinRuns.has(runKey)) return res.json({ success: true, started: true, ...bulkPinRuns.get(runKey) });
  const groupId = String(req.body?.groupId || getSetting("group_id", "")).trim();
  const chat = await readGroupSnapshot(groupId) || await resolveGroupChat(groupId);
  if (!chat || !chat.isGroup || !isConfiguredGroup(groupId)) return res.status(409).json({ error: "القروب الرسمي غير متاح" });
  const normalize = (value) => phoneWithCountry(String(value || "").replace(/@c\.us$/, "").split(":")[0]);
  const entries = (chat.participants || []).map((participant) => ({ phone: normalize(groupParticipantPhone(participant)), recipientId: participant?.id?._serialized || String(participant?.id || "") })).filter((entry) => entry.phone && !isBotPhone(entry.phone));
  const recipients = db.prepare("SELECT id,phone,name FROM users WHERE role='captain' AND account_status='active' AND active=1 AND is_bot=0").all().map((captain) => ({ ...captain, recipientId: entries.find((entry) => entry.phone === normalize(captain.phone))?.recipientId || null })).filter((captain) => captain.recipientId);
  if (recipients.length !== 173) return res.status(409).json({ error: "تغير عدد الكباتن المفعّلين أو أعضاء القروب؛ أعد المعاينة", matchedCount: recipients.length, expectedCount: 173 });
  const appUrl = captainLoginUrl(captainInviteBaseUrl(req));
  const run = { runKey, status: "running", total: recipients.length, updated: 0, sent: 0, failed: 0, skipped: 0, startedAt: now(), completedAt: null };
  bulkPinRuns.set(runKey, run);
  void (async () => {
    for (const captain of recipients) {
      try {
        const prior = db.prepare("SELECT id FROM audit_logs WHERE action='captain.pin_reset.bulk' AND entity_type='user' AND entity_id=? AND details LIKE ? LIMIT 1").get(String(captain.id), `%${runKey}%`);
        if (prior) { run.skipped += 1; run.sent += 1; continue; }
        db.prepare("UPDATE users SET captain_pin_hash=?,captain_pin_ciphertext=NULL,captain_auth_method='pin',updated_at=? WHERE id=? AND role='captain' AND active=1 AND account_status='active'").run(bcrypt.hashSync("00000", 10), now(), captain.id);
        run.updated += 1;
        const text = brandedMessage("تحديث دخول الكابتن", [
          `الكابتن: ${captain.name || "حسابك"}`,
          "تم تحديث بيانات الدخول الخاصة بك في وصلني الآن.",
          `رقم الهاتف: ${captain.phone}`,
          "الرقم السري: 00000",
          `رابط الدخول الفوري: ${appUrl}`,
          "يرجى تغيير الرقم السري بعد أول دخول وعدم مشاركته مع أي شخص.",
        ]);
        const sent = await withTimeout(client.sendMessage(captain.recipientId, text), 30000, null);
        if (!sent) throw new Error("delivery_failed");
        audit("captain.pin_reset.bulk", "user", captain.id, { bulkRunKey: runKey, messageId: sent.id?._serialized || null });
        run.sent += 1;
      } catch (_) { run.failed += 1; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    run.status = "completed";
    run.completedAt = now();
  })().catch(() => { run.status = "failed"; run.completedAt = now(); });
  res.status(202).json({ success: true, started: true, ...run });
});
app.get("/api/admin/group/reset-active-captain-pins/:runKey", requireAdmin, (req, res) => {
  const run = bulkPinRuns.get(String(req.params.runKey || ""));
  if (!run) return res.status(404).json({ error: "عملية PIN غير موجودة في الذاكرة الحالية" });
  res.json({ success: true, ...run });
});
const dailyDebitCancellationRuns = new Map();
app.post("/api/admin/notifications/daily-debit-cancellation", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const runKey = String(req.body?.runKey || "").trim();
  const dryRun = Boolean(req.body?.dryRun);
  if (confirmation !== "SEND_DAILY_DEBIT_CANCELLATION_NOTICE" || !/^DAILY-CANCEL-[A-Z0-9-]{12,80}$/.test(runKey)) return res.status(400).json({ error: "تأكيد العملية ومفتاحها مطلوبان" });
  if (dailyDebitCancellationRuns.has(runKey)) return res.json({ success: true, started: true, ...dailyDebitCancellationRuns.get(runKey) });
  const captains = db.prepare("SELECT id,phone,name,active,account_status,is_bot FROM users WHERE role='captain' AND is_bot=0 AND account_status<>'merged' ORDER BY id").all();
  const run = { runKey, status: dryRun ? "preview" : "running", dryRun, total: captains.length, sent: 0, failed: 0, skipped: 0, startedAt: now(), completedAt: dryRun ? now() : null };
  dailyDebitCancellationRuns.set(runKey, run);
  if (dryRun) return res.json({ success: true, started: false, ...run });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  void (async () => {
    for (const captain of captains) {
      try {
        const prior = db.prepare("SELECT id FROM audit_logs WHERE action='captain.daily_debit_cancellation_notice.sent' AND entity_type='user' AND entity_id=? LIMIT 1").get(String(captain.id));
        if (prior) { run.skipped += 1; continue; }
        const recipient = await resolveWhatsAppRecipientId(captain.phone);
        if (!recipient) throw new Error("recipient_unresolved");
        const text = brandedMessage("إشعار رسمي — إلغاء الخصم اليومي", [
          `الكابتن: ${captain.name || "حساب الكابتن"}`,
          "نحيطك علمًا بأنه تم إلغاء الخصم اليومي بقيمة 10 قروش من حسابك.",
          "لن يتم تنفيذ أي خصم يومي جديد ابتداءً من الآن.",
          "هذا الإشعار لا يغيّر الاشتراك الأسبوعي أو أي حركة مالية سابقة.",
          "وصلني الآن — الإدارة",
        ]);
        const sent = await withTimeout(client.sendMessage(recipient, text), 30000, null);
        if (!sent) throw new Error("delivery_failed");
        audit("captain.daily_debit_cancellation_notice.sent", "user", captain.id, { bulkRunKey: runKey, messageId: sent.id?._serialized || null });
        run.sent += 1;
      } catch (_) { run.failed += 1; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    run.status = "completed";
    run.completedAt = now();
  })().catch(() => { run.status = "failed"; run.completedAt = now(); });
  res.status(202).json({ success: true, started: true, ...run });
});
app.get("/api/admin/notifications/daily-debit-cancellation/:runKey", requireAdmin, (req, res) => {
  const run = dailyDebitCancellationRuns.get(String(req.params.runKey || ""));
  if (!run) return res.status(404).json({ error: "عملية إشعار إلغاء الخصم غير موجودة في الذاكرة الحالية" });
  res.json({ success: true, ...run });
});
app.post("/api/admin/notifications/negative-balance-warning", requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  const runKey = String(req.body?.runKey || "").trim();
  if (confirmation !== "SEND_NEGATIVE_BALANCE_WARNING_TO_ALL" || !/^NEG-WARN-[A-Z0-9-]{12,80}$/.test(runKey)) return res.status(400).json({ error: "تأكيد العملية ومفتاحها مطلوبان" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  if (negativeBalanceWarningRuns.has(runKey)) return res.json({ success: true, started: true, ...negativeBalanceWarningRuns.get(runKey) });
  const captains = db.prepare("SELECT id,phone,name,wallet_cents,active,account_status,is_bot FROM users WHERE role='captain' AND is_bot=0 AND account_status<>'merged' AND wallet_cents<0 ORDER BY id").all();
  const run = { runKey, status: "running", total: captains.length, sent: 0, failed: 0, skipped: 0, startedAt: now(), completedAt: null };
  negativeBalanceWarningRuns.set(runKey, run);
  void (async () => {
    for (const captain of captains) {
      try {
        const prior = db.prepare("SELECT id FROM audit_logs WHERE action='captain.negative_balance_warning.sent' AND entity_type='user' AND entity_id=? AND details LIKE ? LIMIT 1").get(String(captain.id), `%${runKey}%`);
        if (prior) { run.skipped += 1; run.sent += 1; continue; }
        const recipient = await resolveWhatsAppRecipientId(captain.phone);
        if (!recipient) throw new Error("recipient_unresolved");
        const text = brandedMessage("تنبيه رصيد المحفظة", [
          `الكابتن: ${captain.name || "حساب الكابتن"}`,
          `رصيدك الحالي: ${money(captain.wallet_cents)} JOD`,
          "الرجاء شحن رصيدك قبل أن يتم إزالتك من قروب وصلني الآن.",
          "يرجى التواصل مع الإدارة لشحن الرصيد.",
        ]);
        const sent = await withTimeout(client.sendMessage(recipient, text), 30000, null);
        if (!sent) throw new Error("delivery_failed");
        audit("captain.negative_balance_warning.sent", "user", captain.id, { bulkRunKey: runKey, messageId: sent.id?._serialized || null });
        run.sent += 1;
      } catch (_) { run.failed += 1; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    run.status = "completed";
    run.completedAt = now();
  })().catch(() => { run.status = "failed"; run.completedAt = now(); });
  res.status(202).json({ success: true, started: true, ...run });
});
app.get("/api/admin/notifications/negative-balance-warning/:runKey", requireAdmin, (req, res) => {
  const run = negativeBalanceWarningRuns.get(String(req.params.runKey || ""));
  if (!run) return res.status(404).json({ error: "عملية التحذير غير موجودة في الذاكرة الحالية" });
  res.json({ success: true, ...run });
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
    return { userId: user.id, balanceCents: newBalance, valueCents: card.value_cents, cardId: card.id, alreadyRedeemed: false };
  })();
  try {
    const captain = db.prepare("SELECT id,name,phone FROM users WHERE id=? AND role='captain' LIMIT 1").get(result.userId);
    void notifyCaptainCreditRedeemed({ captain, valueCents: result.valueCents, balanceCents: result.balanceCents, cardId: result.cardId });
    void notifyOperations({ event: "topup_card.redeemed", title: "تأكيد إضافة الرصيد", captainPhone: captain?.phone, lines: [`الكابتن: ${captain?.name || "حساب الكابتن"}`, `القيمة المضافة: ${money(result.valueCents)} JOD`, `الرصيد الحالي: ${money(result.balanceCents)} JOD`, "تم تسجيل العملية في دفتر الشركة وإضافة الرصيد مباشرة." ] });
    res.json({ success: true, balance: money(result.balanceCents), credited: money(result.valueCents), currency: "JOD" });
  } catch (error) { res.status(400).json({ error: error.message }); }
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
        return { balanceCents: Number(user?.wallet_cents || 0), valueCents: existingKey.value_cents, cardId: existingKey.id, alreadyRedeemed: true };
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
      return { balanceCents: newBalance, valueCents: card.value_cents, cardId: card.id, alreadyRedeemed: false };
    })();
    if (!result.alreadyRedeemed) {
      const captain = db.prepare("SELECT id,name,phone FROM users WHERE id=? AND role='captain' LIMIT 1").get(req.captainSession.userId);
      void notifyCaptainCreditRedeemed({ captain, valueCents: result.valueCents, balanceCents: result.balanceCents, cardId: result.cardId });
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
app.get("/api/admin/captains/announcement-chat-check/:phone", requireAdmin, async (req, res) => {
  const phone = phoneWithCountry(String(req.params.phone || ""));
  if (!isValidJordanPhone(phone)) return res.status(400).json({ error: "رقم كابتن غير صالح" });
  if (!client || !isReady) return res.status(503).json({ error: "WhatsApp غير جاهز حاليًا" });
  try {
    const recipient = await resolveWhatsAppRecipientId(phone) || `${phone}@c.us`;
    const chat = await withTimeout(client.getChatById(recipient), 20000, null);
    if (!chat || typeof chat.fetchMessages !== "function") return res.json({ success: true, phone, found: false, reason: "chat_unavailable", matches: [] });
    const messages = await withTimeout(chat.fetchMessages({ limit: 60, fromMe: true }), 30000, []);
    const { title, caption } = captainCompletionAnnouncementContent();
    const matches = (Array.isArray(messages) ? messages : []).filter((message) => {
      const body = String(message?.body || "");
      return message?.fromMe === true && (body.includes(title) || body.includes("تم بحمد الله اكتمال تجهيز وتشغيل شركة وصلني الآن") || body === caption);
    }).map((message) => ({
      id: message?.id?._serialized || null,
      timestamp: message?.timestamp || null,
      type: message?.type || null,
      hasMedia: Boolean(message?.hasMedia),
      body: String(message?.body || "").slice(0, 240),
    }));
    res.json({ success: true, phone, found: matches.length > 0, matches });
  } catch (error) {
    res.status(502).json({ error: "تعذر قراءة محادثة الكابتن", detail: String(error?.message || error).slice(0, 240) });
  }
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
  const issueIdempotencyKey = `SUPPORT-TICKET-${ticketId}`;
  let card = db.prepare("SELECT * FROM topup_cards WHERE issue_idempotency_key=? LIMIT 1").get(issueIdempotencyKey);
  if (card && (Number(card.assigned_captain_id) !== captain.id || Number(card.value_cents) !== valueCents)) return res.status(409).json({ error: "طلب الشحن مرتبط ببطاقة مختلفة" });
  if (card && card.status !== "issued") return res.status(409).json({ error: `البطاقة حالتها ${card.status} ولا يمكن إعادة تنفيذ الطلب` });
  if (!card) {
    let code = randomCode();
    while (db.prepare("SELECT id FROM topup_cards WHERE code_hash=?").get(hashCode(code))) code = randomCode();
    const encryptedCode = encryptCardCode(code);
    const result = db.prepare("INSERT INTO topup_cards(code_hash,code_last4,value_cents,status,assigned_captain_id,issue_idempotency_key,code_ciphertext,created_at) VALUES(?,?,?,'issued',?,?,?,?)").run(hashCode(code), code.slice(-4), valueCents, captain.id, issueIdempotencyKey, encryptedCode, now());
    card = db.prepare("SELECT * FROM topup_cards WHERE id=?").get(result.lastInsertRowid);
  }
  if (!client || !isReady) {
    db.prepare("UPDATE support_tickets SET status='in_progress',admin_reply=?,updated_at=? WHERE id=?").run(`تم إصدار البطاقة #${card.id}، وتنتظر اتصال WhatsApp للإرسال.`, now(), ticketId);
    return res.status(503).json({ error: "تم إصدار البطاقة لكن WhatsApp غير جاهز للإرسال حاليًا", cardId: card.id });
  }
  try {
    const code = decryptCardCode(card.code_ciphertext);
    const appUrl = captainAppUrl(captainInviteBaseUrl(req));
    const caption = brandedMessage("بطاقة شحن الرصيد", [`الكابتن: ${captain.name}`, `القيمة: ${money(valueCents)} JOD`, "هذه البطاقة مخصصة لرقمك وتُستخدم مرة واحدة فقط.", `الدخول: ${appUrl}`, "افتح البوابة، اضغط زر التشغيل، اختر دخول الكابتن، ثم أدخل الرمز لإضافة الرصيد مباشرة."]);
    const media = await renderTopupCardMedia({ cardId: card.id, code, valueCents, captainName: captain.name, appUrl });
    const recipient = await resolveWhatsAppRecipientId(phone);
    if (!recipient) throw new Error("captain WhatsApp account could not be resolved");
    const sent = await withTimeout(client.sendMessage(recipient, media, { caption }), 30000, null);
    if (!sent) throw new Error("send timeout");
    db.prepare("UPDATE topup_cards SET sent_at=?,delivery_idempotency_key=? WHERE id=? AND status='issued' AND sent_at IS NULL").run(now(), `SUPPORT-DELIVERY-${ticketId}`, card.id);
    db.prepare("UPDATE support_tickets SET status='resolved',admin_reply=?,updated_at=? WHERE id=?").run(`تم إصدار وإرسال بطاقة الشحن #${card.id} إلى WhatsApp.`, now(), ticketId);
    audit("support.topup_request.fulfilled", "support_ticket", ticketId, { cardId: card.id, captainId: captain.id });
    notifyCaptainCreditSent({ captain, valueCents, cardId: card.id });
    void notifyOperations({ event: "topup_card.sent", title: "تأكيد إصدار بطاقة شحن", lines: [`الكابتن: ${captain.name}`, `القيمة: ${money(valueCents)} JOD`, `رقم البطاقة الداخلي: #${card.id}`, "تم توليد البطاقة وإرسالها عبر WhatsApp.", "يُضاف الرصيد عند إدخال رمز البطاقة."], ownersOnly: true });
    res.json({ success: true, status: "resolved", cardId: card.id });
  } catch (error) {
    db.prepare("UPDATE support_tickets SET status='in_progress',admin_reply=?,updated_at=? WHERE id=?").run(`تم إصدار البطاقة #${card.id} لكن فشل الإرسال؛ يمكن إعادة المحاولة بعد اتصال WhatsApp.`, now(), ticketId);
    res.status(502).json({ error: "تم إصدار البطاقة لكن تعذر إرسالها عبر WhatsApp", cardId: card.id });
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
  const orders = db.prepare("SELECT COUNT(*) AS count FROM orders o JOIN order_settlements s ON s.order_id=o.id AND s.status='applied' WHERE o.status IN ('accepted','completed') AND o.settlement_state='settled'").get().count;
  const accepted = db.prepare("SELECT COUNT(*) AS count FROM orders o JOIN order_settlements s ON s.order_id=o.id AND s.status='applied' WHERE o.status='accepted' AND o.settlement_state='settled'").get().count;
  // الأسعار و«تم» محفوظة داخليًا في order_candidates ولا تظهر كطلبات منتظرة في لوحة الإدارة.
  const pendingConfirmation = 0;
  const company = companyUser();
  const wallets = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role!='company'").get().count;
  const ledgerMoves = db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger").get().count;
  const issuedCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards").get().count;
  const redeemedCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE status='redeemed'").get().count;
  const voidCards = db.prepare("SELECT COUNT(*) AS count FROM topup_cards WHERE status='void'").get().count;
  const customerLeads = db.prepare("SELECT COUNT(*) AS count FROM customer_leads WHERE state NOT IN ('cancelled')").get().count;
  const companyEarnings = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='commission_company' THEN amount_cents ELSE 0 END),0) AS cents, COUNT(CASE WHEN type='commission_company' THEN 1 END) AS entries FROM wallet_ledger WHERE user_id=?").get(company.id);
  const companyWallet = companyWalletSummary();
  res.json({ orders, accepted, pendingConfirmation, customerLeads, companyBalance: money(company.wallet_cents), companyWallet, companyEarnings: { total: money(companyEarnings.cents), entries: companyEarnings.entries }, wallets, ledgerMoves, cards: { issued: issuedCards, redeemed: redeemedCards, void: voidCards }, groupId: getSetting("group_id", null), rules: { allOrders: { captainCashFromCustomer: "100%", producerWalletCredit: "12% من قيمة الطلب", confirmingCaptainWalletDebit: "15% (12% لصاحب تنزيل الطلب + 3% للشركة)", companyWalletCredit: "3% من قيمة الطلب" }, debtLimit: "-2.00 JOD", fare: "الكابتن يستلم كامل قيمة الرحلة نقدًا من الزبون" }, confirmation: { method: "أي مستخدم مسجل ونشط يضع تم", settlementAfterConfirmation: true, automatic: true } });
});
app.get("/api/admin/leads", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id,phone,name,direction,travel_mode,travel_date,travelers_count,state,created_at,updated_at FROM customer_leads ORDER BY updated_at DESC LIMIT 200").all();
  res.json({ leads: rows });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT o.*, p.id AS producer_id,p.name AS producer_name,p.phone AS producer_phone,c.id AS captain_id,c.name AS captain_name,c.phone AS captain_phone,
    s.id AS settlement_id,s.status AS settlement_status,s.idempotency_key AS settlement_key,s.company_cents AS settlement_company_cents,s.producer_cents AS settlement_producer_cents,s.captain_fee_cents AS settlement_captain_fee_cents,s.applied_at AS settlement_applied_at
    FROM orders o JOIN order_settlements s ON s.order_id=o.id AND s.status='applied'
    LEFT JOIN users p ON p.id=COALESCE(s.producer_user_id,o.producer_user_id) LEFT JOIN users c ON c.id=COALESCE(s.captain_user_id,o.captain_user_id)
    WHERE o.status IN ('accepted','completed') AND o.settlement_state='settled' ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ orders: rows.map((row) => ({ ...row, ...settlementFinancials(row), producer_name: row.producer_name || row.producer_name_snapshot || "غير مسجل", producer_phone: row.producer_phone || row.producer_phone_snapshot || null, captain_name: row.captain_name || row.captain_name_snapshot || "غير مسجل", captain_phone: row.captain_phone || row.captain_phone_snapshot || null, orderType: row.order_kind === "order" ? "أوردر محدد" : "طلب عادي" })) });
});
app.get("/api/admin/orders/unlinked", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT o.*,p.name AS producer_name,p.phone AS producer_phone FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id WHERE o.status IN ('accepted','completed') AND (o.captain_user_id IS NULL OR o.settlement_state='unlinked') ORDER BY COALESCE(o.accepted_at,o.created_at) DESC,o.id DESC LIMIT 500`).all();
  res.json({ orders: rows.map((row) => ({ ...row, captain_name: row.captain_name_snapshot || "غير مسجل", captain_phone: row.captain_phone_snapshot || null, producer_name: row.producer_name || row.producer_name_snapshot || "غير مسجل", producer_phone: row.producer_phone || row.producer_phone_snapshot || null, price: money(row.price_cents) })) });
});
app.get("/api/admin/orders/open", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT o.*,p.name AS producer_name,p.phone AS producer_phone FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id WHERE o.status='open' AND COALESCE(o.archive_state,'active')='active' AND o.captain_user_id IS NULL ORDER BY o.created_at DESC,o.id DESC LIMIT 500`).all();
  if (String(req.query.summary || "") === "1") {
    return res.json({ orders: rows.map((row) => ({ orderNo: row.order_no, price: money(row.price_cents), origin: row.origin || null, destination: row.destination || null, tripTime: row.trip_time || null, orderKind: row.order_kind, producerName: row.producer_name || row.producer_name_snapshot || "غير مسجل", status: row.status, settlementState: row.settlement_state, createdAt: row.created_at, importSource: row.import_source || null })) });
  }
  res.json({ orders: rows.map((row) => ({ ...row, captain_name: row.captain_name_snapshot || "غير مسجل", captain_phone: row.captain_phone_snapshot || null, producer_name: row.producer_name || row.producer_name_snapshot || "غير مسجل", producer_phone: row.producer_phone || row.producer_phone_snapshot || null, price: money(row.price_cents) })) });
});
app.get("/api/admin/order-lifecycle", requireAdmin, (req, res) => {
  const requestedLimit = Number(req.query.limit || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  const groupId = String(req.query.groupId || getSetting("group_id", "")).trim();
  const rows = db.prepare(`SELECT c.id,c.source_message_id,c.group_id,c.raw_text,c.price_cents,c.status,c.pending_message_id,c.pending_at,
      c.lifecycle_stage,c.lifecycle_blocker,c.lifecycle_updated_at,c.created_at,c.updated_at,
      p.name AS producer_name,p.phone AS producer_phone
    FROM order_candidates c LEFT JOIN users p ON p.id=c.producer_user_id
    LEFT JOIN orders o ON o.source_message_id=c.source_message_id
    WHERE c.status IN ('candidate','pending') AND COALESCE(o.archive_state,'active')='active' ${groupId ? "AND c.group_id=?" : ""}
    ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`).all(...(groupId ? [groupId, limit] : [limit]));
  res.setHeader("Cache-Control", "no-store");
  res.json({ lifecycle: rows.map((row) => ({ ...row, price: money(row.price_cents), producer_name: row.producer_name || "غير مسجل", producer_phone: row.producer_phone || null })) });
});
app.get("/api/admin/unconfirmed-bookings", requireAdmin, (req, res) => {
  const configuredGroupId = String(getSetting("group_id", "") || "").trim();
  if (!configuredGroupId || !isConfiguredGroup(configuredGroupId)) return res.status(409).json({ error: "Configured WhatsApp group is unavailable", bookings: [] });
  const requestedLimit = Number(req.query.limit || 1000);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 1000)) : 1000;
  const candidates = db.prepare(`SELECT c.id AS candidate_id,c.source_message_id,c.group_id,c.raw_text,c.price_cents,c.origin,c.destination,c.trip_time,c.order_kind,c.status,
      c.pending_message_id,c.pending_at,c.lifecycle_stage,c.lifecycle_blocker,c.lifecycle_updated_at,c.created_at,c.updated_at,
      p.name AS producer_name,p.registration_name AS producer_registration_name,p.phone AS producer_phone,
      a.acceptance_message_id,a.status AS acceptance_status,e.name AS executor_name,e.registration_name AS executor_registration_name,
      e.phone AS executor_phone,e.active AS executor_active,e.account_status AS executor_account_status
    FROM order_candidates c
    LEFT JOIN users p ON p.id=c.producer_user_id
    LEFT JOIN order_candidate_acceptances a ON a.id=(
      SELECT a2.id FROM order_candidate_acceptances a2
      WHERE a2.candidate_id=c.id AND a2.status IN ('pending','selected')
      ORDER BY CASE WHEN a2.acceptance_message_id=(SELECT c2.pending_message_id FROM order_candidates c2 WHERE c2.id=a2.candidate_id) THEN 0 ELSE 1 END,a2.created_at DESC,a2.id DESC
      LIMIT 1
    )
    LEFT JOIN users e ON e.id=a.captain_user_id
    WHERE c.group_id=? AND c.status IN ('candidate','pending')
    ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`).all(configuredGroupId, limit)
    .filter((row) => {
      const equivalentOrder = findEquivalentOrder(row.group_id, row.source_message_id);
      if (equivalentOrder?.archive_state !== "archived") return true;
      const settlement = db.prepare("SELECT status FROM order_settlements WHERE order_id=? ORDER BY id DESC LIMIT 1").get(equivalentOrder.id);
      return settlement?.status !== "applied";
    });
  const openOrders = db.prepare(`SELECT o.id AS order_id,o.order_no,o.source_message_id,o.group_id,o.raw_text,o.price_cents,o.origin,o.destination,o.trip_time,o.order_kind,o.status,o.settlement_state,o.created_at,o.updated_at,
      p.name AS producer_name,p.registration_name AS producer_registration_name,p.phone AS producer_phone
    FROM orders o LEFT JOIN users p ON p.id=o.producer_user_id
    WHERE o.group_id=? AND o.status='open' AND COALESCE(o.archive_state,'active')='active' AND o.captain_user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM order_candidates c WHERE c.source_message_id=o.source_message_id AND c.status IN ('candidate','pending'))
    ORDER BY o.updated_at DESC,o.id DESC LIMIT ?`).all(configuredGroupId, limit);
  const candidateBookings = candidates.map((row) => {
    const executorPhone = row.executor_phone ? phoneWithCountry(row.executor_phone) : null;
    const producerPhone = row.producer_phone ? phoneWithCountry(row.producer_phone) : null;
    const executorActive = Number(row.executor_active) === 1 && row.executor_account_status === "active";
    const canConfirm = row.status === "pending" && Boolean(row.acceptance_message_id) && Boolean(executorPhone) && executorActive;
    const reason = canConfirm ? null : row.status === "candidate" ? "awaiting_quoted_acceptance" : !row.acceptance_message_id ? "acceptance_message_missing" : !executorActive ? "executor_inactive" : "evidence_incomplete";
    return {
      kind: "candidate",
      id: Number(row.candidate_id),
      candidateId: Number(row.candidate_id),
      groupId: row.group_id,
      sourceMessageId: row.source_message_id,
      acceptanceMessageId: row.acceptance_message_id || null,
      rawText: row.raw_text,
      price: money(row.price_cents),
      origin: row.origin || null,
      destination: row.destination || null,
      tripTime: row.trip_time || null,
      orderKind: row.order_kind,
      status: row.status,
      acceptanceStatus: row.acceptance_status || null,
      lifecycleStage: row.lifecycle_stage,
      lifecycleBlocker: row.lifecycle_blocker || null,
      pendingAt: row.pending_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      producer: { name: row.producer_name || row.producer_registration_name || "غير مسجل", phone: producerPhone },
      executor: { name: row.executor_name || row.executor_registration_name || null, phone: executorPhone, active: executorActive },
      canConfirm,
      canReject: true,
      reason,
    };
  });
  const openOrderBookings = openOrders.map((row) => ({
    kind: "order",
    id: Number(row.order_id),
    orderId: Number(row.order_id),
    orderNo: Number(row.order_no),
    groupId: row.group_id,
    sourceMessageId: row.source_message_id,
    acceptanceMessageId: null,
    rawText: row.raw_text,
    price: money(row.price_cents),
    origin: row.origin || null,
    destination: row.destination || null,
    tripTime: row.trip_time || null,
    orderKind: row.order_kind,
    status: row.status,
    acceptanceStatus: null,
    lifecycleStage: "awaiting_acceptance",
    lifecycleBlocker: "awaiting_quoted_acceptance",
    pendingAt: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    producer: { name: row.producer_name || row.producer_registration_name || "غير مسجل", phone: row.producer_phone ? phoneWithCountry(row.producer_phone) : null },
    executor: { name: null, phone: null, active: false },
    canConfirm: false,
    canReject: true,
    reason: "awaiting_quoted_acceptance",
  }));
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, groupId: configuredGroupId, bookings: [...candidateBookings, ...openOrderBookings], counts: { candidates: candidateBookings.length, openOrders: openOrderBookings.length, total: candidateBookings.length + openOrderBookings.length } });
});
app.post("/api/admin/unconfirmed-bookings/candidate/:id/reassign-acceptance", requireBotWalletOwner, async (req, res) => {
  const candidateId = Number(req.params.id);
  const configuredGroupId = String(getSetting("group_id", "") || "").trim();
  const sourceMessageId = String(req.body?.sourceMessageId || "").trim();
  const acceptanceMessageId = String(req.body?.acceptanceMessageId || "").trim();
  const executorPhone = phoneWithCountry(String(req.body?.executorPhone || ""));
  const reason = String(req.body?.reason || "تصحيح رسالة القبول المختارة بعد مطابقة دليل القروب").trim().slice(0, 240);
  if (!Number.isInteger(candidateId) || candidateId <= 0 || !acceptanceMessageId || !executorPhone) {
    return res.status(400).json({ error: "candidate id, acceptanceMessageId, and executorPhone are required", mutation: "none", financialMutation: false });
  }
  if (!configuredGroupId || !isConfiguredGroup(configuredGroupId)) {
    return res.status(409).json({ error: "Configured WhatsApp group is unavailable", mutation: "none", financialMutation: false });
  }
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready", mutation: "none", financialMutation: false });
  const candidate = db.prepare("SELECT * FROM order_candidates WHERE id=? AND group_id=? AND status='pending' LIMIT 1").get(candidateId, configuredGroupId);
  if (!candidate) return res.status(409).json({ error: "Booking is no longer pending", state: "stale", mutation: "none", financialMutation: false });
  if (sourceMessageId && !sourceMessageIdsEqual(sourceMessageId, candidate.source_message_id)) {
    return res.status(409).json({ error: "The supplied source message does not match the candidate", mutation: "none", financialMutation: false });
  }
  const exactMessages = await fetchExactGroupEvidenceMessages(configuredGroupId, candidate.source_message_id, acceptanceMessageId);
  const acceptanceMessage = exactMessages.find((message) => sourceMessageIdsEqual(serializedMessageId(message), acceptanceMessageId));
  if (!acceptanceMessage || acceptanceMessage.fromMe || resolveGroupChatId(acceptanceMessage) !== configuredGroupId || !isCaptainAcceptance(acceptanceMessage.body)) {
    return res.status(409).json({ error: "The supplied acceptance message is not a valid quoted acceptance in the configured group", mutation: "none", financialMutation: false });
  }
  const evidence = await inspectConfirmedRecoveryMessage(acceptanceMessage, exactMessages, configuredGroupId);
  const captain = findCaptainByPhone(executorPhone, { activeOnly: true });
  if (!captain || !recoveryPhoneMatches(evidence?.captainPhone, executorPhone) || !sourceMessageIdsEqual(evidence?.orderMessageId, candidate.source_message_id)) {
    return res.status(409).json({ error: "Acceptance evidence and executor identity do not match the candidate", evidence: recoveryEvidenceSummary(evidence), mutation: "none", financialMutation: false });
  }
  if (candidate.producer_phone_snapshot && evidence?.producerPhone && !recoveryPhoneMatches(candidate.producer_phone_snapshot, evidence.producerPhone)) {
    return res.status(409).json({ error: "The acceptance quotes a different producer than the candidate", evidence: recoveryEvidenceSummary(evidence), mutation: "none", financialMutation: false });
  }
  const result = db.transaction(() => {
    const conflicting = db.prepare("SELECT id,candidate_id,captain_user_id,status FROM order_candidate_acceptances WHERE acceptance_message_id=? LIMIT 1").get(acceptanceMessageId);
    if (conflicting && Number(conflicting.candidate_id) !== candidateId) return { state: "acceptance_linked_to_other_candidate" };
    const stamp = now();
    if (!conflicting) {
      db.prepare("INSERT INTO order_candidate_acceptances(candidate_id,captain_user_id,acceptance_message_id,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").run(candidateId, captain.id, acceptanceMessageId, stamp, stamp);
    } else if (Number(conflicting.captain_user_id) !== Number(captain.id)) {
      return { state: "acceptance_identity_conflict" };
    }
    db.prepare("UPDATE order_candidate_acceptances SET status='rejected',updated_at=? WHERE candidate_id=? AND acceptance_message_id<>? AND status IN ('pending','selected')").run(stamp, candidateId, acceptanceMessageId);
    db.prepare("UPDATE order_candidate_acceptances SET status='selected',updated_at=? WHERE candidate_id=? AND acceptance_message_id=? AND status IN ('pending','selected')").run(stamp, candidateId, acceptanceMessageId);
    db.prepare("UPDATE order_candidates SET pending_captain_user_id=?,pending_message_id=?,pending_at=COALESCE(pending_at,?),lifecycle_stage='acceptance_pending',lifecycle_blocker='awaiting_authorized_thumb',lifecycle_updated_at=?,updated_at=? WHERE id=? AND group_id=? AND status='pending'").run(captain.id, acceptanceMessageId, stamp, stamp, stamp, candidateId, configuredGroupId);
    audit("order.candidate.acceptance_reassigned", "order_candidate", candidateId, { sourceMessageId: candidate.source_message_id, acceptanceMessageId, executorPhone, reason, financialMutation: false });
    return { state: "reassigned", candidateId, sourceMessageId: candidate.source_message_id, acceptanceMessageId, executor: { id: captain.id, name: captain.name, phone: captain.phone } };
  })();
  if (result.state !== "reassigned") return res.status(409).json({ error: "Acceptance could not be reassigned safely", state: result.state, mutation: "none", financialMutation: false });
  return res.json({ success: true, ...result, mutation: "reassigned_acceptance", financialMutation: false, settlement: "not_applied" });
});
app.post("/api/admin/unconfirmed-bookings/candidate/:id/confirm", requireAdmin, (req, res) => {
  const candidateId = Number(req.params.id);
  const configuredGroupId = String(getSetting("group_id", "") || "").trim();
  if (!Number.isInteger(candidateId) || candidateId <= 0) return res.status(400).json({ error: "Valid candidate id is required", mutation: "none" });
  if (!configuredGroupId || !isConfiguredGroup(configuredGroupId)) return res.status(409).json({ error: "Configured WhatsApp group is unavailable", mutation: "none" });
  const actionKey = `candidate:${candidateId}:confirm`;
  const actions = app.locals.unconfirmedBookingActions || (app.locals.unconfirmedBookingActions = new Set());
  if (actions.has(actionKey)) return res.status(409).json({ error: "This booking action is already in progress", mutation: "none" });
  actions.add(actionKey);
  try {
    const candidate = db.prepare("SELECT * FROM order_candidates WHERE id=? AND group_id=? AND status='pending' LIMIT 1").get(candidateId, configuredGroupId);
    if (!candidate) return res.status(409).json({ error: "Booking is no longer pending", state: "stale", mutation: "none" });
    const expectedMessageId = String(candidate.pending_message_id || "").trim();
    if (!expectedMessageId) return res.status(409).json({ error: "A quoted acceptance message is required before confirmation", state: "acceptance_missing", mutation: "none" });
    const acceptance = db.prepare(`SELECT a.*,e.name AS executor_name,e.phone AS executor_phone,e.active AS executor_active,e.account_status AS executor_account_status
      FROM order_candidate_acceptances a JOIN users e ON e.id=a.captain_user_id
      WHERE a.candidate_id=? AND a.acceptance_message_id=? AND a.status IN ('pending','selected') LIMIT 1`).get(candidateId, expectedMessageId);
    if (!acceptance) return res.status(409).json({ error: "The pending quoted acceptance could not be found", state: "acceptance_missing", mutation: "none" });
    if (Number(acceptance.executor_active) !== 1 || acceptance.executor_account_status !== "active") return res.status(409).json({ error: "The executor account is not active", state: "executor_inactive", mutation: "none" });
    const result = settlePendingOrder(candidate.id, acceptance.acceptance_message_id, connectedBotPhone(), { adminApproval: true });
    if (result.state !== "accepted") {
      const status = result.state === "unauthorized" ? 403 : result.state === "debt_limit" ? 409 : 422;
      return res.status(status).json({ success: false, state: result.state, mutation: "none", financialMutation: false, evidence: { candidateId, sourceMessageId: candidate.source_message_id, acceptanceMessageId: acceptance.acceptance_message_id } });
    }
    const confirmationDetails = { orderId: result.order?.id, orderNo: result.order?.order_no, executorName: result.captain?.name, downloaderName: result.producer?.name, priceCents: result.order?.price_cents };
    void sendFinalBookingConfirmation(candidate.group_id, confirmationDetails).catch(() => null);
    audit("order.admin_unconfirmed.confirmed", "order_candidate", candidate.id, { sourceMessageId: candidate.source_message_id, acceptanceMessageId: acceptance.acceptance_message_id, orderNo: result.order?.order_no, financialMutation: true });
    return res.status(201).json({ success: true, state: "accepted", mutation: "applied_once", order: result.order, chargedWallet: result.chargedWallet, evidence: { candidateId, sourceMessageId: candidate.source_message_id, acceptanceMessageId: acceptance.acceptance_message_id, executorPhone: phoneWithCountry(acceptance.executor_phone) }, cardSent: false });
  } finally {
    actions.delete(actionKey);
  }
});
app.post("/api/admin/unconfirmed-bookings/:kind/:id/reject", requireAdmin, (req, res) => {
  const kind = String(req.params.kind || "").trim();
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || "رفض إداري: لم يتم تأكيد الحجز").trim().slice(0, 240);
  const configuredGroupId = String(getSetting("group_id", "") || "").trim();
  if (!['candidate', 'order'].includes(kind) || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Valid booking type and id are required", mutation: "none" });
  if (!configuredGroupId || !isConfiguredGroup(configuredGroupId)) return res.status(409).json({ error: "Configured WhatsApp group is unavailable", mutation: "none" });
  const actionKey = `${kind}:${id}:reject`;
  const actions = app.locals.unconfirmedBookingActions || (app.locals.unconfirmedBookingActions = new Set());
  if (actions.has(actionKey)) return res.status(409).json({ error: "This booking action is already in progress", mutation: "none" });
  actions.add(actionKey);
  try {
    const result = db.transaction(() => {
      const stamp = now();
      if (kind === "candidate") {
        const candidate = db.prepare("SELECT id,source_message_id,group_id,status FROM order_candidates WHERE id=? AND group_id=? AND status IN ('candidate','pending') LIMIT 1").get(id, configuredGroupId);
        if (!candidate) return { state: "stale" };
        db.prepare("UPDATE order_candidate_acceptances SET status='rejected',updated_at=? WHERE candidate_id=? AND status IN ('pending','selected')").run(stamp, id);
        const updated = db.prepare("UPDATE order_candidates SET status='cancelled',pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,lifecycle_stage='rejected',lifecycle_blocker='admin_rejected',lifecycle_updated_at=?,updated_at=? WHERE id=? AND group_id=? AND status IN ('candidate','pending')").run(stamp, stamp, id, configuredGroupId);
        if (!updated.changes) return { state: "stale" };
        const linkedOrder = db.prepare("SELECT id,order_no FROM orders WHERE source_message_id=? AND group_id=? AND status='open' AND captain_user_id IS NULL AND COALESCE(archive_state,'active')='active' LIMIT 1").get(candidate.source_message_id, configuredGroupId);
        if (linkedOrder) db.prepare("UPDATE orders SET status='cancelled',settlement_state='cancelled',updated_at=? WHERE id=? AND status='open' AND captain_user_id IS NULL").run(stamp, linkedOrder.id);
        audit("order.admin_unconfirmed.rejected", "order_candidate", id, { sourceMessageId: candidate.source_message_id, reason, financialMutation: false, linkedOrderNo: linkedOrder?.order_no || null });
        return { state: "rejected", candidateId: id, sourceMessageId: candidate.source_message_id, linkedOrderNo: linkedOrder?.order_no || null };
      }
      const order = db.prepare("SELECT id,order_no,source_message_id,group_id,status FROM orders WHERE id=? AND group_id=? AND status='open' AND captain_user_id IS NULL AND COALESCE(archive_state,'active')='active' LIMIT 1").get(id, configuredGroupId);
      if (!order) return { state: "stale" };
      const updated = db.prepare("UPDATE orders SET status='cancelled',settlement_state='cancelled',updated_at=? WHERE id=? AND status='open' AND captain_user_id IS NULL").run(stamp, id);
      if (!updated.changes) return { state: "stale" };
      audit("order.admin_unconfirmed.rejected", "order", id, { orderNo: order.order_no, sourceMessageId: order.source_message_id, reason, financialMutation: false });
      return { state: "rejected", orderId: id, orderNo: order.order_no, sourceMessageId: order.source_message_id };
    })();
    if (result.state !== "rejected") return res.status(409).json({ error: "Booking is no longer unconfirmed", state: result.state, mutation: "none" });
    return res.json({ success: true, state: "rejected", mutation: "none", financialMutation: false, ...result });
  } finally {
    actions.delete(actionKey);
  }
});
app.post("/api/admin/orders/archive-open", requireAdmin, (req, res) => {
  const reason = String(req.body?.reason || "أرشفة نهائية للطلبات المفتوحة القديمة غير الموزعة").trim().slice(0, 240);
  const stamp = now();
  const rows = db.prepare("SELECT id,order_no,status,captain_user_id,settlement_state FROM orders WHERE status='open' AND COALESCE(archive_state,'active')='active' AND captain_user_id IS NULL ORDER BY id").all();
  const archive = db.transaction(() => {
    for (const row of rows) {
      db.prepare("UPDATE orders SET archive_state='archived',archived_at=?,archive_reason=?,updated_at=? WHERE id=? AND status='open' AND COALESCE(archive_state,'active')='active' AND captain_user_id IS NULL").run(stamp, reason, stamp, row.id);
      audit("order.archived", "order", row.id, { orderNo: row.order_no, reason, financialMutation: false, settlementState: row.settlement_state });
    }
  });
  archive();
  res.json({ success: true, archivedCount: rows.length, orderNos: rows.map((row) => row.order_no), financialMutation: false, reason, archivedAt: stamp });
});
app.post("/api/admin/orders/:id/link-captain", requireAdmin, (req, res) => {
  const orderId = Number(req.params.id);
  const captainId = Number(req.body?.captainId);
  const applySettlement = req.body?.applySettlement === true;
  const reason = String(req.body?.reason || "ربط إداري موثق").trim().slice(0, 240);
  if (!Number.isInteger(orderId) || !Number.isInteger(captainId)) return res.status(400).json({ error: "Valid orderId and captainId are required" });
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  const captain = db.prepare("SELECT * FROM users WHERE id=? AND role='captain' AND active=1 AND account_status='active'").get(captainId);
  if (!order || !captain) return res.status(404).json({ error: "Order or active captain not found" });
  if (order.captain_user_id && Number(order.captain_user_id) !== captainId) return res.status(409).json({ error: "Order is already linked to another captain" });
  let settlement = null;
  if (applySettlement && order.status === "accepted" && order.accepted_message_id && order.producer_user_id) {
    settlement = settleHistoricalConfirmedOrder({ orderId, captainId, acceptedMessageId: order.accepted_message_id, acceptedAt: order.accepted_at || now(), confirmedByPhone: order.confirmed_by_phone || order.producer_phone_snapshot || "" });
  } else {
    db.prepare("UPDATE orders SET captain_user_id=?,captain_phone_snapshot=?,captain_name_snapshot=?,settlement_state=CASE WHEN settlement_state='unlinked' THEN 'pending' ELSE settlement_state END,updated_at=? WHERE id=?").run(captain.id, captain.phone, captain.name, now(), orderId);
  }
  audit("order.captain.linked", "order", orderId, { captainId, applySettlement, settlementState: settlement?.state || "not_applied", reason });
  res.json({ success: true, orderId, captainId, settlement: settlement?.state || "not_applied" });
});
app.post("/api/admin/orders/reconcile-captains", requireAdmin, (req, res) => {
  const applySettlement = req.body?.applySettlement === true;
  const rows = db.prepare("SELECT * FROM orders WHERE captain_phone_snapshot IS NOT NULL AND (captain_user_id IS NULL OR settlement_state='unlinked') ORDER BY id").all();
  const linked = [], settled = [], skipped = [];
  for (const order of rows) {
    const captain = findCaptainByPhone(order.captain_phone_snapshot, { activeOnly: true });
    if (!captain) { skipped.push({ orderNo: order.order_no, reason: "captain_not_registered", phone: order.captain_phone_snapshot }); continue; }
    if (applySettlement && order.status === "accepted" && order.accepted_message_id && order.producer_user_id) {
      const result = settleHistoricalConfirmedOrder({ orderId: order.id, captainId: captain.id, acceptedMessageId: order.accepted_message_id, acceptedAt: order.accepted_at || now(), confirmedByPhone: order.confirmed_by_phone || order.producer_phone_snapshot || "" });
      if (["accepted", "already_settled"].includes(result.state)) {
        settled.push({ orderNo: order.order_no, captainId: captain.id, state: result.state });
        if (result.state === "accepted" && result.chargedWallet && Number(result.chargedWallet.wallet_cents) < 0) void notifyCaptainNegativeBalance({ captainId: captain.id, balanceCents: result.chargedWallet.wallet_cents, reason: "خصم حصة تسوية طلب تاريخي", reference: `ORDER-${order.order_no}` });
      } else skipped.push({ orderNo: order.order_no, reason: result.state });
    } else {
      db.prepare("UPDATE orders SET captain_user_id=?,captain_phone_snapshot=?,captain_name_snapshot=?,settlement_state=CASE WHEN settlement_state='unlinked' THEN 'pending' ELSE settlement_state END,updated_at=? WHERE id=?").run(captain.id, captain.phone, captain.name, now(), order.id);
      linked.push({ orderNo: order.order_no, captainId: captain.id });
    }
  }
  audit("orders.captain.reconciled", "order", "bulk", { applySettlement, linked: linked.length, settled: settled.length, skipped: skipped.length });
  res.json({ success: true, applySettlement, linked, settled, skipped });
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
    ? db.prepare(`SELECT o.*, p.id AS producer_id,p.name AS producer_name,p.phone AS producer_phone,c.id AS captain_id,c.name AS captain_name,c.phone AS captain_phone,
        s.id AS settlement_id,s.status AS settlement_status,s.idempotency_key AS settlement_key,s.company_cents AS settlement_company_cents,s.producer_cents AS settlement_producer_cents,s.captain_fee_cents AS settlement_captain_fee_cents,s.applied_at AS settlement_applied_at
        FROM orders o JOIN order_settlements s ON s.order_id=o.id AND s.status='applied' LEFT JOIN users p ON p.id=COALESCE(s.producer_user_id,o.producer_user_id) LEFT JOIN users c ON c.id=COALESCE(s.captain_user_id,o.captain_user_id)
        WHERE o.status IN ('accepted','completed') AND o.settlement_state='settled' AND o.group_id=? ORDER BY o.accepted_at DESC, o.id DESC LIMIT ?`).all(groupId, limit)
    : db.prepare(`SELECT o.*, p.id AS producer_id,p.name AS producer_name,p.phone AS producer_phone,c.id AS captain_id,c.name AS captain_name,c.phone AS captain_phone,
        s.id AS settlement_id,s.status AS settlement_status,s.idempotency_key AS settlement_key,s.company_cents AS settlement_company_cents,s.producer_cents AS settlement_producer_cents,s.captain_fee_cents AS settlement_captain_fee_cents,s.applied_at AS settlement_applied_at
        FROM orders o JOIN order_settlements s ON s.order_id=o.id AND s.status='applied' LEFT JOIN users p ON p.id=COALESCE(s.producer_user_id,o.producer_user_id) LEFT JOIN users c ON c.id=COALESCE(s.captain_user_id,o.captain_user_id)
        WHERE o.status IN ('accepted','completed') AND o.settlement_state='settled' ORDER BY o.accepted_at DESC, o.id DESC LIMIT ?`).all(limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    count: rows.length,
    groupId: groupId || null,
    orders: rows.map((row) => ({
      ...row,
      ...settlementFinancials(row),
      producer_name: row.producer_name || row.producer_name_snapshot || "غير مسجل",
      producer_phone: row.producer_phone || row.producer_phone_snapshot || null,
      captain_name: row.captain_name || row.captain_name_snapshot || "غير مسجل",
      captain_phone: row.captain_phone || row.captain_phone_snapshot || null,
      orderType: row.order_kind === "order" ? "أوردر محدد" : "طلب عادي",
    })),
  });
});
app.get("/api/admin/company-wallet", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, wallet: companyWalletSummary() });
});
app.get("/api/staff/company-wallet", requireStaffRole("accountant"), (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, wallet: companyWalletSummary() });
});
app.get("/api/admin/wallets", requireAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.id,u.phone,u.name,u.role,u.wallet_cents,u.active,u.updated_at,
    COALESCE((SELECT SUM(s.producer_cents) FROM order_settlements s JOIN orders p ON p.id=s.order_id WHERE s.producer_user_id=u.id AND s.status='applied' AND p.status IN ('accepted','completed')),0) AS posted_share_cents,
    COALESCE((SELECT SUM(s.captain_fee_cents) FROM order_settlements s JOIN orders e ON e.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND e.status IN ('accepted','completed')),0) AS executed_debit_cents,
    COALESCE((SELECT SUM(s.company_cents) FROM order_settlements s JOIN orders e ON e.id=s.order_id WHERE s.captain_user_id=u.id AND s.status='applied' AND e.status IN ('accepted','completed')),0) AS company_share_cents
    FROM users u ORDER BY u.role,u.id`).all();
  res.json({ wallets: users.map((user) => ({ ...user, balance: money(user.wallet_cents), postedShare: money(user.posted_share_cents), executedDebit: money(user.executed_debit_cents), companyShare: money(user.company_share_cents), netMovement: money(Number(user.posted_share_cents || 0) - Number(user.executed_debit_cents || 0)) })), companyWallet: companyWalletSummary() });
});
app.get("/api/admin/subscriptions", requireAdmin, (req, res) => {
  const requestedPeriod = String(req.query.periodStart || "").trim();
  const currentPeriod = currentCaptainSubscriptionPeriod();
  const periodStart = requestedPeriod || currentPeriod?.start || null;
  if (!periodStart) return res.json({ success: true, periodStart: null, count: 0, userCount: 0, totalCents: 0, charges: [], users: [] });
  const rows = db.prepare(`SELECT c.id,c.user_id,c.period_start,c.period_end,c.amount_cents,c.status,c.reference,c.applied_at,
      u.name,COALESCE(NULLIF(u.registration_name,''),u.name) AS registration_name,u.phone,u.wallet_cents,l.balance_after_cents
    FROM captain_subscription_charges c
    JOIN users u ON u.id=c.user_id
    LEFT JOIN wallet_ledger l ON l.id=c.ledger_id
    WHERE c.period_start=?
    ORDER BY c.status='applied' DESC,u.name,u.id`).all(periodStart);
  const users = db.prepare(`SELECT u.id,u.phone,u.name,COALESCE(NULLIF(u.registration_name,''),u.name) AS registration_name,u.wallet_cents,u.active,u.account_status,u.created_at,u.updated_at,
      (SELECT c.status FROM captain_subscription_charges c WHERE c.user_id=u.id AND c.period_start=? ORDER BY c.id DESC LIMIT 1) AS subscription_status,
      (SELECT c.amount_cents FROM captain_subscription_charges c WHERE c.user_id=u.id AND c.period_start=? ORDER BY c.id DESC LIMIT 1) AS subscription_amount_cents,
      (SELECT c.reference FROM captain_subscription_charges c WHERE c.user_id=u.id AND c.period_start=? ORDER BY c.id DESC LIMIT 1) AS subscription_reference,
      (SELECT c.applied_at FROM captain_subscription_charges c WHERE c.user_id=u.id AND c.period_start=? ORDER BY c.id DESC LIMIT 1) AS subscription_applied_at,
      (SELECT l.balance_after_cents FROM captain_subscription_charges c LEFT JOIN wallet_ledger l ON l.id=c.ledger_id WHERE c.user_id=u.id AND c.period_start=? ORDER BY c.id DESC LIMIT 1) AS subscription_balance_after_cents
    FROM users u
    WHERE u.role='captain' AND u.is_bot=0 AND u.account_status<>'merged'
    ORDER BY u.active DESC,u.name,u.id`).all(periodStart, periodStart, periodStart, periodStart, periodStart);
  const totalCents = rows.filter((row) => row.status === "applied").reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  const serializeUser = (row) => {
    const amountCents = Number(row.subscription_amount_cents || 0);
    const applied = row.subscription_status === "applied";
    const currentBalanceCents = Number(row.wallet_cents || 0);
    const balanceAfterCents = applied && row.subscription_applied_at ? Number(row.subscription_balance_after_cents ?? currentBalanceCents) : currentBalanceCents;
    const balanceBeforeCents = applied ? balanceAfterCents + amountCents : currentBalanceCents;
    return {
      id: row.id,
      name: row.name,
      registrationName: row.registration_name || row.name,
      originalName: row.registration_name || row.name,
      displayName: captainDisplayName(row.registration_name || row.name),
      phone: row.phone,
      active: Boolean(row.active),
      accountStatus: row.account_status,
      subscriptionStatus: row.subscription_status || "not_charged",
      subscriptionAmountCents: amountCents,
      subscriptionAmount: money(amountCents),
      balanceBeforeSubscriptionCents: balanceBeforeCents,
      balanceBeforeSubscription: money(balanceBeforeCents),
      balanceAfterSubscriptionCents: balanceAfterCents,
      balanceAfterSubscription: money(balanceAfterCents),
      balanceCents: currentBalanceCents,
      balance: money(currentBalanceCents),
      currentBalanceCents,
      currentBalance: money(currentBalanceCents),
      reference: row.subscription_reference || null,
      appliedAt: row.subscription_applied_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };
  const serializedUsers = users.map(serializeUser);
  res.setHeader("Cache-Control", "no-store");
  if (req.query.compact === "1") {
    return res.json({
      success: true,
      periodStart,
      periodEnd: rows[0]?.period_end || currentPeriod?.end || null,
      count: rows.length,
      userCount: serializedUsers.length,
      appliedCount: rows.filter((row) => row.status === "applied").length,
      total: money(totalCents),
      users: serializedUsers,
      charges: rows.map((row) => ({ name: row.registration_name || row.name, displayName: captainDisplayName(row.registration_name || row.name), phone: row.phone, balance: row.balance_after_cents == null ? money(row.wallet_cents) : money(row.balance_after_cents), reference: row.reference })),
    });
  }
  res.json({
    success: true,
    periodStart,
    periodEnd: rows[0]?.period_end || currentPeriod?.end || null,
    count: rows.length,
    userCount: serializedUsers.length,
    appliedCount: rows.filter((row) => row.status === "applied").length,
    totalCents,
    total: money(totalCents),
    users: serializedUsers,
    charges: rows.map((row) => ({
      id: row.id,
      captainId: row.user_id,
      name: row.registration_name || row.name,
      displayName: captainDisplayName(row.registration_name || row.name),
      phone: row.phone,
      status: row.status,
      amountCents: row.amount_cents,
      amount: money(row.amount_cents),
      balanceAfterChargeCents: row.balance_after_cents,
      balanceAfterCharge: row.balance_after_cents == null ? null : money(row.balance_after_cents),
      currentBalanceCents: row.wallet_cents,
      currentBalance: money(row.wallet_cents),
      reference: row.reference,
      appliedAt: row.applied_at,
    })),
  });
});
app.get("/api/admin/daily-charges", requireAdmin, (req, res) => {
  const requestedDate = String(req.query.chargeDate || "").trim();
  const chargeDate = requestedDate || now().slice(0, 10);
  const rows = db.prepare(`SELECT c.id,c.user_id,c.charge_date,c.amount_cents,c.reference,c.created_at,c.details_json,
      u.name,COALESCE(NULLIF(u.registration_name,''),u.name) AS registration_name,u.phone,u.active,u.account_status,
      l.balance_after_cents
    FROM captain_daily_charges c
    JOIN users u ON u.id=c.user_id
    LEFT JOIN wallet_ledger l ON l.id=c.ledger_id
    WHERE c.charge_date=?
    ORDER BY u.active DESC,u.name,u.id`).all(chargeDate);
  const totalCents = rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  const serialize = (row) => ({
    id: row.id,
    captainId: row.user_id,
    name: row.registration_name || row.name,
    displayName: captainDisplayName(row.registration_name || row.name),
    phone: row.phone,
    active: Boolean(row.active),
    accountStatus: row.account_status,
    amountCents: row.amount_cents,
    amount: money(row.amount_cents),
    balanceAfterCents: row.balance_after_cents,
    balanceAfter: row.balance_after_cents == null ? null : money(row.balance_after_cents),
    reference: row.reference,
    createdAt: row.created_at,
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    chargeDate,
    chargeAmountCents: CAPTAIN_DAILY_CHARGE_CENTS,
    chargeAmount: money(CAPTAIN_DAILY_CHARGE_CENTS),
    count: rows.length,
    totalCents,
    total: money(totalCents),
    activeCount: rows.filter((row) => Boolean(row.active)).length,
    suspendedCount: rows.filter((row) => !Boolean(row.active)).length,
    charges: rows.map(serialize),
  });
});
app.get("/api/admin/settlements", requireAdmin, (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const rows = settlementRows(req.query.limit || 300).map((row) => serializeSettlement(row, true)).filter((row) => {
    if (!query) return true;
    return [row.orderNo, row.downloader.name, row.executor.name, row.downloader.phone, row.executor.phone, row.status, row.confirmation.method].join(" ").toLowerCase().includes(query);
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, count: rows.length, settlements: rows });
});

app.get("/api/staff/settlements", requireStaffRole("accountant"), (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const rows = settlementRows(req.query.limit || 300).map((row) => serializeSettlement(row, true)).filter((row) => {
    if (!query) return true;
    return [row.orderNo, row.downloader.name, row.executor.name, row.status, row.confirmation.method].join(" ").toLowerCase().includes(query);
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, count: rows.length, settlements: rows });
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
app.post("/api/admin/group/send-test-media", requireAdmin, async (req, res) => {
  const officialGroupId = "120363426604560611@g.us";
  const groupId = String(req.body?.groupId || "").trim();
  const operationId = String(req.body?.operationId || req.get("X-Idempotency-Key") || crypto.randomUUID()).slice(0, 120);
  const caption = "اختبار إرسال صورة فقط — لا ينشئ طلبًا ولا يغيّر أي رصيد.";
  if (groupId !== officialGroupId) return res.status(403).json({ error: "Only the verified official group is allowed" });
  if (req.body?.confirm !== true) return res.status(400).json({ error: "Owner confirmation is required" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (isWhatsAppStorageSendBlocked()) return res.status(503).json({ error: "WhatsApp sending paused بسبب ضغط IndexedDB", code: "WHATSAPP_INDEXEDDB_SEND_PAUSED", storagePressure: { ...whatsappStoragePressure } });
  const registration = registerAdminSend({ operationId, chatId: groupId, message: caption });
  if (!registration.created) {
    const existing = registration.state;
    return res.status(existing.sendState === "pending" ? 202 : 200).json({ ...adminSendResponse(existing), mediaType: "image/png", filename: "waslni-now-media-test.png" });
  }
  audit("message.media_test_requested", "chat", groupId, { operationId, mediaType: "image/png", filename: "waslni-now-media-test.png" });
  const sendPromise = Promise.resolve().then(async () => {
    const media = await withTimeout(renderOperationsMessageMedia("اختبار وسائط Waslni Now", ["لا يوجد حجز أو تسوية مالية", "اختبار صورة واحد فقط"]), 30000, null);
    if (!media) throw new Error("media test card render returned no media");
    if (typeof client.sendMessage !== "function") throw new Error("WhatsApp client media send path is unavailable");
    return withTimeoutStrict(client.sendMessage(groupId, media, { caption }), ADMIN_SEND_TIMEOUT_MS, null);
  });
  try {
    const sent = await withTimeoutStrict(sendPromise, ADMIN_SEND_TIMEOUT_MS, null);
    if (serializedMessageId(sent)) {
      const completed = completeAdminSend({ operationId, chatId: groupId, message: caption, sent, confirmationSource: "sendMessage" });
      return res.json({ ...adminSendResponse(completed), mediaType: "image/png", filename: "waslni-now-media-test.png" });
    }
    return res.status(202).json({ ...adminSendResponse(adminSendResults.get(operationId)), mediaType: "image/png", filename: "waslni-now-media-test.png", error: "WhatsApp accepted the media; waiting for message_create confirmation." });
  } catch (error) {
    failAdminSend(operationId, error);
    const detail = String(error?.stack || error?.message || error).slice(0, 500);
    audit("message.media_test_failed", "chat", groupId, { operationId, error: detail });
    return res.status(502).json({ success: false, sendState: "failed", operationId, mediaType: "image/png", filename: "waslni-now-media-test.png", error: detail.slice(0, 240) });
  }
});
app.post("/api/admin/send", requireAdmin, async (req, res) => {
  if (!consumeRateLimit(adminActionRate, clientAddress(req), 30)) return res.status(429).json({ error: "Too many administrative actions; try again later" });
  if (!client || !isReady) return res.status(503).json({ error: "Bot not ready" });
  if (isWhatsAppStorageSendBlocked()) return res.status(503).json({ error: "WhatsApp sending paused بسبب ضغط IndexedDB", code: "WHATSAPP_INDEXEDDB_SEND_PAUSED", storagePressure: { ...whatsappStoragePressure } });
  const to = String(req.body.to || "").trim();
  const message = String(req.body.message || "").trim();
  if (!to || !message) return res.status(400).json({ error: "to and message are required" });
  const chatId = to.endsWith("@g.us") || to.endsWith("@c.us") ? to : `${cleanPhone(to)}@c.us`;
  if (chatId.endsWith("@c.us") && isBlockedPhone(chatId.slice(0, -5))) return res.status(403).json({ error: "This phone is blocked by company policy" });
  const operationId = String(req.body.operationId || crypto.randomUUID()).slice(0, 120);
  const registration = registerAdminSend({ operationId, chatId, message });
  if (!registration.created) {
    const existing = registration.state;
    return res.status(existing.sendState === "pending" ? 202 : 200).json(adminSendResponse(existing));
  }
  const sendPromise = Promise.resolve().then(async () => {
    let chat = null;
    try {
      chat = typeof client.getChatById === "function"
        ? await withTimeout(client.getChatById(chatId), 12000, null)
        : null;
    } catch (error) {
      console.warn(`[WhatsApp] admin send getChatById failed for ${chatId}: ${String(error?.message || error)}`);
    }
    if (!chat && typeof client.getChats === "function") {
      try {
        const chats = await withTimeout(client.getChats(), 15000, []);
        chat = (Array.isArray(chats) ? chats : []).find((item) => String(item?.id?._serialized || item?.id || "") === chatId) || null;
      } catch (error) {
        console.warn(`[WhatsApp] admin send getChats fallback failed for ${chatId}: ${String(error?.message || error)}`);
      }
    }
    if (chat && typeof chat.sendMessage === "function") {
      try {
        return await chat.sendMessage(message);
      } catch (chatError) {
        const detail = String(chatError?.stack || chatError?.message || chatError).slice(0, 500);
        console.warn(`[WhatsApp] admin send chat.sendMessage failed; retrying client.sendMessage: chat=${chatId} detail=${detail}`);
        audit("message.send_chat_failed", "chat", chatId, { operationId, error: detail });
        if (typeof client.sendMessage !== "function") throw chatError;
        try {
          return await client.sendMessage(chatId, message);
        } catch (clientError) {
          clientError.cause = chatError;
          throw clientError;
        }
      }
    }
    return client.sendMessage(chatId, message);
  });
  const sendTimeoutMarker = {};
  try {
    const sent = await withTimeoutStrict(sendPromise, ADMIN_SEND_TIMEOUT_MS, sendTimeoutMarker);
    if (sent === sendTimeoutMarker) {
      audit("message.send_pending", "chat", chatId, { operationId, timeoutMs: ADMIN_SEND_TIMEOUT_MS, messageLength: message.length });
      void sendPromise.then((lateSent) => {
        if (serializedMessageId(lateSent)) {
          const completed = completeAdminSend({ chatId, message, sent: lateSent, operationId, late: true });
          console.warn(`[WhatsApp] admin send completed after timeout: operation=${operationId} message=${completed?.messageId || "none"}`);
        } else {
          console.warn(`[WhatsApp] admin send returned without a message object after timeout: operation=${operationId}; waiting for message_create`);
        }
      }).catch((error) => {
        failAdminSend(operationId, error);
        audit("message.send_failed_after_timeout", "chat", chatId, { operationId, error: String(error?.message || error).slice(0, 240) });
        console.error(`[WhatsApp] admin send failed after timeout: operation=${operationId}:`, error.message);
      });
      return res.status(202).json({
        ...adminSendResponse(adminSendResults.get(operationId)),
        error: "WhatsApp is still processing the message; waiting for message_create confirmation.",
      });
    }
    if (serializedMessageId(sent)) {
      const completed = completeAdminSend({ chatId, message, sent, operationId });
      return res.json(adminSendResponse(completed));
    }
    audit("message.send_waiting_confirmation", "chat", chatId, { operationId, responseObject: Boolean(sent), observationTimeoutMs: ADMIN_SEND_OBSERVATION_TIMEOUT_MS });
    return res.status(202).json({
      ...adminSendResponse(adminSendResults.get(operationId)),
      error: "WhatsApp accepted the send request without a message object; waiting for message_create confirmation.",
    });
  } catch (error) {
    failAdminSend(operationId, error);
    const detail = String(error?.stack || error?.message || error).slice(0, 500);
    audit("message.send_failed", "chat", chatId, { operationId, error: detail });
    console.error(`[WhatsApp] admin send failed: operation=${operationId}: ${detail}`);
    return res.status(502).json({ success: false, sendState: "failed", operationId, error: detail.slice(0, 240) });
  }
});
app.get("/api/admin/send-status/:operationId", requireAdmin, (req, res) => {
  const operationId = String(req.params.operationId || "").trim();
  pruneAdminSendState();
  const state = adminSendResults.get(operationId);
  if (!state) return res.status(404).json({ error: "Send operation was not found or has expired" });
  res.setHeader("Cache-Control", "no-store");
  res.status(state.sendState === "pending" ? 202 : 200).json(adminSendResponse(state));
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
  startCaptainSubscriptionScheduler();
  initializeWhatsApp();
  startWhatsAppWatchdog();
  startWhatsAppReactionScanner();
  if (BAILEYS_ENABLED) initializeBaileys();
});

function isRecoverableBrowserLifecycleError(error) {
  const message = String(error && error.message || error || "");
  // During WhatsApp LOGOUT/disconnect, an async page evaluation can finish
  // after Chromium has already detached its frame. The disconnect handler
  // owns retrying this recoverable browser-lifecycle failure.
  return /Execution context was destroyed|Target closed|Session closed|Protocol error|Attempted to use detached Frame|Frame was detached/i.test(message);
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
