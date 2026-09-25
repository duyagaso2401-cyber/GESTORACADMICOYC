// ════════════════════════════════════════════════════════════════════════
// RONDA 78 — Ajuste de tolerancia y reanimación de BD (cold start de Neon).
//
// SÍNTOMA reportado (con evidencia real de terminal del usuario): con el
// timeout de 7000ms introducido en la Ronda 77, la instancia remota de Neon
// entra en "cold start" (suspendida por inactividad) y tarda más de 7s en
// responder la primera consulta tras un período sin uso — el timeout de
// seguridad, aunque funcionaba exactamente como se diseñó, cortaba esa
// primera consulta ANTES de darle tiempo a Neon de "despertar", generando
// un 503 espurio. Además, el usuario reportó (y esta ronda mitiga de forma
// defensiva, aunque la investigación de código confirmó que los flujos de
// navegación existentes ya son secuenciales) consultas granulares
// disparándose innecesariamente en paralelo con /api/inetis/db.
//
// Cobertura de esta ronda:
//  (1) BACKEND — TIMEOUT_CONSULTA_BD_MS sube de 7000ms a 12000ms.
//  (2) BACKEND — conTimeoutYReintento() (src/lib/timeout.ts): NUEVO helper
//      que, ante un timeout por cold start, espera 3s y reintenta UNA vez
//      antes de rendirse; un error real (no timeout) nunca se reintenta.
//  (3) FRONTEND — _pullDB() ahora es "single-flight": si ya hay un pull
//      completo en curso, cualquier llamador adicional espera y reutiliza
//      ESA MISMA promesa en vez de disparar una petición HTTP nueva.
//  (4) FRONTEND — los 12 "_cargar...Granular()" respetan ese mismo pull en
//      vuelo: si /api/inetis/db ya está trayendo el estado completo, NO
//      disparan su propia petición granular en paralelo.
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
const delay = (ms, val) => new Promise((resolve) => setTimeout(() => resolve(val), ms));

// ════════════════════════════════════════════════════════════════════════
// PARTE A — BACKEND: TIMEOUT_CONSULTA_BD_MS y conTimeoutYReintento()
// (src/lib/timeout.ts), funciones puras sin dependencias externas.
// ════════════════════════════════════════════════════════════════════════
const { conTimeout, conTimeoutYReintento, TimeoutError, TIMEOUT_CONSULTA_BD_MS } = await import('./src/lib/timeout.ts');

check('TIMEOUT_CONSULTA_BD_MS se subió de 7000ms a 12000ms (Ronda 78, margen para el cold start de Neon)', () => {
  assert.equal(TIMEOUT_CONSULTA_BD_MS, 12000);
});

await checkAsync('conTimeoutYReintento(): si el primer intento responde a tiempo, NO reintenta (una sola invocación de la fábrica)', async () => {
  let invocaciones = 0;
  const fabrica = () => { invocaciones++; return delay(20, { filas: ['ok'] }); };
  const resultado = await conTimeoutYReintento(fabrica, 200, 'msg', 50);
  assert.deepEqual(resultado, { filas: ['ok'] });
  assert.equal(invocaciones, 1, 'no debe reintentar cuando el primer intento ya tuvo éxito');
});

await checkAsync('conTimeoutYReintento(): si el PRIMER intento agota el tiempo (cold start) pero el SEGUNDO responde a tiempo, espera y reintenta UNA vez, y al final resuelve con éxito', async () => {
  let invocaciones = 0;
  const fabrica = () => {
    invocaciones++;
    // Simula: la 1ª consulta "despierta" a Neon (lenta, agota el límite);
    // la 2ª, ya con Neon reanimado, responde rápido.
    return invocaciones === 1 ? delay(500, 'nunca debería llegar') : delay(10, { filas: ['reanimado'] });
  };
  const inicio = Date.now();
  const resultado = await conTimeoutYReintento(fabrica, 100, 'msg', 150); // límite 100ms, espera de reintento 150ms (acelerado para la prueba)
  const transcurrido = Date.now() - inicio;
  assert.deepEqual(resultado, { filas: ['reanimado'] });
  assert.equal(invocaciones, 2, 'debe haber invocado la fábrica exactamente 2 veces (intento original + 1 reintento)');
  assert.ok(transcurrido >= 240, `debe reflejar la espera de reintento antes del 2º intento (transcurrido=${transcurrido}ms, esperado >=240ms)`);
});

await checkAsync('conTimeoutYReintento(): si AMBOS intentos agotan el tiempo, rechaza con TimeoutError después del único reintento (nunca un 3er intento)', async () => {
  let invocaciones = 0;
  const fabrica = () => { invocaciones++; return delay(500, 'nunca debería llegar'); };
  await assert.rejects(
    () => conTimeoutYReintento(fabrica, 50, 'msg', 60),
    (err) => err instanceof TimeoutError
  );
  assert.equal(invocaciones, 2, 'exactamente 2 intentos: el original y 1 reintento — nunca más');
});

await checkAsync('conTimeoutYReintento(): un error REAL de la consulta (no un timeout) se propaga de inmediato, SIN reintentar', async () => {
  let invocaciones = 0;
  const fabrica = () => { invocaciones++; return Promise.reject(new Error('Conexión rechazada por Neon')); };
  await assert.rejects(
    () => conTimeoutYReintento(fabrica, 200, 'msg', 50),
    (err) => !(err instanceof TimeoutError) && err.message.includes('Conexión rechazada')
  );
  assert.equal(invocaciones, 1, 'un error real no amerita reintento — reintentar no cambiaría el resultado');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — FRONTEND: single-flight de _pullDB() y guardas en los 12
// "_cargar...Granular()". Misma técnica "vm" de las Rondas 74-77: se carga
// el 03-app-core.js REAL (truncado) en un contexto Node con un DOM/fetch
// simulados.
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

// Fetch stub CONFIGURABLE con latencia y registro de TODAS las llamadas —
// esta es la pieza clave de esta ronda: permite verificar cuántas veces (y
// a qué URL) se llamó realmente a fetch, para comprobar que un pull en
// vuelo evita disparar peticiones granulares duplicadas en paralelo.
let _latenciaSimuladaMs = 0;
let _fetchDebeFallar = false;
const _fetchCalls = [];
async function fetchStub(url, opts) {
  _fetchCalls.push({ url: String(url), opts: opts || {} });
  if (_latenciaSimuladaMs > 0) await new Promise(r => setTimeout(r, _latenciaSimuladaMs));
  if (_fetchDebeFallar) throw new Error('Fallo de red simulado');
  if (opts && opts.signal && opts.signal.aborted) { const e = new Error('AbortError'); e.name = 'AbortError'; throw e; }
  // Respuesta "ok" con un payload mínimo válido para /api/inetis/db, para
  // que _pullDB() pueda completar su camino feliz (db=..., true) en vez de
  // solo probar la rama de fallo (ya cubierta en la Ronda 77).
  if (String(url).includes('/api/inetis/db')) {
    return { ok: true, status: 200, json: async () => ({ data: { nombre: 'INST', ests: [], carga: [], users: [], grados: [] }, version: 'v1' }), text: async () => '' };
  }
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
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 78', anio: '2026',
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
  run('window._currentPlatSK="sk-test-78";');
  _fetchCalls.length = 0;
  _latenciaSimuladaMs = 0;
  _fetchDebeFallar = false;
}

check('_pullDB() expone window._pullDBEnVuelo como mecanismo single-flight (existe y arranca en null)', () => {
  const d = fixtureDB(); instalarDB(d);
  assert.equal(run('window._pullDBEnVuelo'), null);
});

await checkAsync('_pullDB(): dos llamadas CONCURRENTES disparan UNA sola petición HTTP a /api/inetis/db (la 2ª reutiliza el pull en vuelo en vez de duplicar la petición de red)', async () => {
  const d = fixtureDB(); instalarDB(d);
  _latenciaSimuladaMs = 200;
  // NOTA: _pullDB() es "async function", así que cada llamada envuelve su
  // valor de retorno en una promesa NUEVA (aunque ambas adopten el mismo
  // resultado interno) — comparar identidad de promesas no es una prueba
  // válida aquí. Lo que sí es observable y es lo que realmente importa para
  // el pedido del usuario: que la SEGUNDA llamada, mientras la primera sigue
  // en vuelo, jamás dispare su propia petición de red nueva.
  run('window._promesaA = _pullDB(); window._promesaB = _pullDB();');
  assert.equal(_fetchCalls.filter(c => c.url.includes('/api/inetis/db')).length, 1, 'la 2ª llamada no debe disparar una petición de red adicional mientras la 1ª sigue en vuelo');
  const [resA, resB] = await Promise.all([run('window._promesaA'), run('window._promesaB')]);
  assert.equal(resA, true); assert.equal(resB, true);
  const llamadasAInetisDb = _fetchCalls.filter(c => c.url.includes('/api/inetis/db')).length;
  assert.equal(llamadasAInetisDb, 1, `debe haber exactamente 1 petición HTTP real a /api/inetis/db en total, hubo ${llamadasAInetisDb}`);
});

await checkAsync('_pullDB(): tras completarse, window._pullDBEnVuelo vuelve a null (permite un pull fresco más adelante, no queda bloqueado para siempre)', async () => {
  const d = fixtureDB(); instalarDB(d);
  await run('_pullDB()');
  assert.equal(run('window._pullDBEnVuelo'), null);
});

await checkAsync('_pullDB(): una llamada NUEVA después de que la anterior terminó SÍ dispara una petición HTTP nueva (el guard no bloquea pulls legítimos posteriores)', async () => {
  const d = fixtureDB(); instalarDB(d);
  await run('_pullDB()');
  await run('_pullDB()');
  const llamadasAInetisDb = _fetchCalls.filter(c => c.url.includes('/api/inetis/db')).length;
  assert.equal(llamadasAInetisDb, 2, `2 pulls SECUENCIALES (no concurrentes) deben producir 2 peticiones reales, hubo ${llamadasAInetisDb}`);
});

await checkAsync('_cargarActividadesDocenteGranular(): si /api/inetis/db YA está en vuelo, NO dispara su propia petición a /api/actividades-docente — espera y reutiliza el pull completo', async () => {
  const d = fixtureDB(); instalarDB(d);
  _latenciaSimuladaMs = 200;
  run('window._promesaPullEnVuelo = _pullDB();'); // arranca el pull completo, deliberadamente sin esperarlo todavía
  const resultadoGranular = await run('_cargarActividadesDocenteGranular()');
  assert.equal(resultadoGranular, true, 'debe devolver el resultado (true) del pull completo compartido, sin fallar');
  const llamadasActividades = _fetchCalls.filter(c => c.url.includes('/api/actividades-docente')).length;
  assert.equal(llamadasActividades, 0, `NO debe haber disparado su propia petición granular mientras el pull completo estaba en vuelo, hubo ${llamadasActividades}`);
  await run('window._promesaPullEnVuelo');
});

await checkAsync('_cargarAsistenciaGranular(): mismo guard — con el pull completo en vuelo, no dispara /api/carga-docente ni /api/asistencia por su cuenta', async () => {
  const d = fixtureDB(); instalarDB(d);
  _latenciaSimuladaMs = 200;
  run('window._promesaPullEnVuelo2 = _pullDB();');
  const resultadoGranular = await run('_cargarAsistenciaGranular()');
  assert.equal(resultadoGranular, true);
  const llamadasGranulares = _fetchCalls.filter(c => c.url.includes('/api/carga-docente') || c.url.includes('/api/asistencia')).length;
  assert.equal(llamadasGranulares, 0, `no debe disparar peticiones granulares propias mientras hay un pull completo en vuelo, hubo ${llamadasGranulares}`);
  await run('window._promesaPullEnVuelo2');
});

await checkAsync('_cargarActividadesDocenteGranular(): SIN ningún pull en vuelo, sigue funcionando exactamente igual que antes (dispara su propia petición granular)', async () => {
  const d = fixtureDB(); instalarDB(d);
  // Ningún _pullDB() en curso — window._pullDBEnVuelo es null (ver instalarDB).
  await run('_cargarActividadesDocenteGranular()');
  const llamadasActividades = _fetchCalls.filter(c => c.url.includes('/api/actividades-docente')).length;
  assert.equal(llamadasActividades, 1, 'sin un pull en vuelo, el comportamiento granular normal (Ronda 56-77) debe seguir intacto');
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
