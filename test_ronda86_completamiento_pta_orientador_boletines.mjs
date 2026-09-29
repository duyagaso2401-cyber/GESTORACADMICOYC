// ════════════════════════════════════════════════════════════════════════
// RONDA 86 — Completamiento de PTA/Orientador, Boletines/Reportes de
// cierre y Comunicación masiva. Construye sobre la v16 (Rondas 83-85: fix
// Antigravity, Local-First/mergeGlobalData, cimientos RBAC).
//
//   1) TUTOR PTA: Consolidado de Gestión Pedagógica (htmlConsolidadoPedagogicoPTA,
//      cruzando db.carga con db.planesArea/db.planeaciones/db.drivePTA),
//      exportable a PDF/Excel, y Retroalimentación (comentariosPTA sobre
//      una evidencia de db.drivePTA, sin tocar notas).
//   2) DOCENTE ORIENTADOR: Matriz de Seguimiento PIAR con filtros de
//      grado/categoría sobre htmlFichaInclusion(), e Historial integrado
//      de Atenciones Psicopedagógicas + Casos de Convivencia
//      (htmlHistorialOrientacion), con descarga de acta PDF firmada.
//      NOTA DE ALCANCE: el filtro "por sede" del pedido original se deja
//      fuera de forma explícita — el modelo de datos de este sistema no
//      maneja múltiples sedes por institución.
//   3) BOLETINES: se agrega la estampación de la firma digital PERSONAL
//      del Director(a) de Grupo (_firmaDeUsuario, Ronda 84) junto a la del
//      Rector — antes solo se imprimía su nombre sobre la línea de firma,
//      sin imagen. Alertas de riesgo: generarPreinformesCitacionPDF()
//      (nuevo) genera el pre-informe/citación en PDF que antes no existía
//      (solo había notificación interna + email).
//   4) COMUNICACIÓN MASIVA: htmlComunicacionPTAOrientador() gana una
//      plantilla de comunicado editable y un panel de Acudientes real
//      (antes solo remitía al botón de la ficha del estudiante).
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

// ════════════════════════════════════════════════════════════════════════
// Chequeos estáticos de cableado (menú / enrutado / whitelist de módulos)
// ════════════════════════════════════════════════════════════════════════
check('TODOS_MODULOS incluye "consolidado-pedagogico-pta" e "historial-orientacion"', () => {
  assert.match(src1, /\{id:'consolidado-pedagogico-pta',label:'📊 Consolidado Gestión Pedagógica'\}/);
  assert.match(src1, /\{id:'historial-orientacion',label:'📚 Historial Atenciones y Convivencia'\}/);
});
check('Menú: "consolidado-pedagogico-pta" exclusivo de Admin/Tutor PTA', () => {
  assert.match(src1, /if\(\(isAdmin\|\|_esTutorPTA\(\)\)&&_ma\('consolidado-pedagogico-pta'\)\)\s*menu\.push/);
});
check('Menú: "historial-orientacion" exclusivo de Admin/Docente Orientador', () => {
  assert.match(src1, /if\(\(isAdmin\|\|_esDocenteOrientador\(\)\)&&_ma\('historial-orientacion'\)\)\s*menu\.push/);
});
check('Enrutado conectado a htmlConsolidadoPedagogicoPTA()/htmlHistorialOrientacion()', () => {
  assert.match(src1, /pag==='consolidado-pedagogico-pta'&&\(isAdmin\|\|_esTutorPTA\(\)\)\)\s*contenido=htmlConsolidadoPedagogicoPTA\(\)/);
  assert.match(src1, /pag==='historial-orientacion'&&\(isAdmin\|\|_esDocenteOrientador\(\)\)\)\s*contenido=htmlHistorialOrientacion\(\)/);
});
check('_ma(): los 2 módulos nuevos quedan siempre disponibles (mismo motivo que Rondas 84/85)', () => {
  assert.match(src1, /if\(modId==='consolidado-pedagogico-pta'\|\|modId==='historial-orientacion'\)\s*return true;/);
});
check('_generarBoletinesPDF(): estampa también la firma digital PERSONAL del Director(a) de Grupo (_firmaDeUsuario), no solo su nombre', () => {
  const idxFn = src1.indexOf('async function _generarBoletinesPDF(');
  assert.ok(idxFn > -1);
  const idxFin = src1.indexOf('\nfunction _datosParaFirmarBoletin', idxFn);
  const bloque = src1.slice(idxFn, idxFin === -1 ? idxFn + 12000 : idxFin);
  assert.match(bloque, /_firmaDeUsuario\(infoG\.d\)/);
  assert.match(bloque, /doc\.addImage\(_firmaDirGrupoImg,'PNG',_fRcx-18,firmaY-12,36,10\)/);
});
check('generarPreinformesCitacionPDF(): existe y reutiliza las firmas de Rector/Director de Grupo', () => {
  assert.match(src2, /function generarPreinformesCitacionPDF\(\)\{/);
  const idxFn = src2.indexOf('function generarPreinformesCitacionPDF(){');
  const bloque = src2.slice(idxFn, idxFn + 3200);
  assert.match(bloque, /db\.firmaRectora/);
  assert.match(bloque, /_firmaDeUsuario\(infoG\.d\)/);
});
check('htmlAlertaTemprana(): el botón de Pre-informe/Citación está conectado a generarPreinformesCitacionPDF()', () => {
  assert.match(src2, /onclick="generarPreinformesCitacionPDF\(\)"/);
});

// ── Entorno "vm" funcional (mismo patrón de Rondas 74-85) ──
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
const _pdfCallsLog = [];
ctx.jspdf = { jsPDF: function(){
  return {
    setFillColor(){}, rect(){}, setTextColor(){}, setFont(){}, setFontSize(){}, setDrawColor(){}, setLineWidth(){},
    text(){}, line(){}, splitTextToSize(t){ return [String(t)]; },
    addImage(...a){ _pdfCallsLog.push(a); },
    addPage(){}, save(){},
  };
} };
ctx.XLSX = {
  _lastBook: null,
  utils: {
    book_new(){ return { sheets: [] }; },
    aoa_to_sheet(aoa){ return { __aoa: aoa }; },
    book_append_sheet(wb, ws, name){ wb.sheets.push({ name, ws }); },
  },
  write(wb){ ctx.XLSX._lastBook = wb; return new ArrayBuffer(0); },
};
ctx.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
try { vm.runInContext(src2, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }

function run(code) { return vm.runInContext(code, ctx); }

function fixtureDB(extra) {
  return Object.assign({
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 86', anio: '2026',
    config: { numPeriodos: 4, pesosPeriodos: [25,25,25,25], pctSer: 0.25, pctSaber: 0.35, pctHacer: 0.40, nomSer: 'SER', nomSaber: 'SABER', nomHacer: 'HACER', escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, mostrarInasistenciasEnPlanilla: false },
    grados: [{ n: '10°', d: 'doc1' }],
    users: [
      { u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x', firma: 'https://res.cloudinary.com/x/firma-doc1.png' },
      { u: 'orient1', r: 'docente', n: 'Orientadora Uno', p: 'x', rolEspecifico: 'Docente Orientador' },
      { u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', p: 'x', rolEspecifico: 'Tutor PTA' },
      { u: 'rector1', r: 'admin', n: 'Rectora', p: 'x' },
    ],
    carga: [{ id: 101, g: '10°', m: 'Matemáticas', a: 'Matemáticas', d: 'doc1', dn: 'Docente Uno', ih: 5 }],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', nom: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [], telAcud: '3001234567', email: 'acudiente1@test.com' },
      { id: 'e2', n: 'BRAYAN LOPEZ', nom: 'BRAYAN LOPEZ', g: '10°', nts: {}, observaciones: [] },
    ],
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true, true, true, true],
    notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [],
    casosConvivencia: [], drivePTA: [], atencionesPsicopedagogicas: [],
  }, extra || {});
}
function instalarDB(dbObj, sesionObj) {
  run('db = ' + JSON.stringify(dbObj) + ';');
  run('sesion = ' + JSON.stringify(sesionObj) + ';');
  run('window._filaEnEdicion=null; window._loteFilasEnEdicion=null;');
  run('window._colaGuardadoFilas=[]; window._colaGuardadoFilasInfo={};');
  run('window._dbGranularSolamente=false;');
  run('window._piarFiltroGrado=undefined; window._piarFiltroCategoria=undefined;');
  run('window._histOrientFiltroTipo=undefined; window._histOrientFiltroEst=undefined;');
  for (const k of Object.keys(elementosPorId)) delete elementosPorId[k];
  _fetchCalls.length = 0;
  _pdfCallsLog.length = 0;
  _latenciaSimuladaMs = 0;
  _fetchDebeFallar = false;
}

// ════════════════════════════════════════════════════════════════════════
// 1) TUTOR PTA — Consolidado de Gestión Pedagógica + Retroalimentación
// ════════════════════════════════════════════════════════════════════════
check('htmlConsolidadoPedagogicoPTA(): un rol sin acceso (docente de aula normal) no puede verlo', () => {
  instalarDB(fixtureDB(), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  const html = run('htmlConsolidadoPedagogicoPTA()');
  assert.match(html, /No autorizado/);
});
check('htmlConsolidadoPedagogicoPTA(): calcula % de cumplimiento cruzando carga/planesArea/planeaciones/drivePTA', () => {
  instalarDB(fixtureDB({
    planesArea: [{ nombre: 'Plan Mate', asig: 'Matemáticas', grado: '10°', docente: 'Docente Uno' }],
    planeaciones: [],
    drivePTA: [{ id: 1, tipo: 'Evidencia Centro de Interés', titulo: 'x', docente: 'doc1', docenteNombre: 'Docente Uno', fecha: '2026-02-01' }],
  }), { u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', rolEspecifico: 'Tutor PTA' });
  const html = run('htmlConsolidadoPedagogicoPTA()');
  assert.match(html, /Docente Uno/);
  assert.match(html, /Pendiente/, 'falta la planeación — no debe marcar "Al día"');
  assert.match(html, /0%/, 'ningún docente/grado tiene las 3 cosas completas todavía');
});
check('htmlConsolidadoPedagogicoPTA(): marca "Al día" cuando existen las 3 evidencias (plan de área + planeación + drivePTA)', () => {
  instalarDB(fixtureDB({
    planesArea: [{ nombre: 'Plan Mate', asig: 'Matemáticas', grado: '10°', docente: 'Docente Uno' }],
    planeaciones: [{ tipo: 'Secuencia', nombre: 'Secuencia 1', asig: 'Matemáticas', grado: '10°', docente: 'Docente Uno' }],
    drivePTA: [{ id: 1, tipo: 'Evidencia Centro de Interés', titulo: 'x', docente: 'doc1', docenteNombre: 'Docente Uno', fecha: '2026-02-01' }],
  }), { u: 'rector1', r: 'admin', n: 'Rectora' });
  const html = run('htmlConsolidadoPedagogicoPTA()');
  assert.match(html, /Al día/);
  assert.match(html, /100%/);
});
check('pdfConsolidadoPedagogicoPTA()/xlsxConsolidadoPedagogicoPTA(): exportan sin lanzar error para Tutor PTA', () => {
  instalarDB(fixtureDB({
    planesArea: [{ nombre: 'Plan Mate', asig: 'Matemáticas', grado: '10°', docente: 'Docente Uno' }],
  }), { u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', rolEspecifico: 'Tutor PTA' });
  run('pdfConsolidadoPedagogicoPTA()');
  run('xlsxConsolidadoPedagogicoPTA()');
  const wb = run('XLSX._lastBook');
  assert.ok(wb && wb.sheets.length === 1);
});
check('_agregarComentarioPTA(): el Tutor PTA puede dejar retroalimentación sobre una evidencia SIN tocar "nts" de ningún estudiante', () => {
  instalarDB(fixtureDB({
    drivePTA: [{ id: 55, tipo: 'Plan de Área', titulo: 'Plan X', docente: 'doc1', docenteNombre: 'Docente Uno', fecha: '2026-02-01' }],
  }), { u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', rolEspecifico: 'Tutor PTA' });
  elementosPorId['cmtPTA_55'] = { value: 'Buen trabajo, agregue más ejemplos prácticos.' };
  const ntsAntes = run('JSON.stringify(db.ests.map(e=>e.nts))');
  ctx.renderApp = () => {};
  run('_agregarComentarioPTA(55)');
  const ev = run("db.drivePTA.find(e=>e.id===55)");
  assert.equal(ev.comentariosPTA.length, 1);
  assert.equal(ev.comentariosPTA[0].autor, 'Tutora PTA Uno');
  const ntsDespues = run('JSON.stringify(db.ests.map(e=>e.nts))');
  assert.equal(ntsAntes, ntsDespues, 'las notas de los estudiantes no deben cambiar por un comentario del Tutor PTA');
});
check('_agregarComentarioPTA(): un docente de aula normal no puede comentar (no autorizado)', () => {
  instalarDB(fixtureDB({
    drivePTA: [{ id: 55, tipo: 'Plan de Área', titulo: 'Plan X', docente: 'doc1', docenteNombre: 'Docente Uno', fecha: '2026-02-01' }],
  }), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  elementosPorId['cmtPTA_55'] = { value: 'Intento no autorizado' };
  let alertMsg = '';
  ctx.customAlert = (m) => { alertMsg = m; };
  run('_agregarComentarioPTA(55)');
  assert.match(alertMsg, /No autorizado/);
  const ev = run("db.drivePTA.find(e=>e.id===55)");
  assert.equal(ev.comentariosPTA, undefined);
});

// ════════════════════════════════════════════════════════════════════════
// 2) DOCENTE ORIENTADOR — Matriz PIAR con filtros + Historial integrado
// ════════════════════════════════════════════════════════════════════════
check('htmlFichaInclusion(): el filtro de grado reduce la tabla a los estudiantes de ese grado', () => {
  instalarDB(fixtureDB({
    grados: [{ n: '10°', d: 'doc1' }, { n: '11°', d: 'doc1' }],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [], piar: { activo: true, categoria: 'TEA' } },
      { id: 'e2', n: 'CARLOS RUIZ', g: '11°', nts: {}, observaciones: [], piar: { activo: true, categoria: 'Baja visión' } },
    ],
  }), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  run("window._piarFiltroGrado='11°';");
  const html = run('htmlFichaInclusion()');
  assert.match(html, /CARLOS RUIZ/);
  assert.doesNotMatch(html, /ANA PEREZ/);
});
check('htmlFichaInclusion(): el filtro de categoría (tipo de ajuste) reduce la tabla a esa categoría', () => {
  instalarDB(fixtureDB({
    ests: [
      { id: 'e1', n: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [], piar: { activo: true, categoria: 'TEA' } },
      { id: 'e2', n: 'BRAYAN LOPEZ', g: '10°', nts: {}, observaciones: [], piar: { activo: true, categoria: 'Baja visión' } },
    ],
  }), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  run("window._piarFiltroCategoria='Baja visión';");
  const html = run('htmlFichaInclusion()');
  assert.match(html, /BRAYAN LOPEZ/);
  assert.doesNotMatch(html, /ANA PEREZ/);
});
check('htmlHistorialOrientacion(): un docente de aula normal no tiene acceso', () => {
  instalarDB(fixtureDB(), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  const html = run('htmlHistorialOrientacion()');
  assert.match(html, /No autorizado/);
});
check('htmlHistorialOrientacion(): consolida atenciones psicopedagógicas y casos de convivencia en un solo listado', () => {
  instalarDB(fixtureDB({
    atencionesPsicopedagogicas: [{ id: 1, estId: 'e1', tipo: 'Seguimiento', notas: 'Cita realizada', fecha: '2026-02-01', docente: 'orient1', docenteNombre: 'Orientadora Uno' }],
    casosConvivencia: [{ id: 500, estId: 'e2', tipologia: 'Tipología II', descripcion: 'Situación X', seguimiento: 'Remitido', fecha: '2026-03-01', docente: 'orient1', docenteNombre: 'Orientadora Uno' }],
  }), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  const html = run('htmlHistorialOrientacion()');
  assert.match(html, /ANA PEREZ/);
  assert.match(html, /BRAYAN LOPEZ/);
  assert.match(html, /Atención/);
  assert.match(html, /Convivencia/);
  assert.match(html, /_generarActaConvivenciaPDF\(500\)/, 'el caso de convivencia debe tener su botón de descarga de acta');
});
check('htmlHistorialOrientacion(): el filtro por tipo de registro (solo convivencia) oculta las atenciones', () => {
  instalarDB(fixtureDB({
    atencionesPsicopedagogicas: [{ id: 1, estId: 'e1', tipo: 'Seguimiento', notas: 'x', fecha: '2026-02-01', docente: 'orient1', docenteNombre: 'Orientadora Uno' }],
    casosConvivencia: [{ id: 500, estId: 'e2', tipologia: 'Tipología I', descripcion: 'y', seguimiento: 'z', fecha: '2026-03-01', docente: 'orient1', docenteNombre: 'Orientadora Uno' }],
  }), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  run("window._histOrientFiltroTipo='convivencia';");
  const html = run('htmlHistorialOrientacion()');
  const filaRegistros = html.slice(html.indexOf('Registros ('));
  assert.match(filaRegistros, /BRAYAN LOPEZ/);
  assert.doesNotMatch(filaRegistros, /ANA PEREZ/, 'con el filtro "solo convivencia", la fila de Ana Pérez (atención psicopedagógica) no debe aparecer en la TABLA de registros');
});

// ════════════════════════════════════════════════════════════════════════
// 3) BOLETINES Y ALERTAS DE RIESGO
// ════════════════════════════════════════════════════════════════════════
check('generarPreinformesCitacionPDF(): un rol sin autorización (docente de aula normal) no puede generarlo', () => {
  instalarDB(fixtureDB(), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  let alertMsg = '';
  ctx.customAlert = (m) => { alertMsg = m; };
  elementosPorId['at-periodo'] = { value: '1' };
  run('generarPreinformesCitacionPDF()');
  assert.match(alertMsg, /No autorizado/);
});
check('generarPreinformesCitacionPDF(): sin estudiantes seleccionados, avisa y no genera nada', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  let alertMsg = '';
  ctx.customAlert = (m) => { alertMsg = m; };
  elementosPorId['at-periodo'] = { value: '1' };
  run('generarPreinformesCitacionPDF()');
  assert.match(alertMsg, /No hay estudiantes seleccionados/);
});
check('_firmaDeUsuario(): resuelve la firma personal del Director de Grupo (doc1) usada ahora en boletines y pre-informes', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  assert.equal(run("_firmaDeUsuario('doc1')"), 'https://res.cloudinary.com/x/firma-doc1.png');
});

// ════════════════════════════════════════════════════════════════════════
// 4) COMUNICACIÓN MASIVA — plantilla editable + panel de Acudientes
// ════════════════════════════════════════════════════════════════════════
check('htmlComunicacionPTAOrientador(): incluye la plantilla editable y el selector de Acudientes', () => {
  instalarDB(fixtureDB(), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  const html = run('htmlComunicacionPTAOrientador()');
  assert.match(html, /id="cptaPlantilla"/);
  assert.match(html, /id="cptaEstSel"/);
  assert.match(html, /ANA PEREZ/);
});
check('_enviarComunicadoAcudienteWA(): abre wa.me con el texto de la plantilla cuando el estudiante tiene teléfono de acudiente', () => {
  instalarDB(fixtureDB(), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  elementosPorId['cptaEstSel'] = { value: 'e1' };
  elementosPorId['cptaPlantilla'] = { value: 'Mensaje de prueba para el acudiente' };
  let urlAbierta = '';
  ctx.window.open = (u) => { urlAbierta = u; };
  run('_enviarComunicadoAcudienteWA()');
  assert.match(urlAbierta, /^https:\/\/wa\.me\/573001234567\?text=/);
  assert.match(decodeURIComponent(urlAbierta), /Mensaje de prueba para el acudiente/);
});
check('_enviarComunicadoAcudienteWA(): sin teléfono de acudiente registrado, avisa en vez de fallar', () => {
  instalarDB(fixtureDB(), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  elementosPorId['cptaEstSel'] = { value: 'e2' };
  elementosPorId['cptaPlantilla'] = { value: 'x' };
  let alertMsg = '';
  ctx.customAlert = (m) => { alertMsg = m; };
  run('_enviarComunicadoAcudienteWA()');
  assert.match(alertMsg, /no tiene teléfono/);
});

// ════════════════════════════════════════════════════════════════════════
// Preservación de la arquitectura Local-First (Ronda 85): estas nuevas
// vistas/consultas son de SOLO LECTURA sobre "db" salvo por las 2 mutaciones
// explícitas (comentariosPTA), que también deben pasar por updDB() y por
// lo tanto seguir sellando _syncMeta/pending_sync con normalidad.
// ════════════════════════════════════════════════════════════════════════
check('_agregarComentarioPTA(): al mutar vía updDB(), sella _syncMeta/pending_sync igual que cualquier otro cambio (no rompe el Local-First de la Ronda 85)', () => {
  instalarDB(fixtureDB({
    drivePTA: [{ id: 55, tipo: 'Plan de Área', titulo: 'Plan X', docente: 'doc1', docenteNombre: 'Docente Uno', fecha: '2026-02-01' }],
  }), { u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', rolEspecifico: 'Tutor PTA' });
  elementosPorId['cmtPTA_55'] = { value: 'Observación de prueba' };
  ctx.renderApp = () => {};
  run('_agregarComentarioPTA(55)');
  const meta = run('db._syncMeta');
  assert.equal(meta.pending_sync, true);
  assert.match(meta.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});
check('mergeGlobalData() sigue existiendo sin cambios de firma tras la Ronda 86 (2 argumentos)', () => {
  assert.match(src1, /function mergeGlobalData\(localData,\s*incomingData\)\{/);
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) console.log('✅ 100% de la suite en verde.');
else console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
process.exit(fail === 0 ? 0 : 1);
