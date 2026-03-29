const CACHE_NAME = 'wset-level-2-v5';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-512.png',
  './sections.js',
  './chapters.js',
  './content-registry.js',
  './app.js',
  './content/weinstruktur.js',
  './content/weinbau.js',
  './content/weinbereitung.js',
  './content/weisse_rebsorten_1.js',
  './content/weisse_rebsorten_2.js',
  './content/rote_rebsorten_1.js',
  './content/rote_rebsorten_2.js',
  './content/schaumwein.js',
  './content/suesswein.js',
  './content/frankreich.js',
  './content/italien.js',
  './content/spanien_portugal.js',
  './content/da_at_hu.js',
  './content/neue_welt.js',
  './content/lagerung_service_pairing.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      });
    })
  );
});

// Ermöglicht der App, den neuen SW sofort zu aktivieren
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
