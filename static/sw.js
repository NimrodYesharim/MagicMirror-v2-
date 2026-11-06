// MagicMirror Service Worker — offline fallback cache
// Network-first for everything: the server is on the same machine, so the network is
// always fast, and cache-first used to keep serving old JS/CSS after an update.
const CACHE_NAME = 'magicmirror-v2';

const PRECACHE_URLS = [
  '/css/main.css',
  '/js/app.js',
  '/js/ws.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: drop old caches (v1 held stale cache-first copies)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/ws')) return;

  event.respondWith(
    fetch(event.request).then(response => {
      // Keep a copy of static files for offline fallback (API data changes, so skip it)
      if (response && response.ok && !url.pathname.startsWith('/api/')) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
