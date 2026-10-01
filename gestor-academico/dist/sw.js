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
// RONDA 94 — AUDITORÍA OFFLINE-FIRST: CACHE_NAME se sube de versión para que
// todos los dispositivos ya instalados descarten su caché vieja (incompleta)
// y precarguen la lista corregida de abajo en su próxima visita con señal.
// RONDA 98 — ACTUALIZACIÓN AUTOMÁTICA DE LA PWA: se sube de versión otra vez
// junto con el nuevo mecanismo de registration.update() proactivo agregado
// en portal.html — cualquier cambio de bytes en este archivo (como este
// mismo bump) es justo lo que dispara la detección de "hay una versión
// nueva" en el navegador — sin este cambio, esa revisión hasta ahora era
// pasiva (solo cuando el navegador decidía hacerla por su cuenta).
// self.skipWaiting() (más abajo, en 'install') y
// self.clients.claim() (en 'activate') YA estaban activos desde antes — lo
// que faltaba era forzar la revisión, no la toma de control; ver el
// comentario extenso en portal.html.
// RONDA 99-HOTFIX — se sube de versión OTRA VEZ: el usuario reportó, tras
// instalar el paquete de la Ronda 99, que la pantalla de Consolidados
// seguía mostrando el comportamiento viejo del PUESTO (columna = número de
// fila) aun cuando el código fuente de esa ronda YA calculaba el puesto
// correcto (verificado con una prueba dirigida que reproduce el caso
// exacto reportado — ver test_ronda99b_hotfix_...). La causa más probable
// es precisamente el mecanismo de caché de este Service Worker: sin un
// cambio de bytes en sw.js, "registration.update()" (Ronda 98) no tiene
// nada nuevo que detectar y el navegador puede seguir sirviendo, en
// "network-first" con fallback a caché, una copia de 03-app-core.js
// anterior a este paquete. Este bump es el que fuerza esa detección.
// RONDA 99-HOTFIX2 — se sube de versión OTRA VEZ: esta ronda corrige un
// bug de raíz GENUINO (no de caché) en el algoritmo de PUESTO — ver el
// comentario extenso junto a _calcularRankingGrado() en 03-app-core.js —
// más la reactividad automática del módulo de Consolidados. Se mantiene
// la misma disciplina de subir CACHE_NAME en cada paquete que toca
// 03-app-core.js, para que cualquier dispositivo con la PWA ya instalada
// reciba la versión nueva de inmediato en vez de quedarse con una copia
// en caché.
// RONDA 100 — se sube de versión OTRA VEZ: se restringió por permisos
// (Director de Grupo/titular del grado, o Admin) quién puede VER y USAR
// el botón ✏️ de ajuste manual de puesto — ver _puedeEditarPuestoManual()
// en 03-app-core.js.
const CACHE_NAME = 'gestor-yc-shell-v7-20261001';
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
  '/modules/06-documentos-y-resto.js',
  // RONDA 94 — faltaban estos dos módulos en la precarga de instalación:
  // 07-sync-engine.js y 08-outbox-notas.js son justamente los que implementan
  // la cola de sincronización y el reintento offline de notas/actividades.
  // Sin estar precargados, un dispositivo que instala la PWA y abre la app
  // por PRIMERA vez ya sin señal (antes de que el "network-first" del fetch
  // handler alcance a guardarlos en caché por su cuenta) se queda sin esta
  // lógica — justo la que más falta hace estando offline.
  '/modules/07-sync-engine.js',
  '/modules/08-outbox-notas.js'
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

// ============================================================
// NOTIFICACIONES PUSH — se muestran incluso con la app cerrada,
// siempre que el usuario haya activado las notificaciones en este
// dispositivo (ver activarNotificacionesPush() en 03-app-core.js).
// ============================================================
self.addEventListener('push', function(event){
  let datos = {};
  try{ datos = event.data ? event.data.json() : {}; }catch(e){}
  const titulo = datos.title || 'Gestor Académico YC';
  const opciones = {
    body: datos.body || 'Tiene una notificación nueva.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: datos.kind || 'general',
    data: { url: '/portal.html' }
  };
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/portal.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(listaClientes){
      for (const c of listaClientes) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});
