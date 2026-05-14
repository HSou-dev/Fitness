// ─────────────────────────────────────────────────────────────────
// NutriLog Service Worker
// ─────────────────────────────────────────────────────────────────
// Strategy: NETWORK-FIRST for HTML/JSON, CACHE-FIRST for static assets.
// The HTML always pulls fresh from network when online — so when you
// push a new version, users see it on next page load (no manual cache
// clearing required).
//
// HOW TO TRIGGER AN UPDATE AFTER PUSHING CHANGES:
// Bump the SW_VERSION below before pushing. Bumping forces every
// installed copy of the app to detect a new service worker and
// activate it on the next page load. Without bumping, browsers may
// not always re-fetch sw.js (they aggressively cache it).
//
// You don't actually NEED to bump — the byte-comparison Chrome does
// every 24h will eventually detect any change — but bumping makes
// updates instant.
// ─────────────────────────────────────────────────────────────────

const SW_VERSION = '2026-05-14-6';   // ← bump this after each push for instant updates
const CACHE_NAME = `nutrilog-${SW_VERSION}`;

// Files we want available even when fully offline. The HTML itself is
// listed so that the app shell loads from cache if the network is dead.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ─── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] precache miss:', url, err))
        )
      )
    )
  );
  // Take over IMMEDIATELY without waiting for old SW to die.
  // This is what makes updates fast.
  self.skipWaiting();
});

// ─── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('nutrilog-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      ),
      self.clients.claim(),
    ])
  );
});

// ─── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't intercept cross-origin requests (Firebase, Google Fonts, Open Food Facts).
  if (url.origin !== self.location.origin) return;

  // HTML navigation: NETWORK-FIRST so users always get the latest version when online
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Manifest, sw.js, JSON: also network-first
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('sw.js')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else (images, icons): CACHE-FIRST for speed
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      return (
        (await caches.match('./index.html')) ||
        (await caches.match('./')) ||
        new Response('Offline', { status: 503 })
      );
    }
    return new Response('Offline and not cached', { status: 503 });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    // Background refresh — quietly update cache without delaying response
    fetch(req)
      .then((fresh) => {
        if (fresh && fresh.ok && fresh.type === 'basic') {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, fresh));
        }
      })
      .catch(() => {});
    return cached;
  }
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    return new Response('Offline and not cached', { status: 503 });
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
