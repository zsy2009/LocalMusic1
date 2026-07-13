const CACHE_NAME = 'musiccloud-v68-i18n-lyrics-notice';
const ASSETS = [];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))))
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.map((name) => caches.delete(name))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/')) return;
    e.respondWith(fetch(e.request));
});
