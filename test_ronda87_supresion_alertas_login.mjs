// ════════════════════════════════════════════════════════════════════════
// RONDA 87 — SUPRESIÓN DE ALERTAS DE LOGIN (UX). Construye sobre la v17
// (Ronda 86).
//
// INVESTIGACIÓN PREVIA: se rastrearon las 4 emisiones de kind:'login' (al
// iniciar sesión un docente, con o sin biométrico — 03-app-core.js:3602/8409
// y 06-documentos-y-resto.js:9190/9242), todas pasan por el mismo endpoint
// central POST /api/inetis/notify. Se encontraron DOS mecanismos reales de
// "molestia", no uno:
//   (a) Backend: enviarPushParaNotificacion() (src/lib/push-provider.ts)
//       envía un push (notificación emergente del navegador/SO) a TODOS
//       los dispositivos suscritos de la institución — sin filtrar por
//       rol — por CADA notificación, incluido kind==='login'. Con 20
//       docentes entrando, eran 20 push a todo el mundo.
//   (b) Frontend: iniciarPollingNotificaciones() (06-documentos-y-resto.js)
//       arranca para CUALQUIER sesión ("if(sesion)", sin distinguir rol) y
//       muestra un banner flotante (mostrarNotifBanner) por cada
//       notificación nueva de CUALQUIER tipo, incluido 'login'.
// La bandeja de auditoría del Administrador (htmlContacto()/cargarNotificaciones(),
// ya restringida a sesion.r==='admin' antes de esta ronda) NO se tocó: el
// registro en la tabla "notifications" se sigue guardando igual para
// TODOS los logins — eso es precisamente lo que pide el requerimiento
// ("auditoría exclusiva en panel administrativo").
//
// FIX:
//   1) POST /api/inetis/notify (src/index.ts): ya NO llama a
//      enviarPushParaNotificacion() cuando kind==='login' (sigue
//      insertando la fila en "notifications" con normalidad).
//   2) iniciarPollingNotificaciones() (06-documentos-y-resto.js): excluye
//      kind==='login' (TIPOS_NOTIF_SIN_BANNER) de lo que dispara el
//      badge/mostrarNotifBanner(), para CUALQUIER rol — pero sigue
//      avanzando _lastNotifId con todas las notificaciones (login
//      incluido), para no reprocesar nada.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}
async function checkAsync(desc, fn) {
  try { await fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

// ════════════════════════════════════════════════════════════════════════
// PARTE A — src/index.ts: el guard real vive en el handler de
// POST /api/inetis/notify. Como ese archivo importa Express/Drizzle/pg (no
// instalados en este entorno de pruebas), se verifica por INSPECCIÓN DE
// TEXTO del bloque exacto del endpoint (mismo enfoque ya usado en
// test_ronda84 para el guard de _tieneCambioAcademicoNoPermitidoParaRolLimitado),
// y ADEMÁS se ejecuta la condición reelmente extraída como expresión pura
// (sin red/DB) para confirmar su comportamiento con distintos "kind".
// ════════════════════════════════════════════════════════════════════════
const srcIndex = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
const idxEndpoint = srcIndex.indexOf("app.post('/api/inetis/notify'");
check('src/index.ts: existe el endpoint POST /api/inetis/notify', () => {
  assert.ok(idxEndpoint > -1);
});
const idxFinEndpoint = srcIndex.indexOf('app.post(', idxEndpoint + 10);
const bloqueEndpoint = srcIndex.slice(idxEndpoint, idxFinEndpoint === -1 ? idxEndpoint + 2500 : idxFinEndpoint);
check('POST /api/inetis/notify: sigue insertando SIEMPRE la fila en "notifications" (auditoría nunca se pierde), sin condicionar el insert al "kind"', () => {
  assert.match(bloqueEndpoint, /await db\.insert\(notifications\)\.values\(\{/);
  // El insert debe estar ANTES del guard que condiciona el push — es decir,
  // el guard no debe envolver también el insert.
  const idxInsert = bloqueEndpoint.indexOf('await db.insert(notifications)');
  const idxGuard = bloqueEndpoint.indexOf("kind !== 'login'");
  assert.ok(idxInsert > -1 && idxGuard > -1 && idxInsert < idxGuard, 'el insert en "notifications" debe ejecutarse antes del guard de push, e incondicionalmente');
});
check('POST /api/inetis/notify: el push (enviarPushParaNotificacion) se omite explícitamente cuando kind==="login"', () => {
  assert.match(bloqueEndpoint, /if\s*\(sk\s*&&\s*kind\s*!==\s*'login'\)\s*enviarPushParaNotificacion\(/);
});
// Extrae la condición real como expresión ejecutable, sin depender de todo
// el archivo (que no se puede importar en este entorno sin Express/pg).
const condMatch = bloqueEndpoint.match(/if\s*\((sk\s*&&\s*kind\s*!==\s*'login')\)/);
check('La condición extraída del código real se comporta como se espera para distintos valores de "kind" y "sk"', () => {
  assert.ok(condMatch, 'no se pudo extraer la condición del código real');
  const evaluar = (sk, kind) => !!new Function('sk', 'kind', 'return (' + condMatch[1] + ');')(sk, kind);
  assert.equal(evaluar('SK1', 'login'), false, 'con kind="login" el push debe quedar suprimido');
  assert.equal(evaluar('SK1', 'mensaje'), true, 'con cualquier otro kind, el push debe seguir enviándose con normalidad');
  assert.equal(evaluar('SK1', 'alerta-academica'), true, 'las Alertas Académicas (Ronda 84) no deben verse afectadas por este cambio');
  assert.equal(evaluar(undefined, 'mensaje'), false, 'sin "sk" nunca se envía push (comportamiento previo, sin cambios)');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — Frontend (06-documentos-y-resto.js): chequeos estáticos +
// entorno "vm" funcional (mismo patrón de Rondas 74-86).
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

check('iniciarPollingNotificaciones(): excluye "login" del conjunto que dispara badge/banner (TIPOS_NOTIF_SIN_BANNER)', () => {
  assert.match(src2, /const TIPOS_NOTIF_SIN_BANNER=new Set\(\['login'\]\);/);
  const idxFn = src2.indexOf('function iniciarPollingNotificaciones(){');
  const idxFin = src2.indexOf('\nfunction mostrarNotifBanner', idxFn);
  const bloque = src2.slice(idxFn, idxFin === -1 ? idxFn + 1500 : idxFin);
  // RONDA 108-HOTFIX — el filtro ahora es multilínea porque además excluye,
  // SOLO para el rol docente, los "kind" de estado del estudiante (ver
  // KINDS_ESTADO_ESTUDIANTE_SIN_BANNER_DOCENTE más arriba en este mismo
  // archivo) — pero la exclusión de "login" para TODOS los roles, que es lo
  // que esta prueba de la Ronda 87 verifica, se conserva intacta dentro de
  // esa misma expresión.
  assert.match(bloque, /nuevasVisibles=todasNuevas\.filter\(n=>!TIPOS_NOTIF_SIN_BANNER\.has\(n\.kind\)/);
  assert.match(bloque, /mostrarNotifBanner\(nuevasVisibles\)/);
});
check('iniciarPollingNotificaciones(): sigue arrancando para CUALQUIER sesión (no se restringió por rol — el filtro es por "kind", según lo pedido)', () => {
  assert.match(src2, /if\(sesion\)\s*iniciarPollingNotificaciones\(\);/);
});
check('Las 4 emisiones de kind:\'login\' (login normal + biométrico) siguen registrándose — la auditoría no se eliminó, solo el push/banner', () => {
  const ocurrencias = (src1.match(/kind:'login'/g) || []).length + (src2.match(/kind:'login'/g) || []).length;
  assert.equal(ocurrencias, 4, 'deben seguir existiendo las 4 emisiones originales de kind:\'login\' (solo se suprimió su push/banner, no su registro)');
});

// ── Entorno "vm" funcional ──
function fakeEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(),
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], childNodes: [], attributes: {}, _listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {}, remove() {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, select() {}, click() {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; this._escrituras = (this._escrituras||0)+1; },
    textContent: '', value: '', checked: false,
    offsetWidth: 300, offsetHeight: 180,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  return el;
}
const elementosPorId = {};
function _getElementByIdOriginal(id) { return elementosPorId[id] || null; }
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return _getElementByIdOriginal(id); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(tag) { return fakeEl(tag); }, createElementNS(_ns, tag) { return fakeEl(tag); },
  createTextNode(t) { return { textContent: t }; },
};
class MutationObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class IntersectionObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class ResizeObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
const localStorageStub = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() };
})();
let _fetchDebeFallar = false;
let _fetchRespuestaCustom = null;
const _fetchCalls = [];
async function fetchStub(url, opts) {
  _fetchCalls.push({ url: String(url), opts: opts || {} });
  if (_fetchDebeFallar) throw new Error('Fallo de red simulado');
  if (_fetchRespuestaCustom) return _fetchRespuestaCustom(url, opts);
  return { ok: false, status: 0, json: async () => ({}), text: async () => '' };
}
class AbortSignalStub {
  constructor(){ this.aborted = false; this._listeners = []; }
  addEventListener(type, fn){ this._listeners.push(fn); }
  removeEventListener(){}
}
class AbortControllerStub {
  constructor(){ this.signal = new AbortSignalStub(); }
  abort(){ this.signal.aborted = true; this.signal._listeners.forEach(fn=>fn()); }
}
const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){};
ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800;
ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = localStorageStub; ctx.sessionStorage = localStorageStub;
ctx.fetch = fetchStub;
ctx.AbortController = AbortControllerStub;
ctx.console = console;
ctx.MutationObserver = MutationObserverStub; ctx.IntersectionObserver = IntersectionObserverStub; ctx.ResizeObserver = ResizeObserverStub;
ctx.setTimeout = (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); if (t.unref) t.unref(); return t; };
ctx.clearTimeout = clearTimeout;
// El polling real usa setInterval(fn,15000) — en vez de esperar 15s reales
// por prueba, se CAPTURA la función sin programarla, y cada prueba la
// invoca manualmente una vez (equivalente a "avanzar" un tick del
// intervalo), igual de real porque es el mismo código de producción.
ctx.__lastIntervalFn = null;
ctx.setInterval = (fn) => { ctx.__lastIntervalFn = fn; return 1; };
ctx.clearInterval = () => {};
ctx.requestAnimationFrame = (fn) => setTimeout(fn, 0);
ctx.URLSearchParams = URLSearchParams;
ctx.location = { search: '', pathname: '/', href: 'http://localhost/', hostname: 'localhost' };
ctx.history = { pushState(){}, replaceState(){} };
ctx.speechSynthesis = null; ctx.SpeechSynthesisUtterance = function(){};
ctx.alert = () => {}; ctx.confirm = () => true; ctx.prompt = () => null;
ctx.Image = function(){ return fakeEl('img'); };
ctx.FileReader = function(){ return { readAsDataURL(){}, readAsText(){} }; };
ctx.Blob = function(parts, opts){ this.parts = parts; this.opts = opts; };
ctx.FormData = function(){ this._d = new Map(); this.append = (k,v)=>this._d.set(k,v); };
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
ctx.matchMedia = () => ({ matches: false, addListener(){}, addEventListener(){} });
ctx.Notification = function(){}; ctx.EventSource = function(){ this.close = () => {}; }; ctx.WebSocket = function(){};
ctx.performance = performance;
ctx.btoa = typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(String(s), 'binary').toString('base64');
ctx.atob = typeof atob !== 'undefined' ? atob : (s) => Buffer.from(String(s), 'base64').toString('binary');
ctx._delayRef = (ms) => new Promise((resolve) => { globalThis.setTimeout(resolve, ms); });

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
try { vm.runInContext(src2, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }

function run(code) { return vm.runInContext(code, ctx); }
function instalarSesion(sesionObj) {
  run('sesion = ' + JSON.stringify(sesionObj) + ';');
  run('db = { nombre: "INSTITUCIÓN DE PRUEBA RONDA 87" };');
  for (const k of Object.keys(elementosPorId)) delete elementosPorId[k];
  _fetchCalls.length = 0;
  _fetchDebeFallar = false;
  _fetchRespuestaCustom = null;
  run('_lastNotifId = 0; _notifBadge = 0;');
}

await checkAsync('iniciarPollingNotificaciones(): un login (kind="login") llega en el polling, avanza _lastNotifId, pero NO dispara mostrarNotifBanner()', async () => {
  instalarSesion({ u: 'doc1', r: 'docente', n: 'Docente Uno' });
  _fetchRespuestaCustom = async () => ({
    ok: true,
    json: async () => ({ notifications: [
      { id: 1, kind: 'login', actor: 'Docente Dos', message: 'El/La docente Docente Dos ingresó al sistema', createdAt: new Date().toISOString() },
    ] }),
  });
  let bannerLlamado = false;
  ctx.mostrarNotifBanner = () => { bannerLlamado = true; };
  run('iniciarPollingNotificaciones()');
  await ctx.__lastIntervalFn();
  assert.equal(bannerLlamado, false, 'un evento de login NO debe disparar el banner emergente, ni siquiera para un docente');
  assert.equal(run('_lastNotifId'), 1, '_lastNotifId debe avanzar igual, aunque el login no dispare banner');
});
await checkAsync('iniciarPollingNotificaciones(): una notificación de OTRO tipo (ej. "mensaje") sigue disparando el banner con normalidad', async () => {
  instalarSesion({ u: 'rector1', r: 'admin', n: 'Rectora' });
  _fetchRespuestaCustom = async () => ({
    ok: true,
    json: async () => ({ notifications: [
      { id: 5, kind: 'mensaje', actor: 'Docente Uno', message: 'Mensaje de Docente Uno: consulta', createdAt: new Date().toISOString() },
    ] }),
  });
  let bannerArgs = null;
  ctx.mostrarNotifBanner = (n) => { bannerArgs = n; };
  run('iniciarPollingNotificaciones()');
  await ctx.__lastIntervalFn();
  assert.ok(bannerArgs && bannerArgs.length === 1, 'un mensaje normal SÍ debe seguir disparando el banner (no se rompió nada más)');
  assert.equal(run('_lastNotifId'), 5);
});
await checkAsync('iniciarPollingNotificaciones(): un lote mixto (login + mensaje) solo muestra el banner del mensaje, no del login', async () => {
  instalarSesion({ u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', rolEspecifico: 'Tutor PTA' });
  _fetchRespuestaCustom = async () => ({
    ok: true,
    json: async () => ({ notifications: [
      { id: 10, kind: 'login', actor: 'Docente Tres', message: 'ingresó', createdAt: new Date().toISOString() },
      { id: 11, kind: 'mensaje', actor: 'Docente Cuatro', message: 'Hola', createdAt: new Date().toISOString() },
    ] }),
  });
  let bannerArgs = null;
  ctx.mostrarNotifBanner = (n) => { bannerArgs = n; };
  run('iniciarPollingNotificaciones()');
  await ctx.__lastIntervalFn();
  assert.ok(bannerArgs && bannerArgs.length === 1 && bannerArgs[0].kind === 'mensaje', 'el banner solo debe incluir la notificación que NO es de login');
  assert.equal(run('_lastNotifId'), 11, '_lastNotifId debe llegar hasta el id más alto, login incluido');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — Preservación de lo ya construido (Rondas 84-86): la bandeja de
// auditoría del Administrador (cargarNotificaciones()) sigue mostrando
// "🔓 Ingreso" para kind==='login' sin cambios — la auditoría NUNCA se
// eliminó, solo se dejó de "empujar" como alerta emergente.
// ════════════════════════════════════════════════════════════════════════
check('cargarNotificaciones() (panel del Administrador) sigue etiquetando "🔓 Ingreso" para kind===\'login\' — la auditoría sigue intacta', () => {
  assert.match(src2, /n\.kind==='login'\?'🔓 Ingreso'/);
});
check('htmlContacto(): la bandeja de notificaciones (#notifList) sigue existiendo únicamente en la vista de Admin, nunca en la de un docente', () => {
  const idxFn = src2.indexOf('function htmlContacto(){');
  const idxAdminReturn = src2.indexOf('if(isAdmin){', idxFn);
  const idxVistaDocente = src2.indexOf('// Vista del docente', idxFn);
  const bloqueAdmin = src2.slice(idxAdminReturn, idxVistaDocente);
  const bloqueDocente = src2.slice(idxVistaDocente, idxVistaDocente + 1500);
  assert.match(bloqueAdmin, /id="notifList"/);
  assert.doesNotMatch(bloqueDocente, /id="notifList"/);
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) console.log('✅ 100% de la suite en verde.');
else console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
process.exit(fail === 0 ? 0 : 1);
