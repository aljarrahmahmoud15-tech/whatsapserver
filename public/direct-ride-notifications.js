(() => {
  const toneByStatus = {
    offered: "gold",
    assigned: "gold",
    arrived: "mint",
    in_trip: "mint",
    completed: "mint",
    cancelled: "red",
  };
  let audioContext = null;

  function prime() {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") void audioContext.resume();
    } catch {}
  }

  function beep(status = "updated") {
    try {
      if (!audioContext) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const first = status === "offered" || status === "assigned" ? 660 : status === "cancelled" ? 260 : 520;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(first, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(first * 1.18, audioContext.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.24);
    } catch {}
  }

  async function requestPermission() {
    try {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    } catch {}
  }

  function showSystemNotification(payload, audience) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = `V27 · ${audience === "captain" ? "عرض رحلة" : "تحديث الرحلة"}`;
    try {
      const options = { body: payload.message, tag: `v27-ride-${payload.rideId}`, renotify: true, requireInteraction: ["offered", "assigned", "arrived"].includes(payload.status), data: { rideId: payload.rideId, status: payload.status } };
      if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: "V27_NOTIFICATION", title, options });
      else new Notification(title, options);
    } catch {}
  }

  function stack() {
    let element = document.querySelector(".v27-notification-stack");
    if (!element) {
      element = document.createElement("div");
      element.className = "v27-notification-stack";
      element.setAttribute("aria-live", "polite");
      document.body.appendChild(element);
    }
    return element;
  }

  function notify(payload, audience = "rider") {
    if (!payload || payload.silent || payload.eventType === "heartbeat" || payload.eventType === "connected") return;
    prime();
    beep(payload.status);
    if (navigator.vibrate) navigator.vibrate(payload.status === "cancelled" ? [80, 40, 80] : 55);
    showSystemNotification(payload, audience);
    const item = document.createElement("div");
    item.className = `v27-notification ${toneByStatus[payload.status] || ""}`;
    const dot = document.createElement("i");
    dot.className = "v27-notification-dot";
    const copy = document.createElement("div");
    copy.className = "v27-notification-copy";
    const title = document.createElement("strong");
    title.textContent = payload.requestCode ? `${payload.requestCode} · V27` : "V27";
    const message = document.createElement("span");
    message.textContent = payload.message || "تم تحديث حالة الرحلة.";
    copy.append(title, message);
    const time = document.createElement("span");
    time.className = "v27-notification-time";
    time.textContent = "الآن";
    item.append(dot, copy, time);
    stack().prepend(item);
    setTimeout(() => item.remove(), 6500);
  }

  function connect({ url, audience = "rider", onEvent = () => {}, onConnectionChange = () => {} } = {}) {
    if (!("EventSource" in window)) {
      onConnectionChange("unsupported");
      return null;
    }
    const source = new EventSource(url);
    source.addEventListener("ride-status", (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        notify(payload, audience);
        onEvent(payload);
      } catch {}
    });
    source.onopen = () => onConnectionChange("connected");
    source.onerror = () => onConnectionChange("reconnecting");
    return source;
  }

  window.V27Notifications = { connect, notify, prime, requestPermission };
})();
