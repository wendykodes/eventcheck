// Service Worker for offline support
// Caches critical data: guest lists, activities, event info
// Enables offline check-in with sync queue

const CACHE_NAME = 'eventcheck-v12';
const CRITICAL_CACHE = 'eventcheck-critical-v12';
const STATIC_CACHE = 'eventcheck-static-v12';

// Critical API endpoints to cache
const CRITICAL_PATTERNS = [
  /\/api\/events\/\d+$/,
  /\/api\/events\/\d+\/guests/,
  /\/api\/events\/\d+\/activities/,
  /\/api\/dashboard\/\d+$/,
  /\/api\/staff\/dashboard/,
  /\/api\/staff\/timeline/,
];

// Static assets to cache
const STATIC_ASSETS = [
  '/',
  '/login',
  '/checkin',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing');
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
    ])
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== CRITICAL_CACHE && cacheName !== STATIC_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle static assets with cache-first strategy
  if (!url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // Handle API requests
  if (event.request.method === 'GET') {
    const isCritical = CRITICAL_PATTERNS.some(pattern => pattern.test(url.pathname));

    if (isCritical) {
      event.respondWith(
        caches.open(CRITICAL_CACHE).then((cache) => {
          return cache.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetchAndCache(event.request, cache);
            
            if (cachedResponse) {
              // Return cached response immediately, fetch in background
              fetchPromise.catch(() => {});
              return cachedResponse;
            }

            return fetchPromise;
          });
        }).catch(() => {
          // If cache fails, try network
          return fetch(event.request);
        })
      );
    }
  }
});

async function fetchAndCache(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseToCache = response.clone();
      cache.put(request, responseToCache);
    }
    return response;
  } catch (error) {
    console.error('[SW] Fetch failed:', error);
    throw error;
  }
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-checkins') {
    event.waitUntil(syncCheckins());
  }
});

async function syncCheckins() {
  // This would sync offline check-ins when connection is restored
  console.log('[SW] Syncing offline check-ins');
  // Implementation would read from IndexedDB and send to server
}

// Push notifications
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New notification',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('EventCheck', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});

// Listen for messages from clients
self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      event.ports[0].postMessage({ status: 'CACHE_CLEARED' });
    });
  }
});
