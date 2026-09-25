// ════════════════════════════════════════════════════════════════════════
// RONDA 76 — CORRECCIÓN CRÍTICA: el Skeleton (Ronda 75) podía quedarse
// pegado en pantalla de forma indefinida en Observador del Estudiante y
// Observador de Aula si algo fallaba entre mostrarlo y reemplazarlo por el
// contenido real (o por un mensaje de "sin datos"/error).
//
// Metodología: misma técnica de Ronda 75 — se cargan los DOS módulos
// monolíticos REALES (03-app-core.js truncado antes del bootstrap +
// 06-documentos-y-resto.js completo) en un único contexto Node "vm"
// compartido, en el mismo orden que el navegador.
//
// Cobertura pedida por la Ronda 76:
//  (1) Desmonte OBLIGATORIO del skeleton (try/catch/finally) en
//      cargarListaObservador(), renderObsAulaLista(), actualizarEstadosAsist()
//      y actualizarAsignaturasReg(): el skeleton se quita SIEMPRE, incluso
//      si la petición/el procesamiento posterior falla.
//  (2) Estados vacíos ("No se encontraron registros") y de error (banner de
//      error) en vez de dejar el skeleton pegado.
//  (3) Ninguna de estas correcciones entra en bucle infinito ni rompe el
//      armado real de la tabla/lista cuando todo sale bien.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');

const marker = 'render();\n// Inyectar widget IA';
const idx = src1.indexOf(marker);
if (idx === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idx);

// ── DOM/browser stub mínimo (misma técnica ya probada) ──
function fakeEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(),
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], childNodes: [],
    attributes: {},
    _listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {},
    remove() {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {}, blur() {}, select() {}, click() {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; },
    textContent: '',
    value: '',
    offsetWidth: 300, offsetHeight: 200,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  return el;
}
const documentStub = {
  body: fakeEl('body'),
  documentElement: fakeEl('html'),
  readyState: 'complete',
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return null; }, // sobreescrito por cada prueba según lo que necesite
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(tag) { return fakeEl(tag); },
  createElementNS(_ns, tag) { return fakeEl(tag); },
  createTextNode(t) { return { textContent: t }; },
};
class MutationObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class IntersectionObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class ResizeObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
const localStorageStub = (() => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
  };
})();

const _fetchCalls = [];
async function fetchStub(url, opts) {
  _fetchCalls.push({ url: String(url), opts: opts || {} });
  return { ok: false, status: 0, json: async () => ({}), text: async () => '' };
}

const ctx = {};
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
ctx.addEventListener = function(){};
ctx.removeEventListener = function(){};
ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; };
ctx.print = function(){};
ctx.scrollTo = function(){};
ctx.innerWidth = 1280;
ctx.innerHeight = 800;
ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = localStorageStub;
ctx.sessionStorage = localStorageStub;
ctx.fetch = fetchStub;
ctx.console = console;
ctx.MutationObserver = MutationObserverStub;
ctx.IntersectionObserver = IntersectionObserverStub;
ctx.ResizeObserver = ResizeObserverStub;
ctx.setTimeout = (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); if (t.unref) t.unref(); return t; };
ctx.clearTimeout = clearTimeout;
ctx.setInterval = (fn, ms, ...a) => { const t = setInterval(fn, ms, ...a); if (t.unref) t.unref(); return t; };
ctx.clearInterval = clearInterval;
ctx.requestAnimationFrame = (fn) => setTimeout(fn, 0);
ctx.URLSearchParams = URLSearchParams;
ctx.location = { search: '', pathname: '/', href: 'http://localhost/', hostname: 'localhost' };
ctx.history = { pushState(){}, replaceState(){} };
ctx.speechSynthesis = null;
ctx.SpeechSynthesisUtterance = function(){};
ctx.alert = () => {};
ctx.confirm = () => true;
ctx.prompt = () => null;
ctx.Image = function(){ return fakeEl('img'); };
ctx.FileReader = function(){ return { readAsDataURL(){}, readAsText(){} }; };
ctx.Blob = function(parts, opts){ this.parts = parts; this.opts = opts; };
ctx.FormData = function(){ this._d = new Map(); this.append = (k,v)=>this._d.set(k,v); };
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
ctx.matchMedia = () => ({ matches: false, addListener(){}, addEventListener(){} });
ctx.Notification = function(){};
ctx.EventSource = function(){ this.close = () => {}; };
ctx.WebSocket = function(){};
ctx.performance = performance;
ctx.btoa = typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(String(s), 'binary').toString('base64');
ctx.atob = typeof atob !== 'undefined' ? atob : (s) => Buffer.from(String(s), 'base64').toString('binary');
// Helper de retardo REF'D (con el setTimeout real del proceso Node, no el
// "unref'd" del stub de la app) para simular una respuesta lenta sin
// arriesgar que Node cierre el bucle de eventos antes de que el temporizador
// dispare (los timers del stub de la app se dejan "unref'd" a propósito
// para no colgar el proceso de pruebas, pero eso los hace inadecuados para
// ESTA simulación puntual de "fetch lento").
ctx._delayRef = (ms) => new Promise((resolve) => { globalThis.setTimeout(resolve, ms); });

vm.createContext(ctx);

try {
  vm.runInContext(src1, ctx, { filename: '03-app-core.js' });
} catch (e) {
  console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e);
  process.exit(1);
}
try {
  vm.runInContext(src2, ctx, { filename: '06-documentos-y-resto.js' });
} catch (e) {
  console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e);
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════
// Arnés de aserciones
// ════════════════════════════════════════════════════════════════════════
let pass = 0, fail = 0;
function check(desc, fn) {
  try {
    fn();
    pass++;
    console.log('✅ ' + desc);
  } catch (e) {
    fail++;
    console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e));
  }
}
async function checkAsync(desc, fn) {
  try {
    await fn();
    pass++;
    console.log('✅ ' + desc);
  } catch (e) {
    fail++;
    console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e));
  }
}
function run(code) { return vm.runInContext(code, ctx); }

function fixtureDB(extra) {
  return Object.assign({
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 76',
    anio: '2026',
    config: {
      numPeriodos: 4, pesosPeriodos: [25,25,25,25],
      pctSer: 0.25, pctSaber: 0.35, pctHacer: 0.40,
      nomSer: 'SER', nomSaber: 'SABER', nomHacer: 'HACER',
      escalaS: 4.7, escalaA: 4.0, escalaB: 3.0,
      mostrarInasistenciasEnPlanilla: false,
    },
    grados: [{ n: '10°', d: 'doc1' }],
    users: [{ u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x' }],
    carga: [{ id: 101, g: '10°', m: 'Matemáticas', a: 'Matemáticas', d: 'doc1', dn: 'Docente Uno', ih: 5 }],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [{ per: '1', doc: 'Docente Uno', txt: 'Obs de prueba' }] },
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
}

// ════════════════════════════════════════════════════════════════════════
// (1)+(2) Observador del Estudiante — cargarListaObservador()
// ════════════════════════════════════════════════════════════════════════
await checkAsync('cargarListaObservador(): con una respuesta LENTA (fetch granular con retardo), el skeleton se muestra de inmediato y luego SÍ se desmonta al terminar (no queda pegado)', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    const _origGranular = _cargarObservadorGranular;
    _cargarObservadorGranular = function(grado){
      return _delayRef(30).then(()=>false);
    };
    window._wrapObsLento = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '10°' };
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') return window._wrapObsLento;
      return null;
    };
  `);
  const htmlAntes = run('mostrarSkeletonContenedor(window._wrapObsLento, "tarjetas"); window._wrapObsLento.innerHTML;');
  assert.ok(htmlAntes.includes('skel-wrap'));
  await vm.runInContext('cargarListaObservador()', ctx);
  const htmlFinal = run('window._wrapObsLento.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'), 'el skeleton NUNCA debe seguir presente tras terminar la carga, aunque haya tomado un momento');
  assert.equal(run('window._wrapObsLento.getAttribute("aria-busy")'), null, 'aria-busy debe quedar limpio');
  assert.ok(htmlFinal.includes('ANA PEREZ'), 'debe terminar mostrando la tabla real');
  run('_cargarObservadorGranular = _origGranular;');
});

await checkAsync('cargarListaObservador(): si el grado seleccionado no tiene estudiantes, muestra "No se encontraron registros" y desmonta el skeleton (no queda pegado)', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._wrapObsVacio = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '11°' }; // grado sin estudiantes en la fixture
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') return window._wrapObsVacio;
      return null;
    };
  `);
  await vm.runInContext('cargarListaObservador()', ctx);
  const htmlFinal = run('window._wrapObsVacio.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'), 'el skeleton no debe quedar pegado ante un resultado vacío');
  assert.ok(htmlFinal.includes('No se encontraron registros'), 'debe mostrar el mensaje de "sin registros"');
  assert.equal(run('window._wrapObsVacio.getAttribute("aria-busy")'), null);
});

await checkAsync('cargarListaObservador(): si ocurre un ERROR inesperado procesando los datos, se reemplaza el skeleton por un banner de error y NUNCA queda pegado', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    const _origTutorPTA = _esTutorPTA;
    _esTutorPTA = function(){ throw new Error('Fallo simulado de red/proceso'); };
    window._wrapObsError = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '10°' };
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') return window._wrapObsError;
      return null;
    };
  `);
  await vm.runInContext('cargarListaObservador()', ctx);
  const htmlFinal = run('window._wrapObsError.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'), 'el skeleton NUNCA debe quedar pegado tras un error');
  assert.ok(htmlFinal.includes('❌'), 'debe mostrarse un banner de error visible');
  assert.equal(run('window._wrapObsError.getAttribute("aria-busy")'), null, 'aria-busy debe quedar limpio incluso tras un error');
  run('_esTutorPTA = _origTutorPTA;');
});

// ════════════════════════════════════════════════════════════════════════
// (1)+(2) Observador de Aula — renderObsAulaLista()
// ════════════════════════════════════════════════════════════════════════
check('renderObsAulaLista(): si el grado no tiene estudiantes, muestra "No se encontraron registros" y desmonta el skeleton', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._wrapAulaVacio = document.createElement('div');
    mostrarSkeletonContenedor(window._wrapAulaVacio, 'tabla');
    document.getElementById = (id) => {
      if (id === 'obsAulaGrado') return { value: '11°' };
      if (id === 'obsAulaPer') return { value: '1' };
      if (id === 'obsAulaLista') return window._wrapAulaVacio;
      if (id === 'obsAulaContador') return { textContent: '' };
      return null;
    };
    renderObsAulaLista();
  `);
  const htmlFinal = run('window._wrapAulaVacio.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'));
  assert.ok(htmlFinal.includes('No se encontraron registros'));
  assert.equal(run('window._wrapAulaVacio.getAttribute("aria-busy")'), null);
});
check('renderObsAulaLista(): si ocurre un ERROR inesperado (ej. "sesion" nula a mitad de proceso), se reemplaza el skeleton por un banner de error y NUNCA queda pegado', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._wrapAulaError = document.createElement('div');
    mostrarSkeletonContenedor(window._wrapAulaError, 'tabla');
    document.getElementById = (id) => {
      if (id === 'obsAulaGrado') return { value: '10°' }; // SÍ tiene estudiantes -> sigue procesando y explota más adelante
      if (id === 'obsAulaPer') return { value: '1' };
      if (id === 'obsAulaLista') return window._wrapAulaError;
      if (id === 'obsAulaContador') return { textContent: '' };
      return null;
    };
    sesion = null; // fuerza una excepción real al leer sesion.n/sesion.u más adelante en la función
  `);
  run('renderObsAulaLista()');
  const htmlFinal = run('window._wrapAulaError.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'), 'el skeleton NUNCA debe quedar pegado tras un error');
  assert.ok(htmlFinal.includes('❌'));
  assert.equal(run('window._wrapAulaError.getAttribute("aria-busy")'), null);
  run('sesion = { u: "doc1", r: "docente", n: "Docente Uno" };'); // restaurar para las siguientes pruebas
});
check('renderObsAulaLista(): cuando todo sale bien, sigue armando la lista real de tarjetas por estudiante tal como antes', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._wrapAulaOk = document.createElement('div');
    mostrarSkeletonContenedor(window._wrapAulaOk, 'tabla');
    document.getElementById = (id) => {
      if (id === 'obsAulaGrado') return { value: '10°' };
      if (id === 'obsAulaPer') return { value: '1' };
      if (id === 'obsAulaLista') return window._wrapAulaOk;
      if (id === 'obsAulaContador') return { textContent: '' };
      return null;
    };
    renderObsAulaLista();
  `);
  const htmlFinal = run('window._wrapAulaOk.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'));
  assert.ok(htmlFinal.includes('ANA PEREZ'));
  assert.ok(htmlFinal.includes('BRAYAN LOPEZ'));
});

// ════════════════════════════════════════════════════════════════════════
// (1) Asistencia — actualizarEstadosAsist()/actualizarAsignaturasReg()
// ════════════════════════════════════════════════════════════════════════
await checkAsync('actualizarEstadosAsist(): con una respuesta LENTA del fetch granular, renderApp() se ejecuta igual al final (el finally garantiza el desmonte del skeleton)', async () => {
  const d = fixtureDB(); instalarDB(d);
  let renderAppLlamado = false;
  ctx._marcarRenderApp2 = () => { renderAppLlamado = true; };
  run(`
    const _origAsist = _cargarAsistenciaGranular;
    _cargarAsistenciaGranular = function(){ return _delayRef(30).then(()=>false); };
    const _origRenderApp2 = renderApp;
    renderApp = function(){ _marcarRenderApp2(); };
    window._contAsistLento = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contAsistLento : null);
  `);
  await vm.runInContext('actualizarEstadosAsist()', ctx);
  assert.ok(renderAppLlamado, 'renderApp() debe ejecutarse siempre al final, incluso tras una respuesta lenta');
  assert.equal(run('window._contAsistLento.getAttribute("aria-busy")'), null, 'aria-busy debe quedar limpio tras terminar');
  run('_cargarAsistenciaGranular = _origAsist; renderApp = _origRenderApp2;');
});
await checkAsync('actualizarEstadosAsist(): si renderApp() mismo llegara a fallar, se muestra un banner de error en #contenido en vez de dejar el skeleton pegado para siempre', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    const _origRenderApp3 = renderApp;
    renderApp = function(){ throw new Error('Fallo simulado de renderApp'); };
    window._contAsistFalla = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contAsistFalla : null);
    sesion = { u: "admin1", r: "admin", n: "Admin" }; // admin: no hay fetch granular propio, así que renderApp() se llama de una vez
  `);
  await vm.runInContext('actualizarEstadosAsist()', ctx);
  const htmlFinal = run('window._contAsistFalla.innerHTML');
  assert.ok(htmlFinal.includes('❌'), 'debe mostrarse un banner de error si renderApp() mismo falla');
  assert.equal(run('window._contAsistFalla.getAttribute("aria-busy")'), null);
  run('renderApp = _origRenderApp3; sesion = { u: "doc1", r: "docente", n: "Docente Uno" };');
});
await checkAsync('actualizarAsignaturasReg(): con una respuesta LENTA, sigue delegando correctamente en actualizarEstadosAsist() y el flujo termina (renderApp() se ejecuta)', async () => {
  const d = fixtureDB(); instalarDB(d);
  let renderAppLlamado2 = false;
  ctx._marcarRenderApp4 = () => { renderAppLlamado2 = true; };
  run(`
    const _origAsist2 = _cargarAsistenciaGranular;
    _cargarAsistenciaGranular = function(){ return _delayRef(30).then(()=>false); };
    const _origRenderApp4 = renderApp;
    renderApp = function(){ _marcarRenderApp4(); };
    window._contAsistReg = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'contenido') return window._contAsistReg;
      if (id === 'asistCIdSel') return { innerHTML: '' };
      return null;
    };
  `);
  await vm.runInContext("actualizarAsignaturasReg('10°')", ctx);
  assert.ok(renderAppLlamado2, 'el flujo completo debe terminar llamando a renderApp() (vía actualizarEstadosAsist)');
  assert.equal(run('window._contAsistReg.getAttribute("aria-busy")'), null);
  run('_cargarAsistenciaGranular = _origAsist2; renderApp = _origRenderApp4;');
});

// ════════════════════════════════════════════════════════════════════════
// (3) No hay bucle infinito: cada función procesa una sola vez por llamada
// ════════════════════════════════════════════════════════════════════════
await checkAsync('cargarListaObservador(): NO entra en bucle — el fetch granular se invoca exactamente UNA vez por llamada', async () => {
  const d = fixtureDB(); instalarDB(d);
  let llamadas = 0;
  ctx._contarLlamadaObs = () => { llamadas++; };
  run(`
    const _origGranular2 = _cargarObservadorGranular;
    _cargarObservadorGranular = function(grado){ _contarLlamadaObs(); return Promise.resolve(false); };
    window._wrapObsBucle = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '10°' };
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') return window._wrapObsBucle;
      return null;
    };
  `);
  await vm.runInContext('cargarListaObservador()', ctx);
  assert.equal(llamadas, 1, 'el fetch granular debe invocarse exactamente una vez, nunca en bucle');
  run('_cargarObservadorGranular = _origGranular2;');
});
check('renderObsAulaLista(): invocarla varias veces seguidas (como haría el onchange de Grado/Periodo) no acumula HTML ni crece indefinidamente el contenedor', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._wrapAulaRepeat = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'obsAulaGrado') return { value: '10°' };
      if (id === 'obsAulaPer') return { value: '1' };
      if (id === 'obsAulaLista') return window._wrapAulaRepeat;
      if (id === 'obsAulaContador') return { textContent: '' };
      return null;
    };
    renderObsAulaLista();
    renderObsAulaLista();
    renderObsAulaLista();
  `);
  const htmlFinal = run('window._wrapAulaRepeat.innerHTML');
  const ocurrencias = (htmlFinal.match(/ANA PEREZ/g) || []).length;
  assert.equal(ocurrencias, 1, 'cada llamada debe REEMPLAZAR el contenido anterior, no acumularlo');
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
