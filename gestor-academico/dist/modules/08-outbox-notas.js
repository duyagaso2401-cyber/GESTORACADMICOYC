// ════════════════════════════════════════════════════════════════════════════
// 08-OUTBOX-NOTAS · COLA DE RESILIENCIA OFFLINE (IndexedDB, Outbox Pattern)
// ------------------------------------------------------------------------------
// RONDA 45 — DIMENSIÓN 2. Lea esto antes de tocar el archivo.
//
// QUÉ ES Y QUÉ NO ES: este módulo NO reemplaza el mecanismo de guardado que
// ya existe desde las Rondas 36/41 (_debounceGuardarFilaNotas +
// _enviarFilaNotasAlServidor, en 03-app-core.js) — ese mecanismo YA hace
// actualización optimista (el valor se ve en pantalla al instante, la red
// va detrás) y YA tiene su propio respaldo (si guardar-fila falla, cae al
// blob completo vía _pushDB). Ese camino sigue existiendo EXACTAMENTE
// igual, sin tocarlo.
//
// Lo que este módulo agrega es una segunda capa, específica para
// CONECTIVIDAD REALMENTE CAÍDA (el navegador no tiene red — el `catch()`
// de un `fetch()`, no un error 4xx/5xx del servidor, que es un caso
// distinto que el código existente ya maneja): en vez de solo reintentar
// una vez con un timeout corto (como hacía antes), la nota se ENCOLA en
// IndexedDB como un evento `NOTA_CAMBIADA` — sobrevive a que se cierre la
// pestaña, se recargue la página o el celular se quede sin señal por
// horas — y un trabajador en segundo plano la reintenta con backoff
// exponencial apenas detecta conexión, hasta drenar la cola por completo,
// en el mismo orden en que se generaron los cambios (FIFO), sin re-renderizar
// nada de la tabla: solo actualiza el indicador visual puntual de la
// celda/fila que por fin se confirmó.
//
// POR QUÉ COEXISTE EN VEZ DE REEMPLAZAR (tensión de diseño reconocida
// explícitamente, tal como pidió el coordinador que se documentara): el
// mecanismo existente ya resuelve el caso común ("hubo un hipo de red de
// unos segundos, se reintenta pronto") de forma simple y ya probada en 43
// rondas de producción. Reemplazarlo por completo habría significado
// reescribir el flujo crítico de guardado de notas sin poder probar
// concurrencia ni IndexedDB de navegador real en este entorno — el mismo
// riesgo que la Ronda 44 ya rechazó para el almacenamiento del backend.
// En cambio, esta cola solo entra en juego en el caso que el mecanismo
// viejo maneja peor: SIN CONEXIÓN DE VERDAD, por un tiempo largo — ahí es
// donde persistir en IndexedDB (en vez de perder el reintento si se
// cierra la pestaña) aporta valor real y adicional, sin quitarle nada al
// camino que ya funciona.
//
// Se carga como script plano (como el resto de gestor-academico/dist/
// modules), después de 03-app-core.js — ver portal.html.
// ════════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const DB_NAME = '_outboxNotasDB';
  const DB_VERSION = 1;
  const STORE = 'cola_notas_pendientes';
  // Backoff exponencial: 1s, 2s, 4s, 8s, tope 16s (no crece indefinidamente
  // — evita que, tras muchas horas sin red, el primer reintento al volver
  // la señal tarde minutos).
  const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

  let _dbPromise = null;
  function _abrirDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) { reject(new Error('IndexedDB no disponible en este navegador')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('estado', 'estado', { unique: false });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  // Encola un evento NOTA_CAMBIADA. `payload` es EXACTAMENTE el mismo
  // objeto que _enviarFilaNotasAlServidor ya construye para
  // POST /api/notas/actualizar — no se reinterpreta ni se transforma.
  async function _outboxEncolar(payload, endpoint, headers) {
    try {
      const db = await _abrirDB();
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const evento = {
          tipo: 'NOTA_CAMBIADA',
          payload: payload,
          endpoint: endpoint || null,
          headers: headers || { 'Content-Type': 'application/json' },
          estado: 'pending',
          intentos: 0,
          ts: Date.now(),
        };
        const req = store.add(evento);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    } catch (e) {
      console.warn('[OutboxNotas] no se pudo encolar (IndexedDB no disponible en este navegador) — la nota queda protegida solo por localStorage, igual que antes de esta ronda:', e);
      return null;
    }
  }

  async function _outboxListarPendientes() {
    try {
      const db = await _abrirDB();
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = function () {
          // Orden FIFO por timestamp de creación — nunca se reordena.
          const items = (req.result || []).slice().sort(function (a, b) { return a.ts - b.ts; });
          resolve(items);
        };
        req.onerror = function () { reject(req.error); };
      });
    } catch (e) {
      return [];
    }
  }

  async function _outboxEliminar(id) {
    try {
      const db = await _abrirDB();
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    } catch (e) {
      return false;
    }
  }

  async function _outboxMarcarFallo(id, intentos) {
    try {
      const db = await _abrirDB();
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = function () {
          const evento = getReq.result;
          if (!evento) { resolve(false); return; }
          evento.estado = 'failed';
          evento.intentos = intentos;
          store.put(evento);
        };
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    } catch (e) {
      return false;
    }
  }

  // ── Actualización FINA del DOM al confirmar el envío ──────────────────
  // NUNCA re-renderiza la tabla ni la pantalla completa — toca únicamente
  // el indicador visual de la fila del estudiante afectado (reutiliza los
  // mismos ids que ya pinta htmlPlanilla()/_refrescarFilaPlanilla() en
  // 03-app-core.js: "base-"+estId — que SIEMPRE existe si la fila está
  // visible — un destello verde breve que se retira solo).
  function _outboxNotificarCeldaGuardada(payload) {
    try {
      if (!payload || payload.tipo !== 'planilla' || typeof document === 'undefined') return;
      const el = document.getElementById('base-' + payload.estId);
      if (!el) return; // la fila ya no está visible (cambió de pantalla) — no hay nada que actualizar
      const _prevBoxShadow = el.style.boxShadow;
      const _prevTitle = el.title;
      el.style.boxShadow = '0 0 0 2px #27ae60';
      el.title = (_prevTitle || '') + (_prevTitle ? ' — ' : '') + '✅ Sincronizado (recuperado de la cola offline)';
      setTimeout(function () {
        el.style.boxShadow = _prevBoxShadow || '';
        el.title = _prevTitle || '';
      }, 1400);
    } catch (e) { /* nunca debe romper la UI por un simple indicador visual */ }
  }

  let _procesando = false;
  async function _outboxIntentarEnviar(evento) {
    try {
      const endpoint = evento.endpoint || ((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/notas/actualizar');
      const r = await fetch(endpoint, { method: 'POST', headers: evento.headers, body: JSON.stringify(evento.payload) });
      if (r.ok) {
        await _outboxEliminar(evento.id);
        _outboxNotificarCeldaGuardada(evento.payload);
        return true;
      }
      await _outboxMarcarFallo(evento.id, (evento.intentos || 0) + 1);
      return false;
    } catch (e) {
      await _outboxMarcarFallo(evento.id, (evento.intentos || 0) + 1);
      return false;
    }
  }

  // Procesa la cola EN ORDEN (FIFO) — se detiene en el primer fallo para
  // no adelantar cambios más nuevos por delante de uno más viejo que
  // todavía no se pudo confirmar (evita, además, machacar al servidor con
  // toda la cola de golpe si la red sigue mala).
  async function _outboxProcesarCola() {
    if (_procesando) return;
    _procesando = true;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const pendientes = await _outboxListarPendientes();
      for (let i = 0; i < pendientes.length; i++) {
        const evento = pendientes[i];
        const ok = await _outboxIntentarEnviar(evento);
        if (!ok) {
          _outboxProgramarReintento(evento.intentos || 1);
          break;
        }
      }
    } finally {
      _procesando = false;
    }
  }

  let _reintentoProgramado = null;
  function _outboxProgramarReintento(intentos) {
    if (_reintentoProgramado) return;
    const espera = BACKOFF_MS[Math.min(intentos, BACKOFF_MS.length - 1)];
    _reintentoProgramado = setTimeout(function () {
      _reintentoProgramado = null;
      _outboxProcesarCola();
    }, espera);
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('online', function () { _outboxProcesarCola(); });
    // Reintento periódico de bajo costo — cubre navegadores/redes rurales
    // donde el evento 'online' no siempre se dispara de forma confiable.
    setInterval(async function () {
      const p = await _outboxListarPendientes();
      if (p && p.length) _outboxProcesarCola();
    }, 20000);
  }

  global.OutboxNotas = {
    encolar: _outboxEncolar,
    procesarCola: _outboxProcesarCola,
    listarPendientes: _outboxListarPendientes,
  };

  // ══════════════════════════════════════════════════════════════════════
  // RONDA 45 — DIMENSIÓN 3: CACHÉ LOCAL + VALIDACIÓN ETAG EN CLIENTE
  // --------------------------------------------------------------------
  // El servidor ya soporta ETag/If-None-Match en GET /api/inetis/db (desde
  // la Ronda 44) y ahora TAMBIÉN en los 3 endpoints modulares nuevos
  // (/api/grados, /api/grados/:id/estudiantes,
  // /api/grados/:id/materias/:materiaId/notas — ver _responderConETag()
  // en src/index.ts). Este helper genérico guarda en localStorage el
  // último ETag+cuerpo recibido POR URL EXACTA, envía "If-None-Match" en
  // la siguiente petición a esa misma URL, y:
  //   · 304 Not Modified → usa la copia cacheada (cero bytes de cuerpo
  //     transferidos, ideal para conexión rural intermitente).
  //   · 200 OK           → usa el cuerpo nuevo Y actualiza la caché.
  //   · cualquier fallo de red → si hay copia cacheada, la devuelve igual
  //     (mejor una respuesta un poco vieja que ninguna respuesta).
  //
  // ALCANCE HONESTO DE ESTA RONDA: los 3 endpoints modulares de la Ronda
  // 44 (/api/grados*) todavía NO tienen un punto de la interfaz que los
  // consuma (se crearon como infraestructura de lectura liviana, sin
  // reemplazar ninguna pantalla existente todavía — ver
  // CHECKLIST_DESPLIEGUE.md, Ronda 44, Dimensión 1.2). Este helper queda
  // listo, documentado y con pruebas de su lógica (ver
  // test_ronda45_dimensiones.mjs) para que la primera pantalla que decida
  // consumir esos endpoints (en esta ronda o en una futura) solo tenga
  // que llamar a `EtagCache.fetchConCache(url)` en vez de `fetch(url)` —
  // no se fuerza a ninguna pantalla existente a migrar todavía, para no
  // arriesgar una regresión visual sin poder probarla en un navegador
  // real en este entorno.
  const _ETAG_PREFIX = '_etagCache_';
  function _etagLeerCache(url) {
    try {
      const raw = localStorage.getItem(_ETAG_PREFIX + url);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function _etagGuardarCache(url, etag, data) {
    try { localStorage.setItem(_ETAG_PREFIX + url, JSON.stringify({ etag: etag, data: data, ts: Date.now() })); } catch (e) { /* localStorage lleno/no disponible — sin caché, sin romper nada */ }
  }
  async function _etagFetchConCache(url, opciones) {
    const cacheada = _etagLeerCache(url);
    const headers = Object.assign({}, (opciones && opciones.headers) || {});
    if (cacheada && cacheada.etag) headers['If-None-Match'] = cacheada.etag;
    try {
      const r = await fetch(url, Object.assign({}, opciones || {}, { headers: headers }));
      if (r.status === 304 && cacheada) {
        return { data: cacheada.data, deCache: true };
      }
      if (!r.ok) {
        if (cacheada) return { data: cacheada.data, deCache: true, error: 'HTTP ' + r.status };
        throw new Error('HTTP ' + r.status);
      }
      const etagNuevo = r.headers.get('ETag');
      const data = await r.json();
      if (etagNuevo) _etagGuardarCache(url, etagNuevo, data);
      return { data: data, deCache: false };
    } catch (e) {
      if (cacheada) return { data: cacheada.data, deCache: true, error: String(e && e.message || e) };
      throw e;
    }
  }
  global.EtagCache = { fetchConCache: _etagFetchConCache, leerCache: _etagLeerCache };
})(typeof window !== 'undefined' ? window : globalThis);
