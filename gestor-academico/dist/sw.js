// ============================================================
// SERVICE WORKER — Gestor Académico YC
// Objetivo: habilitar la instalación como PWA y dar una capa
// básica de resiliencia si la conexión falla momentáneamente.
// NO cachea llamadas a la API (/api/...) para no servir datos
// desactualizados: esas peticiones siempre van a la red.
// Estrategia para archivos propios (HTML/JS/CSS/íconos):
// "network-first" -> si hay red, se usa y se refresca la caché;
// si falla, se sirve la última copia guardada en caché.
// ============================================================
const CACHE_NAME = 'gestor-yc-shell-v1';
const CORE_ASSETS = [
  '/portal.html',
  '/config.js',
  '/favicon.svg',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/modules/01-proteccion.js',
  '/modules/02-sheetjs-loader.js',
  '/modules/03-app-core.js',
  '/modules/04-ficha-matricula.js',
  '/modules/05-pdf-ficha-blanco.js',
  '/modules/06-documentos-y-resto.js'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(CORE_ASSETS).catch(function(){ /* algún asset pudo no existir aún; no bloquear instalación */ });
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k!==CACHE_NAME; }).map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  const req = event.request;
  const url = new URL(req.url);

  // Solo manejar peticiones GET del mismo origen. Todo lo demás
  // (API, POST, dominios externos como CDNs) pasa directo a la red.
  if(req.method!=='GET' || url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req).then(function(res){
      if(res && res.ok){
        const copia = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copia); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(cached){
        return cached || caches.match('/portal.html');
      });
    })
  );
});
