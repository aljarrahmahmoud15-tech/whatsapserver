"use strict";

const crypto = require("crypto");
const {
  DIRECT_RIDE_LOCATION_MAX_AGE_MS,
  canTransition,
  calculateDirectRideFare,
  haversineDistanceKm,
  rankNearestCaptains,
  normalizeCoordinatePair,
  normalizeRouteEstimate,
} = require("./direct-ride-policy");

function ensureDirectRideSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS direct_ride_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_code TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      origin_lat REAL NOT NULL,
      origin_lng REAL NOT NULL,
      destination_lat REAL NOT NULL,
      destination_lng REAL NOT NULL,
      route_source TEXT NOT NULL DEFAULT 'coordinate_estimate',
      distance_km REAL NOT NULL,
      duration_min REAL NOT NULL,
      quoted_price_cents INTEGER NOT NULL,
      final_distance_km REAL,
      final_duration_min REAL,
      final_price_cents INTEGER,
      status TEXT NOT NULL CHECK(status IN ('requested','priced','rider_confirmed','dispatch_pending','offered','assigned','arrived','in_trip','completed','cancelled')) DEFAULT 'requested',
      customer_token_hash TEXT NOT NULL UNIQUE,
      customer_token_last4 TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      captain_user_id INTEGER,
      captain_name_snapshot TEXT,
      captain_phone_snapshot TEXT,
      captain_pickup_distance_km REAL,
      cancel_reason TEXT,
      requested_at TEXT NOT NULL,
      confirmed_at TEXT,
      offered_at TEXT,
      assigned_at TEXT,
      arrived_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(captain_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_direct_ride_requests_status_updated ON direct_ride_requests(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_direct_ride_requests_phone_created ON direct_ride_requests(phone, created_at DESC);
    CREATE TABLE IF NOT EXISTS direct_ride_offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id INTEGER NOT NULL,
      captain_user_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('offered','accepted','rejected','expired')) DEFAULT 'offered',
      pickup_distance_km REAL NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      offered_at TEXT NOT NULL,
      responded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(ride_id, captain_user_id),
      FOREIGN KEY(ride_id) REFERENCES direct_ride_requests(id) ON DELETE CASCADE,
      FOREIGN KEY(captain_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_direct_ride_offers_captain_status ON direct_ride_offers(captain_user_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_direct_ride_offers_ride_status ON direct_ride_offers(ride_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS direct_ride_locations (
      captain_user_id INTEGER PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy_m REAL,
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(captain_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_direct_ride_locations_recorded ON direct_ride_locations(recorded_at DESC);
    CREATE TABLE IF NOT EXISTS direct_ride_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id INTEGER NOT NULL,
      captain_user_id INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy_m REAL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY(ride_id) REFERENCES direct_ride_requests(id) ON DELETE CASCADE,
      FOREIGN KEY(captain_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_direct_ride_points_ride_recorded ON direct_ride_points(ride_id, recorded_at ASC, id ASC);
    CREATE TABLE IF NOT EXISTS direct_ride_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_user_id INTEGER,
      details_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY(ride_id) REFERENCES direct_ride_requests(id) ON DELETE CASCADE,
      FOREIGN KEY(actor_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_direct_ride_events_ride_created ON direct_ride_events(ride_id, created_at ASC, id ASC);
  `);
}

function createDirectRideService({ db, now = () => new Date().toISOString(), audit = () => {}, dispatchEnabled = false } = {}) {
  if (!db) throw new Error("direct ride service requires a database");

  const stamp = () => now();
  const requestCode = () => {
    let code = "";
    do code = `DR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    while (db.prepare("SELECT id FROM direct_ride_requests WHERE request_code=? LIMIT 1").get(code));
    return code;
  };
  const eventKey = (rideId, type, idempotencyKey) => String(idempotencyKey || `DIRECT-RIDE-${rideId}-${type}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`).slice(0, 180);
  const tokenHash = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
  const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2)} د.أ`;

  function insertEvent({ rideId, eventType, actorRole = "system", actorUserId = null, details = {}, idempotencyKey }) {
    const key = eventKey(rideId, eventType, idempotencyKey);
    const existing = db.prepare("SELECT id FROM direct_ride_events WHERE idempotency_key=? LIMIT 1").get(key);
    if (existing) return { duplicate: true, id: existing.id };
    const result = db.prepare("INSERT INTO direct_ride_events(ride_id,event_type,actor_role,actor_user_id,details_json,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(rideId, eventType, actorRole, actorUserId, JSON.stringify(details || {}), key, stamp());
    audit(`direct_ride.${eventType}`, "direct_ride", rideId, { ...details, actorRole, actorUserId, eventId: result.lastInsertRowid, mutation: "ride_state_only", walletChanged: false });
    return { duplicate: false, id: result.lastInsertRowid };
  }

  function getRide(id) {
    return db.prepare(`SELECT r.*, o.status AS offer_status, o.captain_user_id AS offer_captain_user_id,
      o.pickup_distance_km AS offer_pickup_distance_km, o.offered_at AS offer_offered_at,
      u.name AS live_captain_name, u.phone AS live_captain_phone
      FROM direct_ride_requests r
      LEFT JOIN direct_ride_offers o ON o.ride_id=r.id AND o.status IN ('offered','accepted')
      LEFT JOIN users u ON u.id=COALESCE(r.captain_user_id,o.captain_user_id)
      WHERE r.id=? LIMIT 1`).get(id);
  }

  function response(row, { includeToken = false, token = null, includeEvents = false } = {}) {
    if (!row) return null;
    const result = {
      id: Number(row.id),
      requestCode: row.request_code,
      customerName: row.customer_name,
      phone: row.phone,
      origin: row.origin,
      destination: row.destination,
      originCoordinates: { lat: Number(row.origin_lat), lng: Number(row.origin_lng) },
      destinationCoordinates: { lat: Number(row.destination_lat), lng: Number(row.destination_lng) },
      routeSource: row.route_source,
      distanceKm: Number(row.distance_km),
      durationMin: Number(row.duration_min),
      quotedPriceCents: Number(row.quoted_price_cents),
      quotedPrice: money(row.quoted_price_cents),
      finalDistanceKm: row.final_distance_km === null || row.final_distance_km === undefined ? null : Number(row.final_distance_km),
      finalDurationMin: row.final_duration_min === null || row.final_duration_min === undefined ? null : Number(row.final_duration_min),
      finalPriceCents: row.final_price_cents === null || row.final_price_cents === undefined ? null : Number(row.final_price_cents),
      finalPrice: row.final_price_cents === null || row.final_price_cents === undefined ? null : money(row.final_price_cents),
      status: row.status,
      captain: row.captain_user_id || row.offer_captain_user_id ? {
        id: Number(row.captain_user_id || row.offer_captain_user_id),
        name: row.captain_name_snapshot || row.live_captain_name || null,
        pickupDistanceKm: row.captain_pickup_distance_km === null || row.captain_pickup_distance_km === undefined ? (row.offer_pickup_distance_km == null ? null : Number(row.offer_pickup_distance_km)) : Number(row.captain_pickup_distance_km),
      } : null,
      requestedAt: row.requested_at,
      confirmedAt: row.confirmed_at,
      offeredAt: row.offered_at || row.offer_offered_at || null,
      assignedAt: row.assigned_at,
      arrivedAt: row.arrived_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      cancelReason: row.cancel_reason || null,
      liveDispatchEnabled: Boolean(dispatchEnabled),
    };
    if (includeToken) result.riderToken = token || null;
    if (includeEvents) result.events = db.prepare("SELECT event_type,actor_role,details_json,created_at FROM direct_ride_events WHERE ride_id=? ORDER BY id ASC").all(row.id).map((event) => ({ eventType: event.event_type, actorRole: event.actor_role, details: JSON.parse(event.details_json || "{}"), createdAt: event.created_at }));
    return result;
  }

  function findByCustomerToken(id, token) {
    const row = getRide(id);
    if (!row || !token || !tokenHash(token) || !crypto.timingSafeEqual(Buffer.from(String(row.customer_token_hash)), Buffer.from(tokenHash(token)))) return null;
    return row;
  }

  function updateStatus(rideId, from, to, fields = {}, event = {}, idempotencyKey = null) {
    if (!canTransition(from, to)) return { ok: false, error: `لا يمكن نقل الرحلة من ${from} إلى ${to}` };
    const stampValue = stamp();
    const assignments = ["status=?", "updated_at=?"];
    const values = [to, stampValue];
    for (const [column, value] of Object.entries(fields)) {
      assignments.push(`${column}=?`);
      values.push(value);
    }
    values.push(rideId, from);
    const changed = db.prepare(`UPDATE direct_ride_requests SET ${assignments.join(",")} WHERE id=? AND status=?`).run(...values);
    if (!changed.changes) return { ok: false, conflict: true };
    insertEvent({ rideId, eventType: event.type || to, actorRole: event.actorRole || "system", actorUserId: event.actorUserId || null, details: event.details || {}, idempotencyKey: idempotencyKey || `DIRECT-RIDE-STATUS-${rideId}-${to}-${stampValue}` });
    return { ok: true, row: getRide(rideId) };
  }

  function createRequest(input = {}) {
    const customerName = String(input.customerName || "").trim().slice(0, 80);
    const phone = String(input.phone || "").trim().slice(0, 40);
    const origin = String(input.origin || "").trim().slice(0, 160);
    const destination = String(input.destination || "").trim().slice(0, 160);
    const originCoordinates = normalizeCoordinatePair({ lat: input.originLat, lng: input.originLng });
    const destinationCoordinates = normalizeCoordinatePair({ lat: input.destinationLat, lng: input.destinationLng });
    const route = normalizeRouteEstimate({ distanceKm: input.distanceKm, durationMin: input.durationMin, origin: originCoordinates, destination: destinationCoordinates });
    if (customerName.length < 2 || !phone || origin.length < 2 || destination.length < 2) return { ok: false, status: 400, error: "اسم العميل ورقم الهاتف والموقعان مطلوبون" };
    if (!originCoordinates || !destinationCoordinates) return { ok: false, status: 400, error: "إحداثيات الإقلاع والوجهة مطلوبة" };
    if (!route) return { ok: false, status: 400, error: "المسافة أو المدة غير صالحة" };
    const quote = calculateDirectRideFare(route);
    if (quote.status !== "quoted") return { ok: false, status: 400, error: "تعذر احتساب سعر الرحلة" };
    const idempotencyKey = String(input.idempotencyKey || "").trim().slice(0, 180) || null;
    if (idempotencyKey) {
      const existing = db.prepare("SELECT * FROM direct_ride_requests WHERE idempotency_key=? LIMIT 1").get(idempotencyKey);
      if (existing) return { ok: true, duplicate: true, row: getRide(existing.id), token: null };
    }
    const customerToken = crypto.randomBytes(24).toString("base64url");
    const stampValue = stamp();
    const requestCodeValue = requestCode();
    const inserted = db.prepare(`INSERT INTO direct_ride_requests(
      request_code,customer_name,phone,origin,destination,origin_lat,origin_lng,destination_lat,destination_lng,route_source,distance_km,duration_min,quoted_price_cents,status,customer_token_hash,customer_token_last4,idempotency_key,requested_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'priced',?,?,?,?,?,?)`).run(
      requestCodeValue, customerName, phone, origin, destination,
      originCoordinates.lat, originCoordinates.lng, destinationCoordinates.lat, destinationCoordinates.lng,
      String(input.routeSource || "coordinate_estimate").slice(0, 40), route.distanceKm, route.durationMin, quote.fareCents,
      tokenHash(customerToken), customerToken.slice(-4), idempotencyKey, stampValue, stampValue, stampValue,
    );
    const rideId = Number(inserted.lastInsertRowid);
    insertEvent({ rideId, eventType: "priced", actorRole: "rider", details: { routeSource: input.routeSource || "coordinate_estimate", distanceKm: route.distanceKm, durationMin: route.durationMin, fareCents: quote.fareCents }, idempotencyKey: `DIRECT-RIDE-${rideId}-PRICED` });
    return { ok: true, duplicate: false, row: getRide(rideId), token: customerToken };
  }

  function confirmRider(id, token, idempotencyKey) {
    const row = findByCustomerToken(id, token);
    if (!row) return { ok: false, status: 404, error: "الرحلة غير موجودة أو رابط المتابعة غير صالح" };
    if (row.status !== "priced") return { ok: false, status: 409, error: "لا يمكن تأكيد الرحلة في حالتها الحالية", row };
    const result = updateStatus(id, row.status, "rider_confirmed", { confirmed_at: stamp() }, { type: "rider_confirmed", actorRole: "rider", details: { requestCode: row.request_code } }, idempotencyKey || `DIRECT-RIDE-${id}-RIDER-CONFIRMED`);
    if (!result.ok) return { ok: false, status: 409, error: "تغيرت حالة الرحلة؛ حدّث الصفحة" };
    return { ok: true, row: result.row };
  }

  function dispatch(id, { actorRole = "system", actorUserId = null, idempotencyKey = null } = {}) {
    const row = getRide(id);
    if (!row) return { ok: false, status: 404, error: "الرحلة غير موجودة" };
    if (!["rider_confirmed", "dispatch_pending"].includes(row.status)) return { ok: false, status: 409, error: "الرحلة ليست جاهزة للتوزيع", row };
    const pending = updateStatus(id, row.status, "dispatch_pending", {}, { type: "dispatch_pending", actorRole, actorUserId, details: { liveDispatchEnabled: Boolean(dispatchEnabled) } }, idempotencyKey || `DIRECT-RIDE-${id}-DISPATCH-PENDING`);
    if (!pending.ok && !pending.conflict) return { ok: false, status: 409, error: "تعذر تجهيز الرحلة للتوزيع" };
    if (!dispatchEnabled) return { ok: true, paused: true, row: getRide(id), reason: "live_dispatch_disabled" };
    const candidates = db.prepare(`SELECT u.id AS user_id,u.name,u.phone,l.lat,l.lng,l.accuracy_m,l.recorded_at
      FROM users u JOIN direct_ride_locations l ON l.captain_user_id=u.id
      WHERE u.role='captain' AND u.active=1 AND COALESCE(u.account_status,'active')='active' AND u.is_bot=0`).all();
    const nearest = rankNearestCaptains(candidates.map((item) => ({ ...item, userId: item.user_id, recordedAt: item.recorded_at })), { lat: row.origin_lat, lng: row.origin_lng }, { nowMs: Date.parse(stamp()) });
    const captain = nearest[0];
    if (!captain) {
      insertEvent({ rideId: id, eventType: "dispatch_waiting_for_location", actorRole: "system", details: { reason: "no_fresh_captain_location" }, idempotencyKey: `DIRECT-RIDE-${id}-NO-FRESH-CAPTAIN` });
      return { ok: true, waiting: true, row: getRide(id), reason: "no_fresh_captain_location" };
    }
    const offerKey = `DIRECT-RIDE-${id}-OFFER-${captain.userId}`;
    const existingOffer = db.prepare("SELECT * FROM direct_ride_offers WHERE ride_id=? AND captain_user_id=? LIMIT 1").get(id, captain.userId);
    if (!existingOffer) db.prepare("INSERT INTO direct_ride_offers(ride_id,captain_user_id,status,pickup_distance_km,idempotency_key,offered_at,created_at,updated_at) VALUES(?,?,\'offered\',?,?,?, ?,?)").run(id, captain.userId, captain.distanceToPickupKm, offerKey, stamp(), stamp(), stamp());
    const offered = getRide(id);
    if (offered.status !== "offered") {
      db.prepare("UPDATE direct_ride_requests SET status='offered',offered_at=?,updated_at=? WHERE id=? AND status='dispatch_pending'").run(stamp(), stamp(), id);
      insertEvent({ rideId: id, eventType: "offered", actorRole: "system", details: { captainUserId: captain.userId, pickupDistanceKm: captain.distanceToPickupKm }, idempotencyKey: `DIRECT-RIDE-${id}-OFFERED` });
    }
    return { ok: true, waiting: false, row: getRide(id), captain: { id: captain.userId, name: captain.name, pickupDistanceKm: captain.distanceToPickupKm } };
  }

  function upsertCaptainLocation(captainUserId, input = {}, { rideId = null, actorRole = "captain" } = {}) {
    const coordinates = normalizeCoordinatePair({ lat: input.lat, lng: input.lng });
    if (!coordinates) return { ok: false, status: 400, error: "إحداثيات الموقع غير صالحة" };
    const accuracy = input.accuracyM === undefined || input.accuracyM === null ? null : Number(input.accuracyM);
    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000)) return { ok: false, status: 400, error: "دقة الموقع غير صالحة" };
    const stampValue = stamp();
    db.prepare(`INSERT INTO direct_ride_locations(captain_user_id,lat,lng,accuracy_m,recorded_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(captain_user_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy_m=excluded.accuracy_m,recorded_at=excluded.recorded_at,updated_at=excluded.updated_at`)
      .run(captainUserId, coordinates.lat, coordinates.lng, accuracy, stampValue, stampValue);
    if (rideId) {
      const ride = getRide(rideId);
      if (!ride || Number(ride.captain_user_id || ride.offer_captain_user_id) !== Number(captainUserId) || !["assigned", "arrived", "in_trip"].includes(ride.status)) return { ok: false, status: 409, error: "لا يمكن تسجيل النقطة لهذه الرحلة" };
      db.prepare("INSERT INTO direct_ride_points(ride_id,captain_user_id,lat,lng,accuracy_m,recorded_at) VALUES(?,?,?,?,?,?)").run(rideId, captainUserId, coordinates.lat, coordinates.lng, accuracy, stampValue);
    }
    return { ok: true, location: { ...coordinates, accuracyM: accuracy, recordedAt: stampValue } };
  }

  function listCaptainRides(captainUserId) {
    const rows = db.prepare(`SELECT r.*,o.status AS offer_status,o.pickup_distance_km AS offer_pickup_distance_km,o.offered_at AS offer_offered_at
      FROM direct_ride_requests r JOIN direct_ride_offers o ON o.ride_id=r.id
      WHERE o.captain_user_id=? AND ((o.status='offered' AND r.status='offered') OR (o.status='accepted' AND r.status IN ('assigned','arrived','in_trip')))
      ORDER BY CASE WHEN r.status='in_trip' THEN 0 WHEN r.status='arrived' THEN 1 WHEN r.status='assigned' THEN 2 ELSE 3 END,r.id DESC LIMIT 25`).all(captainUserId);
    return rows.map((row) => response(row));
  }

  function accept(id, captainUserId, idempotencyKey) {
    const ride = getRide(id);
    if (!ride) return { ok: false, status: 404, error: "الرحلة غير موجودة" };
    const offer = db.prepare("SELECT * FROM direct_ride_offers WHERE ride_id=? AND captain_user_id=? AND status='offered' LIMIT 1").get(id, captainUserId);
    if (!offer || ride.status !== "offered") return { ok: false, status: 409, error: "لم يعد هذا العرض متاحًا" };
    const captain = db.prepare("SELECT id,name,phone FROM users WHERE id=? AND role='captain' AND active=1 AND COALESCE(account_status,'active')='active' LIMIT 1").get(captainUserId);
    if (!captain) return { ok: false, status: 403, error: "حساب الكابتن غير متاح" };
    const stampValue = stamp();
    const transaction = db.transaction(() => {
      db.prepare("UPDATE direct_ride_offers SET status='accepted',responded_at=?,updated_at=? WHERE id=? AND status='offered'").run(stampValue, stampValue, offer.id);
      const changed = db.prepare("UPDATE direct_ride_requests SET status='assigned',captain_user_id=?,captain_name_snapshot=?,captain_phone_snapshot=?,captain_pickup_distance_km=?,assigned_at=?,updated_at=? WHERE id=? AND status='offered'")
        .run(captain.id, captain.name, captain.phone, offer.pickup_distance_km, stampValue, stampValue, id);
      if (!changed.changes) throw new Error("ride_assignment_conflict");
      db.prepare("UPDATE direct_ride_offers SET status='expired',responded_at=?,updated_at=? WHERE ride_id=? AND id<>? AND status='offered'").run(stampValue, stampValue, id, offer.id);
      insertEvent({ rideId: id, eventType: "assigned", actorRole: "captain", actorUserId: captain.id, details: { captainName: captain.name, pickupDistanceKm: offer.pickup_distance_km }, idempotencyKey: idempotencyKey || `DIRECT-RIDE-${id}-ACCEPT-${captain.id}` });
    });
    try { transaction(); } catch (error) { return { ok: false, status: 409, error: error.message === "ride_assignment_conflict" ? "تم قبول العرض من كابتن آخر" : "تعذر قبول الرحلة" }; }
    return { ok: true, row: getRide(id) };
  }

  function markArrived(id, captainUserId, idempotencyKey) {
    const row = getRide(id);
    if (!row || Number(row.captain_user_id) !== Number(captainUserId)) return { ok: false, status: 404, error: "الرحلة غير موجودة لهذا الكابتن" };
    const result = updateStatus(id, row.status, "arrived", { arrived_at: stamp() }, { type: "arrived", actorRole: "captain", actorUserId: captainUserId, details: {} }, idempotencyKey || `DIRECT-RIDE-${id}-ARRIVED-${captainUserId}`);
    return result.ok ? { ok: true, row: result.row } : { ok: false, status: 409, error: "لا يمكن تسجيل الوصول الآن" };
  }

  function start(id, captainUserId, input = {}, idempotencyKey) {
    const row = getRide(id);
    if (!row || Number(row.captain_user_id) !== Number(captainUserId)) return { ok: false, status: 404, error: "الرحلة غير موجودة لهذا الكابتن" };
    const result = updateStatus(id, row.status, "in_trip", { started_at: stamp() }, { type: "in_trip", actorRole: "captain", actorUserId: captainUserId, details: {} }, idempotencyKey || `DIRECT-RIDE-${id}-START-${captainUserId}`);
    if (!result.ok) return { ok: false, status: 409, error: "لا يمكن بدء الرحلة الآن" };
    if (input.lat !== undefined || input.lng !== undefined) upsertCaptainLocation(captainUserId, input, { rideId: id });
    return { ok: true, row: getRide(id) };
  }

  function trackedDistance(rideId) {
    const points = db.prepare("SELECT lat,lng FROM direct_ride_points WHERE ride_id=? ORDER BY recorded_at ASC,id ASC").all(rideId);
    let distance = 0;
    for (let index = 1; index < points.length; index += 1) distance += haversineDistanceKm(points[index - 1], points[index]) || 0;
    return { distanceKm: distance, pointCount: points.length };
  }

  function finish(id, captainUserId, input = {}, idempotencyKey) {
    const row = getRide(id);
    if (!row || Number(row.captain_user_id) !== Number(captainUserId)) return { ok: false, status: 404, error: "الرحلة غير موجودة لهذا الكابتن" };
    if (row.status !== "in_trip") return { ok: false, status: 409, error: "لا يمكن إنهاء الرحلة الآن" };
    if (input.lat !== undefined || input.lng !== undefined) {
      const location = upsertCaptainLocation(captainUserId, input, { rideId: id });
      if (!location.ok) return location;
    }
    const tracked = trackedDistance(id);
    const completedAt = stamp();
    const startedAt = Date.parse(row.started_at || completedAt);
    const durationMin = Math.max(1, Number.isFinite(startedAt) ? (Date.parse(completedAt) - startedAt) / 60000 : 1);
    const finalDistanceKm = tracked.pointCount >= 2 ? tracked.distanceKm : 0;
    const quote = calculateDirectRideFare({ distanceKm: finalDistanceKm, durationMin });
    if (quote.status !== "quoted") return { ok: false, status: 409, error: "تعذر حساب السعر النهائي" };
    const changed = db.prepare("UPDATE direct_ride_requests SET status='completed',final_distance_km=?,final_duration_min=?,final_price_cents=?,completed_at=?,updated_at=? WHERE id=? AND status='in_trip' AND captain_user_id=?")
      .run(finalDistanceKm, durationMin, quote.fareCents, completedAt, completedAt, id, captainUserId);
    if (!changed.changes) return { ok: false, status: 409, error: "تغيرت حالة الرحلة؛ حدّث الصفحة" };
    insertEvent({ rideId: id, eventType: "completed", actorRole: "captain", actorUserId: captainUserId, details: { finalDistanceKm, finalDurationMin: durationMin, finalPriceCents: quote.fareCents, pointCount: tracked.pointCount, walletChanged: false }, idempotencyKey: idempotencyKey || `DIRECT-RIDE-${id}-FINISH-${captainUserId}` });
    return { ok: true, row: getRide(id), settlement: { status: "pending_owner_review", walletChanged: false } };
  }

  function cancel(id, actorRole, actorUserId, reason, idempotencyKey) {
    const row = getRide(id);
    if (!row) return { ok: false, status: 404, error: "الرحلة غير موجودة" };
    if (["completed", "cancelled"].includes(row.status)) return { ok: true, duplicate: true, row };
    const changed = db.prepare("UPDATE direct_ride_requests SET status='cancelled',cancel_reason=?,cancelled_at=?,updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')").run(String(reason || "تم الإلغاء").slice(0, 240), stamp(), stamp(), id);
    if (!changed.changes) return { ok: false, status: 409, error: "تعذر إلغاء الرحلة" };
    db.prepare("UPDATE direct_ride_offers SET status='expired',responded_at=?,updated_at=? WHERE ride_id=? AND status IN ('offered','accepted')").run(stamp(), stamp(), id);
    insertEvent({ rideId: id, eventType: "cancelled", actorRole, actorUserId, details: { reason: String(reason || "تم الإلغاء").slice(0, 240), walletChanged: false }, idempotencyKey: idempotencyKey || `DIRECT-RIDE-${id}-CANCEL` });
    return { ok: true, row: getRide(id) };
  }

  function listAdmin({ limit = 200 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    return db.prepare("SELECT * FROM direct_ride_requests ORDER BY id DESC LIMIT ?").all(safeLimit).map((row) => response(row, { includeEvents: true }));
  }

  return {
    createRequest,
    confirmRider,
    dispatch,
    upsertCaptainLocation,
    listCaptainRides,
    accept,
    markArrived,
    start,
    finish,
    cancel,
    getRide: (id) => response(getRide(id), { includeEvents: true }),
    getPublicRide: (id, token) => {
      const row = findByCustomerToken(id, token);
      return row ? response(row, { includeEvents: true }) : null;
    },
    listAdmin,
    response,
  };
}

module.exports = { ensureDirectRideSchema, createDirectRideService };
