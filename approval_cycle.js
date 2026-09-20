"use strict";

/**
 * Waslni Now — automatic WhatsApp order approval cycle.
 *
 * Flow:
 *   1) Producer sends: السعر <variable numeric price>
 *   2) Another captain replies by quoting that exact message: تم
 *   3) Producer reacts 👍 to the quoted تم message
 *
 * Financial settlement is injected through options.settleOrder so this module
 * never guesses or changes wallet policy on its own.
 */

const crypto = require("node:crypto");

function normalizePhone(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `962${digits.slice(1)}`;
  return digits;
}

function messageId(message) {
  return message?.id?._serialized || message?.id?.id || message?.id || null;
}

function parsePrice(body) {
  const text = String(body || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
  const match = /^السعر\s+([0-9]+(?:[.,][0-9]{1,2})?)(?:\s|$)/u.exec(text);
  if (!match) return null;
  const price = Number(match[1].replace(",", "."));
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return null;
  return { price, priceCents: Math.round(price * 100) };
}

function hasDoneText(body) {
  return /^(?:تم|تمم|تم\s+التنفيذ)[.!،،\s]*$/u.test(String(body || "").trim());
}

function safeKey(...parts) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part || "")).join("|")).digest("hex");
}

function createApprovalCycle({ client, db, groupId, isCaptainEligible = async () => true, settleOrder, sendConfirmation = true, logger = console }) {
  if (!client || !db || !groupId || typeof settleOrder !== "function") {
    throw new TypeError("client, db, groupId and settleOrder are required");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      source_message_id TEXT NOT NULL UNIQUE,
      producer_phone TEXT NOT NULL,
      producer_name TEXT,
      body TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS approval_acceptances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      acceptance_message_id TEXT NOT NULL UNIQUE,
      executor_phone TEXT NOT NULL,
      executor_name TEXT,
      quoted_source_message_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY(source_id) REFERENCES approval_sources(id)
    );
    CREATE TABLE IF NOT EXISTS approval_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      acceptance_id INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      group_id TEXT NOT NULL,
      producer_phone TEXT NOT NULL,
      executor_phone TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'settling',
      settlement_json TEXT,
      confirmation_message_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(source_id) REFERENCES approval_sources(id),
      FOREIGN KEY(acceptance_id) REFERENCES approval_acceptances(id)
    );
    CREATE INDEX IF NOT EXISTS approval_sources_group_status ON approval_sources(group_id, status);
    CREATE INDEX IF NOT EXISTS approval_acceptances_source_status ON approval_acceptances(source_id, status);
  `);

  const now = () => new Date().toISOString();
  const log = (event, details = {}) => logger.info(`[ApprovalCycle] ${event}`, details);

  function sourceByMessage(id) {
    return db.prepare("SELECT * FROM approval_sources WHERE source_message_id=? LIMIT 1").get(id);
  }

  async function participantPhone(value) {
    const direct = normalizePhone(value?.user || value?.number || value);
    if (direct) return direct;
    const serialized = value?._serialized || value?.id?._serialized;
    if (!serialized || typeof client.getContactById !== "function") return null;
    try {
      const contact = await client.getContactById(serialized);
      return normalizePhone(contact?.number || contact?.id?.user || contact?.id?._serialized);
    } catch (error) {
      log("participant_resolution_failed", { error: error.message });
      return null;
    }
  }

  async function messageSenderPhone(message) {
    const author = message?.author || message?.from;
    return participantPhone(author);
  }

  async function onMessage(message) {
    if (!message || message.from !== groupId) return { ignored: "group" };
    const id = messageId(message);
    if (!id || !message.body) return { ignored: "invalid" };

    const senderPhone = await messageSenderPhone(message);
    if (!senderPhone || !(await isCaptainEligible(senderPhone))) return { ignored: "ineligible_sender" };

    const parsed = parsePrice(message.body);
    if (parsed) {
      const existing = sourceByMessage(id);
      if (existing) return { duplicate: true, sourceId: existing.id };
      const result = db.prepare(`INSERT INTO approval_sources
        (group_id,source_message_id,producer_phone,producer_name,body,price_cents,created_at,status)
        VALUES (?,?,?,?,?,?,?,'open')`).run(
        groupId, id, senderPhone, message._data?.notifyName || message.notifyName || null,
        String(message.body), parsed.priceCents, now(),
      );
      log("price_recorded", { sourceId: result.lastInsertRowid, sourceMessageId: id, priceCents: parsed.priceCents });
      return { recorded: true, sourceId: result.lastInsertRowid, priceCents: parsed.priceCents };
    }

    if (!hasDoneText(message.body) || !message.hasQuotedMsg || typeof message.getQuotedMessage !== "function") {
      return { ignored: "not_price_or_quoted_done" };
    }
    const quoted = await message.getQuotedMessage();
    const quotedId = messageId(quoted);
    const source = sourceByMessage(quotedId);
    if (!source || source.group_id !== groupId || source.status !== "open") return { ignored: "quote_not_open_source" };
    if (source.producer_phone === senderPhone) return { ignored: "same_captain" };
    if (db.prepare("SELECT id FROM approval_acceptances WHERE acceptance_message_id=?").get(id)) return { duplicate: true };

    const result = db.prepare(`INSERT INTO approval_acceptances
      (source_id,acceptance_message_id,executor_phone,executor_name,quoted_source_message_id,body,created_at,status)
      VALUES (?,?,?,?,?,?,?,'pending')`).run(
      source.id, id, senderPhone, message._data?.notifyName || message.notifyName || null,
      quotedId, String(message.body), now(),
    );
    log("acceptance_recorded", { acceptanceId: result.lastInsertRowid, sourceId: source.id, acceptanceMessageId: id });
    return { recorded: true, acceptanceId: result.lastInsertRowid, sourceId: source.id };
  }

  async function onReaction(reaction) {
    if (!reaction || reaction.reaction !== "👍") return { ignored: "reaction" };
    const targetId = reaction.msgId || reaction.messageId || reaction.msgId?._serialized;
    if (!targetId) return { ignored: "missing_target" };
    const priorOrder = db.prepare(`SELECT o.* FROM approval_orders o
      JOIN approval_acceptances a ON a.id=o.acceptance_id
      WHERE a.acceptance_message_id=? LIMIT 1`).get(targetId);
    if (priorOrder) return { alreadySettled: true, orderId: priorOrder.id, status: priorOrder.status };
    const acceptance = db.prepare("SELECT a.*,s.group_id,s.source_message_id,s.producer_phone,s.producer_name,s.price_cents,s.status AS source_status FROM approval_acceptances a JOIN approval_sources s ON s.id=a.source_id WHERE a.acceptance_message_id=? AND a.status='pending' LIMIT 1").get(targetId);
    if (!acceptance || acceptance.group_id !== groupId || acceptance.source_status !== "open") return { ignored: "not_pending_acceptance" };

    const reactorPhone = await participantPhone(reaction.senderId || reaction.sender || reaction.author || reaction.senderPhone);
    if (!reactorPhone || reactorPhone !== normalizePhone(acceptance.producer_phone)) return { ignored: "reactor_not_producer" };
    if (!(await isCaptainEligible(reactorPhone))) return { ignored: "ineligible_reactor" };

    const idempotencyKey = safeKey(groupId, acceptance.source_message_id, acceptance.acceptance_message_id);
    const existing = db.prepare("SELECT * FROM approval_orders WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
    if (existing) return { alreadySettled: true, orderId: existing.id, status: existing.status };

    const insert = db.prepare(`INSERT INTO approval_orders
      (source_id,acceptance_id,idempotency_key,group_id,producer_phone,executor_phone,price_cents,status,created_at)
      VALUES (?,?,?,?,?,?,?,'settling',?)`).run(
      acceptance.source_id, acceptance.id, idempotencyKey, groupId,
      acceptance.producer_phone, acceptance.executor_phone, acceptance.price_cents, now(),
    );
    const orderId = Number(insert.lastInsertRowid);

    try {
      const settlement = await settleOrder({
        orderId,
        idempotencyKey,
        groupId,
        sourceMessageId: acceptance.source_message_id,
        acceptanceMessageId: acceptance.acceptance_message_id,
        producerPhone: acceptance.producer_phone,
        executorPhone: acceptance.executor_phone,
        priceCents: acceptance.price_cents,
      });
      db.prepare("UPDATE approval_orders SET status='settled',settlement_json=? WHERE id=?").run(JSON.stringify(settlement || {}), orderId);
      db.prepare("UPDATE approval_acceptances SET status='selected' WHERE id=? AND status='pending'").run(acceptance.id);
      db.prepare("UPDATE approval_sources SET status='settled' WHERE id=? AND status='open'").run(acceptance.source_id);

      let confirmationMessageId = null;
      if (sendConfirmation && typeof client.sendMessage === "function") {
        const priceText = (acceptance.price_cents / 100).toFixed(2);
        const text = [
          "✅ تم قبول الطلب وتثبيته",
          `💰 السعر: ${priceText} JOD (شامل العمولة)`,
          `🚖 الكابتن المنفذ: ${acceptance.executor_name || acceptance.executor_phone}`,
          "📌 الحالة: مقبول ومعتمد",
          "",
          "تم تحويل الطلب للتسوية المالية حسب النظام.",
          `رقم الرحلة: #${orderId}`,
          `صاحب الطلب: ${acceptance.producer_name || acceptance.producer_phone}`,
        ].join("\n");
        try {
          const sent = await client.sendMessage(groupId, text);
          confirmationMessageId = messageId(sent);
          db.prepare("UPDATE approval_orders SET confirmation_message_id=? WHERE id=?").run(confirmationMessageId, orderId);
        } catch (error) {
          log("confirmation_send_failed", { orderId, error: error.message });
        }
      }
      log("order_settled", { orderId, sourceMessageId: acceptance.source_message_id, acceptanceMessageId: acceptance.acceptance_message_id });
      return { settled: true, orderId, confirmationMessageId };
    } catch (error) {
      db.prepare("UPDATE approval_orders SET status='failed',settlement_json=? WHERE id=?").run(JSON.stringify({ error: error.message }), orderId);
      log("settlement_failed", { orderId, error: error.message });
      return { settled: false, orderId, error: error.message };
    }
  }

  function bind() {
    const messageHandler = (message) => onMessage(message).catch((error) => log("message_failed", { error: error.message }));
    const reactionHandler = (reaction) => onReaction(reaction).catch((error) => log("reaction_failed", { error: error.message }));
    client.on("message", messageHandler);
    client.on("message_create", messageHandler);
    client.on("message_reaction", reactionHandler);
    return () => {
      client.off?.("message", messageHandler);
      client.off?.("message_create", messageHandler);
      client.off?.("message_reaction", reactionHandler);
    };
  }

  return { bind, onMessage, onReaction, parsePrice, normalizePhone };
}

module.exports = { createApprovalCycle, parsePrice, normalizePhone, hasDoneText, messageId };

if (require.main === module) {
  console.log("approval_cycle.js is a module. Import createApprovalCycle from server.js after initializing whatsapp-web.js and SQLite.");
}
