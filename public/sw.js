// Minimal service worker: lets the app install on a phone and open its shell without a slow reload.
// It never caches database/API traffic, so quotations, rates and transfers are always live data.
const CACHE = 'lb-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase and other sites: straight to the network
  if (req.mode === 'navigate') { // always try the network first so a new version shows up; fall back to the cached page offline
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // hashed build files and icons: cache on first use
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname))) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  })));
});
