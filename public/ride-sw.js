const CACHE = 'v27-ride-shell-v1';
const SHELL = ['/ride.html', '/ride-manifest.webmanifest', '/aljarah-logo-mark-clean.webp'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).origin !== self.location.origin || event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/ride.html'))));
});
