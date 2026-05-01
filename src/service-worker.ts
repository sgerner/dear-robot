import { build, files, version } from '$service-worker';

const CACHE = `triage-${version}`;
const ASSETS = [...build, ...files];
const DEV = import.meta.env.DEV;

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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
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
      fetch(request).catch(async () => {
        const cached = await caches.match(request);
        return cached || caches.match('/').then((fallback) => fallback || Response.error());
      })
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && !url.pathname.startsWith('/api/')) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
