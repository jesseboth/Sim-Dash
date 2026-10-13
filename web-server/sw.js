// Service worker for app install. Requests go to the network, so data is always live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    if (new URL(event.request.url).origin !== self.location.origin) return;
    event.respondWith(fetch(event.request));
});
