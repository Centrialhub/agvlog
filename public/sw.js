// Bump this value whenever the application shell changes. This prevents an
// already-open preview from falling back to an obsolete index.html after a
// deployment.
const CACHE_PREFIX = 'agvlog-driver-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/agvlog-192.png',
  '/icons/agvlog-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/', response.clone()));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
    );
    return;
  }

  const isBuildAsset = url.pathname.startsWith('/assets/')
    && ['script', 'style', 'font'].includes(request.destination);
  const isPublicImage = request.destination === 'image'
    && url.pathname.startsWith('/icons/');

  if (isBuildAsset || isPublicImage) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      })),
    );
  }
});
