// Qonnect Field Operations — Service Worker
// Strategy: Network-first for API calls, Cache-first for static assets
// This ensures deploys always serve fresh code immediately

const CACHE_NAME = 'qonnect-v3';
const OFFLINE_URL = '/offline.html';

// Static assets to pre-cache on install. Deliberately does NOT include the
// built CSS/JS bundle files — those have content-hashed filenames that
// change on every build (e.g. /assets/index-XXXXXXXX.css), which a
// hand-written service worker can't know in advance. They get cached
// automatically by the fetch handler below the first time the page
// actually loads them, instead.
//
// Found and fixed: this list previously included '/index.css', a path
// that has never matched the real built output. cache.addAll() is
// all-or-nothing — one failing URL fails the ENTIRE install event, which
// silently meant this service worker has likely never successfully
// installed for anyone, on any previous version, confirmed by testing
// directly against the live server (fetch('/index.css') returns a real
// 404). install() below is also now resilient per-URL, so a single bad
// entry can never again take down the whole precache step.
const PRECACHE_ASSETS = [
  '/',
  '/offline.html',
];

// ── Install: pre-cache critical assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Precache failed for', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first strategy ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API calls — always go to network
  if (url.pathname.startsWith('/api/')) return;

  // Never intercept non-GET requests
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request)
      .then(response => {
        // Cache successful responses for static assets
        if (response.ok && !url.pathname.startsWith('/api/')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(request).then(cached => {
          if (cached) return cached;
          // Nothing in cache — show offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
