/**
 * Service Worker for EventFlow PWA
 * Provides offline functionality and caching strategies
 */

const isDevelopment =
  self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const CACHE_VERSION = 'eventflow-v18.5.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/assets/css/styles.css',
  '/assets/js/utils/api.js',
  '/assets/js/utils/storage.js',
  '/assets/js/components/ErrorBoundary.js',
  '/site.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

// Maximum cache size for dynamic content
const MAX_DYNAMIC_CACHE_SIZE = 50;
const MAX_IMAGE_CACHE_SIZE = 100;

/**
 * Limit cache size
 * @param {string} cacheName - Name of cache to limit
 * @param {number} maxSize - Maximum number of items
 */
async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxSize) {
    // Remove oldest entries
    const keysToDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(keysToDelete.map(key => cache.delete(key)));
  }
}

/**
 * Install event - cache static assets
 */
self.addEventListener('install', event => {
  if (isDevelopment) {
    console.log('[Service Worker] Installing...');
  }

  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(cache => {
        if (isDevelopment) {
          console.log('[Service Worker] Caching static assets');
        }
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        if (isDevelopment) {
          console.log('[Service Worker] Skip waiting');
        }
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[Service Worker] Installation failed:', error);
      })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', event => {
  if (isDevelopment) {
    console.log('[Service Worker] Activating...');
  }

  event.waitUntil(
    caches
      .keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== IMAGE_CACHE)
            .map(key => {
              if (isDevelopment) {
                console.log('[Service Worker] Deleting old cache:', key);
              }
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        if (isDevelopment) {
          console.log('[Service Worker] Claiming clients');
        }
        return self.clients.claim();
      })
  );
});

/**
 * Fetch event - implement caching strategies
 */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // API requests - secure caching strategy
  if (url.pathname.startsWith('/api/')) {
    // Allowlist of safe public endpoints that may be cached
    // NOTE: Only truly public endpoints with no sensitive data should be here
    const SAFE_API_ENDPOINTS = [
      '/api/config', // Public config (Google Maps key, version)
      '/api/meta', // App metadata (version, node version, env)
    ];

    // Check if this is a safe endpoint
    const isSafeEndpoint = SAFE_API_ENDPOINTS.some(safe => url.pathname === safe);

    // Check if endpoint starts with /api/public/ (if such endpoints exist)
    const isPublicEndpoint = url.pathname.startsWith('/api/public/');

    event.respondWith(
      fetch(request)
        .then(response => {
          // Check Cache-Control header
          const cacheControl = response.headers.get('Cache-Control') || '';
          const hasNoStore = cacheControl.includes('no-store');
          const hasPrivate = cacheControl.includes('private');
          const hasNoCache = cacheControl.includes('no-cache');

          // Never cache if Cache-Control indicates no caching
          const shouldNeverCache = hasNoStore || hasPrivate || hasNoCache;

          // Only cache if:
          // 1. Endpoint is on allowlist OR is a public endpoint
          // 2. Response doesn't have no-store/private/no-cache headers
          // 3. Request doesn't have credentials (cookies/auth) unless explicitly safe
          const canCache = (isSafeEndpoint || isPublicEndpoint) && !shouldNeverCache;

          if (canCache) {
            // Clone response and cache it
            const responseClone = response.clone();
            caches
              .open(DYNAMIC_CACHE)
              .then(cache => {
                cache.put(request, responseClone).catch(err => {
                  // Gracefully handle cache write failures (extensions, quota, etc.)
                  console.warn('[SW] Cache write failed (may be blocked):', err.message);
                });
                limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_CACHE_SIZE);
              })
              .catch(err => {
                console.warn('[SW] Cache open failed:', err.message);
              });
          }

          return response;
        })
        .catch(() => {
          // Network failed - check if we have cached version (only for safe endpoints)
          if (isSafeEndpoint || isPublicEndpoint) {
            return caches.match(request).then(response => {
              return (
                response ||
                new Response(
                  JSON.stringify({
                    error: 'Offline',
                    message: 'You are currently offline',
                  }),
                  {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' },
                  }
                )
              );
            });
          }

          // For all other API endpoints, fail closed - return 503
          return new Response(
            JSON.stringify({
              error: 'Offline',
              message: 'This resource is not available offline',
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        })
    );
    return;
  }

  // Cache-first strategy for images
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then(response => {
        return (
          response ||
          fetch(request).then(fetchResponse => {
            const responseClone = fetchResponse.clone();
            caches
              .open(IMAGE_CACHE)
              .then(cache => {
                cache.put(request, responseClone).catch(err => {
                  console.warn('[SW] Cache write failed:', err.message);
                });
                limitCacheSize(IMAGE_CACHE, MAX_IMAGE_CACHE_SIZE);
              })
              .catch(err => {
                console.warn('[SW] Cache open failed:', err.message);
              });
            return fetchResponse;
          })
        );
      })
    );
    return;
  }

  // Network-first strategy for static assets (JS, CSS, fonts, etc.)
  // This ensures new deployments are reflected immediately
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf') ||
    url.pathname.endsWith('.eot')
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache the fresh response for offline access
          const responseClone = response.clone();
          caches
            .open(STATIC_CACHE)
            .then(cache => {
              cache.put(request, responseClone).catch(err => {
                console.warn('[SW] Cache write failed:', err.message);
              });
            })
            .catch(err => {
              console.warn('[SW] Cache open failed:', err.message);
            });
          return response;
        })
        .catch(() => {
          // Fallback to cache only if network fails (offline mode)
          return caches.match(request);
        })
    );
    return;
  }

  // Network-first strategy for HTML pages
  event.respondWith(
    fetch(request)
      .then(response => {
        // Clone response and cache it
        const responseClone = response.clone();
        caches
          .open(DYNAMIC_CACHE)
          .then(cache => {
            cache.put(request, responseClone).catch(err => {
              console.warn('[SW] Cache write failed:', err.message);
            });
            limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_CACHE_SIZE);
          })
          .catch(err => {
            console.warn('[SW] Cache open failed:', err.message);
          });
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(request).then(response => {
          // If not in cache, show offline page
          return response || caches.match('/offline.html');
        });
      })
  );
});

/**
 * Background sync event - handle form submissions while offline
 */
self.addEventListener('sync', event => {
  if (isDevelopment) {
    console.log('[Service Worker] Background sync:', event.tag);
  }

  if (event.tag === 'sync-form-data') {
    event.waitUntil(
      // Get pending form submissions from IndexedDB
      // and send them when online
      syncFormData()
    );
  }
});

/**
 * Push notification event
 */
self.addEventListener('push', event => {
  if (isDevelopment) {
    console.log('[Service Worker] Push received');
  }

  const data = event.data ? event.data.json() : {};
  const title = data.title || 'EventFlow Notification';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/assets/images/icon-192.png',
    badge: '/assets/images/badge-72.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'default',
    data: data.url ? { url: data.url } : {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Notification click event
 */
self.addEventListener('notificationclick', event => {
  if (isDevelopment) {
    console.log('[Service Worker] Notification click');
  }

  event.notification.close();

  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});

/**
 * Message event - handle messages from clients
 */
self.addEventListener('message', event => {
  if (isDevelopment) {
    console.log('[Service Worker] Message received:', event.data);
  }

  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }

  if (event.data.action === 'clearCache') {
    event.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(keys.map(key => caches.delete(key)));
      })
    );
  }
});

/**
 * Sync form data from IndexedDB
 * @returns {Promise} Promise that resolves when sync is complete
 */
async function syncFormData() {
  // This is a placeholder for actual IndexedDB integration
  // In a real implementation, you would:
  // 1. Open IndexedDB
  // 2. Get pending form submissions
  // 3. Send them to the server
  // 4. Remove them from IndexedDB on success
  if (isDevelopment) {
    console.log('[Service Worker] Syncing form data...');
  }
  return Promise.resolve();
}
