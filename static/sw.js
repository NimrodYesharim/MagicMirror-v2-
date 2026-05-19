// MagicMirror Service Worker — offline cache + instant reload
const CACHE_NAME = 'magicmirror-v1';

// Core assets to pre-cache on install
const PRECACHE_URLS = [
  '/css/main.css',
  '/js/app.js',
  '/js/ws.js',
];

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API/HTML, cache-first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip WebSocket, POST, and non-GET requests
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/ws')) return;

  // API and HTML: network-first (always want fresh data)
  if (url.pathname.startsWith('/api/') || url.pathname === '/mirror' || url.pathname === '/') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets (JS, CSS, fonts, icons): cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Background refresh for next time
        fetch(event.request).then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
