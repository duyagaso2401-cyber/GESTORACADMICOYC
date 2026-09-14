// ============================================================
// 07-SYNC-ENGINE · MOTOR DE SINCRONIZACIÓN INVISIBLE (sección 6 y 7)
// ------------------------------------------------------------
// Este módulo es la corrección central de los problemas reportados:
//   · Parpadeos / deformación de la UI al guardar una nota.
//   · Pérdida de foco mientras se digita.
//   · Autoguardado que a veces "borra" lo digitado (condición de
//     carrera: la respuesta vieja de una petición lenta llega DESPUÉS
//     y sobreescribe lo que el usuario ya cambió).
//   · Consumo de red excesivo por polling agresivo.
//
// Se carga como script plano (sin módulos ES, igual que el resto de
// gestor-academico/dist/modules) DESPUÉS de 03-app-core.js, para poder
// reutilizar _showToast / _updateSyncChip si ya existen, y sin
// necesitar ningún paso de build.
//
// USO TÍPICO (grilla de notas / gradebook):
//
//   <input data-sync-cell
//          data-sync-key="mat_123-corte1"
//          data-sync-endpoint="/api/university/gradebook/secciones/SEC_ID/notas/lote"
//          data-sync-payload='{"matriculaId":"123","corte":1}'
//          value="4.2">
//
//   <script>
//     SyncEngine.init({ getAuthHeader: () => ({ Authorization: 'Bearer ' + miToken }) });
//     SyncEngine.autoAttach(); // engancha TODOS los [data-sync-cell] de la página
//   </script>
//
// También se puede usar por API en vez de atributos — ver
// SyncEngine.attachInput() más abajo.
// ============================================================
(function (global) {
  'use strict';

  // ── Config por defecto (ajustable con SyncEngine.init) ────────────
  const CFG = {
    debounceMs: 900,           // 800-1000ms pedido en la especificación
    batchWindowMs: 1500,       // ventana de agrupamiento 1-2s
    batchMaxWaitMs: 2500,      // tope duro: nunca esperar más que esto para enviar
    maxBatchSize: 200,         // protección: no acumular un lote absurdo
    pollMinMs: 30000,          // ningún polling por debajo de 30s (sección 7)
    getAuthHeader: () => ({}), // el integrador debe sobreescribir esto
    onSaved: null,             // (key, resultado) => void
    onError: null,             // (key, error) => void
  };

  // Estado interno
  const inputsFocused = new Set();          // claves con foco activo AHORA MISMO
  const pendingLocalEdits = new Map();       // key -> {valor, timestamp} aún no confirmado por el servidor
  const debounceTimers = new Map();          // key -> timeoutId (por celda)
  const colasPorEndpoint = new Map();        // endpoint -> { items: Map(key->payload), timer, primerCambioEn }
  let pausadoPorVisibilidad = false;
  const pollersRegistrados = [];             // [{fn, intervalId, ms}] — para poder pausar/reanudar todos

  // -------------------------------------------------------------
  // INDICADOR SUTIL DE SINCRONIZACIÓN (la "nube")
  // -------------------------------------------------------------
  // Reutiliza el chip #_syncChip si el proyecto ya lo tiene (así no hay
  // que tocar el HTML existente ni los ~10 sitios que ya llaman a
  // _updateSyncChip). Si no existe, crea uno propio, absolutamente
  // posicionado, que NUNCA empuja el layout (position:fixed, tamaño
  // fijo, sin texto que cambie de ancho).
  function asegurarIndicador() {
    let chip = document.getElementById('_syncChip');
    if (chip) return chip;
    chip = document.createElement('span');
    chip.id = '_syncChip';
    chip.title = 'Sincronización con el servidor';
    chip.textContent = '☁️';
    // Preferir integrarlo discretamente en una barra superior que la
    // página anfitriona ya tenga (junto a sus propios botones), en vez de
    // flotar encima del contenido — así no queda pegado a otros widgets
    // flotantes de la pantalla (ej. el avatar del Asistente IA, que
    // normalmente ocupa la esquina inferior derecha). Si no encuentra
    // ninguna, cae al flotante de siempre (ahora anclado arriba, ver CSS).
    const hostTopbar = document.querySelector('.topbar-right') || document.querySelector('.tn-right');
    if (hostTopbar) {
      chip.className = 'sync-engine-chip sync-engine-chip--inline';
      hostTopbar.insertBefore(chip, hostTopbar.firstChild);
    } else {
      chip.className = 'sync-engine-chip';
      document.body.appendChild(chip);
    }
    return chip;
  }

  function marcarEstadoSync(estado) {
    // Si la app ya define _updateSyncChip (versión actual del proyecto),
    // se usa esa — mantiene 100% compatibilidad con el resto del código
    // que ya llama a _updateSyncChip('ok'|'syncing'|'offline') en varios
    // puntos. Si no existe, se usa la implementación de respaldo.
    if (typeof global._updateSyncChip === 'function') {
      global._updateSyncChip(estado);
      return;
    }
    const chip = asegurarIndicador();
    chip.classList.remove('syncing', 'offline', 'error');
    if (estado === 'syncing') { chip.classList.add('syncing'); chip.textContent = '☁️'; }
    else if (estado === 'offline') { chip.classList.add('offline'); chip.textContent = '📴'; }
    else if (estado === 'error') { chip.classList.add('error'); chip.textContent = '⚠️'; }
    else { chip.textContent = '☁️'; }
  }

  // -------------------------------------------------------------
  // TOAST NO INTRUSIVO (para reversiones sutiles)
  // -------------------------------------------------------------
  function mostrarToast(mensaje, tipo) {
    if (typeof global._showToast === 'function') { global._showToast(mensaje, tipo || 'info'); return; }
    if (typeof global._showSyncToast === 'function') { global._showSyncToast(mensaje); return; }
    // Respaldo mínimo si el proyecto no trae ya un sistema de toasts.
    let t = document.getElementById('_syncEngineToast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_syncEngineToast';
      t.className = 'sync-engine-toast';
      document.body.appendChild(t);
    }
    t.textContent = mensaje;
    t.dataset.tipo = tipo || 'info';
    t.classList.add('visible');
    clearTimeout(t._to);
    t._to = setTimeout(() => t.classList.remove('visible'), 3200);
  }

  // -------------------------------------------------------------
  // NÚCLEO: debounce por celda + batching por endpoint
  // -------------------------------------------------------------

  /** Registra (u overwrite) el valor pendiente de una celda y reinicia
   * su temporizador de debounce individual. Cuando ese debounce termina
   * (el usuario dejó de escribir en ESA celda específica), el cambio
   * pasa a la cola de batching del endpoint correspondiente — que es la
   * que de verdad dispara la petición HTTP, agrupando todo lo que se
   * acumuló en la ventana de 1-2s. */
  function programarGuardado(key, { endpoint, payload, valor }) {
    pendingLocalEdits.set(key, { valor, ts: Date.now() });

    if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
    const t = setTimeout(() => {
      debounceTimers.delete(key);
      encolarParaLote(endpoint, key, payload);
    }, CFG.debounceMs);
    debounceTimers.set(key, t);
  }

  function encolarParaLote(endpoint, key, payload) {
    let cola = colasPorEndpoint.get(endpoint);
    if (!cola) {
      cola = { items: new Map(), timer: null, primerCambioEn: Date.now() };
      colasPorEndpoint.set(endpoint, cola);
    }
    cola.items.set(key, payload);
    if (!cola.primerCambioEn) cola.primerCambioEn = Date.now();

    const esperaTranscurrida = Date.now() - cola.primerCambioEn;
    const yaTocaEnviarPorTope = esperaTranscurrida >= CFG.batchMaxWaitMs || cola.items.size >= CFG.maxBatchSize;

    if (cola.timer) clearTimeout(cola.timer);
    if (yaTocaEnviarPorTope) {
      flushCola(endpoint);
    } else {
      cola.timer = setTimeout(() => flushCola(endpoint), CFG.batchWindowMs);
    }
  }

  async function flushCola(endpoint) {
    const cola = colasPorEndpoint.get(endpoint);
    if (!cola || cola.items.size === 0) return;
    if (cola.timer) clearTimeout(cola.timer);

    const entradas = [...cola.items.entries()];
    cola.items.clear();
    cola.primerCambioEn = 0;

    marcarEstadoSync('syncing');
    const cambios = entradas.map(([, payload]) => payload);

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...CFG.getAuthHeader() },
        body: JSON.stringify({ cambios }),
        keepalive: true, // permite que el envío termine aunque el usuario navegue a otra pantalla
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();

      // Limpia las ediciones locales pendientes que SÍ se confirmaron.
      entradas.forEach(([key]) => pendingLocalEdits.delete(key));
      marcarEstadoSync('ok');

      const fallidos = (data.fallidos || []).filter(Boolean);
      if (fallidos.length) {
        mostrarToast(`${fallidos.length} celda(s) no se pudieron guardar. Se reintentará.`, 'warning');
        // Reintento suave: se vuelven a encolar solas, no se pierde nada.
        fallidos.forEach((f) => {
          const key = entradas.find(([, p]) => p.matriculaId === f.matriculaId && p.corte === f.corte)?.[0];
          if (key) encolarParaLote(endpoint, key, entradas.find(([k]) => k === key)?.[1]);
        });
      }
      if (typeof CFG.onSaved === 'function') CFG.onSaved(entradas.map((e) => e[0]), data);
    } catch (err) {
      marcarEstadoSync('error');
      mostrarToast('No se pudo guardar automáticamente. Se reintentará en breve — sus cambios siguen aquí.', 'error');
      // Reintento con backoff simple: se re-encola completo tras 4s. Los
      // valores en pendingLocalEdits NO se borran, así que el
      // focus-guard sigue protegiendo lo que el usuario ve en pantalla.
      setTimeout(() => entradas.forEach(([key, payload]) => encolarParaLote(endpoint, key, payload)), 4000);
      if (typeof CFG.onError === 'function') CFG.onError(entradas.map((e) => e[0]), err);
    }
  }

  /** Fuerza el envío inmediato de todo lo pendiente — úsalo antes de
   * navegar a otra pantalla, al cerrar un modal, o en window.beforeunload,
   * para no perder cambios que aún estén dentro de la ventana de
   * batching. El guardado manual ("Guardar todo") también debe llamar
   * esto como respaldo, sin duplicar lo que el batching ya envió. */
  function flushTodoAhora() {
    for (const endpoint of colasPorEndpoint.keys()) flushCola(endpoint);
  }

  // -------------------------------------------------------------
  // FOCUS-GUARD: mientras una celda tiene foco, NADA la sobreescribe
  // -------------------------------------------------------------
  /** Debe llamarse cada vez que llega un valor "del servidor" (por
   * polling, SSE, o la respuesta de otro usuario) para una celda dada.
   * Devuelve true si SÍ se aplicó (la celda no tenía foco ni edición
   * local pendiente) o false si se descartó a propósito. */
  function aplicarValorRemotoSiEsSeguro(key, valorRemoto, aplicarFn) {
    if (inputsFocused.has(key)) return false;              // el usuario está escribiendo ESTO ahora mismo
    if (pendingLocalEdits.has(key)) return false;           // hay un cambio local aún no confirmado
    aplicarFn(valorRemoto);
    return true;
  }

  // -------------------------------------------------------------
  // ACTUALIZACIÓN GRANULAR: solo la celda afectada, nunca la tabla entera
  // -------------------------------------------------------------
  /** Aplica un valor a UN elemento puntual sin tocar el resto del DOM
   * (nada de innerHTML de la tabla completa, nada de re-render del
   * componente padre). Dispara un microefecto visual opcional (clase
   * CSS temporal) para que el usuario note "esto se actualizó" sin que
   * la página salte ni pierda la posición de scroll. */
  function actualizarCeldaGranular(el, valor) {
    if (!el) return;
    if ('value' in el) el.value = valor;
    else el.textContent = valor;
    el.classList.add('sync-engine-actualizado');
    setTimeout(() => el.classList.remove('sync-engine-actualizado'), 600);
  }

  // -------------------------------------------------------------
  // ATTACH: engancha un <input> concreto al motor
  // -------------------------------------------------------------
  function attachInput(inputEl, opciones) {
    const key = opciones.key;
    const endpoint = opciones.endpoint;
    const buildPayload = typeof opciones.buildPayload === 'function'
      ? opciones.buildPayload
      : (valor) => ({ ...opciones.payloadBase, nota: valor });

    inputEl.addEventListener('focus', () => inputsFocused.add(key));
    inputEl.addEventListener('blur', () => inputsFocused.delete(key));

    inputEl.addEventListener('input', () => {
      const valor = inputEl.value;
      // 1) Optimistic update: la UI YA refleja el valor — no hay que
      //    esperar al servidor para "verlo" en pantalla (ya está).
      // 2) Se programa el guardado (debounce + batching) en segundo plano.
      programarGuardado(key, { endpoint, payload: buildPayload(valor), valor });
    });

    return {
      recibirValorRemoto(valorRemoto) {
        return aplicarValorRemotoSiEsSeguro(key, valorRemoto, (v) => actualizarCeldaGranular(inputEl, v));
      },
    };
  }

  /** Engancha automáticamente todo elemento con [data-sync-cell] en la
   * página, leyendo su configuración de los data-attributes. Pensado
   * para grillas grandes (gradebook, asistencia) donde escribir el
   * attachInput() manual celda por celda sería repetitivo. */
  function autoAttach(root) {
    const contenedor = root || document;
    contenedor.querySelectorAll('[data-sync-cell]').forEach((el) => {
      if (el._syncEngineAttached) return;
      el._syncEngineAttached = true;
      let payloadBase = {};
      try { payloadBase = JSON.parse(el.dataset.syncPayload || '{}'); } catch (e) { /* ignora payload malformado */ }
      attachInput(el, {
        key: el.dataset.syncKey,
        endpoint: el.dataset.syncEndpoint,
        payloadBase,
      });
    });
  }

  // -------------------------------------------------------------
  // OPTIMIZACIÓN DE RED: SMART PAUSE por visibilidad (sección 7)
  // -------------------------------------------------------------
  /** Registra un poller (cualquier función que haga fetch periódico) para
   * que el motor lo pause/reanude automáticamente según document.hidden,
   * en vez de que cada pantalla reimplemente su propio listener de
   * visibilitychange. `ms` nunca puede ser menor a CFG.pollMinMs. */
  function registrarPoller(fn, ms) {
    const intervalo = Math.max(ms || CFG.pollMinMs, CFG.pollMinMs);
    const id = setInterval(() => {
      if (document.hidden || pausadoPorVisibilidad) return; // smart pause
      fn();
    }, intervalo);
    pollersRegistrados.push({ fn, id, ms: intervalo });
    return id;
  }

  function manejarCambioVisibilidad() {
    if (document.hidden) {
      pausadoPorVisibilidad = true; // no dispara ninguna llamada nueva mientras está oculto
      return;
    }
    pausadoPorVisibilidad = false;
    // Al volver a primer plano: UNA sola sincronización inmediata (no
    // una ráfaga de todos los pollers a la vez) + se manda ya cualquier
    // cambio que se hubiera quedado pendiente en batching.
    flushTodoAhora();
    if (pollersRegistrados.length) pollersRegistrados[0].fn();
  }

  // -------------------------------------------------------------
  // SESIÓN: recibe el refresh de token silencioso (ver middleware/auth.js)
  // sin interrumpir al usuario ni redirigir al dashboard.
  // -------------------------------------------------------------
  function envolverFetchParaRefreshDeSesion() {
    const fetchOriginal = global.fetch.bind(global);
    global.fetch = async function (...args) {
      const resp = await fetchOriginal(...args);
      const nuevoToken = resp.headers && resp.headers.get && resp.headers.get('X-Univ-Refresh-Token');
      if (nuevoToken && typeof CFG.onTokenRefrescado === 'function') CFG.onTokenRefrescado(nuevoToken);
      return resp;
    };
  }

  function init(opciones) {
    Object.assign(CFG, opciones || {});
    document.addEventListener('visibilitychange', manejarCambioVisibilidad);
    window.addEventListener('beforeunload', flushTodoAhora);
    envolverFetchParaRefreshDeSesion();
    // NO se llama aquí a asegurarIndicador() a propósito (antes sí se
    // llamaba, y eso causaba el ícono ☁️ duplicado/chocando reportado):
    // SyncEngine.init() se ejecuta apenas carga la página, ANTES de
    // iniciar sesión y antes de que exista cualquier barra superior — así
    // que creaba de una vez un ícono flotante (visible incluso en la
    // pantalla de bienvenida, sin sesión), y ese flotante nunca
    // desaparecía: cuando más tarde la pantalla real (con su propio
    // #_syncChip, ej. en el topbar de universidad/app.js) se dibujaba,
    // quedaban DOS íconos en el DOM a la vez. Además, en páginas que ya
    // traen su propio manejador nativo (ej. 03-app-core.js define
    // _updateSyncChip), ese flotante era puro sobrante: marcarEstadoSync()
    // de abajo ya revisa primero si existe _updateSyncChip nativo, así que
    // asegurarIndicador() ni falta hacía ahí. La solución correcta es
    // crear el ícono SOLO cuando de verdad hay algo que reportar —
    // marcarEstadoSync() ya llama a asegurarIndicador() por su cuenta en
    // ese momento (ver más abajo), momento en el que la pantalla real (con
    // su topbar) ya existe.
  }

  global.SyncEngine = {
    init,
    attachInput,
    autoAttach,
    registrarPoller,
    flushTodoAhora,
    aplicarValorRemotoSiEsSeguro,
    actualizarCeldaGranular,
    mostrarToast,
    marcarEstadoSync,
    // Expuesto por si alguna pantalla necesita revisar el estado a mano:
    _debug: { pendingLocalEdits, inputsFocused, colasPorEndpoint },
  };
})(window);
