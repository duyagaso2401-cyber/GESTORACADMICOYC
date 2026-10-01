// ════════════════════════════════════════════════════════════════════════
// RONDA 99 — CUATRO FRENTES REPORTADOS:
//
// FRENTE 1 — Auditoría global de PUESTOS y desempate (con control
// pedagógico). Antes, puestoEst() ordenaba solo por promedio
// (`.sort((a,b)=>b.p-a.p)`), sin ningún criterio de desempate — dos
// estudiantes con el mismo promedio exacto quedaban ordenados por
// casualidad (orden de inserción en db.ests). FIX: se agregó desempate en
// cascada (1° promedio, 2° inasistencias, 3° áreas en Bajo/Básico) y un
// ajuste MANUAL persistido en db.puestoOverrides con prioridad absoluta
// sobre el cálculo automático, disponible como botón "✏️" en la columna
// PUESTO de las vistas de Consolidado (solo cuando hay empate o ya existe
// un ajuste vigente). Las filas de las tablas NUNCA se reordenan — siguen
// siempre en orden alfabético.
//
// FRENTE 2 — Filtro directo y buscador predictivo para el Admin/Rector en
// Planilla y Notas de Actividades: antes, el <select> de "Asignatura"
// mostraba TODA la carga académica de la institución de un solo tirón.
// FIX: se agregó una fila de filtros rápidos (Docente/Grado/texto libre),
// visible solo para el rol admin y solo si hay suficientes opciones, que
// acota las <option> del mismo <select> de siempre — el desplegable
// completo se conserva intacto como alternativa.
//
// FRENTE 3 — Limpieza total de sesión al cerrar sesión: antes,
// _cerrarSesionReal() no purgaba las variables globales que recuerdan la
// última asignatura/grado seleccionado (planCId, notaActCId, asistGrado,
// asistCId, etc.) — como el sistema es un SPA que nunca recarga la página
// entre un logout y el login siguiente, esas variables seguían vivas en
// memoria y podían filtrar datos de un docente a la sesión del siguiente
// en el mismo equipo. FIX: _purgarEstadoDeVistaEntreSesiones() reinicia
// todas esas variables al cerrar sesión Y al iniciar una nueva, y además
// se centralizó la resolución de "carga por id" en _cargaSiPermitida(),
// que nunca deja pasar una carga que no sea del usuario activo.
//
// FRENTE 4 — Persistencia del periodo en Descriptores: antes, el
// <select id="descPer"> se reconstruía siempre sin ningún option
// "selected", así que tras guardarDesc()/replicarUltimosDescs() (que
// terminan en renderApp()) el formulario volvía a mostrar Periodo 1 sin
// importar en qué periodo estuviera trabajando el docente. FIX: se agregó
// la variable persistente descPerActivo, sincronizada ANTES de
// renderApp() en ambas funciones y leída por htmlDescriptores() para
// marcar el option correcto.
//
// METODOLOGÍA: 03-app-core.js es código de navegador sin exports. Para el
// Frente 1 (lógica de cálculo real) y el Frente 3 (efecto real de purgar
// variables), se reutiliza la técnica "vm" ya validada en las Rondas
// 74-79/83 (se carga el archivo fuente REAL, truncado justo antes del
// render() final, en un contexto Node con un DOM/localStorage simulados,
// y se llaman las funciones reales con datos de prueba controlados). Para
// los Frentes 2 y 4 (construcción de HTML/orden de llamadas), se usan
// aserciones de regex tolerantes sobre el código fuente, igual que en
// rondas anteriores.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcCore = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

// ════════════════════════════════════════════════════════════════════════
// FRENTE 2 — verificación por regex (construcción de HTML/orden de
// llamadas — no requiere ejecución real).
// ════════════════════════════════════════════════════════════════════════
check('_htmlFiltrosCargaAdmin(): existe y solo se activa para el rol admin (el docente ya ve nada más su propia carga)', () => {
  const idx = srcCore.indexOf('function _htmlFiltrosCargaAdmin(matsBase,selectId){');
  assert.ok(idx !== -1, 'debe existir la función _htmlFiltrosCargaAdmin');
  const bloque = srcCore.slice(idx, idx + 400);
  assert.match(bloque, /sesion&&sesion\.r===['"]admin['"]/);
});
check('_htmlFiltrosCargaAdmin(): ofrece filtro por Docente, por Grado y buscador de texto libre', () => {
  const idx = srcCore.indexOf('function _htmlFiltrosCargaAdmin(matsBase,selectId){');
  const bloque = srcCore.slice(idx, idx + 2200);
  assert.match(bloque, /Filtrar por Docente/);
  assert.match(bloque, /Filtrar por Grado/);
  assert.match(bloque, /oninput="_onFiltroCargaAdminTexto\(this\.value,'\$\{selectId\}'\)"/);
});
check('htmlPlanilla(): agrega los filtros rápidos del admin SIN quitar el <select> completo de asignatura de siempre', () => {
  const idx = srcCore.indexOf('function htmlPlanilla(){');
  const idxFin = srcCore.indexOf('function cambiarPlanPer', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /_htmlFiltrosCargaAdmin\(mats,'planCId'\)/, 'debe insertar la fila de filtros construida a partir de "mats" (la carga ya filtrada por permisos)');
  assert.match(bloque, /<select id="planCId" onchange="cambiarPlanCId\(this\.value\)">\$\{matsOpts\}<\/select>/, 'el <select> original de Asignatura debe seguir intacto');
  assert.match(bloque, /const matsVisibles=_matsFiltradasAdmin\(mats\);/, 'las <option> del select deben construirse a partir de la carga YA filtrada por los controles rápidos');
});
check('htmlNotasActividades(): misma mejora aplicada — filtros rápidos del admin + select completo intacto', () => {
  const idx = srcCore.indexOf('function htmlNotasActividades(){');
  const idxFin = srcCore.indexOf('async function cambiarNotaActPer', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /_htmlFiltrosCargaAdmin\(mats,'notaActCIdSel'\)/);
  assert.match(bloque, /<select id="notaActCIdSel" onchange="cambiarNotaActCId\(this\.value\)">\$\{matsOpts\}<\/select>/);
});

// ════════════════════════════════════════════════════════════════════════
// FRENTE 4 — verificación por regex.
// ════════════════════════════════════════════════════════════════════════
check('Descriptores: existe la variable persistente descPerActivo (patrón ya usado por planPer/notaActPer)', () => {
  assert.match(srcCore, /let descPerActivo='1';/);
});
check('htmlDescriptores(): el <select id="descPer"> marca "selected" según descPerActivo, en vez de opciones estáticas sin selección', () => {
  const idx = srcCore.indexOf('function htmlDescriptores(){');
  const idxFin = srcCore.indexOf('function guardarDesc(){', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /id="descPer" onchange="descPerActivo=this\.value"/);
  assert.match(bloque, /descPerActivo===p\?' selected':''/);
});
check('guardarDesc(): sincroniza descPerActivo con el periodo elegido ANTES de renderApp() (para no reiniciar a P1 tras guardar)', () => {
  const idx = srcCore.indexOf('function guardarDesc(){');
  const idxRender = srcCore.indexOf('renderApp();', idx);
  const bloque = srcCore.slice(idx, idxRender);
  assert.match(bloque, /descPerActivo\s*=\s*per;/);
});
check('replicarUltimosDescs(): misma sincronización aplicada antes de su propio renderApp()', () => {
  const idx = srcCore.indexOf('function replicarUltimosDescs(){');
  const idxRender = srcCore.indexOf('renderApp();', idx);
  const bloque = srcCore.slice(idx, idxRender);
  assert.match(bloque, /descPerActivo\s*=\s*per;/);
});

// ════════════════════════════════════════════════════════════════════════
// FRENTES 1 y 3 — comportamiento REAL: se carga 03-app-core.js completo en
// un contexto vm de Node (mismo criterio de las Rondas 74-79/83).
// ════════════════════════════════════════════════════════════════════════
let src1 = srcCore;
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM — revisar este test'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

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
  getElementById(id) { return fakeEl('div'); },
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
async function fetchStub() { return { ok: false, status: 0, json: async () => ({}), text: async () => '' }; }
class AbortSignalStub { constructor(){ this.aborted = false; this._listeners = []; } addEventListener(type, fn){ this._listeners.push(fn); } removeEventListener(){} }
class AbortControllerStub { constructor(){ this.signal = new AbortSignalStub(); } abort(){ this.signal.aborted = true; } }

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

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

// Fixture: grado '10°' con 2 asignaturas (Area1/Area2), config simplificada
// para que la "nota base" sea directamente el campo "s" (pctSer:1,
// pctSaber:0, pctHacer:0) y un único periodo — así basta con fijar "s" por
// asignatura para controlar el promedio exacto de cada estudiante.
function fixtureDB() {
  return {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 99', anio: '2026',
    config: { numPeriodos: 1, pctSer: 1, pctSaber: 0, pctHacer: 0, escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, pesosArea: {}, pesosAsig: {} },
    // RONDA 100 — se agrega "d" (Director de Grupo/titular) a los grados
    // 10°/11° porque doc1 es quien ejecuta los ajustes manuales de puesto
    // en las pruebas de este archivo (_setPuestoManual/_celdaPuestoConAjuste
    // más abajo) y, desde Ronda 100, esa acción exige ser el Director de
    // Grupo/titular del grado — ver test_ronda100_permisos_ajuste_manual_puesto.mjs
    // para la cobertura dedicada de esa restricción de permisos.
    grados: [{ n: '10°', d: 'doc1' }, { n: '11°', d: 'doc1' }, { n: '9°' }],
    users: [{ u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x' }, { u: 'doc2', r: 'docente', n: 'Docente Dos', p: 'x' }],
    carga: [
      { id: 201, g: '10°', m: 'Area1', a: 'Area1', d: 'doc1', dn: 'Docente Uno', ih: 5 },
      { id: 202, g: '10°', m: 'Area2', a: 'Area2', d: 'doc1', dn: 'Docente Uno', ih: 5 },
      { id: 301, g: '9°', m: 'Ciencias', a: 'Ciencias', d: 'doc2', dn: 'Docente Dos', ih: 5 },
      { id: 401, g: '11°', m: 'Area1', a: 'Area1', d: 'doc1', dn: 'Docente Uno', ih: 5 },
      { id: 402, g: '11°', m: 'Area2', a: 'Area2', d: 'doc1', dn: 'Docente Uno', ih: 5 },
    ],
    ests: [
      { id: 'e4', n: 'ALFA LIDER', g: '10°', nts: { 201: { 1: { s: 5.0, sb: 0, h: 0, rec: 0, niv: 0 } }, 202: { 1: { s: 5.0, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'e1', n: 'BETA PAREJO', g: '10°', nts: { 201: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } }, 202: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'e3', n: 'GAMA DISPAR', g: '10°', nts: { 201: { 1: { s: 3.0, sb: 0, h: 0, rec: 0, niv: 0 } }, 202: { 1: { s: 5.0, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'e2', n: 'DELTA FALTON', g: '10°', nts: { 201: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } }, 202: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'e5', n: 'ZETA ULTIMO', g: '10°', nts: { 201: { 1: { s: 1.0, sb: 0, h: 0, rec: 0, niv: 0 } }, 202: { 1: { s: 1.0, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'e6', n: 'EMPATE UNO', g: '11°', nts: { 401: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } }, 402: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'e7', n: 'EMPATE DOS', g: '11°', nts: { 401: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } }, 402: { 1: { s: 4.0, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
    ],
    asistencia: [
      { grado: '10°', cargaId: 201, periodo: 1, presentes: [], ausentes: ['e2'], justificados: [] },
      { grado: '10°', cargaId: 202, periodo: 1, presentes: [], ausentes: ['e2'], justificados: [] },
    ],
    actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true],
    notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [],
    descriptores: [],
  };
}
function instalarDB(dbObj) {
  run('db = ' + JSON.stringify(dbObj) + ';');
  run('sesion = { u: "doc1", r: "docente", n: "Docente Uno" };');
  run('window._currentPlatSK="sk-test-99";');
}

// ── FRENTE 1, PARTE A — ranking automático con desempate en cascada ──────
check('puestoEst(): con promedios TODOS distintos, ordena de mayor a menor sin necesitar desempate (regresión — sigue funcionando igual que antes)', () => {
  instalarDB(fixtureDB());
  assert.equal(run(`puestoEst('e4','10°')`), 1, 'ALFA LIDER (prom 5.0) debe ser el puesto 1');
  assert.equal(run(`puestoEst('e5','10°')`), 5, 'ZETA ULTIMO (prom 1.0) debe ser el último puesto (5) de 5 estudiantes');
});
check('puestoEst(): empate exacto en promedio (BETA/GAMA/DELTA, los tres en 4.0) se desempata PRIMERO por menor número de inasistencias', () => {
  instalarDB(fixtureDB());
  const puBeta = run(`puestoEst('e1','10°')`);   // inas=0, bajos=0
  const puDelta = run(`puestoEst('e2','10°')`);  // inas=2, bajos=0
  assert.ok(puBeta < puDelta, `BETA (0 inasistencias) debe quedar en mejor puesto que DELTA (2 inasistencias) — BETA=${puBeta}, DELTA=${puDelta}`);
});
check('puestoEst(): si el promedio Y las inasistencias empatan igual, se desempata por menor número de áreas en Bajo/Básico (GAMA tiene 1 área Básica pese al mismo promedio que BETA)', () => {
  instalarDB(fixtureDB());
  const puBeta = run(`puestoEst('e1','10°')`);  // inas=0, bajos=0 (4.0 y 4.0 -> ambas ALTO)
  const puGama = run(`puestoEst('e3','10°')`);  // inas=0, bajos=1 (3.0 es BÁSICO, 5.0 es SUPERIOR)
  assert.ok(puBeta < puGama, `BETA (0 áreas básicas) debe quedar en mejor puesto que GAMA (1 área básica), pese a idéntico promedio (4.0) e idénticas inasistencias (0) — BETA=${puBeta}, GAMA=${puGama}`);
});
check('puestoEst(): orden final esperado de los 5 estudiantes del grado 10° tras aplicar los 3 criterios en cascada: ALFA(1) > BETA(2) > GAMA(3) > DELTA(4) > ZETA(5)', () => {
  instalarDB(fixtureDB());
  const orden = ['e4', 'e1', 'e3', 'e2', 'e5'].map(id => run(`puestoEst('${id}','10°')`));
  assert.deepEqual(orden, [1, 2, 3, 4, 5], `orden de puestos obtenido: ${JSON.stringify(orden)}`);
});
check('REGLA DE ORO: nada de este cálculo reordena las FILAS — _rankingAutomaticoGrado() es un cálculo aparte, verConsolidado()/verConsolidadoGeneral()/verConsolidadoDir() siguen ordenando "ests" alfabéticamente antes de construir las filas', () => {
  const funcs = ['function verConsolidado(){', 'function verConsolidadoGeneral(){', 'function verConsolidadoDir(){'];
  funcs.forEach(marker => {
    const idx = srcCore.indexOf(marker);
    assert.ok(idx !== -1, `debe existir ${marker}`);
    const bloque = srcCore.slice(idx, idx + 700);
    assert.match(bloque, /\.sort\(\(a,b\)=>a\.n\.localeCompare\(b\.n\)\)/, `${marker} debe seguir ordenando alfabéticamente por nombre`);
  });
});

// ── FRENTE 1, PARTE B — ajuste manual con prioridad absoluta ─────────────
check('_estudianteEmpatadoEnGrado(): detecta un empate TOTAL (mismo promedio, mismas inasistencias, mismas áreas básicas) entre dos estudiantes de 11°', () => {
  instalarDB(fixtureDB());
  assert.equal(run(`_estudianteEmpatadoEnGrado('e6','11°')`), true);
  assert.equal(run(`_estudianteEmpatadoEnGrado('e7','11°')`), true);
});
check('_estudianteEmpatadoEnGrado(): NO reporta empate para estudiantes que el desempate automático ya diferenció (BETA vs GAMA vs DELTA en 10°)', () => {
  instalarDB(fixtureDB());
  assert.equal(run(`_estudianteEmpatadoEnGrado('e1','10°')`), false);
  assert.equal(run(`_estudianteEmpatadoEnGrado('e3','10°')`), false);
  assert.equal(run(`_estudianteEmpatadoEnGrado('e2','10°')`), false);
});
check('_setPuestoManual()/puestoEst(): un ajuste manual tiene PRIORIDAD ABSOLUTA sobre el cálculo automático', () => {
  instalarDB(fixtureDB());
  const automatico = run(`puestoEst('e7','11°')`);
  run(`_setPuestoManual('e7','11°',1)`);
  const manual = run(`puestoEst('e7','11°')`);
  assert.equal(manual, 1, 'tras fijar el ajuste manual a 1, puestoEst() debe devolver 1 sin importar el cálculo automático');
  assert.notEqual(automatico, undefined);
});
check('_setPuestoManual(): se persiste dentro de db.puestoOverrides con clave estudiante+grado (mismo patrón que db.notasAct)', () => {
  instalarDB(fixtureDB());
  run(`_setPuestoManual('e7','11°',1)`);
  const guardado = run(`db.puestoOverrides['e7_11°']`);
  assert.ok(guardado && guardado.puesto === 1, 'debe existir db.puestoOverrides["e7_11°"] con puesto:1');
});
check('_setPuestoManual(null): borra el ajuste manual y puestoEst() vuelve a devolver el valor del cálculo automático', () => {
  instalarDB(fixtureDB());
  const automatico = run(`puestoEst('e7','11°')`);
  run(`_setPuestoManual('e7','11°',1)`);
  run(`_setPuestoManual('e7','11°',null)`);
  const restaurado = run(`puestoEst('e7','11°')`);
  assert.equal(restaurado, automatico, 'al borrar el override, debe volver exactamente al valor automático original');
});
check('_celdaPuestoConAjuste(): NO muestra el botón de ajuste manual cuando no hay empate ni override (la mayoría de las filas se ven igual que antes de esta ronda)', () => {
  instalarDB(fixtureDB());
  const html = run(`_celdaPuestoConAjuste('e4','10°',1)`);
  assert.equal(html, '1°', `sin empate ni override, la celda debe ser texto plano "1°", se obtuvo: ${html}`);
});
check('_celdaPuestoConAjuste(): SÍ muestra el botón de ajuste manual cuando hay empate detectado', () => {
  instalarDB(fixtureDB());
  const html = run(`_celdaPuestoConAjuste('e6','11°',1)`);
  assert.match(html, /_abrirAjustePuestoManual\('e6','11°',1\)/);
});

// ── FRENTE 3 — purga total de sesión al cerrar sesión ────────────────────
check('_cargaSiPermitida(): un docente NUNCA puede resolver una carga que pertenece a OTRO docente, aunque la variable (planCId) apunte a su id', () => {
  instalarDB(fixtureDB());
  run(`sesion={u:'doc1',r:'docente'};`);
  const resuelta = run(`_cargaSiPermitida(301)`); // 301 es la carga de doc2 (grado 9°)
  assert.equal(resuelta, null, 'doc1 no debe poder resolver la carga 301 (pertenece a doc2)');
});
check('_cargaSiPermitida(): el admin SÍ puede resolver cualquier carga de la institución', () => {
  instalarDB(fixtureDB());
  run(`sesion={u:'rector',r:'admin'};`);
  const resuelta = run(`_cargaSiPermitida(301)`);
  assert.ok(resuelta && resuelta.id === 301);
});
check('_purgarEstadoDeVistaEntreSesiones(): reinicia planCId/notaActCId/asistGrado/asistCId/filtros de admin a su valor neutro de fábrica', () => {
  instalarDB(fixtureDB());
  run(`
    planCId='999'; planPer='3'; planPagina=7;
    notaActCId='888'; notaActPer='2';
    asistGrado='GRADO-VIEJO'; asistCId='777'; asistTabActivo='hist';
    _filtroCargaAdminDocente='doc-viejo'; _filtroCargaAdminGrado='grado-viejo'; _filtroCargaAdminTexto='texto-viejo';
    descPerActivo='3';
    _purgarEstadoDeVistaEntreSesiones();
  `);
  assert.equal(run('planCId'), '');
  assert.equal(run('planPer'), '1');
  assert.equal(run('notaActCId'), '');
  assert.equal(run('notaActPer'), '1');
  assert.equal(run('asistGrado'), '');
  assert.equal(run('asistCId'), '');
  assert.equal(run('asistTabActivo'), 'reg');
  assert.equal(run('_filtroCargaAdminDocente'), '');
  assert.equal(run('_filtroCargaAdminGrado'), '');
  assert.equal(run('_filtroCargaAdminTexto'), '');
  assert.equal(run('descPerActivo'), '1');
});
check('_cerrarSesionReal(): al cerrar sesión, invoca la purga total de estado de vista (no solo "sesion=null")', () => {
  const idx = srcCore.indexOf('function _cerrarSesionReal(){');
  const bloque = srcCore.slice(idx, idx + 300);
  assert.match(bloque, /_purgarEstadoDeVistaEntreSesiones\(\);/);
});
check('doLogin(): también invoca la purga de estado de vista, como segundo seguro (por si algún camino de login no pasara por _cerrarSesionReal antes)', () => {
  const idx = srcCore.indexOf('async function doLogin(){');
  const idxFin = srcCore.indexOf(`if(rol==='elecciones')`, idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /_purgarEstadoDeVistaEntreSesiones\(\);/);
});
check('Escenario de campo completo: Docente A deja "planCId" apuntando a su propia carga; tras cerrar sesión y entrar Docente B, _cargaSiPermitida(planCId) ya NO expone los datos de A', () => {
  instalarDB(fixtureDB());
  // Docente A (doc1) navega Planilla y queda con planCId=201 (su propia carga)
  run(`sesion={u:'doc1',r:'docente'}; planCId='201';`);
  assert.ok(run(`_cargaSiPermitida(planCId)`), 'mientras doc1 sigue en sesión, sí debe poder ver su propia carga 201');
  // Cierra sesión (purga) y entra Docente B (doc2), en el mismo navegador, sin recargar la página
  run(`_purgarEstadoDeVistaEntreSesiones(); sesion={u:'doc2',r:'docente'};`);
  assert.equal(run('planCId'), '', 'planCId debe haber quedado vacío tras el logout, no en 201');
  assert.equal(run(`_cargaSiPermitida(201)`), null, 'aunque algo intentara resolver la carga 201 (de doc1) en la sesión de doc2, debe rechazarse');
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
