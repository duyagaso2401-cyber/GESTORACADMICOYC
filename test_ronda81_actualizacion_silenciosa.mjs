// ════════════════════════════════════════════════════════════════════════
// RONDA 81 — Corrección de 2 regresiones visuales/de flujo introducidas por
// el Cache-First de la Ronda 79 ("caché-primero" al navegar entre módulos).
//
// SÍNTOMAS reportados:
//  (1) LAYOUT SHIFT / doble parpadeo ("pom, pom"): al entrar a un módulo
//      (Planillas, Observador, Descriptores, etc.) o refrescar, la pantalla
//      "brinca" verticalmente dos veces. CAUSA REAL: _mostrarSkeletonYNavegar()
//      pinta de inmediato con la caché (renderApp() #1) y, cuando la
//      actualización de red en segundo plano termina, _navegarConCarga-
//      GranularSiAplica() SIEMPRE volvía a llamar a renderApp() (#2) —
//      incluso cuando los datos que llegaron eran IDÉNTICOS a los ya
//      pintados — destruyendo y reconstruyendo todo el contenedor (menú +
//      contenido) sin ningún cambio real que mostrar.
//  (2) Observador de Aula exigía presionar "🔄 Cargar" para ver los datos.
//      CAUSA REAL: htmlObsAula() dependía de un
//      <script>setTimeout(renderObsAulaLista,80)<\/script> incrustado en el
//      HTML que ella misma retorna — pero un <script> insertado vía
//      innerHTML (así es como se inyecta, en renderApp()) NUNCA lo ejecuta
//      el navegador (lo marca "ya iniciado" y lo descarta). La carga
//      automática jamás disparaba en la práctica; solo el botón (onclick
//      real) funcionaba.
//
// SOLUCIÓN de esta ronda:
//  (A) _navegarConCargaGranularSiAplica(yaHabiaDatosEnCache): cuando
//      yaHabiaDatosEnCache es true, toma una "foto" de "db" antes de la
//      actualización y, si al terminar es idéntica (_profundamenteIgual,
//      la misma comparación que ya usa updDB() para su "dirty check"), NO
//      vuelve a llamar a renderApp() — actualización silenciosa.
//  (B) Indicador de sincronización SUTIL (_mostrarIndicadorSyncSutil/
//      _ocultarIndicadorSyncSutil): una barra delgada FIJA fuera de
//      "#contenido" (nunca puede desplazar ni redimensionar el módulo),
//      visible solo mientras dura la actualización en segundo plano de la
//      Ronda 79.
//  (C) renderApp() ahora dispara `setTimeout(renderObsAulaLista,80)`
//      directamente (mismo patrón ya usado para 'menciones-honor'/'actas'),
//      y se retira el <script> muerto de htmlObsAula().
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
// PARTE A — 06-documentos-y-resto.js: htmlObsAula() ya no incrusta ningún
// <script> (dead code que nunca se ejecutaba al insertarse vía innerHTML).
// ════════════════════════════════════════════════════════════════════════
const srcDocs = fs.readFileSync(new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url), 'utf8');
const idxHtmlObsAula = srcDocs.indexOf('function htmlObsAula(){');
const finHtmlObsAula = srcDocs.indexOf('\nfunction renderObsAulaLista', idxHtmlObsAula);
const bloqueHtmlObsAula = srcDocs.slice(idxHtmlObsAula, finHtmlObsAula);
check('htmlObsAula() ya no incrusta ningún <script> en el HTML que retorna (solo puede mencionarse en comentarios explicando el porqué del cambio)', () => {
  const lineasEjecutables = bloqueHtmlObsAula.split('\n').filter(l => !l.trim().startsWith('//'));
  const conScript = lineasEjecutables.filter(l => l.includes('<script>'));
  assert.equal(conScript.length, 0, `no debe quedar ningún <script> real en el HTML devuelto: ${JSON.stringify(conScript)}`);
});
check('htmlObsAula() sigue naciendo con el contenedor "#obsAulaLista" y su skeleton (no se tocó ese comportamiento, solo se quitó el <script> muerto)', () => {
  assert.match(bloqueHtmlObsAula, /<div id="obsAulaLista">\$\{_htmlSkeletonPorTipo\('tabla'\)\}<\/div>/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — 03-app-core.js: renderApp() dispara la carga real de Observador
// de Aula con un setTimeout real (mismo patrón ya usado para
// 'menciones-honor'/'actas'), en vez de depender del <script> muerto.
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

check('renderApp() dispara renderObsAulaLista() con setTimeout(...,80) real cuando pag==="obs-aula", justo después del disparador post-render de "actas" (mismo bloque de renderApp())', () => {
  const idxActas = src1.indexOf("if(pag==='actas') setTimeout(renderActaTab,60);");
  const idxObsAula = src1.indexOf("if(pag==='obs-aula') setTimeout(renderObsAulaLista,80);");
  assert.ok(idxActas > -1, 'referencia (actas) no encontrada — revisar este test');
  assert.ok(idxObsAula > -1, 'debe existir el disparador real de obs-aula en renderApp()');
  assert.ok(idxObsAula > idxActas && (idxObsAula - idxActas) < 1500, 'debe estar en el mismo bloque de disparadores post-render de renderApp(), justo después de "actas"');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — 03-app-core.js: _navegarConCargaGranularSiAplica() ahora acepta
// "yaHabiaDatosEnCache" y usa el indicador sutil + el dirty-check antes de
// decidir si vuelve a llamar a renderApp(). Verificación funcional con la
// técnica "vm" de las Rondas 74-80: se carga el archivo REAL (truncado) en
// un contexto Node con un DOM/fetch simulados.
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
    removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); },
    remove() {},
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
// #head/#body reales (no fakeEl) para que appendChild/getElementById/remove
// funcionen de verdad con el indicador de sync (se agrega/retira del <body>).
const elementosPorId = {};
const bodyReal = {
  tagName: 'BODY', _children: [],
  appendChild(c) { this._children.push(c); if (c && c.id) elementosPorId[c.id] = c; return c; },
  removeChild(c) { const i = this._children.indexOf(c); if (i > -1) this._children.splice(i, 1); },
};
const headReal = {
  tagName: 'HEAD', _children: [],
  appendChild(c) { this._children.push(c); if (c && c.id) elementosPorId[c.id] = c; return c; },
};
const documentStub = {
  body: bodyReal, head: headReal, documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return elementosPorId[id] || null; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(tag) {
    const el = fakeEl(tag);
    el.remove = function () {
      if (bodyReal._children.includes(el)) bodyReal.removeChild(el);
      if (el.id && elementosPorId[el.id] === el) delete elementosPorId[el.id];
    };
    return el;
  },
  createElementNS(_ns, tag) { return fakeEl(tag); },
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
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 81', anio: '2026',
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
  run('window._currentPlatSK="sk-test-81";');
  run('window._adminPortalMode=false;');
  for (const k of Object.keys(elementosPorId)) delete elementosPorId[k];
  bodyReal._children.length = 0; headReal._children.length = 0;
  _fetchCalls.length = 0;
  _latenciaSimuladaMs = 0;
  _fetchDebeFallar = false;
}

check('_mostrarIndicadorSyncSutil()/_ocultarIndicadorSyncSutil(): agregan y retiran un indicador FIJO en el <body>, fuera de "#contenido" (nunca puede desplazar el módulo)', () => {
  run('_mostrarIndicadorSyncSutil();');
  const ind1 = run("document.getElementById('indicadorSyncSutil')");
  assert.ok(ind1, 'el indicador debe existir tras mostrarlo');
  assert.match(run("document.getElementById('indicadorSyncSutil').style.cssText"), /position:\s*fixed/, 'debe ser "position:fixed" (fuera del flujo normal del documento, nunca desplaza nada)');
  run('_ocultarIndicadorSyncSutil();');
  assert.equal(run("document.getElementById('indicadorSyncSutil')"), null, 'el indicador debe desaparecer tras ocultarlo');
});
check('_mostrarIndicadorSyncSutil(): llamarlo dos veces seguidas no duplica el indicador', () => {
  run('_mostrarIndicadorSyncSutil(); _mostrarIndicadorSyncSutil();');
  assert.equal(run('document.body._children.filter(function(c){return c.id==="indicadorSyncSutil";}).length'), 1);
  run('_ocultarIndicadorSyncSutil();');
});

await checkAsync('_navegarConCargaGranularSiAplica(true): si la actualización granular NO cambia nada en "db" (idéntico a la caché ya pintada), NO vuelve a llamar a renderApp() — actualización silenciosa, sin el "salto" de layout', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._renderAppLlamado81 = 0;
    window._renderAppOriginal81 = renderApp;
    window._cargarPlanillaGranularOriginal81 = _cargarPlanillaGranular;
    renderApp = function(){ window._renderAppLlamado81++; };
    // Simula un refresco granular exitoso que NO cambia nada de "db" (mismo
    // escenario que el reportado: la red respondió, pero con los mismos
    // datos que ya estaban en caché).
    _cargarPlanillaGranular = function(){ return Promise.resolve(true); };
    pag = 'planilla';
  `);
  await run('_navegarConCargaGranularSiAplica(true)');
  assert.equal(run('window._renderAppLlamado81'), 0, 'con datos idénticos, renderApp() NO debe volver a llamarse (evita el doble parpadeo)');
  assert.equal(run("document.getElementById('indicadorSyncSutil')"), null, 'el indicador de sincronización debe haberse retirado al terminar');
  run('renderApp = window._renderAppOriginal81; _cargarPlanillaGranular = window._cargarPlanillaGranularOriginal81;');
});

await checkAsync('_navegarConCargaGranularSiAplica(true): si la actualización granular SÍ cambia "db" de verdad, renderApp() se llama con normalidad (los datos nuevos deben verse)', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._renderAppLlamado81b = 0;
    window._renderAppOriginal81b = renderApp;
    window._cargarPlanillaGranularOriginal81b = _cargarPlanillaGranular;
    renderApp = function(){ window._renderAppLlamado81b++; };
    _cargarPlanillaGranular = function(){
      db = Object.assign({}, db, { ests: db.ests.concat([{ id:'e3', n:'NUEVO ESTUDIANTE', g:'10°', nts:{}, observaciones:[] }]) });
      return Promise.resolve(true);
    };
    pag = 'planilla';
  `);
  await run('_navegarConCargaGranularSiAplica(true)');
  assert.equal(run('window._renderAppLlamado81b'), 1, 'con datos realmente distintos, renderApp() SÍ debe volver a llamarse para mostrar lo nuevo');
  run('renderApp = window._renderAppOriginal81b; _cargarPlanillaGranular = window._cargarPlanillaGranularOriginal81b;');
});

await checkAsync('_navegarConCargaGranularSiAplica(true): muestra el indicador de sincronización sutil MIENTRAS dura la actualización en segundo plano, y lo retira al terminar', async () => {
  const d = fixtureDB(); instalarDB(d);
  // Se usa una promesa "diferida" (resuelta manualmente desde AFUERA del
  // contexto vm) en vez de un setTimeout interno al propio "vm": un timer
  // programado con el setTimeout del contexto vm nunca dispara si es lo
  // único que mantiene vivo el event loop (los timers de ese contexto se
  // registran con unref(), igual que el resto de esta suite) — usar una
  // promesa diferida evita depender de ningún timer para esta prueba.
  run(`
    window._renderAppOriginal81c = renderApp;
    window._cargarPlanillaGranularOriginal81c = _cargarPlanillaGranular;
    window._resolverCarga81c = null;
    renderApp = function(){}; // aislado: solo interesa el indicador, no el pintado real
    _cargarPlanillaGranular = function(){ return new Promise(function(resolve){ window._resolverCarga81c = resolve; }); };
    pag = 'planilla';
  `);
  const promesaNav = run('_navegarConCargaGranularSiAplica(true)');
  await delay(3); // dos ticks reales de Node — tiempo de sobra para que la función llegue hasta el "await" de _cargarPlanillaGranular()
  assert.ok(run("document.getElementById('indicadorSyncSutil')"), 'el indicador debe estar visible mientras la actualización sigue en curso');
  run('window._resolverCarga81c(true);'); // se resuelve manualmente desde afuera, sin depender de ningún timer
  await promesaNav;
  assert.equal(run("document.getElementById('indicadorSyncSutil')"), null, 'el indicador debe retirarse al terminar');
  run('renderApp = window._renderAppOriginal81c; _cargarPlanillaGranular = window._cargarPlanillaGranularOriginal81c;');
});

await checkAsync('_navegarConCargaGranularSiAplica(false) / sin argumento (primera carga real, sin caché previa): SIEMPRE llama a renderApp(), sin importar si "db" cambió — mismo comportamiento de siempre, no se aplica el chequeo silencioso', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._renderAppLlamado81d = 0;
    window._renderAppOriginal81d = renderApp;
    window._cargarPlanillaGranularOriginal81d = _cargarPlanillaGranular;
    renderApp = function(){ window._renderAppLlamado81d++; };
    _cargarPlanillaGranular = function(){ return Promise.resolve(true); }; // no cambia "db" — a propósito
    pag = 'planilla';
  `);
  await run('_navegarConCargaGranularSiAplica()'); // sin argumento -> yaHabiaDatosEnCache es falsy
  assert.equal(run('window._renderAppLlamado81d'), 1, 'en la primera carga (sin caché previa) siempre debe renderizarse, aunque los datos "no cambien" (nunca hubo nada pintado antes)');
  assert.equal(run("document.getElementById('indicadorSyncSutil')"), null, 'sin caché previa no debe mostrarse el indicador sutil (se usa el skeleton normal, gestionado aparte)');
  run('renderApp = window._renderAppOriginal81d; _cargarPlanillaGranular = window._cargarPlanillaGranularOriginal81d;');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE D — _mostrarSkeletonYNavegar(): RONDA 83 la volvió incondicional
// (ver test_ronda83_*): SIEMPRE pinta el skeleton primero (universal, sin
// importar si "db" ya tenía datos) y SIEMPRE le pasa "true" a
// _navegarConCargaGranularSiAplica() para habilitar el indicador sutil + el
// chequeo silencioso — ya no existe un camino separado "sin argumento".
// Estas dos pruebas, escritas originalmente contra el camino "caché-primero
// llama a renderApp() de inmediato" de la Ronda 79/81, se actualizan aquí
// para reflejar el nuevo comportamiento (la cobertura detallada del
// skeleton universal vive en test_ronda83_skeleton_universal.mjs).
// ════════════════════════════════════════════════════════════════════════
check('RONDA 83 — _mostrarSkeletonYNavegar(): SIEMPRE invoca _navegarConCargaGranularSiAplica(true), sin importar si "db" ya tenía datos', () => {
  const idxFn = src1.indexOf('function _mostrarSkeletonYNavegar(){');
  const idxCierre = src1.indexOf('\n}', idxFn);
  const fragmento = src1.slice(idxFn, idxCierre);
  assert.match(fragmento, /_navegarConCargaGranularSiAplica\(true\)/, 'debe pasar "true" explícito para habilitar el indicador sutil y el chequeo silencioso en el camino universal con skeleton');
  assert.doesNotMatch(fragmento, /if\(db&&db\.nombre\)/, 'RONDA 83: ya no debe existir el atajo "db.nombre poblado" que saltaba renderApp() sin skeleton');
});

await checkAsync('RONDA 83 — _mostrarSkeletonYNavegar() CON datos ya cacheados en "db": pinta el skeleton universal de inmediato (NO renderApp() síncrono) y la actualización de red sigue disparándose en segundo plano con "true"', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._contNav81 = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contNav81 : elementosPorId[id] || null);
    window._renderAppLlamadoNav81 = 0;
    window._navegarLlamadoNav81 = false;
    window._renderAppOriginalNav81 = renderApp;
    window._navegarOriginalNav81 = _navegarConCargaGranularSiAplica;
    renderApp = function(){ window._renderAppLlamadoNav81++; window._contNav81.innerHTML = '<div class="contenido-real">ya con datos</div>'; };
    _navegarConCargaGranularSiAplica = function(arg){ window._navegarLlamadoNav81 = arg; return Promise.resolve(); };
    pag = 'obs-aula';
    _mostrarSkeletonYNavegar();
  `);
  assert.equal(run('window._renderAppLlamadoNav81'), 0, 'RONDA 83: renderApp() ya NO se llama de forma síncrona, incluso con "db" ya en caché — primero se pinta el skeleton');
  assert.ok(run('window._contNav81.innerHTML').includes('skel-wrap'), 'RONDA 83: el skeleton universal se pinta de inmediato');
  await delay(5);
  assert.equal(run('window._navegarLlamadoNav81'), true, 'la actualización en segundo plano debe seguir disparándose, con el argumento "true"');
  run('renderApp = window._renderAppOriginalNav81; _navegarConCargaGranularSiAplica = window._navegarOriginalNav81; document.getElementById = function(id){ return elementosPorId[id] || null; };');
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
