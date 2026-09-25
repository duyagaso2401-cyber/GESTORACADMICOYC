// ════════════════════════════════════════════════════════════════════════
// RONDA 75 — Estandarización global del Skeleton Loading.
//
// Metodología: misma técnica ya probada en Ronda 74 — se cargan los DOS
// módulos monolíticos REALES tal cual están en el repositorio (SIN copias
// ni parches) dentro de un contexto Node "vm" compartido, en el MISMO
// orden en que el navegador los carga de verdad (ver dist/portal.html:
// primero 03-app-core.js, luego 06-documentos-y-resto.js), con un
// DOM/browser stub mínimo. Esto permite invocar las funciones reales del
// sistema contra fixtures de datos controlados.
//
// Cobertura pedida por la Ronda 75:
//  (1) Existe un mecanismo genérico y reutilizable de Skeleton
//      (mostrarSkeletonContenedor(targetEl, tipoVista) /
//      _htmlSkeletonPorTipo(tipoVista)) que soporta al menos los tipos de
//      vista 'tabla', 'tarjetas'/'perfil' y 'formulario'/'panel', con
//      marcado visualmente distinto entre ellos.
//  (2) El skeleton se aplica de inmediato (antes/durante la resolución de
//      datos) en los módulos reportados como "con salto brusco":
//      Observador del Estudiante, Observador de Aula, Asistencia y Actas.
//  (3) Ninguna de estas correcciones rompe la lógica existente de esos
//      módulos (arma sus filas/tablas reales exactamente igual que antes).
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
const _idRegistry = {};
const documentStub = {
  body: fakeEl('body'),
  documentElement: fakeEl('html'),
  readyState: 'complete',
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return _idRegistry[id] || null; },
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
  if (String(url).includes('/api/inetis/notas/guardar-fila')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, version: new Date().toISOString() }), text: async () => '' };
  }
  if (String(url).includes('/api/inetis/db')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, version: new Date().toISOString() }), text: async () => '' };
  }
  // Cualquier endpoint granular (observador/asistencia/etc.) que no exista en
  // este stub responde "false" de forma controlada — el código real ya está
  // preparado para eso (fallback explícito a _pullDB()), así que basta con
  // devolver una respuesta no-ok.
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

vm.createContext(ctx);

try {
  vm.runInContext(src1, ctx, { filename: '03-app-core.js' });
} catch (e) {
  console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e);
  process.exit(1);
}
try {
  // Se carga completo (sin truncar): no tiene bootstrap propio al final,
  // solo definiciones de funciones — igual que en el navegador, donde se
  // carga como el <script> siguiente en el mismo documento.
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

// ── Fixture de institución de prueba ──
function fixtureDB() {
  return {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 75',
    anio: '2026',
    config: {
      numPeriodos: 4,
      pesosPeriodos: [25,25,25,25],
      pctSer: 0.25, pctSaber: 0.35, pctHacer: 0.40,
      nomSer: 'SER', nomSaber: 'SABER', nomHacer: 'HACER',
      escalaS: 4.7, escalaA: 4.0, escalaB: 3.0,
      mostrarInasistenciasEnPlanilla: false,
    },
    grados: [{ n: '10°', d: 'doc1' }],
    users: [{ u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x' }],
    carga: [
      { id: 101, g: '10°', m: 'Matemáticas', a: 'Matemáticas', d: 'doc1', dn: 'Docente Uno', ih: 5 },
    ],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [] },
      { id: 'e2', n: 'BRAYAN LOPEZ', g: '10°', nts: {}, observaciones: [] },
    ],
    asistencia: [],
    actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true, true, true, true],
    notasAct: {}, notasActColumnas: [], notasActAsignadas: {},
    logNotas: [],
  };
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
// (1) Mecanismo genérico y reutilizable
// ════════════════════════════════════════════════════════════════════════
check('mostrarSkeletonContenedor() existe como función global', () => {
  assert.equal(run('typeof mostrarSkeletonContenedor'), 'function');
});
check('_htmlSkeletonPorTipo() existe y devuelve HTML no vacío para "tabla", "tarjetas" y "formulario"', () => {
  const tabla = run("_htmlSkeletonPorTipo('tabla')");
  const tarjetas = run("_htmlSkeletonPorTipo('tarjetas')");
  const formulario = run("_htmlSkeletonPorTipo('formulario')");
  assert.ok(tabla.length > 20);
  assert.ok(tarjetas.length > 20);
  assert.ok(formulario.length > 20);
});
check('los 3 tipos de vista generan marcado visualmente DISTINTO entre sí (no es el mismo HTML repetido)', () => {
  const tabla = run("_htmlSkeletonPorTipo('tabla')");
  const tarjetas = run("_htmlSkeletonPorTipo('tarjetas')");
  const formulario = run("_htmlSkeletonPorTipo('formulario')");
  assert.notEqual(tabla, tarjetas);
  assert.notEqual(tabla, formulario);
  assert.notEqual(tarjetas, formulario);
  assert.ok(tarjetas.includes('skel-avatar'), 'el tipo "tarjetas" debe usar el marcado de avatar/perfil');
  assert.ok(formulario.includes('skel-form-field'), 'el tipo "formulario" debe usar el marcado de campos de formulario');
  assert.ok(tabla.includes('skel-row'), 'el tipo "tabla" debe conservar el diseño original de fila/tabla');
});
check('"perfil" es alias de "tarjetas" y "panel" es alias de "formulario"', () => {
  assert.equal(run("_htmlSkeletonPorTipo('perfil')"), run("_htmlSkeletonPorTipo('tarjetas')"));
  assert.equal(run("_htmlSkeletonPorTipo('panel')"), run("_htmlSkeletonPorTipo('formulario')"));
});
check('un tipoVista desconocido/omitido cae de forma segura al diseño "tabla" (nunca deja el contenedor vacío)', () => {
  const sinTipo = run('_htmlSkeletonPorTipo()');
  const desconocido = run("_htmlSkeletonPorTipo('algo-que-no-existe')");
  const tabla = run("_htmlSkeletonPorTipo('tabla')");
  assert.equal(sinTipo, tabla);
  assert.equal(desconocido, tabla);
});
check('_htmlSkeletonContenido() (la función original de Ronda 56) sigue existiendo y es idéntica al tipo "tabla" — retrocompatibilidad total', () => {
  assert.equal(run('_htmlSkeletonContenido()'), run("_htmlSkeletonPorTipo('tabla')"));
});
check('mostrarSkeletonContenedor(el, tipo) inyecta el HTML correspondiente dentro del elemento Y marca aria-busy', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._elPrueba = document.createElement('div');
    mostrarSkeletonContenedor(window._elPrueba, 'tarjetas');
  `);
  assert.equal(run('window._elPrueba.innerHTML'), run("_htmlSkeletonPorTipo('tarjetas')"));
  assert.equal(run("window._elPrueba.getAttribute('aria-busy')"), 'true');
});
check('mostrarSkeletonContenedor() no revienta si el elemento no existe (devuelve false en vez de lanzar)', () => {
  assert.equal(run('mostrarSkeletonContenedor(null, "tabla")'), false);
});

// ════════════════════════════════════════════════════════════════════════
// (2) Aplicación en los módulos reportados con "salto brusco"
// ════════════════════════════════════════════════════════════════════════

// ── Observador del Estudiante ──
check('cargarListaObservador() muestra el skeleton tipo "tarjetas" en #listaObservador de inmediato, ANTES de resolver los datos', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._idRegistryTest = {};
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '10°' };
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') { if(!window._wrapObs) window._wrapObs = document.createElement('div'); return window._wrapObs; }
      return null;
    };
    window._promesaCarga = cargarListaObservador();
  `);
  // Justo después de invocar la función (aún no resuelta la promesa async),
  // el contenedor ya debe tener el skeleton — es la señal visual inmediata
  // que antes no existía.
  const htmlInmediato = run('window._wrapObs.innerHTML');
  assert.equal(htmlInmediato, run("_htmlSkeletonPorTipo('tarjetas')"), 'debe verse el skeleton de inmediato, antes de esperar el fetch/pull');
});
check('cargarListaObservador() sigue armando la tabla real de estudiantes tal como antes, una vez resuelto', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    document.getElementById = (id) => {
      if (id === 'obsEstGrado') return { value: '10°' };
      if (id === 'obsEstPer') return { value: '1' };
      if (id === 'listaObservador') { if(!window._wrapObs2) window._wrapObs2 = document.createElement('div'); return window._wrapObs2; }
      return null;
    };
  `);
  await vm.runInContext('cargarListaObservador()', ctx);
  const htmlFinal = run('window._wrapObs2.innerHTML');
  assert.ok(htmlFinal.includes('ANA PEREZ'), 'debe terminar mostrando la tabla real de estudiantes, no el skeleton');
  assert.ok(htmlFinal.includes('BRAYAN LOPEZ'));
  assert.ok(!htmlFinal.includes('skel-avatar'), 'el skeleton debe haber sido reemplazado por el contenido real');
});

// ── Observador de Aula ──
check('htmlObsAula() ya NO deja "#obsAulaLista" vacío: nace con el skeleton tipo "tabla" (evita el salto al poblarse 80ms después)', () => {
  const d = fixtureDB(); instalarDB(d);
  const html = run('htmlObsAula()');
  const m = html.match(/<div id="obsAulaLista">([\s\S]*?)<\/div>\s*<script>/);
  assert.ok(m, 'debe existir el contenedor #obsAulaLista');
  assert.ok(m[1].includes('skel-wrap'), 'el contenedor debe nacer con el skeleton, no vacío');
  assert.ok(html.includes('setTimeout(renderObsAulaLista,80)'), 'el temporizador original que puebla la lista real debe seguir intacto');
});

// ── Actas ──
check('htmlActas() ya NO deja "#actaTabContenido" vacío: nace con el skeleton tipo "tabla" (evita el salto al poblarse 60ms después vía renderActaTab)', () => {
  const d = fixtureDB(); instalarDB(d);
  const html = run('htmlActas()');
  const m = html.match(/<div id="actaTabContenido">([\s\S]*?)<\/div>/);
  assert.ok(m, 'debe existir el contenedor #actaTabContenido');
  assert.ok(m[1].includes('skel-wrap'), 'el contenedor debe nacer con el skeleton, no vacío');
});
check('renderActaTab() sigue reemplazando el contenido de "#actaTabContenido" por el panel real de la pestaña activa', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._wrapActas = document.createElement('div');
    document.getElementById = (id) => (id === 'actaTabContenido' ? window._wrapActas : null);
    document.querySelectorAll = () => [];
  `);
  run('renderActaTab()');
  const htmlFinal = run('window._wrapActas.innerHTML');
  assert.ok(!htmlFinal.includes('skel-wrap'), 'debe reemplazar el skeleton por el panel real de la pestaña "actas"');
});

// ── Asistencia ──
check('actualizarEstadosAsist() muestra el skeleton tipo "tabla" en #contenido de inmediato para un Docente, antes de resolver el fetch granular', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._contAsist = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'contenido') return window._contAsist;
      return null;
    };
    window._promesaAsist = actualizarEstadosAsist();
  `);
  const htmlInmediato = run('window._contAsist.innerHTML');
  assert.equal(htmlInmediato, run("_htmlSkeletonPorTipo('tabla')"), 'debe verse el skeleton de inmediato, antes de esperar el fetch/pull');
});
check('actualizarAsignaturasReg() también muestra el skeleton de inmediato para un Docente (antes de su propio fetch granular)', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._contAsist2 = document.createElement('div');
    document.getElementById = (id) => {
      if (id === 'contenido') return window._contAsist2;
      if (id === 'asistCIdSel') return { innerHTML: '' };
      return null;
    };
    window._promesaAsist2 = actualizarAsignaturasReg('10°');
  `);
  const htmlInmediato = run('window._contAsist2.innerHTML');
  assert.equal(htmlInmediato, run("_htmlSkeletonPorTipo('tabla')"));
});
check('para el rol Admin (sin fetch granular propio), actualizarEstadosAsist() sigue llamando a renderApp() con normalidad (no se rompió el flujo por rol)', async () => {
  const d = fixtureDB(); instalarDB(d);
  run(`sesion = { u: "admin1", r: "admin", n: "Admin" };`);
  let renderAppLlamado = false;
  ctx._marcarRenderApp = () => { renderAppLlamado = true; };
  run(`
    const _renderAppOriginal = renderApp;
    renderApp = function(){ _marcarRenderApp(); };
    document.getElementById = (id) => null;
  `);
  await vm.runInContext('actualizarEstadosAsist()', ctx);
  assert.ok(renderAppLlamado, 'renderApp() debe seguir ejecutándose al final, igual que antes de esta ronda');
  run('renderApp = _renderAppOriginal;');
});

// ════════════════════════════════════════════════════════════════════════
// (3) navTo()/_mostrarSkeletonYNavegar(): el skeleton por página sigue
//     funcionando y ahora usa el tipo de vista correcto según el módulo.
// ════════════════════════════════════════════════════════════════════════
check('_tipoVistaPorPagina() mapea cada módulo reportado al tipo de vista correcto', () => {
  assert.equal(run("_tipoVistaPorPagina('asistencia')"), 'tabla');
  assert.equal(run("_tipoVistaPorPagina('obs-aula')"), 'tabla');
  assert.equal(run("_tipoVistaPorPagina('actas')"), 'tabla');
  assert.equal(run("_tipoVistaPorPagina('observador')"), 'tarjetas');
  assert.equal(run("_tipoVistaPorPagina('adm-base')"), 'formulario');
  assert.equal(run("_tipoVistaPorPagina('tablero')"), 'formulario');
  assert.equal(run("_tipoVistaPorPagina('panel-docente')"), 'formulario');
  assert.equal(run("_tipoVistaPorPagina('padre-home')"), 'formulario');
  assert.equal(run("_tipoVistaPorPagina('est-home')"), 'formulario');
});
check('_mostrarSkeletonYNavegar() sigue inyectando el skeleton en "#contenido" y disparando la navegación granular exactamente igual que en Ronda 56/74 (solo cambia la FORMA del skeleton, no el flujo)', () => {
  const d = fixtureDB(); instalarDB(d);
  run(`
    window._contNav = document.createElement('div');
    document.getElementById = (id) => (id === 'contenido' ? window._contNav : null);
    pag = 'observador';
    _mostrarSkeletonYNavegar();
  `);
  assert.equal(run('window._contNav.innerHTML'), run("_htmlSkeletonPorTipo('tarjetas')"), 'para pag=\'observador\' debe usarse el tipo "tarjetas"');
  assert.equal(run("window._contNav.getAttribute('aria-busy')"), 'true');
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
