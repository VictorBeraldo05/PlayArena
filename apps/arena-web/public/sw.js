const STATIC_CACHE = 'playarena-static-v1';

function isCacheableAsset(pathname) {
  return pathname !== '/sw.js'
    && (pathname.startsWith('/_next/static/')
    || pathname.startsWith('/icons/')
    || pathname.startsWith('/img/')
    || pathname === '/favicon.ico');
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((cacheName) => cacheName.startsWith('playarena-static-') && cacheName !== STATIC_CACHE)
      .map((cacheName) => caches.delete(cacheName)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !isCacheableAsset(url.pathname)) return;

  // Navigation, API, and authenticated responses intentionally never reach this cache.
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    const networkResponse = fetch(request).then(async (response) => {
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    });

    if (cachedResponse) {
      void networkResponse.catch(() => undefined);
      return cachedResponse;
    }

    return networkResponse;
  })());
});
