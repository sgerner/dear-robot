import { build, files, version } from '$service-worker';

const CACHE = `dear-robot-${version}`;
const ASSETS = [...build, ...files];
const DEV = import.meta.env.DEV;
const API_CACHE_PREFIX = '/api/';

function isCacheableApiPath(pathname: string) {
  if (!pathname.startsWith(API_CACHE_PREFIX)) return false;
  return !pathname.includes('/oauth/') && !pathname.includes('/webhooks/');
}

async function cacheFirst(request: Request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request: Request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return Response.error();
  }
}

self.addEventListener('install', (event) => {
  if (DEV) return;
  event.waitUntil(
    Promise.all([caches.open(CACHE).then((cache) => cache.addAll(ASSETS)), self.skipWaiting()])
  );
});

self.addEventListener('activate', (event) => {
  if (DEV) return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (DEV) return;
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request).then(async (response) => {
        if (response.type === 'error') {
          const fallback = await caches.match('/');
          return fallback || response;
        }
        return response;
      })
    );
    return;
  }

  if (isCacheableApiPath(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
