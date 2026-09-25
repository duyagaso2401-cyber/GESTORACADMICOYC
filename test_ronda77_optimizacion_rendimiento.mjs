// ════════════════════════════════════════════════════════════════════════
// RONDA 77 — Optimización global de rendimiento (latencia de Neon / BD
// remota) y timeout de seguridad en frontend y backend.
//
// SÍNTOMA reportado: lentitud extrema y congelamiento al navegar entre
// módulos (todos los roles) porque las peticiones del backend a Neon sufren
// latencia y, sin ningún límite de tiempo, un fetch/consulta lenta dejaba
// la vista (y el Skeleton) esperando indefinidamente.
//
// Cobertura de esta ronda:
//  (1) BACKEND — conTimeout() (src/lib/timeout.ts): función pura que corta
//      cualquier promesa que tarde más de "ms" milisegundos, usada ahora en
//      TODAS las lecturas a Neon (GET /api/inetis/db y el helper compartido
//      _leerBlobInstitucionParaFragmento(), del que dependen los 15
//      endpoints granulares de Observador, Asistencia, Documentos, Actas,
//      Planilla, Configuración y Dashboards).
//  (2) FRONTEND — _fetchConTimeout() (03-app-core.js): mismo concepto del
//      lado del cliente (AbortController), usado en _pullDB() y en TODOS
//      los "_cargar...Granular()".
//  (3) CACHÉ-PRIMERO — cargarListaObservador() pinta de inmediato los datos
//      que YA existen en memoria/localStorage ("db"), sin esperar a la red,
//      mientras la sincronización de fondo revalida en silencio.
//  (4) Simulación de latencia alta (3000ms+) confirmando que el sistema
//      responde de forma acotada y amigable, sin colgar la interfaz.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// ════════════════════════════════════════════════════════════════════════
// PARTE A — BACKEND: conTimeout() (src/lib/timeout.ts), función pura sin
// dependencias externas (no requiere una conexión real a Neon/Postgres).
// ════════════════════════════════════════════════════════════════════════
const { conTimeout, TimeoutError, TIMEOUT_CONSULTA_BD_MS } = await import('./src/lib/timeout.ts');

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

check('TIMEOUT_CONSULTA_BD_MS está dentro del rango 5-15s (Ronda 77: 5-8s inicial; Ronda 78: se amplió a 12s para tolerar el arranque en frío de Neon)', () => {
  assert.ok(TIMEOUT_CONSULTA_BD_MS >= 5000 && TIMEOUT_CONSULTA_BD_MS <= 15000, `debe estar en [5000,15000], es ${TIMEOUT_CONSULTA_BD_MS}`);
});
await checkAsync('conTimeout(): si la consulta a la BD responde ANTES del límite, se propaga su resultado tal cual', async () => {
  const resultado = await conTimeout(delay(20, { filas: ['ok'] }), 200);
  assert.deepEqual(resultado, { filas: ['ok'] });
});
await checkAsync('conTimeout(): simulando latencia ALTA de red/BD (3000ms+), si supera el límite configurado, rechaza con TimeoutError EN VEZ de colgarse indefinidamente', async () => {
  const inicio = Date.now();
  await assert.rejects(
    () => conTimeout(delay(3500, 'nunca debería llegar'), 300, 'consulta simulada a Neon'),
    (err) => err instanceof TimeoutError
  );
  const transcurrido = Date.now() - inicio;
  assert.ok(transcurrido < 1000, `conTimeout debe cortar cerca de los 300ms configurados, no esperar los 3500ms de la consulta lenta (transcurrido=${transcurrido}ms)`);
});
await checkAsync('conTimeout(): un error de la propia consulta (no un timeout) se propaga sin alterarlo', async () => {
  const promesaQueFalla = Promise.reject(new Error('Error real de Neon (ej. conexión rechazada)'));
  await assert.rejects(() => conTimeout(promesaQueFalla, 500), (err) => !(err instanceof TimeoutError) && err.message.includes('Error real de Neon'));
});
await checkAsync('conTimeout(): con latencia extrema (8000ms, un "cuelgue" total de Neon), sigue respondiendo dentro del límite configurado, nunca esperando la latencia completa', async () => {
  const inicio = Date.now();
  await assert.rejects(() => conTimeout(delay(8000, 'x'), 500), (err) => err instanceof TimeoutError);
  const transcurrido = Date.now() - inicio;
  assert.ok(transcurrido < 2000, `debe cortar mucho antes de los 8000ms de latencia simulada (transcurrido=${transcurrido}ms)`);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — FRONTEND: _fetchConTimeout() y caché-primero en
// cargarListaObservador(). Misma técnica de las Rondas 74-76: se cargan los
// módulos monolíticos REALES (03-app-core.js truncado + 06-documentos-y-
// resto.js completo) en un contexto Node "vm" compartido.
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');
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

// Fetch stub CONFIGURABLE: por defecto responde rápido, pero cada prueba
// puede fijar una latencia (ms) para simular una BD/red lenta (3000ms+).
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

// AbortController mínimo (el entorno vm no trae uno propio por defecto).
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
try { vm.runInContext(src2, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }

function run(code) { return vm.runInContext(code, ctx); }

function fixtureDB(extra) {
  return Object.assign({
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 77', anio: '2026',
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
  run('asistGrado=""; asistCId=""; asistPeriodo="1"; asistTabActivo="reg";');
  run('actaTab="actas";');
  _fetchCalls.length = 0;
  _latenciaSimuladaMs = 0;
  _fetchDebeFallar = false;
}

check('_fetchConTimeout() existe como función global (reemplazo transparente de fetch())', () => {
  assert.equal(run('typeof _fetchConTimeout'), 'function');
});
await checkAsync('_fetchConTimeout(): con latencia SIMULADA alta (3000ms+) más allá del límite configurado, resuelve como "no ok" dentro del límite — NUNCA espera la latencia completa', async () => {
  const d = fixtureDB(); instalarDB(d);
  _latenciaSimuladaMs = 3000; // la "BD remota" tarda 3s en responder
  const inicio = Date.now();
  const r = await vm.runInContext(`_fetchConTimeout('https://api.test/lento', {}, 300)`, ctx); // límite de prueba: 300ms
  const transcurrido = Date.now() - inicio;
  assert.equal(r.ok, false, 'debe resolver como "no ok" ante el timeout, nunca lanzar ni colgarse');
  assert.ok(transcurrido < 1500, `debe resolver cerca de los 300ms configurados, no esperar los 3000ms simulados (transcurrido=${transcurrido}ms)`);
});
await checkAsync('_fetchConTimeout(): si la red responde a tiempo, se comporta como un fetch() normal (transparente)', async () => {
  const d = fixtureDB(); instalarDB(d);
  _latenciaSimuladaMs = 10;
  const r = await vm.runInContext(`_fetchConTimeout('https://api.test/rapido', {}, 500)`, ctx);
  assert.equal(r.ok, false); // el stub siempre responde ok:false, pero SIN pasar por la rama de timeout
  assert.equal(r._timeout, undefined, 'no debe marcarse como timeout cuando la red respondió a tiempo');
});
await checkAsync('_fetchConTimeout(): un error de red (no un timeout) también resuelve de forma controlada, sin propagar la excepción', async () => {
  const d = fixtureDB(); instalarDB(d);
  _fetchDebeFallar = true;
  const r = await vm.runInContext(`_fetchConTimeout('https://api.test/falla', {}, 500)`, ctx);
  assert.equal(r.ok, false);
});
await checkAsync('_pullDB(): con latencia SIMULADA alta (3000ms+), usa _fetchConTimeout() por debajo y NUNCA queda esperando más allá del límite configurado (7s por defecto; aquí se sustituye por uno corto para no alargar la prueba — el MECANISMO probado es el mismo)', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._currentPlatSK = 'sk-test-77';
    // TIMEOUT_FETCH_GRANULAR_MS es una constante (7000ms reales) — en vez de
    // reasignarla, se sustituye _fetchConTimeout() mismo por una versión que
    // fuerza un límite corto (300ms), preservando el resto de su
    // comportamiento real (delega en la función original con ese límite).
    const _origFetchConTimeout = _fetchConTimeout;
    _fetchConTimeout = function(url, opts){ return _origFetchConTimeout(url, opts, 300); };
  `);
  _latenciaSimuladaMs = 3000;
  const inicio = Date.now();
  const resultado = await vm.runInContext('_pullDB()', ctx);
  const transcurrido = Date.now() - inicio;
  assert.equal(resultado, false, '_pullDB() debe devolver false (no obtuvo datos a tiempo), nunca colgarse');
  assert.ok(transcurrido < 1500, `_pullDB() debe resolver cerca del límite configurado, no esperar los 3000ms simulados (transcurrido=${transcurrido}ms)`);
  run('_fetchConTimeout = _origFetchConTimeout;');
});

// ── Caché-primero (stale-while-revalidate) en Observador del Estudiante ──
await checkAsync('cargarListaObservador(): con datos YA en caché (db.ests) para el grado, pinta la tabla real de INMEDIATO (sin skeleton) mientras la red (lenta, 3000ms+) revalida en segundo plano', async () => {
  const d = fixtureDB(); instalarDB(d); // fixture YA trae e1/e2 para el grado 10°
  _latenciaSimuladaMs = 3000;
  run(`
    window._wrapObsCache = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '10°' };
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') return window._wrapObsCache;
      return null;
    };
    window._promesaObsCache = cargarListaObservador();
  `);
  // Sin esperar NADA (la red tarda 3s), el contenedor ya debe mostrar los
  // datos reales de la caché, no el skeleton — esta es la mejora central
  // de la Ronda 77 frente al comportamiento de la Ronda 75/76.
  const htmlInmediato = run('window._wrapObsCache.innerHTML');
  assert.ok(!htmlInmediato.includes('skel-wrap'), 'NO debe mostrarse el skeleton cuando ya hay datos en caché para revalidar');
  assert.ok(htmlInmediato.includes('ANA PEREZ'), 'debe pintar de inmediato los datos ya conocidos, sin esperar la red');
  // Y la revalidación de fondo, aunque lenta, eventualmente termina y no
  // deja nada roto ni pegado.
  await vm.runInContext('window._promesaObsCache', ctx);
  const htmlFinal = run('window._wrapObsCache.innerHTML');
  assert.ok(htmlFinal.includes('ANA PEREZ'));
  assert.equal(run('window._wrapObsCache.getAttribute("aria-busy")'), null);
});
await checkAsync('cargarListaObservador(): SIN datos en caché para el grado (primera vez), sigue mostrando el skeleton mientras la red (lenta) resuelve, y termina sin quedar pegado', async () => {
  const d = fixtureDB(); instalarDB(d);
  _latenciaSimuladaMs = 3000;
  run(`
    window._wrapObsSinCache = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '11°' }; // grado sin estudiantes en la fixture
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') return window._wrapObsSinCache;
      return null;
    };
    window._promesaObsSinCache = cargarListaObservador();
  `);
  const htmlInmediato = run('window._wrapObsSinCache.innerHTML');
  assert.ok(htmlInmediato.includes('skel-wrap'), 'sin nada en caché, debe mostrarse el skeleton como red de seguridad visual');
  await vm.runInContext('window._promesaObsSinCache', ctx);
  const htmlFinal = run('window._wrapObsSinCache.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'), 'al terminar (aunque la red haya sido lenta), el skeleton se desmonta');
  assert.equal(run('window._wrapObsSinCache.getAttribute("aria-busy")'), null);
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
