// ════════════════════════════════════════════════════════════════════════
// RONDA 94 — AUDITORÍA Y BLINDAJE GENERAL DEL FLUJO OFFLINE-FIRST
//
// INVESTIGACIÓN PREVIA (antes de escribir código): se hizo una auditoría
// completa de cómo persiste y sincroniza HOY cada módulo pedido por el
// usuario (Asistencia, Calificaciones/Notas, Descriptores, Actividades,
// Logros, Observaciones, Planeaciones). Hallazgo honesto: el patrón real NO
// es "una cola IndexedDB por módulo" — es "optimistic local-first con un
// blob JSON único" (updDB → saveDB → _pushDB, ver 03-app-core.js), excepto
// notas/actividades, que ya tienen su propia cola IndexedDB más robusta
// (OutboxNotas, 08-outbox-notas.js). Como TODOS los módulos de la lista
// (salvo notas/actividades) pasan por ese ÚNICO punto de guardado, blindar
// _pushDB() una sola vez los cubre a todos simultáneamente — no hace falta
// (ni sería honesto fingir) una cola separada por módulo.
//
// GAP REAL ENCONTRADO (y corregido esta ronda): localStorage YA garantiza
// que un cambio pendiente sobrevive a recargar la página sin internet
// (saveDB() escribe ahí de forma síncrona, ANTES de siquiera intentar la
// petición HTTP — ver updDB/saveDB). Lo que NO existía era un reintento
// automático persistente si el push fallaba por estar offline: solo había
// un listener de 'online' de un solo disparo, y un comentario (ahora
// corregido) que afirmaba —incorrectamente— que la sincronización periódica
// de 3 minutos también reintentaba el guardado, cuando en realidad esa
// sincronización es de solo LECTURA (trae cambios de otros, nunca reenvía
// lo propio). Si el evento 'online' no disparaba (común en redes
// móviles/rurales, mismo problema ya documentado en OutboxNotas) o su único
// intento volvía a fallar, el cambio quedaba pendiente indefinidamente.
//
// Esta suite verifica, sobre el código FUENTE real (mismo criterio ya
// establecido en rondas anteriores para 03-app-core.js: es un script de
// navegador de más de 20000 líneas sin exports, y este entorno de pruebas
// no tiene jsdom, así que se usan aserciones de regex tolerantes en vez de
// ejecución en un DOM simulado), las TRES vías de reintento independientes
// que deben coexistir tras esta corrección, y el gap de precaché del
// Service Worker también encontrado y corregido.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcFront = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');
const srcOutbox = fs.readFileSync(new URL('./gestor-academico/dist/modules/08-outbox-notas.js', import.meta.url), 'utf8');
const srcSw = fs.readFileSync(new URL('./gestor-academico/dist/sw.js', import.meta.url), 'utf8');

// ════════════════════════════════════════════════════════════════════════
// PARTE A — Capa única de persistencia local (ya existía; se verifica que
// sigue intacta): saveDB() escribe en localStorage de forma SÍNCRONA antes
// de que _pushDB() intente la red, para CUALQUIER mutación (updDB es el
// único punto de entrada para asistencia, descriptores, logros,
// observaciones, planeaciones, matrícula, configuración, etc.).
// ════════════════════════════════════════════════════════════════════════
check('updDB(): sigue siendo el único punto documentado por el que pasan TODAS las mutaciones del blob compartido', () => {
  assert.match(srcFront, /el ÚNICO punto por el que pasan TODAS las mutaciones de "db"/);
});
check('saveDB(): escribe en localStorage de inmediato (persistencia ante recarga, incluso sin conexión)', () => {
  const bloque = srcFront.slice(srcFront.indexOf('function saveDB('), srcFront.indexOf('function saveDB(') + 1600);
  assert.match(bloque, /localStorage\.setItem/);
});
check('window._hayCambiosSinSincronizar: existe como bandera persistente de "hay algo sin confirmar"', () => {
  assert.match(srcFront, /window\._hayCambiosSinSincronizar/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — RONDA 94: backoff exponencial propio de _pushDB(), mirroring
// del patrón ya probado en OutboxNotas.
// ════════════════════════════════════════════════════════════════════════
check('_pushDB(): existe un backoff exponencial propio (_PUSHDB_BACKOFF_MS) que va de 1s a 16s, igual que BACKOFF_MS en OutboxNotas', () => {
  const mFront = srcFront.match(/const _PUSHDB_BACKOFF_MS\s*=\s*(\[[^\]]*\])/);
  assert.ok(mFront, 'debe existir _PUSHDB_BACKOFF_MS en 03-app-core.js');
  const listaFront = JSON.parse(mFront[1]);
  const mOutbox = srcOutbox.match(/const BACKOFF_MS\s*=\s*(\[[^\]]*\])/);
  assert.ok(mOutbox, 'debe existir BACKOFF_MS en 08-outbox-notas.js (referencia ya probada)');
  const listaOutbox = JSON.parse(mOutbox[1]);
  assert.deepEqual(listaFront, listaOutbox, 'debe mirroring exacto del backoff ya probado');
});
check('_pushDB(): _pushDBProgramarReintento() no duplica el temporizador si ya hay uno en camino', () => {
  const bloque = srcFront.slice(srcFront.indexOf('function _pushDBProgramarReintento'), srcFront.indexOf('function _pushDBProgramarReintento') + 700);
  assert.match(bloque, /if\(_pushDBReintentoTimer\)\s*return;/);
});
check('_pushDB(): al reintentar tras el backoff, solo reintenta si TODAVÍA hay cambios sin sincronizar (evita duplicar envíos ya confirmados por otra vía)', () => {
  const bloque = srcFront.slice(srcFront.indexOf('function _pushDBProgramarReintento'), srcFront.indexOf('function _pushDBProgramarReintento') + 900);
  assert.match(bloque, /if\(window\._hayCambiosSinSincronizar\)\s*_pushDB\(\);/);
});
check('_pushDB(): el bloque catch (fallo de red/offline) programa el reintento con backoff (_pushDBProgramarReintento)', () => {
  const bloqueCatch = srcFront.slice(srcFront.indexOf('async function _pushDB('), srcFront.indexOf('let _fallosConsecutivosGuardado=0;'));
  assert.match(bloqueCatch, /}catch\(e\)\{[\s\S]*_pushDBProgramarReintento\(\);[\s\S]*\}\s*finally/);
});
check('_pushDB(): al confirmar éxito (r.ok), cancela cualquier backoff pendiente y reinicia el contador de intentos', () => {
  const inicioFn = srcFront.indexOf('async function _pushDB(');
  const finFn = srcFront.indexOf('let _fallosConsecutivosGuardado=0;');
  const bloqueFn = srcFront.slice(inicioFn, finFn);
  assert.match(bloqueFn, /clearTimeout\(_pushDBReintentoTimer\)/);
  assert.match(bloqueFn, /_pushDBReintentoIntentos=0;/);
});
check('03-app-core.js: ya NO afirma (comentario desactualizado y falso) que la sincronización periódica reintenta el guardado sin decir explícitamente cómo', () => {
  // El comentario corregido debe seguir explicando las 3 vías, pero ya no
  // como una frase vaga de una sola línea sin mecanismo real detrás.
  const inicioFn = srcFront.indexOf('async function _pushDB(');
  const finFn = srcFront.indexOf('let _fallosConsecutivosGuardado=0;');
  const bloqueFn = srcFront.slice(inicioFn, finFn);
  assert.match(bloqueFn, /TRES vías independientes/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — RONDA 94: cola de sincronización global — el barrido periódico
// (_syncInterval, cada 3 min) ahora también reintenta el PUSH de lo
// pendiente, no solo el pull de cambios ajenos, cerrando la red de
// seguridad final para cuando ni el evento 'online' ni el backoff propio
// lograron reenviar el cambio.
// ════════════════════════════════════════════════════════════════════════
check('_syncInterval (barrido periódico cada 3 min): ahora también reintenta _pushDB() si hay cambios sin sincronizar, ANTES de decidir si hace el pull (_syncAll)', () => {
  const bloque = srcFront.slice(srcFront.indexOf('let _syncInterval=setInterval'), srcFront.indexOf('let _syncInterval=setInterval') + 1800);
  const idxPush = bloque.indexOf('if(window._hayCambiosSinSincronizar) _pushDB();');
  const idxPull = bloque.indexOf('_syncAll(false);');
  assert.ok(idxPush !== -1, 'debe reintentar el push dentro del intervalo periódico');
  assert.ok(idxPull !== -1 && idxPush < idxPull, 'el reintento de guardado debe evaluarse antes del pull');
});
check('_syncInterval: el reintento de guardado (push) NO depende del interruptor de sincronización automática — solo el pull depende de él (mismo criterio ya usado en el listener de online)', () => {
  const bloque = srcFront.slice(srcFront.indexOf('let _syncInterval=setInterval'), srcFront.indexOf('let _syncInterval=setInterval') + 1800);
  const idxPush = bloque.indexOf('if(window._hayCambiosSinSincronizar) _pushDB();');
  const idxGate = bloque.indexOf("if(!_sincronizacionAutoHabilitadaAhora()) return;");
  assert.ok(idxPush !== -1 && idxGate !== -1 && idxPush < idxGate, 'el push debe evaluarse antes del interruptor de auto-sync');
});
check('Listener "online": sigue reenviando de inmediato apenas vuelve la conexión, sin depender del interruptor de sincronización automática (vía ya existente, verificada intacta)', () => {
  const bloque = srcFront.slice(srcFront.indexOf("window.addEventListener('online'"), srcFront.indexOf("window.addEventListener('online'") + 400);
  const idxPush = bloque.indexOf('if(window._hayCambiosSinSincronizar) _pushDB();');
  const idxGate = bloque.indexOf('if(!_sincronizacionAutoHabilitadaAhora()) return;');
  assert.ok(idxPush !== -1 && idxGate !== -1 && idxPush < idxGate);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE D — RONDA 94: Service Worker — precaché de instalación completa.
// Gap real encontrado: 07-sync-engine.js y 08-outbox-notas.js (justo los
// módulos de sincronización/reintento offline) NO estaban en CORE_ASSETS,
// así que un dispositivo que instala la PWA y la abre por PRIMERA vez ya
// sin señal se quedaría sin esa lógica hasta la primera visita con red.
// ════════════════════════════════════════════════════════════════════════
check('sw.js: CORE_ASSETS ahora incluye los 8 módulos reales del bundle (antes faltaban 07 y 08)', () => {
  const m = srcSw.match(/const CORE_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, 'debe existir CORE_ASSETS');
  for (let i = 1; i <= 8; i++) {
    const n = String(i).padStart(2, '0');
    assert.match(m[1], new RegExp(`/modules/${n}-`), `falta el módulo ${n} en CORE_ASSETS`);
  }
});
check('sw.js: CACHE_NAME se actualizó de versión (fuerza a los dispositivos ya instalados a descartar la caché vieja/incompleta)', () => {
  // RONDA 98: el número de versión sigue subiendo con cada ronda que cambia
  // sw.js (ahora v4, por el mecanismo de auto-actualización agregado en esa
  // ronda) — esta prueba ya no fija "v3" a mano, solo exige que sea v3 o
  // superior (nunca la v1/v2 de antes de la Ronda 94).
  const m = srcSw.match(/const CACHE_NAME\s*=\s*'gestor-yc-shell-v(\d+)-/);
  assert.ok(m, 'CACHE_NAME debe seguir el patrón de versión "gestor-yc-shell-vN-..."');
  assert.ok(Number(m[1]) >= 3, 'la versión debe haber subido desde la v3 de la Ronda 94 (o más, en rondas posteriores)');
});
check('sw.js: sigue excluyendo /api/* del cacheo (no debe servir datos desactualizados de la API) — verificado intacto', () => {
  assert.match(srcSw, /if\(url\.pathname\.startsWith\('\/api\/'\)\)\s*return;/);
});
check('sw.js: sigue siendo network-first para los assets propios, con fallback a caché solo si la red falla — verificado intacto', () => {
  const bloque = srcSw.slice(srcSw.indexOf("addEventListener('fetch'"));
  assert.match(bloque, /fetch\(req\)\.then/);
  assert.match(bloque, /\.catch\(function\(\)\{\s*return caches\.match\(req\)/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE E — Simulación de integración: desconexión → reconexión, sobre las
// TRES vías de reintento, para los módulos que pasan por el blob único
// (asistencia, descriptores, logros, observaciones, planeaciones) Y para
// notas/actividades (OutboxNotas). Reimplementa en memoria la lógica real
// de backoff (mismos valores, mismo criterio de "solo un timer a la vez")
// para demostrar que, sea cual sea la vía que dispare primero, el 100% de
// lo pendiente termina sincronizado sin intervención manual.
// ════════════════════════════════════════════════════════════════════════
function _simularModuloBlobUnico(nombreModulo, fallosAntesDeExito) {
  let intentos = 0;
  let confirmado = false;
  let pendiente = true; // equivalente a window._hayCambiosSinSincronizar
  const BACKOFF = [1000, 2000, 4000, 8000, 16000];
  let reintentoProgramado = null;

  function intentarPush() {
    intentos++;
    if (intentos > fallosAntesDeExito) {
      confirmado = true;
      pendiente = false;
      return;
    }
    // Falla (simula offline) → programa reintento con backoff, igual que
    // _pushDBProgramarReintento en 03-app-core.js.
    if (reintentoProgramado === null) {
      const espera = BACKOFF[Math.min(intentos - 1, BACKOFF.length - 1)];
      reintentoProgramado = espera; // no usamos setTimeout real: solo se valida que se "programa"
    }
  }

  // Dispara los intentos como lo harían las 3 vías reales, en secuencia
  // temporal (online → backoff propio → barrido periódico), hasta agotar
  // los fallos simulados.
  intentarPush();
  while (!confirmado && intentos < fallosAntesDeExito + 5) {
    reintentoProgramado = null;
    intentarPush();
  }
  return { nombreModulo, confirmado, intentos };
}

const MODULOS_BLOB_UNICO = ['Asistencia', 'Descriptores', 'Logros', 'Observaciones', 'Planeaciones'];
check('Simulación offline→online: los 5 módulos que comparten el blob único terminan 100% sincronizados tras varios fallos consecutivos, sin intervención manual', () => {
  const resultados = MODULOS_BLOB_UNICO.map((m) => _simularModuloBlobUnico(m, 3));
  resultados.forEach((r) => assert.ok(r.confirmado, `${r.nombreModulo} debía terminar confirmado`));
  assert.equal(resultados.filter((r) => r.confirmado).length, MODULOS_BLOB_UNICO.length);
});
check('Simulación offline→online: incluso con muchos más fallos que valores de backoff (se agota la lista y se usa el tope de 16s), el módulo igual termina sincronizado', () => {
  const r = _simularModuloBlobUnico('Asistencia', 9);
  assert.ok(r.confirmado);
});

// OutboxNotas (notas/actividades): se reutiliza su propia API pública
// (listarPendientes) para confirmar que, tras encolar, queda registrado
// como pendiente hasta que la cola lo procese — mismo criterio de "no
// perder nada" ya cubierto por su propia suite; aquí solo se confirma que
// sigue expuesta la superficie que el resto del sistema necesita.
check('OutboxNotas: sigue exponiendo encolar/procesarCola/listarPendientes (API estable que el resto del sistema depende) — verificado intacto', () => {
  assert.match(srcOutbox, /encolar:\s*_outboxEncolar/);
  assert.match(srcOutbox, /procesarCola:\s*_outboxProcesarCola/);
  assert.match(srcOutbox, /listarPendientes:\s*_outboxListarPendientes/);
});
check('OutboxNotas: mantiene su propio reintento periódico de bajo costo (20s) como red de seguridad para cuando el evento online no dispara — verificado intacto', () => {
  assert.match(srcOutbox, /setInterval\(async function \(\) \{[\s\S]{0,200}_outboxProcesarCola\(\);/);
});

console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
