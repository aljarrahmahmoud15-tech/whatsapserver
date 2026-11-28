const crypto = require("node:crypto");

function timestampMs(value) {
  if (value == null || value === "") return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function selectActivePendingCandidates(db, groupId) {
  return db.prepare(`SELECT c.id AS candidate_id,c.source_message_id,c.group_id,c.public_trip_no,c.raw_text,
      c.price_cents,c.origin,c.destination,c.trip_time,c.order_kind,c.status,c.archive_state,
      c.pending_captain_user_id,c.pending_message_id,c.pending_at,c.final_order_id,
      c.lifecycle_stage,c.lifecycle_blocker,c.created_at,c.updated_at,
      captain.name AS captain_name
    FROM order_candidates c
    JOIN users captain ON captain.id=c.pending_captain_user_id
    WHERE c.group_id=? AND c.status='pending'
      AND COALESCE(c.archive_state,'active')='active'
      AND c.pending_captain_user_id IS NOT NULL
      AND captain.role='captain' AND captain.active=1 AND captain.account_status='active'
    ORDER BY c.id ASC`).all(groupId);
}

function selectActiveOpenOrders(db, groupId) {
  return db.prepare(`SELECT o.id AS order_id,o.source_message_id,o.group_id,o.order_no,o.raw_text,
      o.price_cents,o.origin,o.destination,o.trip_time,o.status,o.archive_state,
      o.pending_captain_user_id,o.pending_message_id,o.created_at,o.updated_at,
      captain.name AS captain_name
    FROM orders o
    JOIN users captain ON captain.id=o.pending_captain_user_id
    WHERE o.group_id=? AND o.status='open'
      AND COALESCE(o.archive_state,'active')='active'
      AND o.pending_captain_user_id IS NOT NULL
      AND captain.role='captain' AND captain.active=1 AND captain.account_status='active'
    ORDER BY o.id ASC`).all(groupId);
}

function selectPendingAcceptances(db, candidateIds) {
  if (!candidateIds.length) return [];
  const placeholders = candidateIds.map(() => "?").join(",");
  return db.prepare(`SELECT a.id AS acceptance_id,a.candidate_id,a.captain_user_id,
      a.acceptance_message_id,a.acceptance_mode,a.status,a.created_at,a.updated_at,
      captain.name AS captain_name
    FROM order_candidate_acceptances a
    LEFT JOIN users captain ON captain.id=a.captain_user_id
    WHERE a.candidate_id IN (${placeholders}) AND a.status IN ('pending','selected')
    ORDER BY a.candidate_id ASC,a.id ASC`).all(...candidateIds);
}

function linkedOrderDetails(db, groupId, sourceMessageId, findEquivalentOrder) {
  const order = typeof findEquivalentOrder === "function"
    ? findEquivalentOrder(groupId, sourceMessageId)
    : db.prepare("SELECT * FROM orders WHERE group_id=? AND source_message_id=? ORDER BY id DESC LIMIT 1").get(groupId, sourceMessageId);
  if (!order) return null;
  const settlement = db.prepare("SELECT id,status,applied_at FROM order_settlements WHERE order_id=? ORDER BY id DESC LIMIT 1").get(order.id) || null;
  return {
    id: Number(order.id),
    orderNo: Number(order.order_no),
    sourceMessageId: String(order.source_message_id || ""),
    status: String(order.status || ""),
    settlementState: String(order.settlement_state || ""),
    archiveState: String(order.archive_state || "active"),
    createdAt: String(order.created_at || ""),
    updatedAt: String(order.updated_at || ""),
    settlement: settlement ? {
      id: Number(settlement.id),
      status: String(settlement.status || ""),
      appliedAt: String(settlement.applied_at || ""),
    } : null,
  };
}

function buildCaptainPendingArchiveSnapshot(db, { groupId, evaluationAt, findEquivalentOrder }) {
  const evaluationMs = timestampMs(evaluationAt);
  if (evaluationMs == null) throw new Error("A valid evaluation timestamp is required");
  const candidates = selectActivePendingCandidates(db, groupId);
  const acceptanceRows = selectPendingAcceptances(db, candidates.map((row) => Number(row.candidate_id)));
  const acceptancesByCandidate = new Map();
  for (const acceptance of acceptanceRows) {
    const key = Number(acceptance.candidate_id);
    if (!acceptancesByCandidate.has(key)) acceptancesByCandidate.set(key, []);
    acceptancesByCandidate.get(key).push(acceptance);
  }

  const classifiedCandidates = candidates.map((row) => {
    const createdMs = timestampMs(row.created_at);
    const pendingMs = timestampMs(row.pending_at);
    const linkedOrder = linkedOrderDetails(db, groupId, row.source_message_id, findEquivalentOrder);
    let protectionReason = null;
    if (createdMs == null || pendingMs == null) protectionReason = "unclassifiable_timestamp";
    else if (createdMs > evaluationMs) protectionReason = "created_after_snapshot";
    else if (pendingMs >= evaluationMs) protectionReason = "assigned_after_snapshot";
    else if (row.final_order_id != null) protectionReason = "final_order_linked";
    else if (linkedOrder?.status === "open") protectionReason = "linked_open_order";
    else if (linkedOrder) protectionReason = "linked_order_history";
    return {
      ...row,
      candidate_id: Number(row.candidate_id),
      pending_captain_user_id: Number(row.pending_captain_user_id),
      final_order_id: row.final_order_id == null ? null : Number(row.final_order_id),
      acceptances: acceptancesByCandidate.get(Number(row.candidate_id)) || [],
      linkedOrder,
      protectionReason,
    };
  });

  const allOngoingOrders = selectActiveOpenOrders(db, groupId).map((row) => {
    const createdMs = timestampMs(row.created_at);
    return {
      ...row,
      order_id: Number(row.order_id),
      order_no: Number(row.order_no),
      pending_captain_user_id: Number(row.pending_captain_user_id),
      createdAtClass: createdMs == null ? "unclassifiable" : createdMs <= evaluationMs ? "pre_snapshot" : "post_snapshot",
    };
  });
  const ongoingOrders = allOngoingOrders.filter((row) => row.createdAtClass === "pre_snapshot");
  const unclassifiableOngoingOrders = allOngoingOrders.filter((row) => row.createdAtClass === "unclassifiable");

  return {
    evaluationAt: String(evaluationAt),
    candidates: classifiedCandidates,
    archiveableCandidates: classifiedCandidates.filter((row) => row.protectionReason === null),
    protectedCandidates: classifiedCandidates.filter((row) => row.protectionReason !== null),
    ongoingOrders,
    unclassifiableOngoingOrders,
    allOngoingOrders,
  };
}

function fingerprintCaptainPendingArchiveSnapshot(groupId, snapshot) {
  const stableCandidates = snapshot.candidates.map((row) => ({
    id: Number(row.candidate_id),
    sourceMessageId: String(row.source_message_id || ""),
    groupId: String(row.group_id || ""),
    publicTripNo: row.public_trip_no == null ? null : Number(row.public_trip_no),
    rawText: String(row.raw_text || ""),
    priceCents: Number(row.price_cents || 0),
    origin: String(row.origin || ""),
    destination: String(row.destination || ""),
    tripTime: String(row.trip_time || ""),
    orderKind: String(row.order_kind || ""),
    captainName: String(row.captain_name || ""),
    status: String(row.status || ""),
    archiveState: String(row.archive_state || "active"),
    pendingCaptainUserId: Number(row.pending_captain_user_id || 0),
    pendingMessageId: String(row.pending_message_id || ""),
    pendingAt: String(row.pending_at || ""),
    finalOrderId: row.final_order_id == null ? null : Number(row.final_order_id),
    lifecycleStage: String(row.lifecycle_stage || ""),
    lifecycleBlocker: String(row.lifecycle_blocker || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    protectionReason: row.protectionReason,
    linkedOrder: row.linkedOrder,
    acceptances: row.acceptances.map((acceptance) => ({
      id: Number(acceptance.acceptance_id),
      captainUserId: Number(acceptance.captain_user_id),
      captainName: String(acceptance.captain_name || ""),
      messageId: String(acceptance.acceptance_message_id || ""),
      mode: String(acceptance.acceptance_mode || ""),
      status: String(acceptance.status || ""),
      createdAt: String(acceptance.created_at || ""),
      updatedAt: String(acceptance.updated_at || ""),
    })),
  }));
  const stableOngoingOrders = snapshot.allOngoingOrders.map((row) => ({
    id: Number(row.order_id),
    sourceMessageId: String(row.source_message_id || ""),
    groupId: String(row.group_id || ""),
    orderNo: Number(row.order_no),
    rawText: String(row.raw_text || ""),
    priceCents: Number(row.price_cents || 0),
    origin: String(row.origin || ""),
    destination: String(row.destination || ""),
    tripTime: String(row.trip_time || ""),
    captainName: String(row.captain_name || ""),
    status: String(row.status || ""),
    archiveState: String(row.archive_state || "active"),
    pendingCaptainUserId: Number(row.pending_captain_user_id || 0),
    pendingMessageId: String(row.pending_message_id || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    createdAtClass: String(row.createdAtClass || ""),
  }));
  const payload = {
    scope: "captain-pending-archive-v1",
    groupId: String(groupId || ""),
    evaluationAt: String(snapshot.evaluationAt || ""),
    candidates: stableCandidates,
    ongoingOrders: stableOngoingOrders,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function paginateById(rows, cursor, limit, idField = "candidate_id") {
  const after = Number.isSafeInteger(Number(cursor)) && Number(cursor) > 0 ? Number(cursor) : 0;
  const pageSize = Number.isInteger(Number(limit)) ? Math.max(1, Math.min(Number(limit), 250)) : 100;
  const remaining = rows.slice().sort((left, right) => Number(left[idField]) - Number(right[idField]))
    .filter((row) => Number(row[idField]) > after);
  const page = remaining.slice(0, pageSize);
  return {
    rows: page,
    nextCursor: remaining.length > page.length && page.length ? Number(page[page.length - 1][idField]) : null,
  };
}

function matchesCaptainPendingArchiveApproval(groupId, snapshot, expectedFingerprint, candidateIds) {
  if (!Array.isArray(candidateIds) || candidateIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) return false;
  const normalizedIds = candidateIds.map(Number);
  if (new Set(normalizedIds).size !== normalizedIds.length) return false;
  const expectedIds = snapshot.archiveableCandidates.map((row) => Number(row.candidate_id)).sort((a, b) => a - b);
  normalizedIds.sort((a, b) => a - b);
  return /^[a-f0-9]{64}$/i.test(String(expectedFingerprint || ""))
    && fingerprintCaptainPendingArchiveSnapshot(groupId, snapshot) === String(expectedFingerprint).toLowerCase()
    && JSON.stringify(normalizedIds) === JSON.stringify(expectedIds);
}

function archiveCaptainPendingCandidates(db, { groupId, candidates, stamp, reason, onCandidateArchived }) {
  const updateAcceptance = db.prepare(`UPDATE order_candidate_acceptances
    SET status='cancelled',updated_at=?
    WHERE id=? AND candidate_id=? AND status=?`);
  const updateCandidate = db.prepare(`UPDATE order_candidates
    SET archive_state='archived',archived_at=?,archive_reason=?,status='cancelled',
        pending_captain_user_id=NULL,pending_message_id=NULL,pending_at=NULL,
        lifecycle_stage='archived',lifecycle_blocker='admin_archived',lifecycle_updated_at=?,updated_at=?
    WHERE id=? AND group_id=? AND status='pending'
      AND COALESCE(archive_state,'active')='active'
      AND pending_captain_user_id=? AND pending_message_id IS ?
      AND pending_at=? AND created_at=? AND updated_at=? AND final_order_id IS NULL`);
  const candidateIds = [];
  for (const candidate of candidates) {
    for (const acceptance of candidate.acceptances) {
      const acceptanceUpdate = updateAcceptance.run(stamp, acceptance.acceptance_id, candidate.candidate_id, acceptance.status);
      if (acceptanceUpdate.changes !== 1) throw new Error("CAPTAIN_QUEUE_ARCHIVE_STALE_ACCEPTANCE");
    }
    const candidateUpdate = updateCandidate.run(
      stamp,
      reason,
      stamp,
      stamp,
      candidate.candidate_id,
      groupId,
      candidate.pending_captain_user_id,
      candidate.pending_message_id == null ? null : candidate.pending_message_id,
      candidate.pending_at,
      candidate.created_at,
      candidate.updated_at,
    );
    if (candidateUpdate.changes !== 1) throw new Error("CAPTAIN_QUEUE_ARCHIVE_STALE_CANDIDATE");
    candidateIds.push(Number(candidate.candidate_id));
    if (typeof onCandidateArchived === "function") onCandidateArchived(candidate);
  }
  return { archivedCount: candidateIds.length, candidateIds };
}

module.exports = {
  timestampMs,
  buildCaptainPendingArchiveSnapshot,
  fingerprintCaptainPendingArchiveSnapshot,
  paginateById,
  matchesCaptainPendingArchiveApproval,
  archiveCaptainPendingCandidates,
};
