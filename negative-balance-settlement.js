const crypto = require("crypto");

function createNegativeBalanceSettlementService({ db, money, now, audit }) {
  const previews = new Map();

  function listEligible() {
    return db.prepare(`
      SELECT id, phone, name, registration_name, wallet_cents, active, is_bot, account_status
      FROM users
      WHERE role='captain' AND is_bot=0 AND active=1 AND account_status='active' AND wallet_cents<0
      ORDER BY id
    `).all();
  }

  function preview({ expectedCount, expectedTotalCents } = {}) {
    const rows = listEligible().map((row) => ({
      captainId: Number(row.id),
      phone: String(row.phone || ""),
      name: row.name || row.registration_name || "غير مسجل",
      currentCents: Number(row.wallet_cents),
      targetCents: 0,
      correctionCents: Math.abs(Number(row.wallet_cents)),
    }));
    const totalCents = rows.reduce((sum, row) => sum + row.correctionCents, 0);
    if (expectedCount != null && Number(expectedCount) !== rows.length) throw new Error("تغير عدد الحسابات السالبة؛ أعد المعاينة");
    if (expectedTotalCents != null && Number(expectedTotalCents) !== totalCents) throw new Error("تغير إجمالي العجز؛ أعد المعاينة");
    const previewId = `NEGATIVE-FLOOR-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    const result = {
      previewId,
      createdAt: now(),
      rows,
      summary: { count: rows.length, totalCents, total: money(totalCents), target: "0.00" },
    };
    previews.set(previewId, result);
    return {
      success: true,
      readOnly: true,
      policy: "active_human_negative_to_zero",
      previewId,
      createdAt: result.createdAt,
      summary: result.summary,
      rows: rows.map((row) => ({
        captainId: row.captainId,
        name: row.name,
        phoneMasked: row.phone.length > 6 ? `${row.phone.slice(0, 5)}${"*".repeat(Math.max(3, row.phone.length - 8))}${row.phone.slice(-3)}` : "***",
        currentBalance: money(row.currentCents),
        correction: money(row.correctionCents),
        targetBalance: "0.00",
        active: true,
        eligible: true,
      })),
    };
  }

  function apply({ previewId, expectedCount, expectedTotalCents, confirmation }) {
    if (confirmation !== "APPLY_NEGATIVE_BALANCE_ZERO_FLOOR_V1") throw new Error("تأكيد تصحيح الأرصدة غير صحيح");
    const item = previews.get(String(previewId));
    if (!item) throw new Error("المعاينة غير موجودة أو انتهت؛ أعد المعاينة");
    if (Number(expectedCount) !== item.summary.count || Number(expectedTotalCents) !== item.summary.totalCents) throw new Error("العدد أو الإجمالي لا يطابق المعاينة");
    const applied = [];
    db.transaction(() => {
      for (const row of item.rows) {
        const idempotencyKey = `NEGATIVE-FLOOR-${crypto.createHash("sha256").update(`${item.previewId}|${row.captainId}|${row.currentCents}`).digest("hex").slice(0, 40)}`;
        const existing = db.prepare("SELECT id,balance_after_cents FROM wallet_ledger WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
        if (existing) {
          applied.push({ captainId: row.captainId, alreadyApplied: true, ledgerId: existing.id, balanceAfter: money(existing.balance_after_cents) });
          continue;
        }
        const current = db.prepare("SELECT id,phone,name,wallet_cents,active,is_bot,account_status FROM users WHERE id=? AND role='captain' LIMIT 1").get(row.captainId);
        if (!current || !current.active || current.is_bot || current.account_status !== "active") throw new Error(`الحساب ${row.captainId} لم يعد مؤهلًا`);
        if (Number(current.wallet_cents) !== row.currentCents || Number(current.wallet_cents) >= 0) throw new Error(`تغير رصيد ${current.phone} منذ المعاينة؛ أعد المعاينة`);
        const stamp = now();
        const changed = db.prepare("UPDATE users SET wallet_cents=0,updated_at=? WHERE id=? AND role='captain' AND wallet_cents=?").run(stamp, row.captainId, row.currentCents);
        if (!changed.changes) throw new Error(`تعذر تصفير رصيد ${current.phone}`);
        const reference = `NEGATIVE-FLOOR-${row.captainId}`;
        const details = JSON.stringify({ source: "negative_balance_zero_floor", previewId: item.previewId, correctionCents: row.correctionCents, targetBalanceCents: 0, actor: "owner", whatsappSent: false, accountPreserved: true });
        const ledger = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)").run(row.captainId, "admin_credit", row.correctionCents, 0, reference, "تصحيح الرصيد السالب إلى 0.00 د.أ", stamp, details, idempotencyKey);
        audit("captain.wallet.negative_balance_zeroed", "user", row.captainId, { previewId: item.previewId, phone: current.phone, correctionCents: row.correctionCents, balanceAfterCents: 0, whatsappSent: false, accountPreserved: true });
        applied.push({ captainId: row.captainId, name: current.name, balanceAfter: "0.00", correction: money(row.correctionCents), alreadyApplied: false, ledgerId: ledger.lastInsertRowid });
      }
    })();
    item.appliedAt = now();
    return { success: true, previewId: item.previewId, applied, count: applied.length, total: money(item.summary.totalCents), whatsappSent: false, accountsDeleted: 0 };
  }

  return { preview, apply };
}

module.exports = { createNegativeBalanceSettlementService };
