const CACHE_NAME = 'wset-level-2-v19';
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
  // 01 Grundlagen
  './content/weinstruktur.js',
  './content/verkostungssystematik.js',
  './content/qualitaetsbeurteilung.js',
  // 02 Weinbau
  './content/klima_und_standort.js',
  './content/lese.js',
  './content/weinberg_management.js',
  // 03 Weinherstellung
  './content/weinbereitung_weisswein.js',
  './content/weinbereitung_rotwein.js',
  './content/weinbereitung_rose.js',
  './content/reifung_und_ausbau.js',
  // 04 Weiße Rebsorten
  './content/chardonnay.js',
  './content/sauvignon_blanc.js',
  './content/riesling.js',
  './content/pinot_grigio_pinot_gris.js',
  './content/weitere_weissweine.js',
  // 05 Rote Rebsorten
  './content/cabernet_sauvignon.js',
  './content/merlot.js',
  './content/pinot_noir.js',
  './content/syrah.js',
  './content/rotweine_mediterran.js',
  './content/rotweine_international.js',
  // 06 Schaumwein
  './content/schaumwein_grundlagen.js',
  './content/herstellungsverfahren_schaumwein.js',
  // 07 Süßwein
  './content/suesswein_grundlagen.js',
  './content/herstellungsverfahren_suesswein.js',
  // 08 Weinregionen
  './content/frankreich.js',
  './content/da_at_hu.js',
  './content/spanien_portugal.js',
  './content/italien.js',
  './content/usa.js',
  './content/suedamerika.js',
  './content/australien_neuseeland.js',
  './content/suedafrika.js',
  // 09 Service & Pairing
  './content/lagerung.js',
  './content/service.js',
  './content/food_pairing.js'
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
