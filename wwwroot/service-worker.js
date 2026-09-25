const CACHE_NAME = 'pharmacare-shell-v7-1';
const SHELL = ['/', '/index.html', '/css/app.css?v=7.1', '/js/app.js?v=7.1', '/js/offline-db.js?v=7.1', '/lib/jspdf.umd.min.js?v=7.1', '/lib/jspdf.plugin.autotable.min.js?v=7.1', '/manifest.webmanifest'];

/*
 PURPOSE:
 Caches the application shell so the POS interface can reopen without internet.
 REFERENCE:
 Business records are not stored in Cache Storage; products, batches and pending sales use IndexedDB instead.
*/
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

/*
 PURPOSE:
 Removes old shell caches after a deployment.
 REFERENCE:
 Version the CACHE_NAME whenever UI assets must be force-refreshed.
*/
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

/*
 PURPOSE:
 Uses network-first for API requests and cache-first for static application files.
 REFERENCE:
 API failures are handled by the client offline queue; the service worker never invents transaction responses.
*/
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy=response.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
