const CACHE_NAME = 'despensa-online-v2'; // subir el número al cambiar el set de assets cacheados
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon.svg',
    './js/state.js',
    './js/utils.js',
    './js/storage.js',
    './js/api.js',
    './js/despensa.js',
    './js/recetas.js',
    './js/menu.js',
    './js/lista-compra.js',
    './js/config.js',
    './js/event-handler.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Nunca cachear la API de datos de Supabase ni peticiones no-GET
    if (event.request.method !== 'GET' || url.href.includes('supabase.co') || url.pathname.includes('/rest/v1/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
