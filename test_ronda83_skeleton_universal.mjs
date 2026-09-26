// ════════════════════════════════════════════════════════════════════════
// RONDA 83 — Skeleton universal y uniforme en TODOS los módulos.
//
// DIAGNÓSTICO DEL USUARIO (confirmado en el código): pese a las Rondas
// 79-82, _mostrarSkeletonYNavegar() conservaba un atajo "if(db&&db.nombre)"
// que, en cuanto la institución ya tenía datos generales cargados en
// memoria (lo cual ocurre casi de inmediato tras iniciar sesión), saltaba
// DIRECTO a renderApp() sin pintar ningún skeleton. Como "db" puede tener
// datos GENERALES de la institución sin que el módulo destino tenga todavía
// sus datos ESPECÍFICOS (p. ej. la lista de estudiantes de Observador, que
// llega en un segundo paso asíncrono), ese primer render podía verse
// vacío/corto y momentos después la tabla completa lo reemplazaba de golpe
// — el "brinco"/"tintín" que reportó el usuario. Solo 2-3 módulos con carga
// asíncrona secundaria propia (Observador de Aula, Observador del
// Estudiante, Notas de Actividades) conservaban un skeleton visible.
//
// SOLUCIÓN de esta ronda (los 3 puntos pedidos):
//  1) SKELETON UNIVERSAL: _mostrarSkeletonYNavegar() ahora SIEMPRE pinta el
//     skeleton correspondiente al tipo de vista (vía _actualizarHTMLSiCambio,
//     así que si por alguna razón el HTML fuera idéntico al ya pintado no
//     se toca el DOM), sin importar si "db" ya tenía datos o no. El atajo
//     "if(db&&db.nombre)" que saltaba renderApp() de inmediato fue
//     eliminado por completo.
//  2) ALTURA MÍNIMA CONTENIDA: .skel-wrap (la envoltura de TODO skeleton,
//     ver _htmlSkeletonPorTipo en 03-app-core.js) ahora tiene
//     min-height:500px en portal.html — el contenedor nunca puede colapsar
//     a 0px entre el clic en el menú y la llegada del contenido real.
//  3) REEMPLAZO SUAVE: el reemplazo del skeleton por el contenido real
//     sigue pasando por el mismo pipeline de las Rondas 81-82
//     (_navegarConCargaGranularSiAplica(true) -> renderApp() con el
//     guard-check de _actualizarHTMLSiCambio en "#contenido", más los
//     guard-checks propios de cargarListaObservador()/renderObsAulaLista())
//     — no se reconstruye la estructura exterior si el cascarón no cambió.
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
// PARTE A — portal.html: .skel-wrap tiene min-height:500px (punto 2).
// ════════════════════════════════════════════════════════════════════════
const srcPortal = fs.readFileSync(new URL('./gestor-academico/dist/portal.html', import.meta.url), 'utf8');
check('portal.html: la clase ".skel-wrap" (envoltura de TODO skeleton) tiene min-height:500px y box-sizing:border-box — el área de trabajo nunca colapsa a 0px durante la transición', () => {
  const m = srcPortal.match(/\.skel-wrap\{[^}]*\}/);
  assert.ok(m, 'no se encontró la regla ".skel-wrap{...}"');
  assert.match(m[0], /min-height:\s*500px/, 'debe fijar min-height:500px');
  assert.match(m[0], /box-sizing:\s*border-box/, 'debe usar box-sizing:border-box para que padding no sume por encima de los 500px');
});

// ════════════════════════════════════════════════════════════════════════
// Carga del código fuente real (mismo patrón "vm" de rondas anteriores).
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

// ════════════════════════════════════════════════════════════════════════
// PARTE B — _mostrarSkeletonYNavegar(): verificación estática del código
// fuente — ya no existe el atajo "db.nombre poblado" y el camino único
// pinta el skeleton incondicionalmente.
// ════════════════════════════════════════════════════════════════════════
const idxFnSkel = src1.indexOf('function _mostrarSkeletonYNavegar(){');
const idxCierreSkel = src1.indexOf('\n}', idxFnSkel);
const bloqueSkel = src1.slice(idxFnSkel, idxCierreSkel);

check('_mostrarSkeletonYNavegar(): ya NO existe el atajo "if(db&&db.nombre)" que saltaba renderApp() sin skeleton', () => {
  assert.doesNotMatch(bloqueSkel, /if\(db&&db\.nombre\)/);
});
check('_mostrarSkeletonYNavegar(): pinta el skeleton incondicionalmente vía _actualizarHTMLSiCambio(cont, _htmlSkeletonPorTipo(...)), sin condicionarlo a si "db" ya tenía datos', () => {
  assert.match(bloqueSkel, /_actualizarHTMLSiCambio\(cont,\s*_htmlSkeletonPorTipo\(_tipoVistaPorPagina\(pag\)\)\)/);
});
check('_mostrarSkeletonYNavegar(): marca aria-busy="true" en el contenedor mientras se resuelve la navegación (accesibilidad, no se tocó en rondas previas)', () => {
  assert.match(bloqueSkel, /cont\.setAttribute\('aria-busy','true'\)/);
});
check('_mostrarSkeletonYNavegar(): agenda _navegarConCargaGranularSiAplica(true) SIEMPRE, para habilitar el guard-check silencioso de la Ronda 81/82 en el reemplazo del skeleton por el contenido real', () => {
  assert.match(bloqueSkel, /_navegarConCargaGranularSiAplica\(true\)/);
});

// ════════════════════════════════════════════════════════════════════════
// Entorno "vm" funcional (mismo stub que Rondas 74-82).
// ════════════════════════════════════════════════════════════════════════
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
    textContent: '', value: '',
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
try { vm.runInContext(src2, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }

function run(code) { return vm.runInContext(code, ctx); }

function fixtureDB(extra) {
  return Object.assign({
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 83', anio: '2026',
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
  for (const k of Object.keys(elementosPorId)) delete elementosPorId[k];
  _fetchCalls.length = 0;
  _latenciaSimuladaMs = 0;
  _fetchDebeFallar = false;
}

// ════════════════════════════════════════════════════════════════════════
// PARTE C — Funcional: _mostrarSkeletonYNavegar() SIEMPRE pinta el
// skeleton, tanto con "db" vacío (primera sincronización) como con "db" ya
// poblado (navegación en caliente) — punto 1, "skeleton universal".
// ════════════════════════════════════════════════════════════════════════
for (const escenario of [
  { desc: 'CON "db" ya poblado (db.nombre lleno, navegación en caliente)', dbNombre: 'INSTITUCIÓN DE PRUEBA RONDA 83' },
  { desc: 'SIN nada en "db" todavía (db.nombre vacío, primera sincronización)', dbNombre: '' },
]) {
  check(`_mostrarSkeletonYNavegar() ${escenario.desc}: pinta el skeleton de inmediato en "#contenido" (min-height garantizado por .skel-wrap) — ya no depende de si "db" tenía datos o no`, () => {
    const d = fixtureDB({ nombre: escenario.dbNombre }); instalarDB(d);
    run(`
      window._contSkel83 = document.createElement('div');
      document.getElementById = (id) => (id === 'contenido' ? window._contSkel83 : elementosPorId[id] || null);
      window._navegarLlamadoSkel83 = false;
      window._navegarOriginalSkel83 = _navegarConCargaGranularSiAplica;
      _navegarConCargaGranularSiAplica = function(){ window._navegarLlamadoSkel83 = true; return Promise.resolve(); };
      pag = 'planilla';
      _mostrarSkeletonYNavegar();
    `);
    assert.ok(run('window._contSkel83.innerHTML').includes('skel-wrap'), 'debe pintarse el skeleton (clase "skel-wrap") de inmediato, sin importar el estado de "db"');
    assert.equal(run('window._contSkel83.getAttribute("aria-busy")'), 'true', 'debe marcar aria-busy="true" mientras se resuelve la navegación');
    ctx.document.getElementById = _getElementByIdOriginal;
    run('_navegarConCargaGranularSiAplica = window._navegarOriginalSkel83;');
  });
}

await checkAsync('_mostrarSkeletonYNavegar(): tras pintar el skeleton, SIEMPRE agenda _navegarConCargaGranularSiAplica(true) en segundo plano (sin importar si "db" ya tenía datos), habilitando el guard-check silencioso de la Ronda 81/82 para el reemplazo por el contenido real', async () => {
  const d = fixtureDB(); instalarDB(d); // db.nombre YA poblado
  run(`
    window._contSkel83b = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contSkel83b : elementosPorId[id] || null);
    window._navegarArgSkel83b = 'NO-LLAMADO';
    window._navegarOriginalSkel83b = _navegarConCargaGranularSiAplica;
    _navegarConCargaGranularSiAplica = function(arg){ window._navegarArgSkel83b = arg; return Promise.resolve(); };
    pag = 'obs-aula';
    _mostrarSkeletonYNavegar();
  `);
  await delay(20); // requestAnimationFrame (stub) + setTimeout(...,0) encadenados
  assert.equal(run('window._navegarArgSkel83b'), true, 'debe invocarse con "true" explícito');
  ctx.document.getElementById = _getElementByIdOriginal;
  run('_navegarConCargaGranularSiAplica = window._navegarOriginalSkel83b;');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE D — Punto 3 ("reemplazo suave sin destruir el DOM si no hay
// cambios"): el reemplazo skeleton → contenido real, hecho por el pipeline
// existente (_navegarConCargaGranularSiAplica(true) -> renderApp()), sigue
// usando _actualizarHTMLSiCambio en "#contenido" — si por alguna razón el
// contenido final resultara igual al skeleton (caso límite) no se duplica
// la escritura; y si es distinto (el caso normal), la escritura SÍ ocurre y
// deja el contenido real visible, con min-height estabilizador entretanto.
// ════════════════════════════════════════════════════════════════════════
check('_actualizarHTMLSiCambio(): reemplazar el skeleton (skel-wrap) por contenido real distinto SÍ escribe y estabiliza con min-height (no deja el contenedor colapsado durante la transición)', () => {
  const el = run('document.createElement("div")');
  const htmlSkeleton = run('_htmlSkeletonPorTipo("tabla")');
  el.innerHTML = htmlSkeleton;
  assert.ok(el.innerHTML.includes('skel-wrap'), 'precondición: el elemento arranca con el skeleton pintado');
  const resultado = run('_actualizarHTMLSiCambio')(el, '<div class="contenido-real-83">tabla real con datos</div>');
  assert.equal(resultado, true, 'el contenido real es distinto del skeleton: sí debe escribirse');
  assert.ok(el.innerHTML.includes('contenido-real-83'), 'el contenido real debe quedar visible tras el reemplazo');
  assert.ok(!el.innerHTML.includes('skel-wrap'), 'el skeleton ya no debe estar presente tras el reemplazo');
  assert.equal(el.style.minHeight, '180px', 'debe fijar un min-height estabilizador (altura previa del skeleton) durante la transición');
});
check('_actualizarHTMLSiCambio(): si el contenido "real" resultara idéntico al skeleton ya pintado (caso límite), NO se duplica la escritura', () => {
  const el = run('document.createElement("div")');
  el.innerHTML = '<div class="skel-wrap">X</div>';
  const escriturasAntes = el._escrituras;
  const resultado = run('_actualizarHTMLSiCambio')(el, '<div class="skel-wrap">X</div>');
  assert.equal(resultado, false, 'HTML idéntico: no debe tocar el DOM');
  assert.equal(el._escrituras, escriturasAntes, 'no debe haber escrituras nuevas');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE E — No-regresión: la carga automática de Observador de Aula
// (Ronda 81) y el guard-check de Observador del Estudiante (Ronda 82)
// siguen funcionando igual, ahora que _mostrarSkeletonYNavegar() cambió su
// camino de entrada (esto NO afecta a esas funciones, que se invocan más
// abajo en el pipeline, pero se confirma explícitamente para esta ronda).
// ════════════════════════════════════════════════════════════════════════
check('No-regresión Ronda 81: renderApp() sigue dsiparando renderObsAulaLista() vía setTimeout(...,80) cuando pag==="obs-aula"', () => {
  assert.match(src1, /if\(pag==='obs-aula'\)\s*setTimeout\(renderObsAulaLista,80\);/);
});
check('No-regresión Ronda 82: cargarListaObservador() sigue usando _actualizarHTMLSiCambio (guard-check) en su escritura final, tal como quedó en la Ronda 82 — el cambio de Ronda 83 en _mostrarSkeletonYNavegar() no toca esta función', () => {
  const idxFn = src1.indexOf('async function cargarListaObservador(){');
  const idxCierre = src1.indexOf('\nasync function ', idxFn + 10);
  const bloque = src1.slice(idxFn, idxCierre === -1 ? idxFn + 3000 : idxCierre);
  assert.match(bloque, /_actualizarHTMLSiCambio\(wrap,\s*_htmlTablaObservador\(/, 'la escritura final de cargarListaObservador() debe seguir pasando por _actualizarHTMLSiCambio');
});
await checkAsync('No-regresión Ronda 82: cargarListaObservador() sigue armando la tabla real con los datos ya cacheados en "db", sin quedar pegada al skeleton', async () => {
  const d = fixtureDB(); instalarDB(d);
  const wrap = run('document.createElement("div")');
  elementosPorId.obsEstGrado = { value: '10°' };
  elementosPorId.obsEstPer = { value: '1' };
  elementosPorId.listaObservador = wrap;
  await run('cargarListaObservador()');
  assert.ok(wrap.innerHTML.includes('ANA PEREZ'), 'debe verse el contenido real (tabla de estudiantes), no un skeleton pegado');
  assert.ok(!wrap.innerHTML.includes('skel-wrap'), 'no debe quedar el skeleton pegado tras resolverse la carga');
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) console.log('✅ 100% de la suite en verde.');
else console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
process.exit(fail === 0 ? 0 : 1);
