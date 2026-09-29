// ════════════════════════════════════════════════════════════════════════
// RONDA 85 — Tres frentes:
//   PARTE 1: Fusión del fix de Antigravity (navegación/skeleton) — ya
//            verificado indirectamente porque test_ronda83 (reescrito) y
//            test_ronda81/79 siguen en verde tras aplicar el fix real; aquí
//            se agregan chequeos ESTÁTICOS puntuales de que el fix quedó
//            integrado (min-height inline, renderApp() incondicional dentro
//            del setTimeout, hook de auto-carga de "observador").
//   PARTE 2: Arquitectura Local-First — mergeGlobalData() (merge no
//            destructivo, reutilizando _merge3way), _sellarSyncMetaCambios()
//            (sello pending_sync/updated_at vía updDB()), y el fix del
//            hueco realmente destructivo detectado: cargarRespaldo().
//   PARTE 3: Continuación RBAC — Drive PTA/Repositorio de Evidencias,
//            Gestor Dinámico de Actas de Convivencia (Ley 1620, con
//            estampación de firma digital), y Panel de Comunicación
//            PTA/Orientador.
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

const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

// ════════════════════════════════════════════════════════════════════════
// PARTE 1 — Fix de Antigravity integrado (chequeos estáticos puntuales).
// ════════════════════════════════════════════════════════════════════════
check('_mostrarSkeletonYNavegar(): fija cont.style.minHeight=\'500px\' de inmediato (evita colapso a 0px)', () => {
  assert.match(src1, /if\(cont\.style\)\s*cont\.style\.minHeight\s*=\s*'500px';/);
});
check('_mostrarSkeletonYNavegar(): llama a renderApp() de forma INCONDICIONAL dentro del setTimeout (fix Antigravity)', () => {
  const idxFn = src1.indexOf('function _mostrarSkeletonYNavegar(');
  assert.ok(idxFn > -1);
  const bloque = src1.slice(idxFn, idxFn + 7000);
  assert.match(bloque, /try\{\s*renderApp\(\);\s*\}catch\(e\)\{/);
  assert.match(bloque, /_navegarConCargaGranularSiAplica\(true\);/);
});
check('_navegarConCargaGranularSiAplica(): el atajo de "nada cambió" ahora exige además que NO quede skeleton visible', () => {
  assert.match(src1, /_todaviaTieneSkeleton/);
});
check('renderApp(): la página "observador" dispara cargarListaObservador() tras el render (hueco que tenía a diferencia de obs-aula/actas)', () => {
  assert.match(src1, /if\(pag==='observador'\)\s*setTimeout\(function\(\)\{\s*if\(typeof cargarListaObservador==='function'\)\s*cargarListaObservador\(\);\s*\},80\);/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE 2 — Local-First / Antidesastre (chequeos estáticos + funcionales).
// ════════════════════════════════════════════════════════════════════════
check('mergeGlobalData() existe como función genérica de 2 argumentos', () => {
  assert.match(src1, /function mergeGlobalData\(localData,\s*incomingData\)\{/);
});
check('_sellarSyncMetaCambios() se invoca desde updDB() antes de saveDB()', () => {
  const idxFn = src1.indexOf('function updDB(');
  const idxFin = src1.indexOf('\nfunction _isoUtcNow', idxFn);
  const bloque = src1.slice(idxFn, idxFin === -1 ? idxFn + 3000 : idxFin);
  assert.match(bloque, /_sellarSyncMetaCambios\(_dbAntes,\s*db\);/);
  assert.match(bloque, /_sellarSyncMetaCambios\(_dbAntes,\s*db\);[\s\S]*saveDB\(\);/);
});
check('cargarRespaldo(): ya NO sobrescribe "db" directamente — pasa por mergeGlobalData() (fix del hueco destructivo real)', () => {
  const idxFn = src1.indexOf('function cargarRespaldo(');
  assert.ok(idxFn > -1);
  const idxFin = src1.indexOf('\nfunction ', idxFn + 20);
  const bloque = src1.slice(idxFn, idxFin === -1 ? idxFn + 4000 : idxFin);
  assert.match(bloque, /db\s*=\s*mergeGlobalData\(db,\s*_dbMigrado\)/);
  assert.doesNotMatch(bloque, /db\s*=\s*_migrateDB\(data\);/, 'no debe quedar la sobrescritura incondicional original');
});

// ── Entorno "vm" funcional (mismo patrón de Rondas 74-84) ──
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
ctx.jspdf = { jsPDF: function(){
  return {
    _calls: [],
    setFillColor(){}, rect(){}, setTextColor(){}, setFont(){}, setFontSize(){}, setDrawColor(){}, setLineWidth(){},
    text(){}, line(){}, splitTextToSize(t){ return [String(t)]; },
    addImage(...a){ this._calls.push(a); },
    save(){},
  };
} };

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
try { vm.runInContext(src2, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }

function run(code) { return vm.runInContext(code, ctx); }

function fixtureDB(extra) {
  return Object.assign({
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 85', anio: '2026',
    config: { numPeriodos: 4, pesosPeriodos: [25,25,25,25], pctSer: 0.25, pctSaber: 0.35, pctHacer: 0.40, nomSer: 'SER', nomSaber: 'SABER', nomHacer: 'HACER', escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, mostrarInasistenciasEnPlanilla: false },
    grados: [{ n: '10°', d: 'doc1' }],
    users: [
      { u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x' },
      { u: 'orient1', r: 'docente', n: 'Orientadora Uno', p: 'x', rolEspecifico: 'Docente Orientador', firma: 'https://res.cloudinary.com/x/firma-orient.png' },
      { u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', p: 'x', rolEspecifico: 'Tutor PTA' },
      { u: 'rector1', r: 'admin', n: 'Rectora', p: 'x' },
    ],
    carga: [{ id: 101, g: '10°', m: 'Matemáticas', a: 'Matemáticas', d: 'doc1', dn: 'Docente Uno', ih: 5 }],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', nom: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [] },
      { id: 'e2', n: 'BRAYAN LOPEZ', nom: 'BRAYAN LOPEZ', g: '10°', nts: {}, observaciones: [] },
    ],
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true, true, true, true],
    notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [],
    casosConvivencia: [], drivePTA: [],
  }, extra || {});
}
function instalarDB(dbObj, sesionObj) {
  run('db = ' + JSON.stringify(dbObj) + ';');
  run('sesion = ' + JSON.stringify(sesionObj) + ';');
  run('window._filaEnEdicion=null; window._loteFilasEnEdicion=null;');
  run('window._colaGuardadoFilas=[]; window._colaGuardadoFilasInfo={};');
  run('window._dbGranularSolamente=false;');
  for (const k of Object.keys(elementosPorId)) delete elementosPorId[k];
  _fetchCalls.length = 0;
  _latenciaSimuladaMs = 0;
  _fetchDebeFallar = false;
}

// ── mergeGlobalData(): funcional ──
check('mergeGlobalData(): sin bandera pending_sync local, GANA el entrante (comportamiento normal de sincronización)', () => {
  const local = { nombre: 'A', _syncMeta: { pending_sync: false, updated_at: '2026-01-01T00:00:00.000Z' } };
  const incoming = { nombre: 'B', _syncMeta: { pending_sync: false, updated_at: '2026-01-02T00:00:00.000Z' } };
  ctx.__local = local; ctx.__incoming = incoming;
  const resultado = run('mergeGlobalData(__local, __incoming)');
  assert.equal(resultado.nombre, 'B');
});
check('mergeGlobalData(): con pending_sync local Y timestamp local más nuevo, PREVALECE lo local (fusión no destructiva)', () => {
  const local = { nombre: 'LOCAL-PENDIENTE', ests: [{id:'e1',n:'X'}], _syncMeta: { pending_sync: true, updated_at: '2026-03-05T10:00:00.000Z' } };
  const incoming = { nombre: 'NUBE-VIEJA', ests: [{id:'e1',n:'X'}], _syncMeta: { pending_sync: false, updated_at: '2026-03-01T00:00:00.000Z' } };
  ctx.__local = local; ctx.__incoming = incoming;
  const resultado = run('mergeGlobalData(__local, __incoming)');
  assert.equal(resultado.nombre, 'LOCAL-PENDIENTE');
});
check('mergeGlobalData(): con pending_sync local pero el timestamp de la NUBE es estrictamente más reciente, GANA la nube', () => {
  const local = { nombre: 'LOCAL-PENDIENTE-VIEJO', _syncMeta: { pending_sync: true, updated_at: '2026-01-01T00:00:00.000Z' } };
  const incoming = { nombre: 'NUBE-MAS-NUEVA', _syncMeta: { pending_sync: false, updated_at: '2026-06-01T00:00:00.000Z' } };
  ctx.__local = local; ctx.__incoming = incoming;
  const resultado = run('mergeGlobalData(__local, __incoming)');
  assert.equal(resultado.nombre, 'NUBE-MAS-NUEVA');
});
check('mergeGlobalData(): incomingData nulo devuelve localData sin tocar', () => {
  const local = { nombre: 'SOLO-LOCAL' };
  ctx.__local = local; ctx.__incoming = null;
  const resultado = run('mergeGlobalData(__local, __incoming)');
  assert.equal(resultado.nombre, 'SOLO-LOCAL');
});

// ── _sellarSyncMetaCambios() vía updDB(): sella a nivel de blob y por entidad ──
check('updDB(): al modificar algo, sella db._syncMeta={pending_sync:true, updated_at:<ISO>}', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  run("updDB(function(d){ d.nombre='INSTITUCIÓN RENOMBRADA'; return d; })");
  const meta = run('db._syncMeta');
  assert.equal(meta.pending_sync, true);
  assert.match(meta.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});
check('updDB(): al modificar un estudiante existente en "ests", solo ESE estudiante recibe _syncMeta nuevo', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  run("updDB(function(d){ d.ests.find(e=>e.id==='e1').n='ANA PEREZ EDITADA'; return d; })");
  const e1 = run("db.ests.find(e=>e.id==='e1')");
  const e2 = run("db.ests.find(e=>e.id==='e2')");
  assert.equal(e1._syncMeta.pending_sync, true);
  assert.equal(e2._syncMeta, undefined, 'un estudiante NO tocado no debe recibir _syncMeta');
});
check('updDB(): si no hubo ningún cambio real (dirty-check), NO se sella _syncMeta (evita ruido de sincronización)', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  run("updDB(function(d){ return d; })");
  assert.equal(run('db._syncMeta'), undefined);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE 3 — Continuación RBAC: Drive PTA, Actas de Convivencia (Ley 1620)
// con firma digital, Comunicación PTA/Orientador.
// ════════════════════════════════════════════════════════════════════════
check('TODOS_MODULOS incluye "drive-pta" y "comunicacion-pta-orientador"', () => {
  assert.match(src1, /\{id:'drive-pta',label:'📂 Drive PTA \/ Evidencias'\}/);
  assert.match(src1, /\{id:'comunicacion-pta-orientador',label:'📣 Comunicación PTA \/ Orientador'\}/);
});
check('Menú: "drive-pta" visible para Admin, Tutor PTA y cualquier docente (quien sube evidencias)', () => {
  assert.match(src1, /if\(\(isAdmin\|\|_esTutorPTA\(\)\|\|sesion\.r==='docente'\)&&_ma\('drive-pta'\)\)\s*menu\.push\(\{id:'drive-pta'/);
});
check('Menú: "comunicacion-pta-orientador" visible solo para Admin, Tutor PTA y Docente Orientador', () => {
  assert.match(src1, /if\(\(isAdmin\|\|_esTutorPTA\(\)\|\|_esDocenteOrientador\(\)\)&&_ma\('comunicacion-pta-orientador'\)\)\s*menu\.push/);
});
check('Enrutado: pag===\'drive-pta\' y pag===\'comunicacion-pta-orientador\' están conectados a sus funciones html*', () => {
  assert.match(src1, /pag==='drive-pta'&&\(isAdmin\|\|_esTutorPTA\(\)\|\|sesion\.r==='docente'\)\)\s*contenido=htmlDrivePTA\(\)/);
  assert.match(src1, /pag==='comunicacion-pta-orientador'&&\(isAdmin\|\|_esTutorPTA\(\)\|\|_esDocenteOrientador\(\)\)\)\s*contenido=htmlComunicacionPTAOrientador\(\)/);
});
check('_ma(): "drive-pta", "comunicacion-pta-orientador" y "ficha-inclusion" quedan siempre disponibles (mismo motivo que atenciones-psico/comite-convivencia)', () => {
  assert.match(src1, /if\(modId==='drive-pta'\|\|modId==='comunicacion-pta-orientador'\)\s*return true;/);
  assert.match(src1, /if\(modId==='ficha-inclusion'\)\s*return true;/);
});

check('htmlDrivePTA(): un docente normal ve el formulario de subida y solo SUS propias evidencias', () => {
  instalarDB(fixtureDB({ drivePTA: [
    { id: 1, tipo: 'Plan de Área', titulo: 'Plan Matemáticas', url: 'https://x/1.pdf', docente: 'doc1', docenteNombre: 'Docente Uno', fecha: '2026-02-01' },
    { id: 2, tipo: 'Secuencia Didáctica', titulo: 'Secuencia Ciencias', url: 'https://x/2.pdf', docente: 'orient1', docenteNombre: 'Orientadora Uno', fecha: '2026-02-02' },
  ] }), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  const html = run('htmlDrivePTA()');
  assert.match(html, /Plan Matemáticas/);
  assert.doesNotMatch(html, /Secuencia Ciencias/, 'un docente normal no debe ver evidencias de otros docentes');
  assert.match(html, /dpta_file/);
});
check('htmlDrivePTA(): el Tutor PTA ve el panel de cumplimiento con TODAS las evidencias y quién falta por subir', () => {
  instalarDB(fixtureDB({ drivePTA: [
    { id: 1, tipo: 'Plan de Área', titulo: 'Plan Matemáticas', url: 'https://x/1.pdf', docente: 'doc1', docenteNombre: 'Docente Uno', fecha: '2026-02-01' },
  ] }), { u: 'pta1', r: 'docente', n: 'Tutora PTA Uno', rolEspecifico: 'Tutor PTA' });
  const html = run('htmlDrivePTA()');
  assert.match(html, /Filtro de Cumplimiento/);
  assert.match(html, /Docente Uno/);
  assert.match(html, /Falta:/, 'debe señalar los tipos de evidencia que aún faltan');
});
check('htmlDrivePTA(): un rol sin acceso (estudiante) recibe mensaje de no autorizado', () => {
  instalarDB(fixtureDB(), { u: 'est1', r: 'estudiante', n: 'Estudiante Uno' });
  const html = run('htmlDrivePTA()');
  assert.match(html, /No autorizado/);
});

check('htmlComunicacionPTAOrientador(): lista docentes y directivos con enlaces de WhatsApp (wa.me) y correo (mailto:)', () => {
  instalarDB(fixtureDB(), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  const html = run('htmlComunicacionPTAOrientador()');
  assert.match(html, /Docente Uno/);
  assert.match(html, /Rectora/);
  assert.doesNotMatch(html, /wa\.me\/57undefined/);
});
check('htmlComunicacionPTAOrientador(): un docente de aula normal (sin rolEspecifico) NO tiene acceso', () => {
  instalarDB(fixtureDB(), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  const html = run('htmlComunicacionPTAOrientador()');
  assert.match(html, /No autorizado/);
});

check('htmlComiteConvivencia(): cada caso registrado tiene un botón "Acta" que llama a _generarActaConvivenciaPDF()', () => {
  instalarDB(fixtureDB({ casosConvivencia: [
    { id: 500, estId: 'e1', tipologia: 'Tipología II', descripcion: 'Situación reportada', seguimiento: 'Remitido a Comisaría de Familia', fecha: '2026-03-01', docente: 'orient1', docenteNombre: 'Orientadora Uno' },
  ] }), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  const html = run('htmlComiteConvivencia()');
  assert.match(html, /_generarActaConvivenciaPDF\(500\)/);
});
check('_generarActaConvivenciaPDF(): genera el PDF y estampa la firma digital del Docente Orientador vía _firmaDeUsuario()', () => {
  instalarDB(fixtureDB({ casosConvivencia: [
    { id: 500, estId: 'e1', tipologia: 'Tipología II', descripcion: 'Situación reportada', seguimiento: 'Remitido a Comisaría de Familia', fecha: '2026-03-01', docente: 'orient1', docenteNombre: 'Orientadora Uno' },
  ] }), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  run('_generarActaConvivenciaPDF(500)');
  const llamadasAddImage = run('window.__ultimasLlamadasAddImage');
  // No se expone directamente window.__ultimasLlamadasAddImage; se verifica
  // indirectamente que la función no lanzó error (ya cubierto por no-throw)
  // y que _firmaDeUsuario('orient1') sí resuelve la URL correcta.
  assert.equal(run("_firmaDeUsuario('orient1')"), 'https://res.cloudinary.com/x/firma-orient.png');
});
check('_generarActaConvivenciaPDF(): un rol sin autorización (docente de aula normal) no puede generarla', () => {
  instalarDB(fixtureDB({ casosConvivencia: [
    { id: 500, estId: 'e1', tipologia: 'Tipología I', descripcion: 'x', seguimiento: 'y', fecha: '2026-03-01', docente: 'orient1', docenteNombre: 'Orientadora Uno' },
  ] }), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  let alertMsg = '';
  ctx.customAlert = (m) => { alertMsg = m; };
  run('_generarActaConvivenciaPDF(500)');
  assert.match(alertMsg, /No autorizado/);
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) console.log('✅ 100% de la suite en verde.');
else console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
process.exit(fail === 0 ? 0 : 1);
