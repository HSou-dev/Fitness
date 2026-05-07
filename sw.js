// NutriLog Service Worker
// Bump SW_VERSION on every deploy for instant updates.
const SW_VERSION = '2026-05-07-1';
const CACHE_NAME = `nutrilog-${SW_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] precache miss:', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Delete all old caches
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

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin requests (Firebase, Google Fonts, CDNs)
  if (url.origin !== self.location.origin) return;

  // HTML navigation → network-first (fresh content when online)
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // manifest.json and sw.js → always network-first so Chrome always
  // sees the latest version for installability checks
  if (url.pathname === '/manifest.json' || url.pathname === '/sw.js') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Static assets (icons, images, fonts) → cache-first for speed
  event.respondWith(cacheFirst(req));
});

// ── STRATEGIES ────────────────────────────────────────────────────────────────

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(req);
    // Cache any successful same-origin response (basic = same-origin, no redirect)
    if (response && response.status === 200) {
      cache.put(req, response.clone());
    }
    return response;
  } catch (_err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Fallback for navigation requests when fully offline
    if (req.mode === 'navigate') {
      const fallback = await cache.match('/index.html') || await cache.match('/');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    // Background-refresh so cache stays warm
    fetch(req).then((response) => {
      if (response && response.status === 200) {
        caches.open(CACHE_NAME).then((cache) => cache.put(req, response));
      }
    }).catch(() => {});
    return cached;
  }
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(req);
    if (response && response.status === 200) {
      cache.put(req, response.clone());
    }
    return response;
  } catch (_err) {
    return new Response('', { status: 503 });
  }
}

// ── MESSAGES ──────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
