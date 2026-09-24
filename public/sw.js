// Cashier no longer uses a service worker. Browsers that installed the old
// precaching worker fetch this script on their next update check; it takes over
// immediately, drops every cache the old worker created, and unregisters itself.
// It has no fetch handler, so pages it still controls go straight to the network
// until they are next loaded. Keep serving it until installed copies have aged out.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })()
  );
});
