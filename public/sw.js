const CACHE_PREFIX = 'agvlog-driver-shell-';
// Replaced by the Vite build with a digest of the emitted application and
// driver shell. The public template is never registered in development.
const BUILD_HASH = '__AGVLOG_BUILD_HASH__';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_HASH}`;
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/driver-shell-assets.json',
  '/driver-build.json',
  '/icons/agvlog-192.png',
  '/icons/agvlog-512.png',
];

async function cacheApplicationShell() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch('/', { cache:'no-store' });
    if (!response.ok) throw new Error('Application shell unavailable');
    const html = await response.clone().text();
    const buildAssets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
      .map((match) => match[1]);
    const manifestResponse=await fetch('/driver-shell-assets.json',{cache:'no-store'});
    if(!manifestResponse.ok)throw new Error('Driver asset manifest unavailable');
    const driverAssets=await manifestResponse.json();
    if(!Array.isArray(driverAssets)||!driverAssets.every(path=>typeof path==='string'&&path.startsWith('/assets/'))){
      throw new Error('Driver asset manifest invalid');
    }
    const required=[...APP_SHELL.filter((path) => path !== '/'), ...new Set([...buildAssets,...driverAssets])];
    // A waiting worker only exists after every required response is available.
    // If any fetch fails, the incomplete build cache is removed and the active
    // worker keeps serving the previous complete build.
    await cache.addAll(required);
    await cache.put('/', response);
    const cached=await Promise.all(['/',...required].map(path=>cache.match(path)));
    if(cached.some(entry=>!entry))throw new Error('Application shell cache incomplete');
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplicationShell());
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

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
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

  // Vite modulepreload requests may expose an empty destination in Chromium.
  // The /assets/ namespace is content-hashed build output, so every GET there
  // is safe to serve cache-first regardless of the destination hint.
  const isBuildAsset = url.pathname.startsWith('/assets/');
  const isPublicImage = request.destination === 'image'
    && url.pathname.startsWith('/icons/');

  if (isBuildAsset || isPublicImage) {
    event.respondWith(
      // Vite preview/CDNs may emit `Vary: Origin`; module scripts use
      // `crossorigin` while install-time requests do not. The URL is immutable
      // and content-hashed, so matching it while ignoring Vary is intentional.
      caches.match(url.pathname, { ignoreSearch:true, ignoreVary:true }).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      })),
    );
  }
});
