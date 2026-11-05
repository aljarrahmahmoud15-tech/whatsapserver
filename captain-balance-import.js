const crypto = require("crypto");

function parseTargetCents(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("target_balance_jod يجب أن يكون رقمًا موجبًا أو صفرًا بمنزلتين عشريتين");
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("target_balance_jod غير صالح");
  return cents;
}

function createCaptainBalanceImportService({ db, normalizePhone, validPhone, money, now, audit, minBalanceCents = -300, manualDebitsEnabled = false }) {
  const previews = new Map();

  function normalizeRows(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error("يجب إرسال من 1 إلى 1000 صف");
    const seen = new Set();
    return rows.map((raw, index) => {
      const line = index + 2;
      const phone = normalizePhone(String(raw?.phone || "").trim());
      if (!validPhone(phone)) throw new Error(`السطر ${line}: رقم الهاتف غير صالح`);
      if (seen.has(phone)) throw new Error(`السطر ${line}: رقم الهاتف مكرر`);
      seen.add(phone);
      const sourceReference = String(raw?.source_reference || "").trim();
      if (!sourceReference || sourceReference.length > 100) throw new Error(`السطر ${line}: source_reference مطلوب`);
      return {
        line,
        phone,
        name: String(raw?.name || "").trim().slice(0, 100),
        targetCents: parseTargetCents(raw?.target_balance_jod),
        sourceReference,
        note: String(raw?.note || "").trim().slice(0, 500),
        createIfMissing: String(raw?.create_if_missing || "no").trim().toLowerCase(),
      };
    });
  }

  function preview(rows, { sourceReference, expectedRows } = {}) {
    const normalized = normalizeRows(rows);
    if (Number(expectedRows) !== normalized.length) throw new Error("عدد الصفوف لا يطابق expectedRows");
    const requestedReference = String(sourceReference || normalized[0]?.sourceReference || "").trim();
    if (!requestedReference) throw new Error("sourceReference مطلوب");
    const matches = normalized.map((row) => {
      const captain = db.prepare("SELECT id,phone,name,wallet_cents,active,is_bot,account_status FROM users WHERE phone=? AND role='captain' LIMIT 1").get(row.phone);
      if (!captain) return { ...row, status: "not_found", action: "review", reason: "الحساب غير موجود", captainId: null, dbName: null, currentCents: null, differenceCents: null };
      if (!captain.active || captain.is_bot || captain.account_status !== "active") return { ...row, status: "review", action: "review", reason: "الحساب غير نشط أو محمي", captainId: captain.id, dbName: captain.name, currentCents: Number(captain.wallet_cents || 0), differenceCents: null };
      const currentCents = Number(captain.wallet_cents || 0);
      const differenceCents = row.targetCents - currentCents;
      const action = differenceCents === 0 ? "no_change" : differenceCents > 0 ? "credit" : "debit";
      const status = action === "debit" && (!manualDebitsEnabled || currentCents + differenceCents < minBalanceCents) ? "review" : "matched";
      return { ...row, status, action: status === "review" ? "review" : action, reason: status === "review" ? "الخصم اليدوي غير مسموح أو يتجاوز حد الدين" : "مطابق", captainId: captain.id, dbName: captain.name, currentCents, differenceCents };
    });
    const previewId = `BAL-PREVIEW-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const fileHash = crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const result = {
      previewId,
      fileHash,
      sourceReference: requestedReference,
      createdAt: now(),
      rows: matches,
      summary: {
        submitted: matches.length,
        matched: matches.filter((x) => x.status === "matched").length,
        review: matches.filter((x) => x.status === "review" || x.status === "not_found").length,
        noChange: matches.filter((x) => x.action === "no_change").length,
        totalCreditsCents: matches.filter((x) => x.action === "credit").reduce((s, x) => s + x.differenceCents, 0),
        totalDebitsCents: matches.filter((x) => x.action === "debit").reduce((s, x) => s + Math.abs(x.differenceCents), 0),
      },
    };
    previews.set(previewId, result);
    return { ...result, rows: matches.map(toPublicRow), summary: { ...result.summary, totalCredits: money(result.summary.totalCreditsCents), totalDebits: money(result.summary.totalDebitsCents) } };
  }

  function toPublicRow(row) {
    return {
      line: row.line, phone: row.phone, name: row.name, dbName: row.dbName, captainId: row.captainId,
      currentBalance: row.currentCents == null ? null : money(row.currentCents),
      targetBalance: money(row.targetCents), difference: row.differenceCents == null ? null : money(row.differenceCents),
      status: row.status, action: row.action, reason: row.reason,
    };
  }

  function apply(previewId, fileHash, confirmation) {
    if (confirmation !== "APPLY_CAPTAIN_BALANCE_DIFFERENCES_V1") throw new Error("تأكيد اعتماد التسوية غير صحيح");
    const item = previews.get(String(previewId));
    if (!item || item.fileHash !== String(fileHash || "")) throw new Error("المعاينة غير موجودة أو تغير الملف");
    if (item.rows.some((row) => row.status !== "matched")) throw new Error("لا يمكن الاعتماد قبل معالجة صفوف المراجعة");
    const applied = [];
    db.transaction(() => {
      for (const row of item.rows) {
        if (row.action === "no_change") continue;
        const idempotencyKey = `CSV-BAL-${crypto.createHash("sha256").update(`${item.sourceReference}|${row.captainId}|${row.targetCents}`).digest("hex").slice(0, 40)}`;
        const existing = db.prepare("SELECT id,balance_after_cents FROM wallet_ledger WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
        if (existing) { applied.push({ ...toPublicRow(row), alreadyApplied: true, ledgerId: existing.id }); continue; }
        const current = db.prepare("SELECT id,wallet_cents,active,is_bot,account_status FROM users WHERE id=? AND role='captain'").get(row.captainId);
        if (!current || !current.active || current.is_bot || current.account_status !== "active" || Number(current.wallet_cents) !== row.currentCents) throw new Error(`تغير رصيد ${row.phone} منذ المعاينة؛ أعد المعاينة`);
        const next = row.currentCents + row.differenceCents;
        if (row.action === "debit" && (!manualDebitsEnabled || next < minBalanceCents)) throw new Error(`خصم غير مسموح للكابتن ${row.phone}`);
        const stamp = now();
        const changed = db.prepare("UPDATE users SET wallet_cents=?,updated_at=? WHERE id=? AND role='captain' AND wallet_cents=?").run(next, stamp, row.captainId, row.currentCents);
        if (!changed.changes) throw new Error(`تعذر تحديث رصيد ${row.phone}`);
        const reference = `${item.sourceReference}-${row.captainId}`.slice(0, 100);
        const details = JSON.stringify({ source: "captain_balance_csv_import", previewId: item.previewId, fileHash: item.fileHash, targetBalanceCents: row.targetCents, actor: "owner", whatsappSent: false });
        const ledger = db.prepare("INSERT INTO wallet_ledger(user_id,type,amount_cents,balance_after_cents,reference,note,created_at,details_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)").run(row.captainId, row.action === "credit" ? "admin_credit" : "admin_debit", row.differenceCents, next, reference, row.note || "مطابقة رصيد من ملف CSV", stamp, details, idempotencyKey);
        audit("captain.wallet.csv_balance_import", "user", row.captainId, { previewId: item.previewId, phone: row.phone, differenceCents: row.differenceCents, balanceAfterCents: next, whatsappSent: false });
        applied.push({ ...toPublicRow(row), alreadyApplied: false, ledgerId: ledger.lastInsertRowid, balanceAfter: money(next) });
      }
    })();
    item.appliedAt = now();
    return { success: true, previewId: item.previewId, applied, whatsappSent: false };
  }

  return { preview, apply };
}

module.exports = { createCaptainBalanceImportService, parseTargetCents };
