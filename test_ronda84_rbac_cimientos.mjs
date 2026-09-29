// ════════════════════════════════════════════════════════════════════════
// RONDA 84 — CIMIENTOS RBAC para TUTOR_PTA y DOCENTE_ORIENTADOR.
//
// INVESTIGACIÓN PREVIA (obligatoria antes de escribir código, por pedido
// explícito del coordinador de no asumir nada): al revisar el código real
// se encontró que TUTOR_PTA y DOCENTE_ORIENTADOR NO son roles nuevos — ya
// existen desde las Rondas 35/39/40 como clasificaciones finas
// (sesion.rolEspecifico) dentro del rol genérico "docente"
// (_esDocenteOrientador()/_esTutorPTA()/_bloqueadoNotasPlanillas() en
// 03-app-core.js; ROLES_ESPECIFICOS_BLOQUEADOS_NOTAS en
// src/lib/jwt-auth.ts), con acceso ya construido a: Observador (filtrado a
// Pedagógica/Académica para Tutor PTA), Centros de Interés (Tutor PTA),
// Alertas Académicas / Atenciones Psicopedagógicas / Comité de Convivencia
// (Docente Orientador), y bloqueo real (frontend + JWT firmado en servidor)
// de Planilla/Notas/Actividades/Quiz para ambos. El "SUPER-ROL
// Administrativo/Rector" tampoco es nuevo: sesion.r==='admin' YA ve todo
// (ningún módulo de lectura está oculto para isAdmin).
//
// Lo que esta ronda SÍ agrega (alcance acordado: "cimientos RBAC", no todavía
// Drive/Actas dinámicas/Comunicación — quedan para próximas rondas):
//  1) Ficha de Inclusión / PIAR (Decreto 1421): dato nuevo (est.piar),
//     panel de EDICIÓN exclusivo de Administrador dentro de "Gestión de
//     Estudiantes", y una vista NUEVA de SOLO LECTURA para Docente
//     Orientador (htmlFichaInclusion()) que no comparte ningún botón de
//     edición con el panel de administrador.
//  2) Defensa en profundidad en el backend: POST /api/inetis/db ahora
//     también rechaza (403), para Docente Orientador y Tutor PTA, cualquier
//     cambio a notas (nts), Ficha PIAR, grado o estado de matrícula de
//     cualquier estudiante — aunque el frontend nunca les muestre un botón
//     para hacerlo, el servidor ya no confía solo en que el botón esté
//     oculto.
//  3) Firma Digital en "Mi Perfil" (editarDocente()), disponible para TODOS
//     los roles: subida de imagen (reutilizando el mismo flujo de
//     Cloudinary que ya usa la Foto), con vista previa y opción de
//     quitarla. La ESTAMPACIÓN automática en actas/boletines/informes queda
//     para una ronda posterior (esta ronda solo agrega la carga y el
//     almacenamiento del dato — _firmaDeUsuario() ya expuesto como helper
//     de lectura para cuando se conecte).
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
// PARTE A — src/lib/jwt-auth.ts: rolBloqueadoParaNotas() sigue bloqueando
// (real, criptográficamente) a Docente Orientador y Tutor PTA para notas —
// se ejecuta el módulo REAL con tsx (solo depende de "crypto", nativo de
// Node, así que se puede importar sin instalar dependencias externas).
// ════════════════════════════════════════════════════════════════════════
const { rolBloqueadoParaNotas } = await import('./src/lib/jwt-auth.ts');
check('rolBloqueadoParaNotas(): bloquea a Docente Orientador (vía rolEspecifico) para notas/planillas', () => {
  assert.equal(rolBloqueadoParaNotas({ rol: 'docente', rolEspecifico: 'Docente Orientador' }), true);
});
check('rolBloqueadoParaNotas(): bloquea a Tutor PTA (vía rolEspecifico) para notas/planillas', () => {
  assert.equal(rolBloqueadoParaNotas({ rol: 'docente', rolEspecifico: 'Tutor PTA' }), true);
});
check('rolBloqueadoParaNotas(): NO bloquea a un docente de aula normal (sin rolEspecifico restringido)', () => {
  assert.equal(rolBloqueadoParaNotas({ rol: 'docente', rolEspecifico: undefined }), false);
});
check('rolBloqueadoParaNotas(): NO bloquea a admin/rector — el super-rol conserva acceso total', () => {
  assert.equal(rolBloqueadoParaNotas({ rol: 'admin', rolEspecifico: undefined }), false);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — src/index.ts: nuevo guard de defensa en profundidad,
// _tieneCambioAcademicoNoPermitidoParaRolLimitado(). Este archivo importa
// Express/Drizzle/pg (no instalados en este entorno de pruebas), así que se
// EXTRAE el texto de la función (igual que Ronda 80 hizo por inspección de
// código para endpoints que dependen de Neon) y se evalúa de forma aislada
// con `new Function` — la función en sí es PURA (JSON.stringify/Map, nada
// de red/DB), así que esto la ejecuta de verdad, no solo la inspecciona.
// ════════════════════════════════════════════════════════════════════════
const srcIndex = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
const idxFnGuard = srcIndex.indexOf('function _tieneCambioAcademicoNoPermitidoParaRolLimitado');
check('src/index.ts: existe la función _tieneCambioAcademicoNoPermitidoParaRolLimitado()', () => {
  assert.ok(idxFnGuard > -1);
});
// Aísla el cuerpo de la función buscando la línea "}" que cierra el nivel 0
// de llaves (balanceo simple — suficiente porque es la última función del
// bloque y no contiene template literals con llaves sin escapar).
function _extraerBloqueFuncion(src, idxInicio) {
  let profundidad = 0, i = idxInicio, empezado = false;
  for (; i < src.length; i++) {
    if (src[i] === '{') { profundidad++; empezado = true; }
    else if (src[i] === '}') { profundidad--; if (empezado && profundidad === 0) { i++; break; } }
  }
  return src.slice(idxInicio, i);
}
const bloqueGuardTs = _extraerBloqueFuncion(srcIndex, idxFnGuard);
// La función es TypeScript real (anotaciones de tipo) — en vez de intentar
// des-tipar a mano con regex frágiles, se escribe a un archivo .ts temporal
// con un "export default" y se importa con tsx (mismo runtime que ya usa
// este proyecto — ver package.json), que sí sabe despojar tipos de verdad.
// La función es PURA (JSON.stringify/Map, sin red/DB), así que esto la
// ejecuta de verdad, no solo la inspecciona por texto.
const _tmpGuardPath = new URL('./_tmp_ronda84_guard.ts', import.meta.url);
fs.writeFileSync(_tmpGuardPath, bloqueGuardTs + '\nexport default _tieneCambioAcademicoNoPermitidoParaRolLimitado;\n');
const { default: _tieneCambioAcademicoNoPermitidoParaRolLimitado } = await import(_tmpGuardPath.href + '?t=' + Date.now());
fs.unlinkSync(_tmpGuardPath);

check('_tieneCambioAcademicoNoPermitidoParaRolLimitado(): no bloquea cuando nada cambió', () => {
  const viejo = { ests: [{ id: 'e1', nts: { 1: { m1: 4.5 } }, g: '10°', estadoMatricula: 'activo' }] };
  const nuevo = JSON.parse(JSON.stringify(viejo));
  assert.equal(_tieneCambioAcademicoNoPermitidoParaRolLimitado(nuevo, viejo), false);
});
check('_tieneCambioAcademicoNoPermitidoParaRolLimitado(): bloquea si cambian las notas (nts) de un estudiante', () => {
  const viejo = { ests: [{ id: 'e1', nts: { 1: { m1: 4.5 } }, g: '10°' }] };
  const nuevo = { ests: [{ id: 'e1', nts: { 1: { m1: 5.0 } }, g: '10°' }] };
  assert.equal(_tieneCambioAcademicoNoPermitidoParaRolLimitado(nuevo, viejo), true);
});
check('_tieneCambioAcademicoNoPermitidoParaRolLimitado(): bloquea si se crea/edita la Ficha PIAR de un estudiante', () => {
  const viejo = { ests: [{ id: 'e1', g: '10°', piar: null }] };
  const nuevo = { ests: [{ id: 'e1', g: '10°', piar: { activo: true, categoria: 'TEA' } }] };
  assert.equal(_tieneCambioAcademicoNoPermitidoParaRolLimitado(nuevo, viejo), true);
});
check('_tieneCambioAcademicoNoPermitidoParaRolLimitado(): bloquea si cambia el grado (traslado/promoción)', () => {
  const viejo = { ests: [{ id: 'e1', g: '10°' }] };
  const nuevo = { ests: [{ id: 'e1', g: '11°' }] };
  assert.equal(_tieneCambioAcademicoNoPermitidoParaRolLimitado(nuevo, viejo), true);
});
check('_tieneCambioAcademicoNoPermitidoParaRolLimitado(): bloquea si cambia el estado de matrícula', () => {
  const viejo = { ests: [{ id: 'e1', g: '10°', estadoMatricula: 'activo' }] };
  const nuevo = { ests: [{ id: 'e1', g: '10°', estadoMatricula: 'retirado' }] };
  assert.equal(_tieneCambioAcademicoNoPermitidoParaRolLimitado(nuevo, viejo), true);
});
check('_tieneCambioAcademicoNoPermitidoParaRolLimitado(): NO bloquea cambios en "observaciones" (esas ya tienen su propio chequeo dedicado)', () => {
  const viejo = { ests: [{ id: 'e1', g: '10°', observaciones: [] }] };
  const nuevo = { ests: [{ id: 'e1', g: '10°', observaciones: [{ per: 1, doc: 'x', fecha: '2026-01-01', txt: 'nota', tipo_anotacion: 'ACADEMICA' }] }] };
  assert.equal(_tieneCambioAcademicoNoPermitidoParaRolLimitado(nuevo, viejo), false);
});
check('_tieneCambioAcademicoNoPermitidoParaRolLimitado(): NO bloquea cuando se matricula un estudiante NUEVO', () => {
  const viejo = { ests: [{ id: 'e1', g: '10°' }] };
  const nuevo = { ests: [{ id: 'e1', g: '10°' }, { id: 'e2', g: '10°', nts: {} }] };
  assert.equal(_tieneCambioAcademicoNoPermitidoParaRolLimitado(nuevo, viejo), false);
});

check('POST /api/inetis/db: el guard de Ronda 84 se invoca para Docente Orientador Y Tutor PTA, con 403 explicando el motivo', () => {
  const idxEndpoint = srcIndex.indexOf("app.post('/api/inetis/db'");
  const idxFin = srcIndex.indexOf('app.delete', idxEndpoint) > -1 ? srcIndex.indexOf('app.delete', idxEndpoint) : idxEndpoint + 6000;
  const bloqueEndpoint = srcIndex.slice(idxEndpoint, Math.min(idxFin, idxEndpoint + 6000));
  assert.match(bloqueEndpoint, /actorRolEspecifico === 'Tutor PTA' \|\| actorRolEspecifico === 'Docente Orientador'/);
  assert.match(bloqueEndpoint, /_tieneCambioAcademicoNoPermitidoParaRolLimitado\(data, dataVieja\)/);
  assert.match(bloqueEndpoint, /status\(403\)/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — Frontend (03-app-core.js / 06-documentos-y-resto.js): mismo
// entorno "vm" de las Rondas 74-83.
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
const SRC2_PATH = new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const src2 = fs.readFileSync(SRC2_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

check('TODOS_MODULOS incluye el nuevo módulo "ficha-inclusion" (Ficha de Inclusión / PIAR)', () => {
  assert.match(src1, /\{id:'ficha-inclusion',label:'🧩 Ficha de Inclusión \/ PIAR'\}/);
});
check('Menú lateral: "ficha-inclusion" se muestra a isAdmin o a _esDocenteOrientador() — no a Tutor PTA ni a un docente de aula normal', () => {
  assert.match(src1, /if\(\(isAdmin\|\|_esDocenteOrientador\(\)\)&&_ma\('ficha-inclusion'\)\) menu\.push\(\{id:'ficha-inclusion'/);
});
check('Enrutado de contenido: pag===\'ficha-inclusion\' solo renderiza para isAdmin o _esDocenteOrientador()', () => {
  assert.match(src1, /pag==='ficha-inclusion'&&\(isAdmin\|\|_esDocenteOrientador\(\)\)\) contenido=htmlFichaInclusion\(\)/);
});
check('htmlFichaInclusion() (vista de solo lectura) existe en 06-documentos-y-resto.js y NO contiene ningún botón de edición/borrado de PIAR', () => {
  const idxFn = src2.indexOf('function htmlFichaInclusion(){');
  assert.ok(idxFn > -1, 'no se encontró htmlFichaInclusion()');
  const idxFin = src2.indexOf('\nfunction htmlCentrosInteres(){', idxFn);
  const bloque = src2.slice(idxFn, idxFin === -1 ? idxFn + 3500 : idxFin);
  assert.doesNotMatch(bloque, /onclick="guardarFichaPIAR/, 'la vista de solo lectura no debe exponer el botón de guardado');
  // RONDA 86 — se agregaron dos <select> de FILTRO (grado / categoría) a
  // esta vista, que solo cambian qué filas se muestran (window._piarFiltroGrado/
  // _piarFiltroCategoria + renderApp()) — no escriben en "db" ni exponen el
  // formulario de edición real de la Ficha PIAR (ese sigue siendo
  // exclusivo de htmlEstudiantes()/guardarFichaPIAR(), ver más abajo). Se
  // sigue exigiendo que NO haya ningún <input> ni <textarea> (los campos de
  // edición reales), y que los únicos <select> presentes sean los dos
  // filtros nuevos, identificables por su id.
  assert.doesNotMatch(bloque, /<input|<textarea/, 'la vista de solo lectura no debe tener ningún campo de EDICIÓN (input/textarea)');
  const selects = bloque.match(/<select[^>]*>/g) || [];
  assert.equal(selects.length, 2, 'solo deben existir los 2 <select> de FILTRO (grado y categoría), ningún otro control');
  assert.ok(selects.every(s => /id="piarFiltroGradoSel"|id="piarFiltroCatSel"/.test(s)), 'los únicos <select> permitidos son los filtros de grado/categoría');
});
check('Panel de EDICIÓN de PIAR (guardarFichaPIAR, dentro de htmlEstudiantes) existe y es exclusivo del panel de Administrador', () => {
  assert.match(src1, /function guardarFichaPIAR\(\)\{/);
  assert.match(src1, /id="piarGrado"/);
  assert.match(src1, /id="piarActivo"/);
});
check('_firmaDeUsuario() existe como helper de lectura para futura estampación en documentos', () => {
  assert.match(src1, /function _firmaDeUsuario\(u\)\{/);
});

// ── Entorno "vm" funcional ──
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

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
try { vm.runInContext(src2, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }

function run(code) { return vm.runInContext(code, ctx); }

function fixtureDB(extra) {
  return Object.assign({
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 84', anio: '2026',
    config: { numPeriodos: 4, pesosPeriodos: [25,25,25,25], pctSer: 0.25, pctSaber: 0.35, pctHacer: 0.40, nomSer: 'SER', nomSaber: 'SABER', nomHacer: 'HACER', escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, mostrarInasistenciasEnPlanilla: false },
    grados: [{ n: '10°', d: 'doc1' }],
    users: [
      { u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x' },
      { u: 'orient1', r: 'docente', n: 'Orientadora Uno', p: 'x', rolEspecifico: 'Docente Orientador' },
    ],
    carga: [{ id: 101, g: '10°', m: 'Matemáticas', a: 'Matemáticas', d: 'doc1', dn: 'Docente Uno', ih: 5 }],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', g: '10°', nts: {}, observaciones: [], piar: { activo: true, categoria: 'TEA', apoyos: 'Tiempo adicional', observaciones: 'Seguimiento trimestral', actualizadoPor: 'RECTOR', fecha: '2026-02-10' } },
      { id: 'e2', n: 'BRAYAN LOPEZ', g: '10°', nts: {}, observaciones: [] },
    ],
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true, true, true, true],
    notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [],
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

check('htmlFichaInclusion(): un docente de aula NORMAL (sin rolEspecifico) recibe el mensaje de acceso restringido, no la tabla', () => {
  instalarDB(fixtureDB(), { u: 'doc1', r: 'docente', n: 'Docente Uno' });
  const html = run('htmlFichaInclusion()');
  assert.match(html, /Solo el administrador\/rector o el Docente Orientador/);
});
check('htmlFichaInclusion(): Docente Orientador SÍ ve la tabla, con los estudiantes que tienen PIAR activo, y SIN campos editables', () => {
  instalarDB(fixtureDB(), { u: 'orient1', r: 'docente', n: 'Orientadora Uno', rolEspecifico: 'Docente Orientador' });
  const html = run('htmlFichaInclusion()');
  assert.match(html, /ANA PEREZ/);
  assert.match(html, /TEA/);
  assert.doesNotMatch(html, /BRAYAN LOPEZ/, 'no debe listar estudiantes SIN PIAR activo');
  // RONDA 86 — permite los 2 <select> de FILTRO (grado/categoría, que no
  // escriben en "db"), sigue prohibiendo cualquier <input>/<textarea> real.
  assert.doesNotMatch(html, /<input|<textarea/);
  assert.match(html, /id="piarFiltroGradoSel"/);
  assert.match(html, /id="piarFiltroCatSel"/);
});
check('htmlFichaInclusion(): Admin/Rector también puede consultarla (supervisión total)', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  const html = run('htmlFichaInclusion()');
  assert.match(html, /ANA PEREZ/);
});

check('guardarFichaPIAR(): guarda correctamente los datos de la Ficha PIAR en el estudiante seleccionado', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  elementosPorId.piarEst = { value: 'e2' };
  elementosPorId.piarActivo = { checked: true };
  elementosPorId.piarCategoria = { value: 'Baja visión' };
  elementosPorId.piarApoyos = { value: 'Material ampliado' };
  elementosPorId.piarObservaciones = { value: 'Revisar cada periodo' };
  elementosPorId.piarStatus = fakeEl('div');
  run('guardarFichaPIAR()');
  const est = run("db.ests.find(e=>e.id==='e2')");
  assert.equal(est.piar.activo, true);
  assert.equal(est.piar.categoria, 'Baja visión');
  assert.equal(est.piar.apoyos, 'Material ampliado');
  assert.equal(est.piar.actualizadoPor, 'Rectora');
});

check('_optsEstudiantesGrado()/_refrescarSelectEstPIAR(): arman las opciones del <select> de estudiantes a partir del grado elegido', () => {
  instalarDB(fixtureDB(), { u: 'rector1', r: 'admin', n: 'Rectora' });
  const opts = run("_optsEstudiantesGrado('10°')");
  assert.match(opts, /value="e1"/);
  assert.match(opts, /value="e2"/);
});

check('_firmaDeUsuario(): retorna la URL de firma guardada en el usuario, o cadena vacía si no tiene', () => {
  instalarDB(fixtureDB({ users: [{ u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x', firma: 'https://res.cloudinary.com/x/firma.png' }] }), { u: 'admin1', r: 'admin', n: 'Admin' });
  assert.equal(run("_firmaDeUsuario('doc1')"), 'https://res.cloudinary.com/x/firma.png');
  assert.equal(run("_firmaDeUsuario('inexistente')"), '');
});

check('editarDocente(): el modal de "Mi Perfil"/edición incluye el bloque de subida de Firma Digital (Cloudinary, carpeta dedicada) para cualquier rol', () => {
  const idxFn = src1.indexOf('function editarDocente(u,opts){');
  const idxFin = src1.indexOf('\nasync function _guardarEdicionDocente', idxFn);
  const bloque = src1.slice(idxFn, idxFin);
  assert.match(bloque, /Firma Digital/);
  assert.match(bloque, /_edFirmaFile/);
  assert.match(bloque, /'firmas-usuarios'/);
});
check('_guardarEdicionDocente(): persiste el campo "firma" del usuario editado (mismo patrón que "foto") y limpia el archivo anterior en Cloudinary si se reemplazó', () => {
  const idxFn = src1.indexOf('async function _guardarEdicionDocente(u,modoPerfilPropio){');
  const idxFin = src1.indexOf('\nasync function eliminarDocente', idxFn);
  const bloque = src1.slice(idxFn, idxFin);
  assert.match(bloque, /firma:firmaNuevaDoc/);
  assert.match(bloque, /firmaAnteriorDoc&&firmaAnteriorDoc!==firmaNuevaDoc\)\s*_cloudinaryEliminar\(firmaAnteriorDoc\)/);
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) console.log('✅ 100% de la suite en verde.');
else console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
process.exit(fail === 0 ? 0 : 1);
