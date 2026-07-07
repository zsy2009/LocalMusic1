const CACHE_NAME = 'musiccloud-v6';
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/visualizer-worker.js',
    '/logo.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
    // 1. 放行 API 请求，走真实网络
    if (e.request.url.includes('/api/')) {
        return;
    }

    // 2. 修复 Chrome DevTools 禁用缓存导致的 Bug
    if (e.request.cache === 'only-if-cached' && e.request.mode !== 'same-origin') {
        return;
    }

    // 3. 正常的缓存优先策略
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        }).catch(() => {
            console.log("Fetch 失败，可能处于离线状态或请求被拦截");
        })
    );
});
