// Service Worker — Aê, Piloto
// Estratégia: network-first para HTML/JS/JSON (sempre fresco, cai no cache se offline);
//             cache-first para fontes e ícones (raramente mudam);
//             sem cache para GPS/Worker (tempo real).
'use strict';

const CACHE  = 'ae-piloto-v20261025-6';
const CACHE_ONLY = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap',
  '/acompanha_onibus/icon-192.png',
  '/acompanha_onibus/icon-512.png',
  '/acompanha_onibus/manifest.json',
];
const NETWORK_FIRST = [
  '/acompanha_onibus/',
  '/acompanha_onibus/index.html',
  '/acompanha_onibus/apuracao.html',
  '/acompanha_onibus/planner.js',
  '/acompanha_onibus/linhas.json',
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) { return c.addAll(CACHE_ONLY.concat(NETWORK_FIRST)); })
      .then(function() { return self.skipWaiting(); })
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
  // Tempo real: nunca cachear
  if (url.includes('workers.dev') || url.includes('mobilidade.rio') ||
      url.includes('resultados.tse.jus.br') ||
      url.includes('githubusercontent.com/kamilomsantos') || url.includes('radarmeteorologico.com.br')) {
    return;
  }
  var isNetFirst = NETWORK_FIRST.some(function(p) { return url.endsWith(p) || url === location.origin + p; });
  if (isNetFirst) {
    // Network-first: pega da rede, atualiza cache; se offline, usa cache
    e.respondWith(
      fetch(e.request).then(function(resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return resp;
      }).catch(function() { return caches.match(e.request); })
    );
  } else {
    // Cache-first para estáticos (fontes, ícones, leaflet)
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(resp) {
          if (resp && resp.status === 200 && e.request.method === 'GET') {
            var clone = resp.clone();
            caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
          }
          return resp;
        });
      })
    );
  }
});
