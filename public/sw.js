// Service worker: guarda la app para que abra rápido y sin conexión. Los datos en vivo siempre vienen de la red.
const CACHE = 'dondeviene-v7';
const SHELL = [
  '/', '/css/app.css', '/js/boot.js', '/js/app.js', '/js/ui.js', '/js/i18n.js', '/js/map.js', '/js/geo.js',
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

// Notificación push del servidor: "¡Ya viene tu camión!", aunque la app esté cerrada.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* aviso sin datos */ }
  e.waitUntil(self.registration.showNotification(data.title || '¿Dónde Viene?', {
    body: data.body || 'Tu camión está cerca.',
    tag: data.tag || 'dv', renotify: true,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 300],
    data: { url: data.url || '/' },
  }));
});

// Al tocar la notificación se abre la app (o se trae al frente si ya estaba abierta).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(location.origin));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
