(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = { rides: [], watch: null, timer: null, stream: null, phone: "" };
  const ACCESS_CODES = new Set([
    "captain_authentication_required",
    "captain_group_verification_required",
    "captain_official_group_membership_required",
    "captain_group_verification_unavailable",
    "captain_account_inactive",
  ]);
  const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2)} د.أ`;
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "تعذر الاتصال");
      error.status = response.status;
      error.code = data.code || null;
      if (ACCESS_CODES.has(error.code) && !$("#app").classList.contains("hidden")) lockAccess(error);
      throw error;
    }
    return data;
  }
  function notice(text, tone = "") {
    const node = $("#app-notice");
    if (node) { node.textContent = text; node.className = `notice ${tone}`; }
  }
  function loginNotice(text, tone = "") {
    const node = $("#login-notice");
    if (node) { node.textContent = text; node.className = `notice ${tone}`; }
  }
  function showScreen(id) {
    ["login-card", "verify-card", "lock-card", "app"].forEach((name) => $("#" + name)?.classList.toggle("hidden", name !== id));
  }
  function beginVerification(result, phone) {
    state.phone = String(phone || "").trim();
    $("#verify-phone").value = state.phone;
    $("#verify-code").value = "";
    $("#verify-notice").textContent = result?.message || "أدخل الرمز المرسل إلى WhatsApp المسجل.";
    showScreen("verify-card");
    $("#verify-code").focus();
  }
  function closeStream() { state.stream?.close(); state.stream = null; }
  function connectStream() {
    if (state.stream || !window.V27Notifications) return;
    state.stream = window.V27Notifications.connect({
      url: "/api/captain/direct-rides/events",
      audience: "captain",
      onEvent: (payload) => { if (!payload.silent) void load(); },
      onConnectionChange: (status) => {
        if (status === "connected") notice("الإشعارات الفورية مفعلة.", "ok");
        if (status === "reconnecting") notice("جاري إعادة الاتصال بالإشعارات؛ التحديث الدوري يعمل.", "warn");
      },
    });
  }
  function stopWatch() {
    if (state.watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.watch);
    state.watch = null;
  }
  function stopPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }
  function lockAccess(error = {}) {
    closeStream();
    stopWatch();
    stopPolling();
    state.rides = [];
    $("#rides-list").innerHTML = "";
    $("#app").classList.add("hidden");
    const unavailable = error.code === "captain_group_verification_unavailable" || error.status === 503;
    const notMember = error.code === "captain_official_group_membership_required";
    $("#lock-title").textContent = notMember ? "تم قفل الوصول" : unavailable ? "تعذر فحص العضوية مؤقتًا" : "يلزم تسجيل الدخول مجددًا";
    $("#lock-message").textContent = error.message || (notMember
      ? "انضم إلى القروب الرسمي ثم سجّل الدخول والتحقق من جديد. لم يتم تعطيل حسابك."
      : unavailable
        ? "لم يتم تعطيل الحساب أو تغيير بياناته. أعد المحاولة عندما يتاح فحص القروب الرسمي."
        : "أعد تسجيل الدخول للتحقق من عضويتك الحالية في القروب الرسمي.");
    $("#lock-retry-button").textContent = unavailable ? "إعادة المحاولة" : "فحص العضوية مجددًا";
    showScreen("lock-card");
  }
  function startPolling() {
    stopPolling();
    state.timer = setInterval(() => { if (!$("#app").classList.contains("hidden")) void load(); }, 8000);
  }
  async function openApp(name = "") {
    if (name) $("#hello").textContent = `مرحبًا ${name}`;
    showScreen("app");
    connectStream();
    startPolling();
    await load();
  }
  async function sendLocation(rideId = null) {
    if (!navigator.geolocation) return notice("هذا الجهاز لا يدعم GPS.");
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        await api("/api/captain/direct-rides/location", { method: "POST", body: JSON.stringify({ rideId, lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: position.coords.accuracy }) });
        notice("تم تحديث موقعك.", "ok");
        resolve(true);
      } catch (error) { notice(error.message, "warn"); resolve(false); }
    }, (error) => {
      notice(error.code === 1 ? "اسمح بالموقع من إعدادات المتصفح." : "تعذر قراءة موقعك.", "warn");
      resolve(false);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }));
  }
  function activeRide() { return state.rides.find((ride) => ["assigned", "arrived", "in_trip"].includes(ride.status)) || null; }
  function render() {
    const box = $("#rides-list");
    if (!state.rides.length) {
      box.innerHTML = '<div class="empty">لا يوجد عرض الآن.<br>عند تأكيد رحلة من الراكب ستظهر هنا بيانات الإقلاع والوجهة والسعر.</div>';
      return;
    }
    box.innerHTML = state.rides.map((ride) => {
      const offered = ride.status === "offered";
      const assigned = ["assigned", "arrived", "in_trip"].includes(ride.status);
      const status = ({ offered: "عرض جديد", assigned: "تم القبول", arrived: "وصلت", in_trip: "العداد نشط" })[ride.status] || ride.status;
      return `<article class="card ${offered ? "offer" : ""}" style="margin-top:10px;padding:14px"><div class="topline"><div><p class="eyebrow">${offered ? "عرض قريب" : "رحلة مخصصة"}</p><h3>${ride.requestCode}</h3></div><span class="pill ${ride.status === "in_trip" ? "" : "wait"}">${status}</span></div><div class="route"><div class="place"><span>الإقلاع</span><b>${ride.origin}</b></div><div class="place"><span>الوجهة</span><b>${ride.destination}</b></div></div><div class="fare"><span>${ride.distanceKm.toFixed(1)} كم · ${Math.round(ride.durationMin)} د</span><strong>${ride.finalPrice || ride.quotedPrice}</strong></div><div class="actions">${offered ? `<button class="main" data-action="accept" data-id="${ride.id}">قبول الرحلة</button><button class="secondary" data-action="navigate" data-id="${ride.id}">اتجاه الإقلاع</button>` : ""}${assigned ? `<button class="secondary" data-action="navigate" data-id="${ride.id}">فتح موقع الراكب</button><button class="main" data-action="arrived" data-id="${ride.id}" ${ride.status !== "assigned" ? "disabled" : ""}>وصلت إلى الراكب</button><button class="main" data-action="start" data-id="${ride.id}" ${ride.status !== "arrived" ? "disabled" : ""}>بدء الرحلة</button><button class="danger" data-action="finish" data-id="${ride.id}" ${ride.status !== "in_trip" ? "disabled" : ""}>إنهاء عند النقطة الحالية</button>` : ""}</div>${ride.status === "in_trip" ? '<div class="meter"><div><span>المسافة المسجلة</span><b>تتحدث مع GPS</b></div><div><span>المدة</span><b>عداد نشط</b></div><div><span>الحساب</span><b>حتى الإنهاء</b></div></div>' : ""}</article>`;
    }).join("");
    box.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => action(button.dataset.action, Number(button.dataset.id))));
  }
  async function load() {
    try {
      const data = await api("/api/captain/direct-rides");
      state.rides = data.rides || [];
      $("#live-pill").textContent = data.liveDispatchEnabled ? "تشغيل حي" : "بانتظار اعتماد";
      render();
      const ride = activeRide();
      if (ride) startWatch(ride.id); else stopWatch();
    } catch (error) {
      if (ACCESS_CODES.has(error.code) || error.status === 401 || error.status === 403 || error.status === 503) {
        if (error.code === "captain_authentication_required" || error.code === "captain_group_verification_required" || error.status === 401) {
          closeStream(); stopWatch(); stopPolling(); showScreen("login-card"); loginNotice(error.message || "سجّل الدخول مجددًا.", "warn");
        } else lockAccess(error);
      } else notice(error.message, "warn");
    }
  }
  function startWatch(rideId) {
    if (state.watch || !navigator.geolocation) return;
    state.watch = navigator.geolocation.watchPosition((position) => {
      void api("/api/captain/direct-rides/location", { method: "POST", body: JSON.stringify({ rideId, lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: position.coords.accuracy }) }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 });
  }
  async function action(type, id) {
    const ride = state.rides.find((item) => item.id === id);
    if (!ride) return;
    try {
      if (type === "navigate") {
        const coordinates = ride.originCoordinates;
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${coordinates.lat},${coordinates.lng}`)}`, "_blank", "noopener");
        return;
      }
      const route = { accept: "accept", arrived: "arrived", start: "start", finish: "finish" }[type];
      const body = {};
      if (type === "start" || type === "finish") {
        if (!navigator.geolocation) return notice("اسمح بالموقع قبل تشغيل العداد.", "warn");
        const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }));
        body.lat = position.coords.latitude; body.lng = position.coords.longitude; body.accuracyM = position.coords.accuracy;
      }
      await api(`/api/captain/direct-rides/${id}/${route}`, { method: "POST", body: JSON.stringify(body) });
      notice(type === "finish" ? "انتهت الرحلة؛ السعر النهائي بانتظار مراجعة الإدارة." : type === "arrived" ? "سُجل وصولك وأُرسل إشعار للراكب." : "تم تحديث الرحلة.", "ok");
      await load();
    } catch (error) { notice(error.message, "warn"); }
  }
  $("#login-button").addEventListener("click", async () => {
    const button = $("#login-button"); button.disabled = true; loginNotice("");
    const phone = $("#phone").value.trim();
    try {
      const result = await api("/api/captain/login", { method: "POST", body: JSON.stringify({ phone, pin: $("#pin").value.trim() }) });
      if (result.requiresGroupVerification) beginVerification(result, phone);
      else await openApp(result.user?.name || "");
    } catch (error) { loginNotice(error.message, "warn"); }
    finally { button.disabled = false; }
  });
  $("#whatsapp-login-button").addEventListener("click", async () => {
    const button = $("#whatsapp-login-button"); button.disabled = true; loginNotice("");
    const phone = $("#phone").value.trim();
    try {
      const result = await api("/api/captain/whatsapp/request-code", { method: "POST", body: JSON.stringify({ phone }) });
      beginVerification(result, phone);
    } catch (error) { loginNotice(error.message, "warn"); }
    finally { button.disabled = false; }
  });
  $("#verify-button").addEventListener("click", async () => {
    const button = $("#verify-button"), phone = $("#verify-phone").value.trim(), code = $("#verify-code").value.trim();
    button.disabled = true; $("#verify-notice").textContent = "جارٍ فحص الرمز والعضوية الحالية…";
    try {
      const result = await api("/api/captain/group-access/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
      state.phone = phone; $("#verify-code").value = ""; await openApp(result.user?.name || "");
    } catch (error) { $("#verify-notice").textContent = error.message || "تعذر التحقق."; }
    finally { button.disabled = false; }
  });
  $("#verify-back-button").addEventListener("click", () => showScreen("login-card"));
  $("#location-button").addEventListener("click", () => sendLocation(activeRide()?.id || null));
  $("#refresh-button").addEventListener("click", () => void load());
  $("#logout-button").addEventListener("click", async () => {
    stopWatch(); stopPolling(); closeStream(); await api("/api/captain/logout", { method: "POST" }).catch(() => {}); showScreen("login-card");
  });
  $("#lock-retry-button").addEventListener("click", async () => {
    const button = $("#lock-retry-button"); button.disabled = true; $("#lock-message").textContent = "جارٍ تحديث فحص العضوية…";
    try { await api("/api/captain/access"); await openApp(); }
    catch (error) {
      if (error.code === "captain_authentication_required" || error.code === "captain_group_verification_required") {
        $("#lock-title").textContent = "أعد تسجيل الدخول"; $("#lock-message").textContent = error.message || "سجّل الدخول بعد التأكد من عضويتك في القروب الرسمي.";
      } else lockAccess(error);
    }
    finally { button.disabled = false; }
  });
  $("#lock-login-button").addEventListener("click", () => { $("#pin").value = ""; showScreen("login-card"); });
  (async () => {
    try { await api("/api/captain/access"); await openApp(); }
    catch (error) {
      if (error.code === "captain_official_group_membership_required" || error.code === "captain_group_verification_unavailable") lockAccess(error);
      else showScreen("login-card");
    }
  })();
})();
