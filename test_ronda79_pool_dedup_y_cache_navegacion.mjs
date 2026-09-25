// ════════════════════════════════════════════════════════════════════════
// RONDA 79 — Cuello de botella del pool de PostgreSQL + caché-primero
// también en la NAVEGACIÓN EN CALIENTE (no solo en el arranque en frío).
//
// SÍNTOMA reportado (con evidencia de terminal): timeouts masivos y
// repetidos en /api/carga-docente, /api/permisos-docente,
// /api/grados/:id/observador, /api/actividades-docente y /api/inetis/db —
// pero un reintento MANUAL (botón "Cargar") funciona al instante. La
// investigación de código (ver los comentarios de esta ronda en
// src/db/index.ts, src/lib/db-cache.ts, src/index.ts y 03-app-core.js)
// confirmó 3 causas reales combinadas:
//  (1) El pool de `pg` usaba sus valores por defecto (max:10, sin límite de
//      espera por conexión, conexiones ociosas cerradas a los 10s) — bajo
//      para el patrón de uso real de la app.
//  (2) Varios endpoints (/api/inetis/db, /api/carga-docente,
//      /api/permisos-docente, /api/grados/:id/observador,
//      /api/actividades-docente) comparten el MISMO helper de lectura de
//      `kv_store`, pero cuando la caché de 5s estaba vacía, CADA uno
//      disparaba su PROPIA consulta a Neon si llegaban casi al mismo
//      tiempo — justo el patrón "carga automática con varias peticiones a
//      la vez falla, un solo reintento manual funciona" que describió el
//      usuario.
//  (3) "Observador de Aula" (y, en general, cualquier navegación que ya
//      tuviera datos utilizables en memoria) bloqueaba su primer render en
//      la respuesta de red en vez de usar lo que ya había en caché local.
//
// Cobertura de esta ronda:
//  (A) BACKEND — Pool de `pg` (src/db/index.ts): max/connectionTimeoutMillis/
//      idleTimeoutMillis ajustados según lo pedido. Verificado por
//      inspección de código (no se puede levantar una conexión real a
//      Postgres en este entorno de pruebas — no hay `node_modules`/
//      DATABASE_URL — mismo criterio ya usado en rondas anteriores para
//      código que depende de una BD real).
//  (B) BACKEND — leerFilaKvStoreConDedup() (src/lib/db-cache.ts): la
//      función REAL se extrae tal cual del archivo fuente (mismo texto,
//      sin reescribirla a mano) y se ejecuta de forma aislada (no depende
//      de Drizzle/pg — ver el propio comentario del archivo) para verificar
//      el comportamiento de deduplicación con datos controlados.
//  (C) FRONTEND — _mostrarSkeletonYNavegar(): con datos ya cacheados en
//      "db", renderiza de inmediato (sin bloquear en el skeleton) mientras
//      la actualización de red sigue en segundo plano.
//  (D) FRONTEND — el "fast path" de caché en el arranque en frío
//      (bootstrap dentro de la IIFE al final de 03-app-core.js) se verifica
//      por inspección de código, ya que esa IIFE se ejecuta una única vez
//      al cargar el script (no es una función independiente invocable de
//      nuevo con distintos fixtures, igual que el resto del bootstrap de
//      rondas anteriores).
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
const delay = (ms, val) => new Promise((resolve) => setTimeout(() => resolve(val), ms));

// ════════════════════════════════════════════════════════════════════════
// PARTE A — Pool de `pg` (src/db/index.ts): verificación por inspección de
// código (no se puede instanciar `new Pool()` de verdad sin `node_modules`
// ni una `DATABASE_URL` real en este entorno de pruebas).
// ════════════════════════════════════════════════════════════════════════
const srcDbIndex = fs.readFileSync(new URL('./src/db/index.ts', import.meta.url), 'utf8');
const bloquePool = (srcDbIndex.match(/const pool = new Pool\(\{[\s\S]*?\}\);/) || [''])[0];

check('src/db/index.ts: el Pool de pg fija max:20 (antes, sin este ajuste, usaba el default de la librería, 10)', () => {
  assert.match(bloquePool, /max:\s*20\s*,/, 'debe encontrarse "max: 20," dentro de la config de new Pool({...})');
});
check('src/db/index.ts: el Pool de pg fija connectionTimeoutMillis:10000 (10s) — antes no tenía límite (0 = esperar indefinidamente por una conexión libre)', () => {
  assert.match(bloquePool, /connectionTimeoutMillis:\s*10000\s*,/, 'debe encontrarse "connectionTimeoutMillis: 10000," dentro de la config de new Pool({...})');
});
check('src/db/index.ts: el Pool de pg fija idleTimeoutMillis:30000 (30s) — antes 10s, cerraba conexiones (con su TLS ya negociado) demasiado rápido', () => {
  assert.match(bloquePool, /idleTimeoutMillis:\s*30000\s*,/, 'debe encontrarse "idleTimeoutMillis: 30000," dentro de la config de new Pool({...})');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — leerFilaKvStoreConDedup() (src/lib/db-cache.ts): se EXTRAE el
// código fuente REAL (líneas 33-150, que no dependen de Drizzle/pg/Express
// — mismo criterio documentado en el propio archivo) a un módulo temporal y
// se ejecuta tal cual, sin reescribir la lógica a mano, para comprobar la
// deduplicación de lecturas concurrentes con datos controlados.
// ════════════════════════════════════════════════════════════════════════
const srcDbCache = fs.readFileSync(new URL('./src/lib/db-cache.ts', import.meta.url), 'utf8');
const lineasDbCache = srcDbCache.split('\n');
const inicioBloque = lineasDbCache.findIndex(l => l.includes('const CACHE_TTL_MS'));
const finBloqueIdx = lineasDbCache.findIndex((l, i) => i > inicioBloque && l.trim() === '}' && lineasDbCache[i - 1].trim() === 'return promesa;');
if (inicioBloque === -1 || finBloqueIdx === -1) {
  console.error('❌ NO SE PUDO EXTRAER EL BLOQUE DE leerFilaKvStoreConDedup() — revisar los marcadores de extracción de este test');
  process.exit(1);
}
const bloqueExtraido = lineasDbCache.slice(inicioBloque, finBloqueIdx + 1).join('\n');
// Comprobación de honestidad del propio test: el bloque extraído debe
// contener literalmente la función bajo prueba (si el nombre cambiara, este
// test fallaría aquí en vez de dar un falso verde probando un bloque vacío).
if (!bloqueExtraido.includes('export async function leerFilaKvStoreConDedup')) {
  console.error('❌ El bloque extraído no contiene leerFilaKvStoreConDedup() — revisar los marcadores de extracción');
  process.exit(1);
}
const tmpFile = path.join(os.tmpdir(), `ronda79_dedup_extraido_${Date.now()}.ts`);
fs.writeFileSync(tmpFile, bloqueExtraido, 'utf8');
const { leerFilaKvStoreConDedup, leerDbCacheado, invalidarDbCache } = await import(`file://${tmpFile}?t=${Date.now()}`);

check('leerFilaKvStoreConDedup() se extrajo correctamente del archivo fuente real y es una función', () => {
  assert.equal(typeof leerFilaKvStoreConDedup, 'function');
});

await checkAsync('leerFilaKvStoreConDedup(): 2 lecturas CONCURRENTES para el MISMO "sk" invocan "ejecutarConsulta" UNA sola vez (la 2ª espera y reutiliza la 1ª en vuelo)', async () => {
  invalidarDbCache('sk-dedup-1');
  let invocaciones = 0;
  const ejecutarConsulta = () => { invocaciones++; return delay(50, { value: { x: 1 }, updatedAt: new Date(), existe: true }); };
  const [r1, r2] = await Promise.all([
    leerFilaKvStoreConDedup('sk-dedup-1', ejecutarConsulta),
    leerFilaKvStoreConDedup('sk-dedup-1', ejecutarConsulta),
  ]);
  assert.equal(invocaciones, 1, `"ejecutarConsulta" no debe invocarse más de 1 vez para 2 lecturas concurrentes del mismo sk, se invocó ${invocaciones} veces`);
  assert.deepEqual(r1.value, { x: 1 }); assert.deepEqual(r2.value, { x: 1 });
});

await checkAsync('leerFilaKvStoreConDedup(): "sk" DIFERENTES nunca comparten la deduplicación (cada institución dispara su propia consulta)', async () => {
  invalidarDbCache('sk-dedup-2a'); invalidarDbCache('sk-dedup-2b');
  let invocaciones = 0;
  const ejecutarConsulta = () => { invocaciones++; return delay(20, { value: {}, updatedAt: new Date(), existe: true }); };
  await Promise.all([
    leerFilaKvStoreConDedup('sk-dedup-2a', ejecutarConsulta),
    leerFilaKvStoreConDedup('sk-dedup-2b', ejecutarConsulta),
  ]);
  assert.equal(invocaciones, 2, `2 instituciones distintas deben producir 2 consultas reales, hubo ${invocaciones}`);
});

await checkAsync('leerFilaKvStoreConDedup(): tras completarse, una lectura NUEVA (ya no concurrente) para el mismo "sk" SÍ dispara su propia consulta (respeta la caché de 5s, no bloquea para siempre)', async () => {
  invalidarDbCache('sk-dedup-3');
  let invocaciones = 0;
  const ejecutarConsulta = () => { invocaciones++; return Promise.resolve({ value: { n: invocaciones }, updatedAt: new Date(), existe: true }); };
  const r1 = await leerFilaKvStoreConDedup('sk-dedup-3', ejecutarConsulta);
  invalidarDbCache('sk-dedup-3'); // se fuerza a expirar la caché de 5s para aislar el comportamiento del dedup de en-vuelo, no de la caché por TTL
  const r2 = await leerFilaKvStoreConDedup('sk-dedup-3', ejecutarConsulta);
  assert.equal(invocaciones, 2);
  assert.equal(r1.value.n, 1); assert.equal(r2.value.n, 2);
});

await checkAsync('leerFilaKvStoreConDedup(): si "ejecutarConsulta" falla (ej. TimeoutError tras agotar el reintento), la lectura en vuelo se limpia — la SIGUIENTE lectura para ese "sk" reintenta desde cero en vez de quedar bloqueada para siempre', async () => {
  invalidarDbCache('sk-dedup-4');
  let intento = 0;
  const ejecutarConsulta = () => {
    intento++;
    return intento === 1 ? Promise.reject(new Error('Timeout simulado')) : Promise.resolve({ value: { ok: true }, updatedAt: new Date(), existe: true });
  };
  await assert.rejects(() => leerFilaKvStoreConDedup('sk-dedup-4', ejecutarConsulta));
  const r2 = await leerFilaKvStoreConDedup('sk-dedup-4', ejecutarConsulta);
  assert.equal(intento, 2, 'la 2ª llamada, tras el fallo de la 1ª, debe reintentar la consulta real (no quedarse esperando una lectura en vuelo que ya falló)');
  assert.deepEqual(r2.value, { ok: true });
});

await checkAsync('leerFilaKvStoreConDedup(): respeta la caché de 5s existente — con una entrada cacheada vigente, NO invoca "ejecutarConsulta" en absoluto', async () => {
  invalidarDbCache('sk-dedup-5');
  let invocaciones = 0;
  const ejecutarConsulta = () => { invocaciones++; return Promise.resolve({ value: { primero: true }, updatedAt: new Date(), existe: true }); };
  await leerFilaKvStoreConDedup('sk-dedup-5', ejecutarConsulta); // puebla la caché de 5s
  const r2 = await leerFilaKvStoreConDedup('sk-dedup-5', ejecutarConsulta); // debe servirse de la caché, no de una 2ª consulta
  assert.equal(invocaciones, 1, `con la caché de 5s vigente, "ejecutarConsulta" no debe invocarse de nuevo, se invocó ${invocaciones} veces`);
  assert.deepEqual(r2.value, { primero: true });
});

fs.unlinkSync(tmpFile);

// ════════════════════════════════════════════════════════════════════════
// PARTE C — FRONTEND: _mostrarSkeletonYNavegar() caché-primero. Misma
// técnica "vm" de las Rondas 74-78: se carga el 03-app-core.js REAL
// (truncado) en un contexto Node con un DOM/fetch simulados.
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idx = src1.indexOf(marker);
if (idx === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idx);

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
    set innerHTML(v) { this._html = v; },
    textContent: '', value: '',
    offsetWidth: 300, offsetHeight: 200,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  return el;
}
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return null; },
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

let _latenciaSimuladaMs = 0;
let _fetchDebeFallar = false;
const _fetchCalls = [];
async function fetchStub(url, opts) {
  _fetchCalls.push({ url: String(url), opts: opts || {} });
  if (_latenciaSimuladaMs > 0) await new Promise(r => setTimeout(r, _latenciaSimuladaMs));
  if (_fetchDebeFallar) throw new Error('Fallo de red simulado');
  if (opts && opts.signal && opts.signal.aborted) { const e = new Error('AbortError'); e.name = 'AbortError'; throw e; }
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
ctx.setInterval = (fn, ms, ...a) => { const t = setInterval(fn, ms, ...a); if (t.unref) t.unref(); return t; };
ctx.clearInterval = clearInterval;
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

function run(code) { return vm.runInContext(code, ctx); }

function fixtureDB(extra) {
  return Object.assign({
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 79', anio: '2026',
    config: { numPeriodos: 4, pesosPeriodos: [25,25,25,25], pctSer: 0.25, pctSaber: 0.35, pctHacer: 0.40, nomSer: 'SER', nomSaber: 'SABER', nomHacer: 'HACER', escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, mostrarInasistenciasEnPlanilla: false },
    grados: [{ n: '10°', d: 'doc1' }],
    users: [{ u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x' }],
    carga: [{ id: 101, g: '10°', m: 'Matemáticas', a: 'Matemáticas', d: 'doc1', dn: 'Docente Uno', ih: 5 }],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [] },
      { id: 'e2', n: 'BRAYAN LOPEZ', g: '10°', nts: {}, observaciones: [] },
    ],
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true, true, true, true],
    notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [],
  }, extra || {});
}
function instalarDB(dbObj) {
  run('db = ' + JSON.stringify(dbObj) + ';');
  run('sesion = { u: "doc1", r: "docente", n: "Docente Uno" };');
  run('window._filaEnEdicion=null; window._loteFilasEnEdicion=null;');
  run('window._colaGuardadoFilas=[]; window._colaGuardadoFilasInfo={};');
  run('window._dbGranularSolamente=false;');
  run('window._pullDBEnVuelo=null;');
  run('window._currentPlatSK="sk-test-79";');
  run('window._adminPortalMode=false;');
  _fetchCalls.length = 0;
  _latenciaSimuladaMs = 0;
  _fetchDebeFallar = false;
}

check('_mostrarSkeletonYNavegar() CON datos ya cacheados en "db" (db.nombre poblado): renderiza el contenido REAL de inmediato (renderApp()), sin tapar la vista con el skeleton crudo', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._contNav79 = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contNav79 : null);
    window._renderAppLlamado79 = false;
    window._navegarLlamado79 = false;
    window._renderAppOriginal79 = renderApp;
    window._navegarOriginal79 = _navegarConCargaGranularSiAplica;
    renderApp = function(){ window._renderAppLlamado79 = true; window._contNav79.innerHTML = '<div class="contenido-real">ya con datos</div>'; };
    _navegarConCargaGranularSiAplica = function(){ window._navegarLlamado79 = true; return Promise.resolve(); };
    pag = 'obs-aula';
    _mostrarSkeletonYNavegar();
  `);
  assert.equal(run('window._renderAppLlamado79'), true, 'con datos ya en caché, renderApp() debe llamarse de inmediato, de forma síncrona');
  assert.ok(!run('window._contNav79.innerHTML').includes('skel-wrap'), 'NO debe inyectarse el skeleton crudo cuando ya hay datos utilizables en "db"');
  assert.ok(run('window._contNav79.innerHTML').includes('contenido-real'), 'debe verse el contenido real pintado por renderApp(), no un cascarón vacío');
  run('renderApp = window._renderAppOriginal79; _navegarConCargaGranularSiAplica = window._navegarOriginal79;');
});

await checkAsync('_mostrarSkeletonYNavegar() CON datos ya cacheados: la actualización de red (_navegarConCargaGranularSiAplica) SIGUE disparándose en segundo plano, no se omite', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._contNav79b = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contNav79b : null);
    window._navegarLlamado79b = false;
    window._renderAppOriginal79b = renderApp;
    window._navegarOriginal79b = _navegarConCargaGranularSiAplica;
    renderApp = function(){};
    _navegarConCargaGranularSiAplica = function(){ window._navegarLlamado79b = true; return Promise.resolve(); };
    pag = 'ausentismo';
    _mostrarSkeletonYNavegar();
  `);
  // _navegarConCargaGranularSiAplica se agenda con setTimeout(...,0) — hay
  // que ceder el control del event loop para que llegue a ejecutarse.
  await delay(20);
  assert.equal(run('window._navegarLlamado79b'), true, 'la actualización de red en segundo plano debe seguir disparándose aunque ya se haya pintado desde caché');
  run('renderApp = window._renderAppOriginal79b; _navegarConCargaGranularSiAplica = window._navegarOriginal79b;');
});

check('_mostrarSkeletonYNavegar() SIN nada en "db" todavía (db.nombre vacío): conserva el comportamiento de siempre — muestra el skeleton y NO llama renderApp() de inmediato', () => {
  const d = fixtureDB(); d.nombre = ''; instalarDB(d);
  run(`
    window._contNav79c = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contNav79c : null);
    window._renderAppLlamado79c = false;
    window._renderAppOriginal79c = renderApp;
    renderApp = function(){ window._renderAppLlamado79c = true; };
    pag = 'obs-aula';
    _mostrarSkeletonYNavegar();
  `);
  assert.equal(run('window._renderAppLlamado79c'), false, 'sin nada en caché todavía, NO debe llamarse renderApp() de inmediato (debe esperar la navegación granular, igual que antes de esta ronda)');
  assert.ok(run('window._contNav79c.innerHTML').includes('skel-wrap'), 'sin caché, debe mostrarse el skeleton crudo como red de seguridad visual, igual que siempre');
  run('renderApp = window._renderAppOriginal79c;');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE D — Bootstrap de arranque en frío (IIFE al final del archivo): se
// ejecuta UNA sola vez al cargar el script (no es una función invocable de
// nuevo con distintos fixtures), así que se verifica por inspección de
// código — mismo criterio que el resto de este bootstrap en rondas
// anteriores (Rondas 35/56/58, nunca testeadas función-por-función porque
// no son funciones independientes).
// ════════════════════════════════════════════════════════════════════════
check('Bootstrap de arranque en frío: existe la variable "_yaHabiaCacheLocalParaPintarYa" que detecta caché local utilizable (db.nombre) ANTES de esperar cualquier respuesta de red', () => {
  assert.match(src1, /_yaHabiaCacheLocalParaPintarYa\s*=\s*!!\(sesion&&!window\._adminPortalMode&&db&&db\.nombre\)/, 'debe existir la detección de caché local utilizable, basada en sesión activa + db.nombre poblado');
});
check('Bootstrap de arranque en frío: cuando SÍ hay caché local utilizable, se llama a renderApp() de inmediato (antes del "let ok;"/de esperar cualquier _pullDB()/granular)', () => {
  const idxFlag = src1.indexOf('_yaHabiaCacheLocalParaPintarYa=');
  const idxLetOk = src1.indexOf('let ok;');
  assert.ok(idxFlag > -1 && idxLetOk > -1 && idxFlag < idxLetOk, 'la detección de caché y su renderApp() inmediato deben ocurrir ANTES de "let ok;" (antes de cualquier await de red)');
  const fragmento = src1.slice(idxFlag, idxLetOk);
  assert.match(fragmento, /if\(_yaHabiaCacheLocalParaPintarYa\)\{[\s\S]*?renderApp\(\);/, 'debe llamarse renderApp() dentro del "if(_yaHabiaCacheLocalParaPintarYa){...}"');
});
check('Bootstrap de arranque en frío: si la revalidación de red falla pero YA se pintó desde caché, NO se vuelve a la pantalla de login/landing (antes de esta ronda, un timeout de red sí "rebotaba" a la landing)', () => {
  assert.match(src1, /\}\s*else if\(_yaHabiaCacheLocalParaPintarYa\)\s*\{/, 'debe existir una rama "else if(_yaHabiaCacheLocalParaPintarYa)" que NO llame a renderGestorLanding()/renderAdminPortal() cuando la app ya se pintó desde caché');
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) {
  console.log('✅ 100% de la suite en verde.');
  process.exit(0);
} else {
  console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
  process.exit(1);
}
