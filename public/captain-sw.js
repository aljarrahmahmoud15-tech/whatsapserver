const CACHE = 'v27-captain-shell-v1';
const SHELL = ['/captain', '/captain.html', '/captain-manifest.json', '/aljarah-logo-mark-clean.png'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then((response) => { const copy=response.clone(); caches.open(CACHE).then((cache)=>cache.put(event.request,copy)); return response; }).catch(() => caches.match(event.request).then((cached)=>cached || caches.match('/captain'))));
});
