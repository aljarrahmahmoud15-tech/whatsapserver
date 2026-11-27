const crypto = require("node:crypto");

const PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_CANDIDATES = 1024;
const CONFIRMATION = "REMOVE_ZERO_BALANCE_MEMBERS_FROM_OFFICIAL_GROUP_V1";
const OPERATION_DELAY_MS = 1500;

// This owner-authorized route changes WhatsApp group membership only. It is a
// deliberately separate exception; the global captain archive/suspend/merge
// pause remains in force for every account-removal route.

function registerZeroBalanceGroupRemovalRoutes(app, dependencies) {
  const previews = new Map();
  const operations = new Map();
  let latestOperationId = null;
  let operationInFlight = false;

  const {
    db,
    requireOwnerAdmin,
    adminMutationLimiter,
    adminReadLimiter,
    configuredRuntimeGroupId,
    isConfiguredGroup,
    isReady,
    getConnectionGeneration,
    readGroupRemovalContext,
    readGroupSnapshot,
    connectedBotPhone,
    serializedWhatsappUserId,
    phoneWithCountry,
    isValidJordanPhone,
    isBlockedPhone,
    isProtectedOwnerIdentity,
    audit,
    now,
  } = dependencies;

  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const runInBackground = dependencies.runInBackground || ((work) => setImmediate(() => { void work(); }));
  const removeRpcTimeoutMs = Number(dependencies.removeRpcTimeoutMs) > 0 ? Number(dependencies.removeRpcTimeoutMs) : 60000;

  let storageError = null;
  let persistOperationStatement = null;
  let findOperationStatement = null;
  let latestOperationStatement = null;
  let recentOperationsStatement = null;
  let interruptedOperationsStatement = null;
  let unresolvedOperationsStatement = null;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS group_zero_balance_removal_operations (
      operation_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      requested INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      removed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      unknown INTEGER NOT NULL DEFAULT 0,
      audit_failure TEXT,
      results_json TEXT NOT NULL DEFAULT '[]',
      account_mutation INTEGER NOT NULL DEFAULT 0,
      financial_mutation INTEGER NOT NULL DEFAULT 0
    )`);
    persistOperationStatement = db.prepare(`INSERT INTO group_zero_balance_removal_operations (
      operation_id, group_id, status, created_at, updated_at, started_at, finished_at,
      requested, completed, removed, failed, skipped, unknown, audit_failure,
      results_json, account_mutation, financial_mutation
    ) VALUES (
      @operation_id, @group_id, @status, @created_at, @updated_at, @started_at, @finished_at,
      @requested, @completed, @removed, @failed, @skipped, @unknown, @audit_failure,
      @results_json, 0, 0
    ) ON CONFLICT(operation_id) DO UPDATE SET
      group_id=excluded.group_id, status=excluded.status, updated_at=excluded.updated_at,
      started_at=excluded.started_at, finished_at=excluded.finished_at,
      requested=excluded.requested, completed=excluded.completed, removed=excluded.removed,
      failed=excluded.failed, skipped=excluded.skipped, unknown=excluded.unknown,
      audit_failure=excluded.audit_failure, results_json=excluded.results_json,
      account_mutation=0, financial_mutation=0`);
    findOperationStatement = db.prepare("SELECT * FROM group_zero_balance_removal_operations WHERE operation_id=? LIMIT 1");
    latestOperationStatement = db.prepare("SELECT * FROM group_zero_balance_removal_operations ORDER BY rowid DESC LIMIT 1");
    recentOperationsStatement = db.prepare("SELECT * FROM group_zero_balance_removal_operations ORDER BY rowid DESC LIMIT 5");
    interruptedOperationsStatement = db.prepare("SELECT * FROM group_zero_balance_removal_operations WHERE status IN ('queued','running') ORDER BY rowid ASC");
    unresolvedOperationsStatement = db.prepare("SELECT operation_id, status, unknown, results_json FROM group_zero_balance_removal_operations WHERE unknown > 0 OR status='uncertain' ORDER BY rowid ASC");
  } catch (error) {
    storageError = error;
  }

  function operationFromRow(row) {
    if (!row) return null;
    let results = [];
    try { results = JSON.parse(String(row.results_json || "[]")); } catch (_) {}
    if (!Array.isArray(results)) results = [];
    return {
      operationId: String(row.operation_id),
      groupId: String(row.group_id),
      status: String(row.status),
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      requested: Number(row.requested) || 0,
      completed: Number(row.completed) || 0,
      removed: Number(row.removed) || 0,
      failed: Number(row.failed) || 0,
      skipped: Number(row.skipped) || 0,
      unknown: Number(row.unknown) || 0,
      auditFailure: row.audit_failure ? String(row.audit_failure) : null,
      results,
      candidates: [],
      groupMembershipOnly: true,
      accountMutation: false,
      financialMutation: false,
    };
  }

  function persistOperation(operation) {
    if (!persistOperationStatement) throw storageError || new Error("سجل عمليات القروب غير متاح");
    const updatedAt = String(now());
    operation.updatedAt = updatedAt;
    persistOperationStatement.run({
      operation_id: operation.operationId,
      group_id: operation.groupId,
      status: operation.status,
      created_at: operation.createdAt || updatedAt,
      updated_at: updatedAt,
      started_at: operation.startedAt || null,
      finished_at: operation.finishedAt || null,
      requested: Number(operation.requested) || 0,
      completed: Number(operation.completed) || 0,
      removed: Number(operation.removed) || 0,
      failed: Number(operation.failed) || 0,
      skipped: Number(operation.skipped) || 0,
      unknown: Number(operation.unknown) || 0,
      audit_failure: operation.auditFailure || null,
      results_json: JSON.stringify(operation.results || []),
    });
  }

  function restoreInterruptedOperations() {
    if (!recentOperationsStatement || !interruptedOperationsStatement) return;
    const recentRows = recentOperationsStatement.all();
    const interruptedRows = interruptedOperationsStatement.all();
    for (const row of interruptedRows) {
      const operation = operationFromRow(row);
      for (const result of operation.results) {
        if (result.status === "removing") {
          result.status = "unknown";
          result.error = "انقطعت الخدمة أثناء طلب الإزالة؛ تحقّق يدويًا من عضوية القروب";
        } else if (result.status === "pending") {
          result.status = "skipped";
          result.error = "توقفت العملية بسبب إعادة تشغيل الخدمة قبل المحاولة";
        }
      }
      operation.unknown = operation.results.filter((result) => result.status === "unknown").length;
      operation.skipped = operation.results.filter((result) => result.status === "skipped").length;
      operation.completed = operation.results.filter((result) => result.status !== "pending" && result.status !== "removing").length;
      operation.status = operation.unknown ? "uncertain" : "stopped";
      operation.finishedAt = String(now());
      operation.auditFailure = "أعيد تشغيل الخدمة أثناء العملية؛ تم استرجاع حالتها من السجل الدائم";
      persistOperation(operation);
      operations.set(operation.operationId, operation);
    }
    for (const row of recentRows.slice().reverse()) {
      const operation = operationFromRow(row);
      if (!operations.has(operation.operationId)) operations.set(operation.operationId, operation);
    }
    latestOperationId = latestOperationStatement.get()?.operation_id ? String(latestOperationStatement.get().operation_id) : null;
  }

  try {
    restoreInterruptedOperations();
  } catch (error) {
    storageError = error;
  }

  function normalizePhone(value) {
    const phone = phoneWithCountry(String(value || ""));
    if (!phone || !isValidJordanPhone(phone) || isBlockedPhone(phone)) return "";
    return phone;
  }

  function auditSafely(event, entityType, entityId, details) {
    try {
      audit(event, entityType, entityId, details);
    } catch (_) {}
  }

  function routeError(res, status, error, extra = {}) {
    return res.status(status).json({ success: false, mutation: "none", financialMutation: false, accountMutation: false, error, ...extra });
  }

  function operationForStatus(operationId) {
    if (operationId && operations.has(operationId)) return operations.get(operationId);
    if (!findOperationStatement || !latestOperationStatement) return null;
    const row = operationId ? findOperationStatement.get(operationId) : latestOperationStatement.get();
    const operation = operationFromRow(row);
    if (operation) operations.set(operation.operationId, operation);
    return operation;
  }

  function publicOperation(operation) {
    if (!operation) return null;
    return {
      operationId: operation.operationId,
      groupId: operation.groupId,
      status: operation.status,
      createdAt: operation.createdAt || null,
      updatedAt: operation.updatedAt || null,
      startedAt: operation.startedAt || null,
      finishedAt: operation.finishedAt || null,
      requested: Number(operation.requested) || 0,
      completed: Number(operation.completed) || 0,
      removed: Number(operation.removed) || 0,
      failed: Number(operation.failed) || 0,
      skipped: Number(operation.skipped) || 0,
      unknown: Number(operation.unknown) || 0,
      auditFailure: operation.auditFailure || null,
      results: Array.isArray(operation.results) ? operation.results : [],
      groupMembershipOnly: true,
      accountMutation: false,
      financialMutation: false,
    };
  }

  function tryAudit(event, entityType, entityId, details) {
    try {
      audit(event, entityType, entityId, details);
      return null;
    } catch (error) {
      return error;
    }
  }

  function getOfficialGroup(req) {
    const configuredId = String(configuredRuntimeGroupId() || "").trim();
    const requestedId = String(req.body?.groupId || configuredId).trim();
    if (!configuredId || !isConfiguredGroup(configuredId)) return { error: "القروب الرسمي غير مضبوط", status: 409 };
    if (requestedId !== configuredId || !isConfiguredGroup(requestedId)) return { error: "يسمح بهذا الإجراء للقروب الرسمي المكوّن فقط", status: 403 };
    return { groupId: configuredId };
  }

  function previousUnknownTargets() {
    if (!unresolvedOperationsStatement) throw storageError || new Error("سجل نتائج الإزالة غير المحسومة غير متاح");
    const targets = new Map();
    for (const row of unresolvedOperationsStatement.all()) {
      let results = [];
      try { results = JSON.parse(String(row.results_json || "[]")); } catch (_) {}
      if (!Array.isArray(results)) results = [];
      const unknownResults = results.filter((result) => String(result?.status || "") === "unknown");
      const rawUnknownCount = Number(row.unknown);
      const unknownCount = Number.isSafeInteger(rawUnknownCount) && rawUnknownCount > 0 ? rawUnknownCount : 0;
      const targetCount = Math.max(unknownCount, unknownResults.length);
      const operationId = String(row.operation_id || "unknown-operation");
      const hasNoUnknownEvidence = targetCount === 0
        && (String(row.status || "") === "uncertain" || rawUnknownCount !== 0);
      if (hasNoUnknownEvidence) {
        targets.set(`unidentified:${operationId}:uncertain`, { captainId: 0, phone: "", participantId: "", unidentified: true });
      }
      for (let index = 0; index < targetCount; index += 1) {
        const result = unknownResults[index] || {};
        const captainId = Number(result.captainId) > 0 ? Number(result.captainId) : 0;
        const phone = normalizePhone(result.phone);
        const participantId = serializedWhatsappUserId(result.participantId);
        const unidentified = !captainId && !phone && !participantId;
        const key = phone ? `phone:${phone}`
          : participantId ? `participant:${participantId}`
            : captainId ? `captain:${captainId}`
              : `unidentified:${operationId}:${index}`;
        targets.set(key, { captainId, phone, participantId, unidentified });
      }
    }
    return [...targets.values()];
  }

  function summarizePreviousUnknownOverlap(candidates) {
    const targets = previousUnknownTargets();
    const unidentifiedCount = targets.filter((target) => target.unidentified).length;
    const overlappingCaptainIds = new Set();
    for (const candidate of candidates) {
      const overlaps = unidentifiedCount > 0 || targets.some((target) =>
        (target.captainId && target.captainId === Number(candidate.captainId))
        || (target.phone && target.phone === candidate.phone)
        || (target.participantId && target.participantId === candidate.participantId));
      if (overlaps) overlappingCaptainIds.add(Number(candidate.captainId));
    }
    return {
      previousUnknownTargets: targets.length,
      previousUnknownOverlap: overlappingCaptainIds.size,
      previousUnknownUnidentified: unidentifiedCount,
    };
  }

  function userRows() {
    return db.prepare(`
      SELECT id, phone, name, registration_name, wallet_cents, is_bot, role, account_status
      FROM users
      WHERE role='captain' AND is_bot=0
    `).all();
  }

  function getUserById(id) {
    return db.prepare(`
      SELECT id, phone, name, registration_name, wallet_cents, is_bot, role, account_status
      FROM users WHERE id=? LIMIT 1
    `).get(id);
  }

  async function resolveLiveGroup(groupId) {
    if (!isReady()) throw Object.assign(new Error("WhatsApp غير جاهز حاليًا"), { status: 503 });
    const connectionGeneration = getConnectionGeneration();
    const [context, snapshot] = await Promise.all([
      readGroupRemovalContext(groupId).catch(() => null),
      readGroupSnapshot(groupId).catch(() => null),
    ]);
    if (!isReady() || getConnectionGeneration() !== connectionGeneration) {
      throw Object.assign(new Error("تغير اتصال WhatsApp أثناء قراءة القروب؛ أعد المحاولة بعد استقرار الاتصال"), { status: 409 });
    }
    if (!context || !context.chat || typeof context.chat.removeParticipants !== "function" || !(context.phoneToParticipantId instanceof Map)) {
      throw Object.assign(new Error("تعذرت قراءة أعضاء القروب الرسمي بأمان"), { status: 503 });
    }
    if (!snapshot || snapshot.isGroup !== true || snapshot.id !== groupId || !Array.isArray(snapshot.participants)) {
      throw Object.assign(new Error("تعذر التحقق من لقطة القروب الرسمي"), { status: 503 });
    }
    const participantIds = new Set((context.participantIds || []).map((id) => serializedWhatsappUserId(id)).filter(Boolean));
    const snapshotParticipants = new Map();
    for (const participant of snapshot.participants) {
      const id = serializedWhatsappUserId(participant?.id || participant);
      if (id) snapshotParticipants.set(id, participant);
    }
    const phoneParticipantIds = new Map();
    for (const [rawPhone, rawId] of context.phoneToParticipantId.entries()) {
      const phone = normalizePhone(rawPhone);
      const id = serializedWhatsappUserId(rawId);
      if (!phone || !id || !participantIds.has(id) || !snapshotParticipants.has(id)) continue;
      const ids = phoneParticipantIds.get(phone) || [];
      if (!ids.includes(id)) ids.push(id);
      phoneParticipantIds.set(phone, ids);
    }

    const botPhone = normalizePhone(connectedBotPhone());
    const botIds = botPhone ? phoneParticipantIds.get(botPhone) || [] : [];
    const botIsAdmin = botIds.some((id) => Boolean(snapshotParticipants.get(id)?.isAdmin));
    if (!botPhone || botIds.length !== 1 || !botIsAdmin) {
      throw Object.assign(new Error("يلزم أن يكون حساب البوت المعروف مديرًا في القروب الرسمي لإجراء الإزالة"), { status: 409 });
    }

    const adminIds = new Set(
      [...snapshotParticipants.entries()]
        .filter(([, participant]) => Boolean(participant?.isAdmin || participant?.isSuperAdmin))
        .map(([id]) => id),
    );
    return { groupId, context, snapshot, connectionGeneration, participantIds, snapshotParticipants, phoneParticipantIds, adminIds, botPhone };
  }

  function computeCandidates(liveGroup) {
    const captainsByPhone = new Map();
    for (const row of userRows()) {
      if (row.role !== "captain" || Number(row.is_bot) !== 0 || row.account_status === "merged") continue;
      const phone = normalizePhone(row.phone);
      if (!phone) continue;
      const rows = captainsByPhone.get(phone) || [];
      rows.push(row);
      captainsByPhone.set(phone, rows);
    }

    const candidates = [];
    const skipped = { protected: 0, admins: 0, unresolved: 0, ambiguous: 0, noCaptainAccount: 0, nonZeroBalance: 0 };
    const resolvedIds = new Set();
    for (const [phone, ids] of liveGroup.phoneParticipantIds.entries()) {
      for (const id of ids) resolvedIds.add(id);
      if (ids.length !== 1) {
        skipped.ambiguous += 1;
        continue;
      }
      const participantId = ids[0];
      if (liveGroup.adminIds.has(participantId)) {
        skipped.admins += 1;
        continue;
      }
      if (isProtectedOwnerIdentity(phone)) {
        skipped.protected += 1;
        continue;
      }
      const rows = captainsByPhone.get(phone) || [];
      if (rows.length !== 1) {
        if (rows.length > 1) skipped.ambiguous += 1;
        else skipped.noCaptainAccount += 1;
        continue;
      }
      const user = rows[0];
      if (Number(user.wallet_cents) !== 0) {
        skipped.nonZeroBalance += 1;
        continue;
      }
      candidates.push({
        captainId: Number(user.id),
        phone,
        name: String(user.registration_name || user.name || `كابتن ${user.id}`).trim(),
        walletCents: Number(user.wallet_cents),
        participantId,
      });
    }
    skipped.unresolved = Math.max(0, liveGroup.participantIds.size - resolvedIds.size);
    candidates.sort((a, b) => a.captainId - b.captainId);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      groupId: liveGroup.groupId,
      connectionGeneration: liveGroup.connectionGeneration,
      candidates: candidates.map(({ captainId, phone, participantId, walletCents }) => ({ captainId, phone, participantId, walletCents })),
    })).digest("hex");
    return { candidates, skipped, fingerprint };
  }

  function publicCandidate(candidate) {
    return { captainId: candidate.captainId, name: candidate.name, phone: candidate.phone, balance: "0.00 JOD" };
  }

  function cleanupPreviews() {
    const currentTime = Date.now();
    for (const [id, preview] of previews.entries()) {
      if (preview.expiresAtMs <= currentTime) previews.delete(id);
    }
  }

  function compactOperations() {
    while (operations.size > 5) {
      const oldest = operations.keys().next().value;
      if (oldest === latestOperationId) break;
      operations.delete(oldest);
    }
  }

  app.post("/api/admin/group/zero-balance-removals/preview", requireOwnerAdmin, adminMutationLimiter, async (req, res) => {
    cleanupPreviews();
    if (storageError) return routeError(res, 503, "سجل عمليات الإزالة غير متاح؛ لم تبدأ أي عملية");
    const target = getOfficialGroup(req);
    if (target.error) return routeError(res, target.status, target.error);
    if (operationInFlight) return routeError(res, 409, "توجد عملية إزالة من القروب قيد التنفيذ؛ انتظر انتهائها أولًا", { operationId: latestOperationId });
    try {
      const liveGroup = await resolveLiveGroup(target.groupId);
      const { candidates, skipped, fingerprint } = computeCandidates(liveGroup);
      if (candidates.length > MAX_CANDIDATES) return routeError(res, 413, "عدد المرشحين يتجاوز الحد الآمن للعملية الواحدة", { candidateCount: candidates.length, maxCandidates: MAX_CANDIDATES });
      const previewId = crypto.randomBytes(24).toString("base64url");
      const generatedAt = String(now());
      const expiresAtMs = Date.now() + PREVIEW_TTL_MS;
      const priorUnknown = summarizePreviousUnknownOverlap(candidates);
      const summary = { count: candidates.length, ...skipped, totalGroupMembers: liveGroup.snapshot.participants.length, ...priorUnknown };
      const preview = { previewId, groupId: target.groupId, generatedAt, expiresAtMs, connectionGeneration: liveGroup.connectionGeneration, fingerprint, candidates, summary };
      previews.set(previewId, preview);
      auditSafely("group.zero_balance_members_removal.previewed", "group", target.groupId, {
        previewId,
        fingerprint,
        ...summary,
        mutation: "none",
        financialMutation: false,
        accountMutation: false,
      });
      return res.json({
        success: true,
        mutation: "none",
        financialMutation: false,
        accountMutation: false,
        previewId,
        groupId: target.groupId,
        groupName: liveGroup.snapshot.name || null,
        generatedAt,
        expiresAt: new Date(expiresAtMs).toISOString(),
        fingerprint,
        summary,
        candidates: candidates.map(publicCandidate),
        warning: "هذه معاينة فقط؛ سيُزال الأعضاء المعروضون من عضوية القروب الرسمي فقط. الحسابات والمحافظ والسجلات ستبقى دون تغيير.",
      });
    } catch (error) {
      return routeError(res, Number(error.status) || 503, String(error.message || "تعذرت معاينة القروب"));
    }
  });

  async function runOperation(operation) {
    operation.status = "running";
    operation.startedAt = operation.startedAt || String(now());
    persistOperation(operation);

    const completedCount = () => operation.results.filter((entry) => entry.status !== "pending" && entry.status !== "removing").length;
    const updateCounts = () => {
      operation.completed = completedCount();
      operation.skipped = operation.results.filter((entry) => entry.status === "skipped").length;
      operation.unknown = operation.results.filter((entry) => entry.status === "unknown").length;
    };
    const stopPending = (fromIndex, reason) => {
      for (let pending = fromIndex; pending < operation.results.length; pending += 1) {
        if (operation.results[pending].status === "pending") {
          operation.results[pending].status = "skipped";
          operation.results[pending].error = reason;
        }
      }
      updateCounts();
      persistOperation(operation);
    };
    const setAuditFailure = (error) => {
      operation.auditFailure = String(error?.message || error || "تعذر تسجيل التدقيق").slice(0, 240);
    };
    const auditOrStop = (event, entityType, entityId, details) => {
      const error = tryAudit(event, entityType, entityId, details);
      if (error) setAuditFailure(error);
      return !error;
    };
    const unknownResult = (candidate, result, reason) => {
      result.status = "unknown";
      result.error = String(reason || "تعذر تأكيد نتيجة طلب الإزالة").slice(0, 240);
      updateCounts();
      persistOperation(operation);
      auditOrStop("group.zero_balance_member.removal_unknown", "user", candidate.captainId, {
        operationId: operation.operationId,
        groupId: operation.groupId,
        phone: candidate.phone,
        participantId: candidate.participantId,
        error: result.error,
        groupMembershipChanged: "unknown",
        accountMutation: false,
        financialMutation: false,
      });
    };

    try {
      for (let index = 0; index < operation.candidates.length; index += 1) {
        const candidate = operation.candidates[index];
        const result = operation.results[index];
        if (result.status !== "pending") continue;
        if (!isReady() || getConnectionGeneration() !== operation.connectionGeneration || configuredRuntimeGroupId() !== operation.groupId || !isConfiguredGroup(operation.groupId)) {
          stopPending(index, "تغيّر اتصال WhatsApp أو القروب الرسمي؛ أوقفت العملية بأمان");
          break;
        }

        let removalAttempted = false;
        try {
          const liveGroup = await resolveLiveGroup(operation.groupId);
          if (liveGroup.connectionGeneration !== operation.connectionGeneration) throw new Error("تغيّر اتصال WhatsApp أثناء قراءة القروب");
          const currentIds = liveGroup.phoneParticipantIds.get(candidate.phone) || [];
          if (currentIds.length !== 1 || currentIds[0] !== candidate.participantId) {
            result.status = "skipped";
            result.error = "لم تعد هوية العضو مطابقة للمعاينة أو لم يعد في القروب";
          } else if (liveGroup.adminIds.has(candidate.participantId) || isProtectedOwnerIdentity(candidate.phone)) {
            result.status = "skipped";
            result.error = "العضو مدير أو هوية محمية؛ تم تخطيه";
          } else {
            const user = getUserById(candidate.captainId);
            if (!user || user.role !== "captain" || Number(user.is_bot) !== 0 || user.account_status === "merged" || normalizePhone(user.phone) !== candidate.phone || Number(user.wallet_cents) !== 0) {
              result.status = "skipped";
              result.error = "تغير الحساب أو لم يعد رصيده يساوي 0.00 JOD؛ تم تخطيه";
            } else if (!isReady() || getConnectionGeneration() !== operation.connectionGeneration || configuredRuntimeGroupId() !== operation.groupId || !isConfiguredGroup(operation.groupId)) {
              result.status = "skipped";
              result.error = "تغير اتصال WhatsApp أو القروب الرسمي قبل الإزالة؛ لم يُرسل طلب إزالة";
              stopPending(index + 1, "أوقفت العملية قبل محاولة الإزالة");
            } else {
              result.status = "removing";
              updateCounts();
              persistOperation(operation);
              const auditReady = auditOrStop("group.zero_balance_member.removal_requested", "user", candidate.captainId, {
                operationId: operation.operationId,
                groupId: operation.groupId,
                phone: candidate.phone,
                participantId: candidate.participantId,
                walletCents: 0,
                accountMutation: false,
                financialMutation: false,
              });
              if (!auditReady) {
                result.status = "failed";
                result.error = "تعذر تسجيل التدقيق؛ لم يُرسل طلب الإزالة";
                operation.failed += 1;
                stopPending(index + 1, "أوقفت العملية بسبب فشل سجل التدقيق");
              } else if (!isReady() || getConnectionGeneration() !== liveGroup.connectionGeneration || configuredRuntimeGroupId() !== operation.groupId || !isConfiguredGroup(operation.groupId)) {
                result.status = "skipped";
                result.error = "تغير اتصال WhatsApp أو القروب الرسمي قبل الإزالة؛ لم يُرسل طلب إزالة";
                stopPending(index + 1, "أوقفت العملية قبل محاولة الإزالة");
              } else {
                removalAttempted = true;
                let timeoutId;
                const removalPromise = liveGroup.context.chat.removeParticipants([candidate.participantId]);
                const request = Promise.resolve(removalPromise)
                  .then((value) => ({ kind: "resolved", value }), (error) => ({ kind: "rejected", error }));
                const timeout = new Promise((resolve) => {
                  timeoutId = setTimeout(() => resolve({ kind: "timeout" }), removeRpcTimeoutMs);
                });
                const rpcOutcome = await Promise.race([request, timeout]);
                if (timeoutId) clearTimeout(timeoutId);

                const verified = await resolveLiveGroup(operation.groupId);
                if (verified.connectionGeneration !== operation.connectionGeneration) throw new Error("تغير اتصال WhatsApp بعد إرسال طلب الإزالة");
                const remainingIds = verified.phoneParticipantIds.get(candidate.phone) || [];
                const removedIds = [...liveGroup.participantIds].filter((id) => !verified.participantIds.has(id));
                const addedIds = [...verified.participantIds].filter((id) => !liveGroup.participantIds.has(id));
                const confirmedRemoved = remainingIds.length === 0
                  && !verified.participantIds.has(candidate.participantId)
                  && !verified.snapshotParticipants.has(candidate.participantId)
                  && removedIds.length === 1
                  && removedIds[0] === candidate.participantId
                  && addedIds.length === 0;

                if (confirmedRemoved) {
                  result.status = "removed";
                  result.error = null;
                  operation.removed += 1;
                  updateCounts();
                  persistOperation(operation);
                  const auditReadyAfter = auditOrStop("group.zero_balance_member.removed", "user", candidate.captainId, {
                    operationId: operation.operationId,
                    groupId: operation.groupId,
                    phone: candidate.phone,
                    participantId: candidate.participantId,
                    rpcOutcome: rpcOutcome.kind,
                    groupMembershipChanged: true,
                    accountMutation: false,
                    financialMutation: false,
                    settlementMutation: false,
                    orderMutation: false,
                    whatsappMessageSentByApplication: false,
                  });
                  if (!auditReadyAfter) stopPending(index + 1, "أوقفت العملية بعد الإزالة المؤكدة بسبب فشل سجل التدقيق");
                } else {
                  const reason = rpcOutcome.kind === "timeout"
                    ? "انتهت مهلة WhatsApp وقد يكتمل الطلب لاحقًا؛ لم يمكن تأكيد العضوية"
                    : rpcOutcome.kind === "rejected"
                      ? `رفض/تعذر طلب WhatsApp وقد يكون أثره غير محسوم: ${String(rpcOutcome.error?.message || rpcOutcome.error || "خطأ غير معروف")}`
                      : `استجاب WhatsApp لكن لقطة القروب لم تؤكد إزالة هذا العضو وحده${rpcOutcome.value?.status ? ` (status ${rpcOutcome.value.status})` : ""}`;
                  unknownResult(candidate, result, reason);
                  stopPending(index + 1, "توقفت العملية لأن نتيجة الإزالة السابقة غير محسومة؛ تحقق من القروب قبل إجراء آخر");
                  break;
                }
              }
            }
          }

          if (result.status === "skipped") {
            updateCounts();
            persistOperation(operation);
            const skipAuditReady = auditOrStop("group.zero_balance_member.removal_skipped", "user", candidate.captainId, {
              operationId: operation.operationId,
              groupId: operation.groupId,
              phone: candidate.phone,
              reason: result.error,
              accountMutation: false,
              financialMutation: false,
            });
            if (!skipAuditReady) {
              stopPending(index + 1, "أوقفت العملية بسبب فشل سجل التدقيق");
              break;
            }
          }
          if (operation.auditFailure) break;
        } catch (error) {
          if (removalAttempted) {
            unknownResult(candidate, result, `تعذر تأكيد نتيجة طلب الإزالة: ${String(error?.message || error).slice(0, 180)}`);
            stopPending(index + 1, "توقفت العملية لأن نتيجة الإزالة السابقة غير محسومة؛ تحقق من القروب قبل إجراء آخر");
            break;
          }
          if (result.status === "removing") {
            result.status = "failed";
            result.error = `لم يُرسل طلب الإزالة: ${String(error?.message || error).slice(0, 180)}`;
            operation.failed += 1;
            setAuditFailure(error);
          } else {
            result.status = "skipped";
            result.error = String(error?.message || error).slice(0, 180);
          }
          updateCounts();
          try { persistOperation(operation); } catch (_) {}
          stopPending(index + 1, "توقفت العملية بسبب تعذر التحقق أو التسجيل");
          break;
        }

        updateCounts();
        persistOperation(operation);
        if (index + 1 < operation.candidates.length && !operation.auditFailure) await sleep(OPERATION_DELAY_MS);
        if (operation.auditFailure) break;
      }

      updateCounts();
      operation.status = operation.unknown
        ? (operation.removed || operation.failed ? "partial" : "uncertain")
        : operation.failed
          ? (operation.removed ? "partial" : "failed")
          : operation.skipped
            ? (operation.removed ? "partial" : "stopped")
            : "succeeded";
      operation.finishedAt = String(now());
      persistOperation(operation);
      const finalAuditError = tryAudit("group.zero_balance_members_removal.finished", "group", operation.groupId, {
        operationId: operation.operationId,
        status: operation.status,
        requested: operation.requested,
        removed: operation.removed,
        failed: operation.failed,
        skipped: operation.skipped,
        unknown: operation.unknown,
        groupMembershipOnly: true,
        accountMutation: false,
        financialMutation: false,
      });
      if (finalAuditError) {
        setAuditFailure(finalAuditError);
        persistOperation(operation);
      }
    } finally {
      operationInFlight = false;
    }
  }
  app.post("/api/admin/group/zero-balance-removals/execute", requireOwnerAdmin, adminMutationLimiter, async (req, res) => {
    cleanupPreviews();
    if (storageError) return routeError(res, 503, "سجل عمليات الإزالة غير متاح؛ لم تبدأ أي عملية");
    const target = getOfficialGroup(req);
    if (target.error) return routeError(res, target.status, target.error);
    if (operationInFlight) return routeError(res, 409, "توجد عملية إزالة من القروب قيد التنفيذ؛ انتظر انتهائها أولًا", { operationId: latestOperationId });
    const previewId = String(req.body?.previewId || "");
    const preview = previews.get(previewId);
    const expectedCount = Number(req.body?.expectedCount);
    const confirmation = String(req.body?.confirmation || "");
    const suppliedFingerprint = String(req.body?.fingerprint || "");
    if (!preview || preview.expiresAtMs <= Date.now()) return routeError(res, 409, "انتهت المعاينة أو لم تعد متاحة؛ أنشئ معاينة جديدة");
    if (preview.groupId !== target.groupId || preview.connectionGeneration !== getConnectionGeneration()) return routeError(res, 409, "تغير القروب أو اتصال WhatsApp منذ المعاينة؛ أنشئ معاينة جديدة");
    if (confirmation !== CONFIRMATION || !Number.isInteger(expectedCount) || expectedCount !== preview.candidates.length || suppliedFingerprint !== preview.fingerprint) {
      return routeError(res, 400, "عبارة التأكيد أو العدد أو بصمة المعاينة غير مطابقة");
    }
    if (expectedCount < 1) return routeError(res, 400, "لا يوجد أعضاء مؤهلون للإزالة");
    const previewSummary = preview.summary || {};
    if (["unresolved", "ambiguous", "protected"].some((key) => Number(previewSummary[key]) > 0)) {
      return routeError(res, 409, "تتضمن المعاينة هوية غير محسومة أو ملتبسة أو محمية؛ لم تبدأ الإزالة");
    }
    let priorUnknown;
    try { priorUnknown = summarizePreviousUnknownOverlap(preview.candidates); }
    catch (error) { return routeError(res, 503, "تعذر فحص نتائج إزالة سابقة غير محسومة؛ لم تبدأ الإزالة"); }
    if (priorUnknown.previousUnknownOverlap > 0 || priorUnknown.previousUnknownUnidentified > 0) {
      return routeError(res, 409, "تتضمن المعاينة هدفًا من عملية سابقة غير محسومة أو تعذر تحديد هويته؛ لم تبدأ الإزالة", priorUnknown);
    }
    if (preview.consumedAt || preview.processing) return routeError(res, 409, "استُخدمت هذه المعاينة أو يجري التحقق منها؛ أنشئ معاينة جديدة");

    preview.processing = true;
    operationInFlight = true;
    try {
      const liveGroup = await resolveLiveGroup(target.groupId);
      const current = computeCandidates(liveGroup);
      const currentUnknown = summarizePreviousUnknownOverlap(current.candidates);
      const currentUnsafe = Number(current.skipped.unresolved) > 0 || Number(current.skipped.ambiguous) > 0 || Number(current.skipped.protected) > 0;
      if (currentUnsafe || currentUnknown.previousUnknownOverlap > 0 || currentUnknown.previousUnknownUnidentified > 0) {
        previews.delete(previewId);
        operationInFlight = false;
        return routeError(res, 409, "تغيرت حالة الهوية أو ظهر هدف سابق غير محسوم؛ لم تبدأ الإزالة", { ...current.skipped, ...currentUnknown });
      }
      if (current.fingerprint !== preview.fingerprint || current.candidates.length !== expectedCount) {
        previews.delete(previewId);
        operationInFlight = false;
        return routeError(res, 409, "تغير الرصيد أو أعضاء القروب منذ المعاينة؛ لم تبدأ الإزالة، أنشئ معاينة جديدة");
      }
    } catch (error) {
      preview.processing = false;
      operationInFlight = false;
      return routeError(res, Number(error.status) || 503, String(error.message || "تعذر إعادة التحقق من القروب"));
    }

    preview.consumedAt = String(now());
    preview.processing = false;
    const operationId = `ZBGR-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const operation = {
      operationId,
      previewId,
      groupId: target.groupId,
      status: "queued",
      createdAt: String(now()),
      updatedAt: null,
      startedAt: null,
      finishedAt: null,
      requested: preview.candidates.length,
      completed: 0,
      removed: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
      auditFailure: null,
      candidates: preview.candidates.map((candidate) => ({ ...candidate })),
      results: preview.candidates.map((candidate) => ({ captainId: candidate.captainId, name: candidate.name, phone: candidate.phone, status: "pending", error: null })),
      connectionGeneration: preview.connectionGeneration,
      groupMembershipOnly: true,
      accountMutation: false,
      financialMutation: false,
    };
    try {
      persistOperation(operation);
    } catch (error) {
      operationInFlight = false;
      return routeError(res, 503, "تعذر حفظ سجل العملية؛ لم يبدأ طلب الإزالة");
    }
    operations.set(operationId, operation);
    latestOperationId = operationId;
    compactOperations();
    const startAuditError = tryAudit("group.zero_balance_members_removal.started", "group", target.groupId, {
      operationId,
      previewId,
      fingerprint: preview.fingerprint,
      requested: operation.requested,
      groupMembershipOnly: true,
      accountMutation: false,
      financialMutation: false,
    });
    if (startAuditError) {
      operation.status = "stopped";
      operation.finishedAt = String(now());
      operation.auditFailure = String(startAuditError.message || startAuditError).slice(0, 240);
      for (const result of operation.results) {
        result.status = "skipped";
        result.error = "تعذر تسجيل التدقيق؛ لم يبدأ طلب الإزالة";
      }
      operation.skipped = operation.requested;
      operation.completed = operation.requested;
      try { persistOperation(operation); } catch (_) {}
      operationInFlight = false;
      return routeError(res, 503, "تعذر تسجيل التدقيق؛ لم تبدأ الإزالة", { operationId, operation: publicOperation(operation) });
    }
    try {
      runInBackground(() => runOperation(operation).catch((error) => {
        const message = String(error?.message || error).slice(0, 240);
        for (const result of operation.results) {
          if (result.status === "removing") {
            result.status = "unknown";
            result.error = `تعذر إنهاء العملية والتحقق من النتيجة: ${message}`;
          } else if (result.status === "pending") {
            result.status = "skipped";
            result.error = message;
          }
        }
        operation.completed = operation.results.filter((entry) => entry.status !== "pending" && entry.status !== "removing").length;
        operation.skipped = operation.results.filter((entry) => entry.status === "skipped").length;
        operation.unknown = operation.results.filter((entry) => entry.status === "unknown").length;
        operation.status = operation.unknown ? (operation.removed || operation.failed ? "partial" : "uncertain") : operation.removed ? "partial" : operation.failed ? "failed" : "stopped";
        operation.finishedAt = String(now());
        operation.auditFailure = operation.auditFailure || message;
        try { persistOperation(operation); } catch (_) {}
        operationInFlight = false;
        tryAudit("group.zero_balance_members_removal.unexpected_failure", "group", operation.groupId, {
          operationId,
          error: message,
          removed: operation.removed,
          failed: operation.failed,
          skipped: operation.skipped,
          unknown: operation.unknown,
          accountMutation: false,
          financialMutation: false,
        });
      }));
    } catch (error) {
      operation.status = "failed";
      operation.finishedAt = String(now());
      operation.auditFailure = String(error?.message || error).slice(0, 240);
      operation.results.forEach((result) => {
        if (result.status === "pending") { result.status = "skipped"; result.error = "تعذر جدولة العملية؛ لم يبدأ طلب الإزالة"; }
      });
      operation.skipped = operation.results.filter((result) => result.status === "skipped").length;
      operation.completed = operation.results.length;
      try { persistOperation(operation); } catch (_) {}
      operationInFlight = false;
      return routeError(res, 503, "تعذر جدولة العملية؛ لم يبدأ طلب الإزالة", { operationId, operation: publicOperation(operation) });
    }
    return res.status(202).json({ success: true, accepted: true, mutation: "group_membership_only", financialMutation: false, accountMutation: false, operationId, requested: operation.requested, status: operation.status });
  });

  app.get("/api/admin/group/zero-balance-removals/status", requireOwnerAdmin, adminReadLimiter, (req, res) => {
    if (storageError) return routeError(res, 503, "سجل عمليات الإزالة غير متاح");
    const requestedId = String(req.query?.operationId || "");
    const operation = operationForStatus(requestedId);
    if (!requestedId && operation) latestOperationId = operation.operationId;
    return res.json({ success: true, mutation: "none", financialMutation: false, accountMutation: false, operation: publicOperation(operation) });
  });
}

module.exports = { registerZeroBalanceGroupRemovalRoutes };
