// Service worker: guarda la app para que abra rápido y sin conexión. Los datos en vivo siempre vienen de la red.
const CACHE = 'dondeviene-v3';
const SHELL = [
  '/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/i18n.js', '/js/map.js', '/js/geo.js',
  '/js/passenger.js', '/js/driver.js', '/js/admin.js',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/descargas/')) return;
  // Red primero; si no hay conexión, la copia guardada.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  );
});
