// ════════════════════════════════════════════════════════════════════════
// RONDA 98 — DOS FRENTES REPORTADOS EN PRUEBAS DE CAMPO:
//
// FRENTE 1 — "Sync-before-pull": antes de esta ronda, _pullDB() (el camino
// de arranque en frío para roles/páginas sin adaptador granular propio)
// SOBREESCRIBÍA "db" por completo con lo que trajera el servidor, sin
// fijarse si había cambios locales todavía sin confirmar
// (window._hayCambiosSinSincronizar) — si un docente abría la app ya con
// internet después de haber guardado algo sin conexión, el pull podía
// ganarle la carrera al reintento de subida y el cambio local se perdía de
// la memoria. FIX: _pullDB() ahora (1) intenta subir lo pendiente PRIMERO
// (await _pushDB()) y (2) si sigue habiendo algo pendiente después de eso,
// fusiona con _merge3way() en vez de sobreescribir a ciegas. Se replica el
// mismo criterio en el listener de 'visibilitychange' (ya lo tenían
// 'online' y el barrido periódico) y se agrega un "boot check" explícito al
// arranque que también adelanta el drenado de OutboxNotas (IndexedDB).
//
// FRENTE 2 — Actualización automática de la PWA: antes de esta ronda, el
// Service Worker ya tomaba control inmediatamente al activarse
// (self.skipWaiting()/self.clients.claim(), desde antes de esta ronda) pero
// NADA forzaba al navegador a revisar si había una versión nueva mientras
// la PWA seguía abierta — solo se enteraba en la siguiente revisión pasiva
// del navegador (a veces hasta 24h). FIX: portal.html ahora llama a
// registration.update() al cargar, al recuperar el foco
// (visibilitychange/pageshow) y cada hora, y recarga la página de forma
// transparente en cuanto detecta que un Service Worker nuevo tomó control
// (evento 'controllerchange').
//
// METODOLOGÍA: igual que en rondas anteriores, 03-app-core.js/
// 08-outbox-notas.js/portal.html/sw.js son código de navegador sin exports
// — se verifica con aserciones de regex tolerantes sobre el código FUENTE
// real (no hay jsdom en este entorno de pruebas).
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcCore = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');
const srcOutbox = fs.readFileSync(new URL('./gestor-academico/dist/modules/08-outbox-notas.js', import.meta.url), 'utf8');
const srcPortal = fs.readFileSync(new URL('./gestor-academico/dist/portal.html', import.meta.url), 'utf8');
const srcSw = fs.readFileSync(new URL('./gestor-academico/dist/sw.js', import.meta.url), 'utf8');

// ════════════════════════════════════════════════════════════════════════
// FRENTE 1, PARTE A — _pullDB(): sync-before-pull + merge en vez de
// sobreescritura ciega.
// ════════════════════════════════════════════════════════════════════════
const idxPullDB = srcCore.indexOf('async function _pullDB(){');
const idxFinPullDB = srcCore.indexOf('\n}\n', idxPullDB);
const bloquePullDB = srcCore.slice(idxPullDB, idxFinPullDB);

check('_pullDB(): si hay cambios locales sin sincronizar, intenta subirlos (_pushDB()) ANTES de pedir el blob al servidor', () => {
  const idxCheck = bloquePullDB.indexOf('window._hayCambiosSinSincronizar');
  const idxPush = bloquePullDB.indexOf('await _pushDB()');
  const idxFetch = bloquePullDB.indexOf("_fetchConTimeout(API_BASE+'/api/inetis/db");
  assert.ok(idxCheck !== -1 && idxPush !== -1 && idxFetch !== -1);
  assert.ok(idxCheck < idxPush && idxPush < idxFetch, 'el orden debe ser: revisar pendientes → subir → recién ahí pedir al servidor');
});
check('_pullDB(): si TODAVÍA hay cambios sin sincronizar después del intento de subida, fusiona con _merge3way() en vez de sobreescribir "db" a ciegas', () => {
  assert.match(bloquePullDB, /const _fus=_merge3way\(_base,db,_pulled\)/);
  assert.match(bloquePullDB, /db=_fus\.result;/);
});
check('_pullDB(): sin nada pendiente, sigue adoptando el blob del servidor directamente (sin overhead de fusión innecesario)', () => {
  assert.match(bloquePullDB, /db=_pulled;/);
});
check('_pullDB(): registra los conflictos de la fusión en la bitácora, igual que ya hace _syncAll() en sus fusiones periódicas', () => {
  assert.match(bloquePullDB, /_registrarConflictoBitacora\(_sk,_fus\.conflictos,_fus\.detalles,'pull-arranque'\)/);
});

// ════════════════════════════════════════════════════════════════════════
// FRENTE 1, PARTE B — "Boot check" explícito al arranque (antes de
// cualquier adaptador granular o de _pullDB()).
// ════════════════════════════════════════════════════════════════════════
check('Arranque en frío: existe un "boot check" que revisa cambios pendientes del blob Y de OutboxNotas ANTES de los adaptadores granulares/_pullDB()', () => {
  const idxIIFE = srcCore.indexOf("(async()=>{try{\n  if(pag==='restablecer-password')return;");
  assert.ok(idxIIFE !== -1, 'debe existir el IIFE de arranque con el guard de restablecer-password inmediatamente después');
  const idxBootCheck = srcCore.indexOf('BOOT CHECK', idxIIFE);
  const idxPrimerGranular = srcCore.indexOf('_esDocentePlanillaDirecta', idxIIFE);
  assert.ok(idxBootCheck !== -1 && idxPrimerGranular !== -1 && idxBootCheck < idxPrimerGranular, 'el boot check debe ejecutarse antes de evaluar cualquier camino granular');
  const bloqueBootCheck = srcCore.slice(idxBootCheck, idxBootCheck + 3600);
  assert.match(bloqueBootCheck, /if\(window\._hayCambiosSinSincronizar\)\s*_pushDB\(\);/);
  assert.match(bloqueBootCheck, /OutboxNotas\.procesarCola\(\)/);
});
check('Boot check: solo actúa si hay conexión (navigator.onLine !== false) — no fuerza intentos de red inútiles estando offline de verdad', () => {
  const idxBootCheck = srcCore.indexOf('BOOT CHECK');
  const bloqueBootCheck = srcCore.slice(idxBootCheck, idxBootCheck + 3600);
  assert.match(bloqueBootCheck, /navigator\.onLine\s*!==\s*false/);
});

// ════════════════════════════════════════════════════════════════════════
// FRENTE 1, PARTE C — 'visibilitychange' también hace push-before-pull,
// igual que ya hacían 'online' y el barrido periódico (_syncInterval).
// ════════════════════════════════════════════════════════════════════════
check("listener de 'visibilitychange': reintenta el guardado pendiente (_pushDB) ANTES del pull en segundo plano (_syncAll), igual que 'online' y _syncInterval", () => {
  const idxVis = srcCore.indexOf("document.addEventListener('visibilitychange'");
  const idxFinVis = srcCore.indexOf('\n});', idxVis);
  const bloqueVis = srcCore.slice(idxVis, idxFinVis);
  const idxPush = bloqueVis.indexOf('if(window._hayCambiosSinSincronizar) _pushDB();');
  const idxSyncAll = bloqueVis.indexOf('_syncAll(false)');
  assert.ok(idxPush !== -1 && idxSyncAll !== -1 && idxPush < idxSyncAll);
});

// ════════════════════════════════════════════════════════════════════════
// FRENTE 1, PARTE D — OutboxNotas (08-outbox-notas.js): drenado inmediato
// al cargar el módulo, sin esperar al evento 'online' ni al primer tick
// del poll de 20s.
// ════════════════════════════════════════════════════════════════════════
check('08-outbox-notas.js: revisa la cola UNA VEZ de inmediato al cargar el módulo (no espera 20s ni el evento online) si hay conexión', () => {
  const idxOnline = srcOutbox.indexOf("global.addEventListener('online'");
  const idxBoot = srcOutbox.indexOf('BOOT CHECK', idxOnline);
  assert.ok(idxBoot !== -1, 'debe existir el boot check después de registrar los listeners existentes');
  const bloqueBoot = srcOutbox.slice(idxBoot, idxBoot + 1600);
  assert.match(bloqueBoot, /_outboxListarPendientes\(\)\.then/);
  assert.match(bloqueBoot, /_outboxProcesarCola\(\)/);
});
check('08-outbox-notas.js: el drenado inmediato al cargar respeta el estado de conexión (no dispara si navigator.onLine===false)', () => {
  const idxBoot = srcOutbox.indexOf('BOOT CHECK');
  const bloqueBoot = srcOutbox.slice(idxBoot, idxBoot + 1600);
  assert.match(bloqueBoot, /navigator\.onLine\s*!==\s*false/);
});
check('08-outbox-notas.js: los mecanismos existentes (listener online + poll de 20s + backoff exponencial) siguen intactos', () => {
  assert.match(srcOutbox, /global\.addEventListener\('online', function \(\) \{ _outboxProcesarCola\(\); \}\)/);
  assert.match(srcOutbox, /setInterval\(async function \(\) \{[\s\S]{0,200}_outboxProcesarCola\(\);/);
  assert.match(srcOutbox, /const BACKOFF_MS = \[1000, 2000, 4000, 8000, 16000\];/);
});

// ════════════════════════════════════════════════════════════════════════
// FRENTE 2, PARTE E — portal.html: revisión proactiva de actualizaciones
// del Service Worker + refresco transparente al tomar control.
// ════════════════════════════════════════════════════════════════════════
const idxReg = srcPortal.indexOf("navigator.serviceWorker.register('/sw.js')");
check('portal.html: captura el objeto "registration" devuelto por register() (antes se descartaba con .catch() nada más)', () => {
  assert.match(srcPortal, /register\('\/sw\.js'\)\.then\(function\(registration\)\{/);
});
check('portal.html: llama a registration.update() al cargar, al recuperar el foco (visibilitychange) y en pageshow', () => {
  const bloque = srcPortal.slice(idxReg, idxReg + 2000);
  assert.match(bloque, /registration\.update\(\)/);
  assert.match(bloque, /_revisarActualizacion\(\);\s*\n\s*document\.addEventListener\('visibilitychange'/);
  assert.match(bloque, /window\.addEventListener\('pageshow'/);
});
check('portal.html: además revisa actualizaciones periódicamente (red de seguridad para sesiones largas sin cambiar de pestaña)', () => {
  const bloque = srcPortal.slice(idxReg, idxReg + 2000);
  assert.match(bloque, /setInterval\(_revisarActualizacion,\s*60\*60\*1000\)/);
});
check("portal.html: recarga la página de forma transparente en 'controllerchange' (nuevo Service Worker tomó control) — con guard para no entrar en bucle", () => {
  const bloque = srcPortal.slice(idxReg, idxReg + 2600);
  assert.match(bloque, /navigator\.serviceWorker\.addEventListener\('controllerchange'/);
  assert.match(bloque, /_yaSeRecargoPorActualizacion/);
  assert.match(bloque, /window\.location\.reload\(\)/);
});

// ════════════════════════════════════════════════════════════════════════
// FRENTE 2, PARTE F — sw.js: skipWaiting()/clients.claim() siguen intactos
// (ya eran correctos desde antes) y CACHE_NAME se sube de versión para que
// este propio cambio sea detectable por registration.update().
// ════════════════════════════════════════════════════════════════════════
check("sw.js: self.skipWaiting() sigue presente en 'install' (toma la versión nueva sin esperar a que se cierren las pestañas)", () => {
  const idxInstall = srcSw.indexOf("addEventListener('install'");
  const bloque = srcSw.slice(idxInstall, idxInstall + 300);
  assert.match(bloque, /self\.skipWaiting\(\)/);
});
check("sw.js: self.clients.claim() sigue presente en 'activate' (controla las pestañas ya abiertas sin recarga manual)", () => {
  const idxActivate = srcSw.indexOf("addEventListener('activate'");
  const bloque = srcSw.slice(idxActivate, idxActivate + 400);
  assert.match(bloque, /self\.clients\.claim\(\)/);
});
check("sw.js: 'activate' sigue purgando cachés de versiones anteriores (borra toda clave distinta de CACHE_NAME)", () => {
  const idxActivate = srcSw.indexOf("addEventListener('activate'");
  const bloque = srcSw.slice(idxActivate, idxActivate + 400);
  assert.match(bloque, /keys\.filter\(function\(k\)\{\s*return k!==CACHE_NAME;\s*\}\)\.map\(function\(k\)\{\s*return caches\.delete\(k\);\s*\}\)/);
});
check('sw.js: CACHE_NAME se subió de versión en esta ronda (v4 o superior en rondas posteriores) — necesario para que el propio cambio sea detectable por registration.update()', () => {
  // RONDA 99-HOTFIX: igual que ya se generalizó en el test de la Ronda 94,
  // esta aserción ya no fija "v4" a mano — cada ronda que vuelve a tocar
  // sw.js (como el hotfix que sube a v5) sube el número, nunca lo baja.
  const m = srcSw.match(/const CACHE_NAME = 'gestor-yc-shell-v(\d+)-/);
  assert.ok(m, 'CACHE_NAME debe seguir el patrón de versión "gestor-yc-shell-vN-..."');
  assert.ok(Number(m[1]) >= 4, 'la versión debe haber subido desde la v4 de esta ronda (o más, en rondas posteriores)');
});

console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
