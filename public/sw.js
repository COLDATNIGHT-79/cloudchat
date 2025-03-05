self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open('dropit-cache').then((cache) => {
        return cache.addAll([
          '/',
          '/index.html',
          '/room.html',
          '/style.css',
          '/client.js',
          '/icons/icon-192x192.png',
          '/icons/icon-512x512.png'
        ]);
      })
    );
  });
  
  self.addEventListener('fetch', (event) => {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  });
  