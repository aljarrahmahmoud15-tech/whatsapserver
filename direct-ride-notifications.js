const STATUS_MESSAGES = {
  priced: "تم احتساب سعر الرحلة.",
  rider_confirmed: "تم تأكيد الرحلة من الراكب.",
  dispatch_pending: "جارٍ البحث عن أقرب كابتن.",
  dispatch_waiting_for_location: "لم نعثر على موقع حديث لكابتن؛ الرحلة بانتظار التوزيع.",
  offered: "تم إرسال عرض الرحلة إلى أقرب كابتن.",
  assigned: "تم قبول الرحلة وتعيين الكابتن.",
  arrived: "وصل الكابتن إلى موقع الإقلاع.",
  in_trip: "بدأت الرحلة والعداد يعمل الآن.",
  completed: "انتهت الرحلة. السعر النهائي بانتظار مراجعة الإدارة.",
  cancelled: "تم إلغاء الرحلة.",
};

function createDirectRideNotificationHub({ heartbeatMs = 25000 } = {}) {
  const rideStreams = new Map();
  const captainStreams = new Map();
  const adminStreams = new Set();

  function write(res, eventName, payload) {
    if (!res || res.writableEnded || res.destroyed) return false;
    try {
      const eventId = String(payload?.eventId || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_.:-]/g, "_");
      res.write(`id: ${eventId}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      res.flush?.();
      return true;
    } catch {
      return false;
    }
  }

  function addStream(collection, key, res, initialPayload = null) {
    const normalizedKey = String(key);
    let streams = collection.get(normalizedKey);
    if (!streams) {
      streams = new Set();
      collection.set(normalizedKey, streams);
    }
    streams.add(res);
    if (initialPayload) write(res, "ride-status", initialPayload);
    const heartbeat = setInterval(() => {
      if (!write(res, "heartbeat", { at: new Date().toISOString() })) cleanup();
    }, heartbeatMs);
    heartbeat.unref?.();
    const cleanup = () => {
      clearInterval(heartbeat);
      streams.delete(res);
      if (!streams.size) collection.delete(normalizedKey);
    };
    res.once("close", cleanup);
    return cleanup;
  }

  function addAdminStream(res, initialPayload = null) {
    adminStreams.add(res);
    if (initialPayload) write(res, "ride-status", initialPayload);
    const heartbeat = setInterval(() => {
      if (!write(res, "heartbeat", { at: new Date().toISOString() })) cleanup();
    }, heartbeatMs);
    heartbeat.unref?.();
    const cleanup = () => {
      clearInterval(heartbeat);
      adminStreams.delete(res);
    };
    res.once("close", cleanup);
    return cleanup;
  }

  function basePayload(payload) {
    const ride = payload?.ride || {};
    const eventType = String(payload?.eventType || "updated");
    return {
      eventId: `ride-${payload.rideId}-${eventType}-${payload.createdAt || Date.now()}`,
      rideId: Number(payload.rideId),
      requestCode: ride.requestCode || null,
      eventType,
      status: ride.status || eventType,
      message: STATUS_MESSAGES[eventType] || "تم تحديث حالة الرحلة.",
      at: payload.createdAt || new Date().toISOString(),
      silent: false,
    };
  }

  function rideView(ride, audience) {
    if (!ride) return null;
    const shared = {
      id: Number(ride.id),
      requestCode: ride.requestCode || null,
      status: ride.status || null,
      origin: ride.origin || null,
      destination: ride.destination || null,
      quotedPrice: ride.quotedPrice || null,
      finalPrice: ride.finalPrice || null,
      distanceKm: ride.distanceKm == null ? null : Number(ride.distanceKm),
      durationMin: ride.durationMin == null ? null : Number(ride.durationMin),
      finalDistanceKm: ride.finalDistanceKm == null ? null : Number(ride.finalDistanceKm),
      finalDurationMin: ride.finalDurationMin == null ? null : Number(ride.finalDurationMin),
      captain: ride.captain ? { id: Number(ride.captain.id), name: ride.captain.name || null } : null,
    };
    if (audience === "captain" || audience === "admin") {
      return { ...shared, customerName: ride.customerName || null, originCoordinates: ride.originCoordinates || null, destinationCoordinates: ride.destinationCoordinates || null };
    }
    return shared;
  }

  function publish(payload) {
    const base = basePayload(payload);
    const ride = payload?.ride || null;
    const riderPayload = { ...base, audience: "rider", ride: rideView(ride, "rider") };
    const captainPayload = { ...base, audience: "captain", ride: rideView(ride, "captain") };
    const adminPayload = { ...base, audience: "admin", ride: rideView(ride, "admin") };
    const rideSet = rideStreams.get(String(payload.rideId));
    rideSet?.forEach((res) => write(res, "ride-status", riderPayload));
    const captainId = Number(payload?.details?.captainUserId || ride?.captain?.id || 0);
    if (captainId) captainStreams.get(String(captainId))?.forEach((res) => write(res, "ride-status", captainPayload));
    adminStreams.forEach((res) => write(res, "ride-status", adminPayload));
  }

  function initialPayload(ride, audience) {
    const payload = basePayload({ rideId: ride?.id, eventType: "snapshot", createdAt: new Date().toISOString(), ride });
    payload.message = "تم فتح قناة متابعة الرحلة.";
    payload.silent = true;
    payload.audience = audience;
    payload.ride = rideView(ride, audience);
    return payload;
  }

  return {
    publish,
    subscribeRide: (rideId, res, ride) => addStream(rideStreams, rideId, res, initialPayload(ride, "rider")),
    subscribeCaptain: (captainId, res) => addStream(captainStreams, captainId, res, { eventId: `captain-connected-${captainId}-${Date.now()}`, eventType: "connected", status: "connected", message: "تم فتح قناة إشعارات الكابتن.", at: new Date().toISOString(), silent: true, audience: "captain" }),
    subscribeAdmin: (res) => addAdminStream(res, { eventId: `admin-connected-${Date.now()}`, eventType: "connected", status: "connected", message: "تم فتح قناة مركز V27.", at: new Date().toISOString(), silent: true, audience: "admin" }),
  };
}

module.exports = { createDirectRideNotificationHub, STATUS_MESSAGES };
