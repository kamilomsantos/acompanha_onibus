// Service Worker — Aê, Piloto
// Estratégia: cache-first para o shell do app (HTML, planner, linhas);
//             network-first para o GPS (sempre fresco).
'use strict';

const CACHE  = 'ae-piloto-v20261006-5';
const SHELL  = [
  '/acompanha_onibus/',
  '/acompanha_onibus/index.html',
  '/acompanha_onibus/planner.js',
  '/acompanha_onibus/linhas.json',
  '/acompanha_onibus/manifest.json',
  '/acompanha_onibus/icon-192.png',
  '/acompanha_onibus/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap',
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // GPS e Worker: sempre da rede
  if (url.includes('workers.dev') || url.includes('mobilidade.rio') || url.includes('githubusercontent.com/kamilomsantos')) {
    return;
  }
  // Shell: cache-first
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(resp) {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return resp;
      }).catch(function() { return cached; });
    })
  );
});
