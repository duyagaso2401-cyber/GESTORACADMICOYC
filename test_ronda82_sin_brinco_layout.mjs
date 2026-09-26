// ════════════════════════════════════════════════════════════════════════
// RONDA 82 — Eliminación definitiva del Layout Shift ("pom, pom") que
// persistía pese a la Ronda 81.
//
// DIAGNÓSTICO (por qué la Ronda 81 no bastaba): esa ronda solo evitaba el
// SEGUNDO renderApp() cuando "db" no cambiaba tras la actualización en
// segundo plano de _navegarConCargaGranularSiAplica(). Pero:
//  (a) CUALQUIER llamada a renderApp() — incluida la PRIMERA, la del pintado
//      inmediato desde caché — destruye y reconstruye TODO el árbol de
//      "#app" (menú lateral completo, panel de perfil, banners) desde cero,
//      aunque nada de eso cambie entre una página y otra del mismo
//      usuario/sesión. Eso reinicia scroll/foco y fuerza un reflow de la
//      página ENTERA, no solo del módulo.
//  (b) Algunas vistas (Observador del Estudiante vía cargarListaObservador(),
//      Observador de Aula vía renderObsAulaLista()) hacen su PROPIA segunda
//      escritura de tabla/lista al terminar su actualización de red, por
//      fuera del renderApp() de la Ronda 81 — con los mismos datos, la
//      mayoría de las veces.
//
// SOLUCIÓN de esta ronda (los 3 puntos pedidos):
//  1) Altura mínima estabilizadora: _actualizarHTMLSiCambio() fija un
//     "min-height" igual a la altura previa del contenedor justo antes de
//     reemplazar su contenido, y lo retira 2 frames después de asentarse —
//     el contenedor nunca "colapsa" a una altura menor en el instante entre
//     borrar lo viejo y pintar lo nuevo.
//  2) Guard-check de innerHTML: la MISMA función compara el HTML nuevo
//     contra el que ya está en el contenedor; si son idénticos, NO toca el
//     DOM en absoluto. Se aplica en 3 puntos: renderApp() (ahora divide el
//     render en "cascarón" — sidebar/perfil, solo se reconstruye si algo
//     relevante cambió — y "contenido", con este guard-check),
//     cargarListaObservador() y renderObsAulaLista().
//  3) Estabilización de tablas: _htmlTablaObservador() ahora usa
//     table-layout:fixed con anchos porcentuales explícitos por columna, y
//     la regla global "td" gana overflow-wrap/word-break como red de
//     seguridad para que ningún texto largo se salga de su celda.
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
// PARTE A — portal.html: la regla global "td" ahora incluye overflow-wrap /
// word-break (punto 3, red de seguridad general para cualquier tabla con
// columnas de ancho fijo o estrecho).
// ════════════════════════════════════════════════════════════════════════
const srcPortal = fs.readFileSync(new URL('./gestor-academico/dist/portal.html', import.meta.url), 'utf8');
check('portal.html: la regla global "td{...}" incluye overflow-wrap:break-word (evita que un texto largo se salga de su celda)', () => {
  const m = srcPortal.match(/\btd\{[^}]*\}/);
  assert.ok(m, 'no se encontró la regla global "td{...}"');
  assert.match(m[0], /overflow-wrap:\s*break-word/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — 03-app-core.js: _htmlTablaObservador() usa table-layout:fixed
// con anchos explícitos por columna (punto 3, tabla concreta con doble
// escritura cache→red).
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

check('_htmlTablaObservador() usa table-layout:fixed con anchos porcentuales explícitos en sus 4 columnas', () => {
  const idxFn = src1.indexOf('function _htmlTablaObservador(ests,per,esTutorPTA){');
  const fragmento = src1.slice(idxFn, idxFn + 900);
  assert.match(fragmento, /table-layout:fixed/);
  const anchos = fragmento.match(/width:\d+%/g) || [];
  assert.equal(anchos.length, 4, `deben existir 4 anchos explícitos (uno por columna), se encontraron ${anchos.length}`);
  const suma = anchos.reduce((acc, a) => acc + parseInt(a.match(/\d+/)[0], 10), 0);
  assert.equal(suma, 100, `los anchos de columna deben sumar 100%, suman ${suma}%`);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — renderApp(): división "cascarón" (sidebar/perfil) vs.
// "contenido" — la re-escritura completa de "#app" solo ocurre si algo
// relevante del cascarón cambió; si no, se actualiza SOLO "#contenido" (con
// su propio guard-check). Verificación por inspección de código: invocar el
// renderApp() REAL requiere reconstruir toda la lógica de menús/módulos
// activos (miles de líneas, decenas de funciones htmlX() dependientes) —
// igual criterio ya usado en rondas anteriores para código cuyo costo de
// ejecución aislada supera ampliamente su valor de verificación.
// ════════════════════════════════════════════════════════════════════════
const idxRenderApp = src1.indexOf('function renderApp(){');
const idxFinRenderApp = src1.indexOf('\nfunction navTo(', idxRenderApp);
const bloqueRenderApp = src1.slice(idxRenderApp, idxFinRenderApp);

check('renderApp(): existe una "firma del cascarón" que resume todo lo que puede cambiar su apariencia (rol, usuario, foto/correo/teléfono, página activa, nombre de institución, modo Gestor/solo-lectura, lector de pantalla)', () => {
  assert.match(bloqueRenderApp, /const _shellFirma82=JSON\.stringify\(\[isAdmin,sesion\.r,sesion\.u,sesion\.n,sesion\.foto\|\|'',sesion\.email\|\|'',sesion\.telefono\|\|'',pag,_instNombre,/);
});
check('renderApp(): si la firma del cascarón coincide con la del último render, SOLO se actualiza "#contenido" (vía _actualizarHTMLSiCambio), sin tocar el resto de "#app"', () => {
  assert.match(bloqueRenderApp, /if\(_appEl82&&_appEl82\.getAttribute\('data-shell-firma'\)===_shellFirma82&&_contEl82Existente\)\{\s*_actualizarHTMLSiCambio\(_contEl82Existente,contenido\);\s*\}/);
});
check('renderApp(): si la firma del cascarón CAMBIÓ (o es la primera vez), se reconstruye "#app" por completo y se guarda la nueva firma para la próxima comparación', () => {
  assert.match(bloqueRenderApp, /document\.getElementById\('app'\)\.setAttribute\('data-shell-firma',_shellFirma82\);/);
});
check('renderApp(): los disparadores post-render (attachLogoListeners, hooks de obs-aula/actas/menciones-honor, widget IA) siguen ejecutándose SIEMPRE, sin importar si se tomó el camino de cascarón completo o el de solo-contenido', () => {
  const idxRamaFin = bloqueRenderApp.indexOf("setAttribute('data-shell-firma',_shellFirma82);");
  const fragmentoDespues = bloqueRenderApp.slice(idxRamaFin, idxRamaFin + 600);
  assert.match(fragmentoDespues, /attachLogoListeners\(\);/, 'attachLogoListeners() debe quedar FUERA del "if/else" (ejecutarse siempre)');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE D — _actualizarHTMLSiCambio(): guard-check + estabilización de
// altura genéricos (funcional, con la técnica "vm" de las Rondas 74-81).
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
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return elementosPorId[id] || null; },
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
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 82', anio: '2026',
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

check('_actualizarHTMLSiCambio(): si el HTML nuevo es IDÉNTICO al actual, no toca el DOM en absoluto (cero escrituras)', () => {
  const el = run('document.createElement("div")');
  el.innerHTML = '<p>hola</p>';
  const escriturasAntes = el._escrituras;
  const resultado = run('_actualizarHTMLSiCambio')(el, '<p>hola</p>');
  assert.equal(resultado, false, 'debe devolver false (no hizo falta tocar el DOM)');
  assert.equal(el._escrituras, escriturasAntes, 'no debe haber ninguna escritura nueva de innerHTML');
});
check('_actualizarHTMLSiCambio(): si el HTML nuevo es DISTINTO, sí actualiza el contenedor y fija un min-height estabilizador con la altura previa', () => {
  const el = run('document.createElement("div")');
  el.innerHTML = '<p>viejo</p>';
  const resultado = run('_actualizarHTMLSiCambio')(el, '<p>nuevo</p>');
  assert.equal(resultado, true, 'debe devolver true (sí actualizó)');
  assert.equal(el.innerHTML, '<p>nuevo</p>');
  assert.equal(el.style.minHeight, '180px', 'debe fijar min-height con la altura previa del contenedor (offsetHeight=180 en el stub)');
});
await checkAsync('_actualizarHTMLSiCambio(): el min-height estabilizador se retira solo, un par de frames después de asentarse el contenido nuevo', async () => {
  const el = run('document.createElement("div")');
  el.innerHTML = '<p>viejo</p>';
  run('_actualizarHTMLSiCambio')(el, '<p>nuevo</p>');
  assert.notEqual(el.style.minHeight, '', 'justo después de actualizar, el min-height debe seguir puesto');
  await delay(20); // varias vueltas de microtareas/rAF simulados (ctx.requestAnimationFrame -> setTimeout)
  assert.equal(el.style.minHeight, '', 'un par de frames después, el min-height debe haberse retirado');
});

// ── Observador del Estudiante (cargarListaObservador) ──
await checkAsync('cargarListaObservador(): si la revalidación de red trae EXACTAMENTE los mismos estudiantes/observaciones que ya estaban pintados desde caché, la escritura final se OMITE (guard-check) — no hay una segunda escritura idéntica que provoque el "salto"', async () => {
  const d = fixtureDB(); instalarDB(d); // fixture YA trae e1/e2 para el grado 10°, sin cambios de red
  const wrap = run('document.createElement("div")');
  elementosPorId.obsEstGrado = { value: '10°' };
  elementosPorId.obsEstPer = { value: '1' };
  elementosPorId.listaObservador = wrap;
  await run('cargarListaObservador()');
  const escriturasTotal = wrap._escrituras;
  // Con la fixture sin cambios de red (el fetch stub siempre responde
  // ok:false y cargarListaObservador cae al fallback de "db" ya cargado en
  // memoria), la pintura de caché y la "final" deben producir el MISMO
  // HTML — por lo tanto, como mucho 1 escritura real (la de caché), nunca 2.
  assert.ok(escriturasTotal <= 1, `debían producirse a lo sumo 1 escritura real (idéntica evitada), hubo ${escriturasTotal}`);
  assert.ok(wrap.innerHTML.includes('ANA PEREZ'));
});
await checkAsync('cargarListaObservador(): si SÍ cambian los datos entre la pintura de caché y la revalidación de red, la escritura final SÍ se aplica (no se pierde ningún cambio real)', async () => {
  const d = fixtureDB(); instalarDB(d);
  const wrap = run('document.createElement("div")');
  elementosPorId.obsEstGrado = { value: '10°' };
  elementosPorId.obsEstPer = { value: '1' };
  elementosPorId.listaObservador = wrap;
  run(`
    window._cargarObservadorGranularOriginal82 = _cargarObservadorGranular;
    _cargarObservadorGranular = function(){
      db.ests = db.ests.concat([{ id:'e3', n:'NUEVO ESTUDIANTE', g:'10°', nts:{}, observaciones:[] }]);
      return Promise.resolve(true);
    };
  `);
  await run('cargarListaObservador()');
  assert.ok(wrap.innerHTML.includes('NUEVO ESTUDIANTE'), 'el estudiante agregado por la revalidación de red SÍ debe verse en el resultado final');
  run('_cargarObservadorGranular = window._cargarObservadorGranularOriginal82;');
});

// ── Observador de Aula (renderObsAulaLista) ──
await checkAsync('renderObsAulaLista(): llamarla dos veces seguidas con los MISMOS datos produce como mucho 1 escritura real de DOM (la segunda es idéntica y se omite)', () => {
  const d = fixtureDB(); instalarDB(d);
  const wrap = run('document.createElement("div")');
  elementosPorId.obsAulaGrado = { value: '10°' };
  elementosPorId.obsAulaPer = { value: '1' };
  elementosPorId.obsAulaContador = run('document.createElement("span")');
  elementosPorId.obsAulaLista = wrap;
  run('renderObsAulaLista();');
  const escriturasPrimeraVez = wrap._escrituras;
  assert.ok(escriturasPrimeraVez >= 1, 'la primera vez sí debe escribir (no había nada pintado antes)');
  run('renderObsAulaLista();'); // mismos datos, ninguna observación cambió
  assert.equal(wrap._escrituras, escriturasPrimeraVez, 'una segunda llamada con los mismos datos NO debe producir ninguna escritura adicional');
});
await checkAsync('renderObsAulaLista(): si SÍ cambian los datos (una nueva observación registrada), la siguiente llamada SÍ actualiza el DOM', () => {
  const d = fixtureDB(); instalarDB(d);
  const wrap = run('document.createElement("div")');
  elementosPorId.obsAulaGrado = { value: '10°' };
  elementosPorId.obsAulaPer = { value: '1' };
  elementosPorId.obsAulaContador = run('document.createElement("span")');
  elementosPorId.obsAulaLista = wrap;
  run('renderObsAulaLista();');
  const escriturasAntes = wrap._escrituras;
  run(`db.ests[0].observaciones.push({tipo:'Comportamental',txt:'Se portó excelente',per:'1',doc:'Docente Uno',fecha:'hoy'});`);
  run('renderObsAulaLista();');
  assert.ok(wrap._escrituras > escriturasAntes, 'con una observación nueva, SÍ debe producirse una escritura real');
  assert.ok(wrap.innerHTML.includes('Se portó excelente'));
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
