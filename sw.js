// Service Worker for toyennard21/fnaf-ucn-zfb
// Caches core files and uses a cache-first strategy for large resources under /resources/

const CACHE_NAME = 'fnaf-ucn-cache-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/src/Runtime.js'
];

// Maximum number of entries to keep in the runtime cache for resources
const RUNTIME_CACHE = 'fnaf-ucn-runtime-v1';
const MAX_RUNTIME_ENTRIES = 100; // avoid unbounded cache growth

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Clean up old caches
      const keys = await caches.keys();
      await Promise.all(keys.map(key => {
        if (key !== CACHE_NAME && key !== RUNTIME_CACHE) return caches.delete(key);
      }));
      await self.clients.claim();
    })()
  );
});

// Helper to limit cache size (FIFO)
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const deleteCount = keys.length - maxEntries;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // 1) Serve navigation requests (HTML) from cache-first then network fallback
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      caches.match('/index.html').then(cached => cached || fetch(request))
    );
    return;
  }

  // 2) Resources under /resources/ (images, audio) - cache-first with background update
  if (url.origin === location.origin && url.pathname.startsWith('/resources/')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async cache => {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          // In background, update the cached copy
          event.waitUntil(
            fetch(request).then(resp => {
              if (resp && resp.ok) cache.put(request, resp.clone());
              trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
            }).catch(()=>{})
          );
          return cachedResponse;
        }
        // Not cached: fetch and cache
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            cache.put(request, response.clone());
            trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
          }
          return response;
        } catch (err) {
          // network failed, try to return something from PRECACHE as fallback
          return caches.match('/index.html');
        }
      })
    );
    return;
  }

  // 3) For other static same-origin requests, try cache first, otherwise network
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  // 4) For cross-origin requests (CDNs), use network-first
  // Let them go to network by default (no special handling)
});

// Listen for a message from the page to skip waiting and activate the new SW
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
