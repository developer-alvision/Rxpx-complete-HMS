/*
 * Service worker — offline shell and controlled updates.
 *
 * Local standalone storage keeps the hospital data available offline;
 * the service worker caches the HTML, CSS, and scripts for fast offline
 * startup and controlled updates.
 *
 * Strategy:
 *   HTML  network-first, falling back to cache, so staff normally get
 *         the newest page but still get a working one when offline.
 *   CSS / JS / images  cache-first with a background refresh, so pages
 *         paint instantly and update quietly.
 *
 * Bump CACHE_VERSION on every deploy. Old caches are deleted on
 * activate, which clears any stale CSS or scripts.
 */
const CACHE_VERSION = 'rxpx-v4-20261127';
const APP_SHELL = [
    './',
    'index.html',
    'dashboard.html',
    'doctor-dashboard.html',
    'patients.html',
    'patient-profile.html',
    'appointments.html',
    'op-queue.html',
    'consultation.html',
    'consultations.html',
    'lab-reports.html',
    'imaging.html',
    'billing.html',
    'today-collections.html',
    'pharmacy.html',
    'inventory-alerts.html',
    'maternity-care.html',
    'partograph.html',
    'bed-management.html',
    'ot-schedule.html',
    'discharge.html',
    'certificates.html',
    'accounts.html',
    'attendance.html',
    'admin.html',
    'css/style.css',
    'js/local-db.js',
    'js/helpers.js',
    'js/hospital-policy.js',
    'js/hospital-forms.js',
    'js/login.js',
    'js/dashboard.js',
    'js/i18n.js',
    'js/branch.js',
    'images/logo.png',
    'manifest.webmanifest'
];

// Requests that must always go to the network.
function isPassThrough(url) {
    return url.hostname.indexOf('googleapis.com') !== -1
        || url.hostname.indexOf('gstatic.com') !== -1
        || url.hostname.indexOf('firebaseio.com') !== -1
        || url.hostname.indexOf('firebaseapp.com') !== -1
        || url.hostname.indexOf('cloudfunctions.net') !== -1
        || url.hostname.indexOf('google.com') !== -1;
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) =>
            // Individually, so one 404 cannot fail the whole install.
            Promise.all(APP_SHELL.map((path) =>
                cache.add(path).catch((err) => console.warn('[sw] skipped', path, err.message))
            ))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    // The page asks for the new worker to take over after the user
    // accepts the update prompt.
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (isPassThrough(url)) return;

    const isDocument = request.mode === 'navigate'
        || (request.headers.get('accept') || '').includes('text/html');

    if (isDocument) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request).then((cached) =>
                    // Each caches.match is a promise, so these must be awaited
                    // in turn — `||` on promises always takes the first one.
                    cached || caches.match('dashboard.html')
                        .then((dash) => dash || caches.match('index.html'))
                ))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const copy = response.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
