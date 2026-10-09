"use strict";

function parseDetails(value) {
  if (!value) return {};
  try { return JSON.parse(value); } catch (_) { return {}; }
}

/**
 * Cancel a financially settled order exactly once.
 * The caller owns authorization and external notifications; this function owns
 * the SQLite transaction, wallet movements, settlement state, and audit row.
 */
function cancelSettledOrderAndReverse(db, { orderId, now, audit, reason = "إلغاء من المالك عبر V26", actor = "owner_v26", idempotencyKey = null }) {
  if (!db || typeof db.transaction !== "function") throw new Error("database is required");
  if (typeof now !== "function") throw new Error("now callback is required");
  if (typeof audit !== "function") throw new Error("audit callback is required");

  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM orders WHERE id=? LIMIT 1").get(Number(orderId));
    if (!current) return { state: "not_found", orderId: Number(orderId) };

    const settlement = db.prepare("SELECT * FROM order_settlements WHERE order_id=? LIMIT 1").get(current.id);
    if (current.status === "cancelled" && settlement?.status === "reversed") {
      return {
        state: "already_reversed",
        order: current,
        settlement,
        reversal: { companyCents: 0, producerCents: 0, chargedWalletCents: 0 },
      };
    }

    if (!settlement || settlement.status !== "applied" || !["accepted", "completed"].includes(current.status) || current.settlement_state !== "settled") {
      return { state: "not_settled", order: current, settlement: settlement || null };
    }

    const company = db.prepare("SELECT id FROM users WHERE role='company' ORDER BY id LIMIT 1").get();
    const producerId = Number(settlement.producer_user_id || current.producer_user_id || 0);
    const chargedWalletId = Number(settlement.charged_user_id || settlement.captain_user_id || 0);
    const producer = producerId ? db.prepare("SELECT id FROM users WHERE id=? LIMIT 1").get(producerId) : null;
    const chargedWallet = chargedWalletId ? db.prepare("SELECT id FROM users WHERE id=? LIMIT 1").get(chargedWalletId) : null;
    if (!company || !producer || !chargedWallet) {
      return { state: "missing_wallet_party", order: current, settlement };
    }

    const stamp = now();
    const reference = `ORDER-${current.order_no}-CANCEL`;
    const operationKey = `ORDER-CANCEL-${current.id}`;
    const details = {
      originalSettlementId: settlement.id,
      originalSettlementKey: settlement.idempotency_key,
      ownerAction: actor,
      reason,
      requestIdempotencyKey: idempotencyKey,
      reversal: true,
    };
    const detailJson = JSON.stringify({ ...parseDetails(settlement.details_json), ...details });
    const movements = [
      { userId: company.id, delta: -Number(settlement.company_cents || 0), type: "reversal_company", note: "عكس حصة الشركة بعد إلغاء المالك للحجز", key: `${operationKey}-COMPANY` },
      { userId: producer.id, delta: -Number(settlement.producer_cents || 0), type: "reversal_producer", note: "عكس حصة منزّل الطلب بعد إلغاء المالك للحجز", key: `${operationKey}-PRODUCER` },
      { userId: chargedWallet.id, delta: Number(settlement.captain_fee_cents || 0), type: "reversal_captain_fee", note: "إرجاع خصم المنفّذ بعد إلغاء المالك للحجز", key: `${operationKey}-CHARGED-WALLET` },
    ];

    for (const movement of movements) {
      if (!movement.delta) continue;
      const changed = db.prepare("UPDATE users SET wallet_cents=wallet_cents+?,updated_at=? WHERE id=?").run(movement.delta, stamp, movement.userId);
      if (!changed.changes) throw new Error(`تعذر تحديث محفظة العكس للمستخدم ${movement.userId}`);
      const after = db.prepare("SELECT wallet_cents FROM users WHERE id=?").get(movement.userId);
      db.prepare("INSERT INTO wallet_ledger(user_id,order_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        movement.userId,
        current.id,
        movement.type,
        movement.delta,
        Number(after.wallet_cents),
        reference,
        movement.note,
        stamp,
        detailJson,
        movement.key,
      );
    }

    const settlementChanged = db.prepare("UPDATE order_settlements SET status='reversed' WHERE order_id=? AND status='applied'").run(current.id);
    if (!settlementChanged.changes) throw new Error("لم تتغير حالة التسوية؛ أُلغيت العملية كاملة");
    const orderChanged = db.prepare("UPDATE orders SET status='cancelled',settlement_state='reversed',updated_at=? WHERE id=? AND status IN ('accepted','completed') AND settlement_state='settled'").run(stamp, current.id);
    if (!orderChanged.changes) throw new Error("لم تتغير حالة الحجز؛ أُلغيت العملية كاملة");

    audit("order.cancelled_owner_reversed", "order", current.id, {
      orderNo: current.order_no,
      actor,
      reason,
      requestIdempotencyKey: idempotencyKey,
      operationKey,
      settlementId: settlement.id,
      companyCents: Number(settlement.company_cents || 0),
      producerCents: Number(settlement.producer_cents || 0),
      chargedWalletCents: Number(settlement.captain_fee_cents || 0),
      chargedWalletId: chargedWallet.id,
      financialMutation: true,
      synchronizedState: "cancelled_reversed",
    });

    return {
      state: "cancelled",
      order: { ...current, status: "cancelled", settlement_state: "reversed", updated_at: stamp },
      settlement: { ...settlement, status: "reversed" },
      reversal: {
        companyCents: Number(settlement.company_cents || 0),
        producerCents: Number(settlement.producer_cents || 0),
        chargedWalletCents: Number(settlement.captain_fee_cents || 0),
        chargedWalletId: chargedWallet.id,
      },
    };
  })();
}

module.exports = { cancelSettledOrderAndReverse };
