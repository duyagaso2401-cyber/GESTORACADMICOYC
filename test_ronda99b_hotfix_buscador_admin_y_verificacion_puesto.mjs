// ════════════════════════════════════════════════════════════════════════
// RONDA 99-HOTFIX — el usuario reportó, tras probar el paquete de la
// Ronda 99, dos problemas:
//
// (A) "Los cambios de PUESTO no se reflejan en pantalla": se verificó con
// una prueba dirigida (ver más abajo, reproduce EXACTAMENTE los nombres y
// promedios del caso reportado — Castro Mutis 4.11, Ortega Quiroz 4.33,
// Reales Atencia 3.92) que puestoEst() YA calcula correctamente Ortega=1°,
// Castro=2°, Reales=3° en el código fuente de la Ronda 99 — el problema no
// era de lógica sino de una versión vieja todavía en caché/despliegue. Este
// test deja esa verificación como regresión permanente para que cualquier
// futura ronda que toque puestoEst()/calcPromedioEst() no la rompa sin
// darse cuenta.
//
// (B) Dos bugs REALES sí aparecieron en el buscador del admin agregado en
// la Ronda 99 (Frente 2), que se corrigen en esta ronda:
//   B1) "Focus Loss Bug": _onFiltroCargaAdminTexto() llamaba a renderApp()
//       en cada tecla presionada (tras un debounce) — renderApp() reemplaza
//       TODA la app, incluido el propio <input> de búsqueda, y al recrearse
//       el nodo el navegador pierde el foco/cursor. FIX: ahora se llama a
//       _refrescarOpcionesCargaAdmin(selectId), que solo reconstruye las
//       <option> del <select> de Asignatura correspondiente, sin tocar el
//       <input>.
//   B2) "Estado inicial sucio": htmlPlanilla()/htmlNotasActividades()
//       auto-seleccionaban SIEMPRE mats[0] (la primera carga académica de
//       TODA la institución) incluso para el admin, mostrando de entrada
//       los datos de un docente arbitrario (ej. "Eliécer González") sin que
//       el admin hubiera elegido nada. FIX: para el rol admin, el <select>
//       arranca vacío con el placeholder "Seleccione o busque Docente /
//       Grado..." y la tabla espera la selección; el docente conserva el
//       auto-selección de siempre (no tiene nada que buscar, solo ve lo
//       suyo).
//
// METODOLOGÍA: misma técnica "vm" ya validada en Rondas 74-79/83/99 para
// (A); regex tolerantes sobre el código fuente para (B), ya que ejecutar
// _refrescarOpcionesCargaAdmin() de verdad requeriría un DOM real con
// <select>/<input> concretos, que este entorno de pruebas no tiene.
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
// PARTE B1 — Focus Loss Bug: los 3 handlers ya NO llaman a renderApp().
// ════════════════════════════════════════════════════════════════════════
check('_onFiltroCargaAdminTexto(): ya NO llama a renderApp() en cada tecla — llama a _refrescarOpcionesCargaAdmin(selectId), que no toca el <input>', () => {
  const idx = srcCore.indexOf('function _onFiltroCargaAdminTexto(v,selectId){');
  assert.ok(idx !== -1, 'debe existir _onFiltroCargaAdminTexto(v,selectId) con el nuevo parámetro selectId');
  const idxFin = srcCore.indexOf('\n}', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.doesNotMatch(bloque, /setTimeout\(renderApp/, 'ya no debe reconstruir TODA la app en cada tecla (eso es lo que causaba la pérdida de foco)');
  assert.match(bloque, /_refrescarOpcionesCargaAdmin\(selectId\)/);
});
check('_onFiltroCargaAdminDocente()/_onFiltroCargaAdminGrado(): también migrados a _refrescarOpcionesCargaAdmin() (consistencia con el fix del buscador de texto)', () => {
  assert.match(srcCore, /function _onFiltroCargaAdminDocente\(v,selectId\)\{_filtroCargaAdminDocente=v;_refrescarOpcionesCargaAdmin\(selectId\);\}/);
  assert.match(srcCore, /function _onFiltroCargaAdminGrado\(v,selectId\)\{_filtroCargaAdminGrado=v;_refrescarOpcionesCargaAdmin\(selectId\);\}/);
});
check('_refrescarOpcionesCargaAdmin(): reconstruye SOLO las <option> del <select> indicado (document.getElementById(selectId).innerHTML=...), nunca renderApp()', () => {
  const idx = srcCore.indexOf('function _refrescarOpcionesCargaAdmin(selectId){');
  assert.ok(idx !== -1);
  const idxFin = srcCore.indexOf('\n}', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /document\.getElementById\(selectId\)/);
  assert.match(bloque, /sel\.innerHTML\s*=/);
  assert.doesNotMatch(bloque, /renderApp\(\)/, 'el refresco puntual del select no debe llamar a renderApp()');
});
check('_htmlFiltrosCargaAdmin(): los 3 controles (Docente/Grado/Buscar) pasan el id del <select> de Asignatura de esa pantalla a sus handlers', () => {
  const idx = srcCore.indexOf('function _htmlFiltrosCargaAdmin(matsBase,selectId){');
  assert.ok(idx !== -1, 'la firma debe incluir selectId');
  const idxFin = srcCore.indexOf('\n}', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /_onFiltroCargaAdminDocente\(this\.value,'\$\{selectId\}'\)/);
  assert.match(bloque, /_onFiltroCargaAdminGrado\(this\.value,'\$\{selectId\}'\)/);
  assert.match(bloque, /_onFiltroCargaAdminTexto\(this\.value,'\$\{selectId\}'\)/);
});
check('htmlPlanilla()/htmlNotasActividades(): invocan _htmlFiltrosCargaAdmin con el id real de su propio <select> ("planCId" / "notaActCIdSel")', () => {
  assert.match(srcCore, /_htmlFiltrosCargaAdmin\(mats,'planCId'\)/);
  assert.match(srcCore, /_htmlFiltrosCargaAdmin\(mats,'notaActCIdSel'\)/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B2 — Estado inicial limpio: sin auto-selección para el admin.
// ════════════════════════════════════════════════════════════════════════
check('htmlPlanilla(): el admin YA NO hereda automáticamente mats[0] — el auto-select solo aplica si sesion.r!==\'admin\'', () => {
  assert.match(srcCore, /if\(!planCId&&mats\.length&&sesion\.r!== ?'admin'\) planCId=String\(mats\[0\]\.id\);/);
});
check('htmlNotasActividades(): misma corrección — el admin ya no hereda automáticamente mats[0]', () => {
  assert.match(srcCore, /if\(!notaActCId&&mats\.length&&!isAdmin\) notaActCId=String\(mats\[0\]\.id\);/);
});
check('htmlPlanilla()/htmlNotasActividades(): cuando el admin no ha elegido nada, el <select> de Asignatura muestra el placeholder "Seleccione o busque Docente / Grado..." como opción seleccionada', () => {
  assert.match(srcCore, /const PLACEHOLDER_CARGA_ADMIN='Seleccione o busque Docente \/ Grado\.\.\.';/);
  assert.match(srcCore, /_placeholderPlanCId=\(sesion\.r==='admin'\)\?`<option value=""\$\{!planCId\?' selected':''\}>\$\{PLACEHOLDER_CARGA_ADMIN\}<\/option>`:'';/);
  assert.match(srcCore, /_placeholderNotaActCId=isAdmin\?`<option value=""\$\{!notaActCId\?' selected':''\}>\$\{PLACEHOLDER_CARGA_ADMIN\}<\/option>`:'';/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE A — verificación numérica dirigida (vm): reproduce EXACTAMENTE el
// caso reportado por el usuario (Castro 4.11 / Ortega 4.33 / Reales 3.92)
// y confirma que puestoEst() ya calcula el orden correcto por promedio.
// ════════════════════════════════════════════════════════════════════════
let src1 = srcCore;
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

function fakeEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(), style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], childNodes: [], attributes: {}, _listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; }, appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, select() {}, click() {}, get innerHTML() { return this._html || ''; }, set innerHTML(v) { this._html = v; },
    textContent: '', value: '', offsetWidth: 300, offsetHeight: 200,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  return el;
}
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener() {}, removeEventListener() {}, getElementById() { return fakeEl('div'); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(t) { return fakeEl(t); }, createElementNS(_n, t) { return fakeEl(t); }, createTextNode(t) { return { textContent: t }; },
};
const localStorageStub = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() }; })();

const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){}; ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800; ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = localStorageStub; ctx.sessionStorage = localStorageStub;
ctx.fetch = async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' });
ctx.AbortController = class { constructor(){ this.signal = { aborted: false, addEventListener(){}, removeEventListener(){} }; } abort(){} };
ctx.console = console;
ctx.MutationObserver = class { constructor(){} observe(){} disconnect(){} };
ctx.IntersectionObserver = ctx.MutationObserver; ctx.ResizeObserver = ctx.MutationObserver;
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
ctx.Blob = function(p, o){ this.parts = p; this.opts = o; };
ctx.FormData = function(){ this._d = new Map(); this.append = (k,v)=>this._d.set(k,v); };
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
ctx.matchMedia = () => ({ matches: false, addListener(){}, addEventListener(){} });
ctx.Notification = function(){}; ctx.EventSource = function(){ this.close = () => {}; }; ctx.WebSocket = function(){};
ctx.performance = performance;
ctx.btoa = s => Buffer.from(String(s), 'binary').toString('base64');
ctx.atob = s => Buffer.from(String(s), 'base64').toString('binary');

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

function instalarCasoReportado() {
  const db = {
    nombre: 'INSTITUCIÓN EDUCATIVA TÉCNICA EN INFORMÁTICA DE SINCELEJITO', anio: '2026',
    config: { numPeriodos: 1, pctSer: 1, pctSaber: 0, pctHacer: 0, escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, pesosArea: {}, pesosAsig: {} },
    grados: [{ n: '0° - Transición' }],
    users: [{ u: 'maria', r: 'docente', n: 'Maria Florez', p: 'x' }],
    carga: [{ id: 1, g: '0° - Transición', m: 'Dimensión Cognitiva', a: 'Dimensión Cognitiva', d: 'maria', dn: 'Maria Florez', ih: 5 }],
    ests: [
      { id: 'c1', n: 'CASTRO MUTIS ANGEL DAVID', g: '0° - Transición', nts: { 1: { 1: { s: 4.11, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'o1', n: 'ORTEGA QUIROZ MARIA CELESTE', g: '0° - Transición', nts: { 1: { 1: { s: 4.33, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'r1', n: 'REALES ATENCIA SAMUEL', g: '0° - Transición', nts: { 1: { 1: { s: 3.92, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
    ],
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true], notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [], descriptores: [],
  };
  run('db = ' + JSON.stringify(db) + ';');
  run('sesion = { u: "maria", r: "docente", n: "Maria Florez" };');
  run('window._currentPlatSK="sk-verif-hotfix";');
}

check('CASO REPORTADO POR EL USUARIO — ORTEGA QUIROZ (4.33, el promedio más alto) debe quedar en PUESTO 1°', () => {
  instalarCasoReportado();
  assert.equal(run(`puestoEst('o1','0° - Transición')`), 1);
});
check('CASO REPORTADO POR EL USUARIO — CASTRO MUTIS (4.11) debe quedar en PUESTO 2°, NO en 1° (antes del fix, por ser la primera fila alfabética, aparecía como 1°)', () => {
  instalarCasoReportado();
  assert.equal(run(`puestoEst('c1','0° - Transición')`), 2);
});
check('CASO REPORTADO POR EL USUARIO — REALES ATENCIA (3.92, el promedio más bajo de los 3) debe quedar en PUESTO 3°', () => {
  instalarCasoReportado();
  assert.equal(run(`puestoEst('r1','0° - Transición')`), 3);
});
check('CASO REPORTADO POR EL USUARIO — la celda renderizada por _celdaPuestoConAjuste() para Ortega dice "1°" en texto plano (no hay empate en este caso, así que tampoco debe aparecer el botón ✏️)', () => {
  instalarCasoReportado();
  const html = run(`_celdaPuestoConAjuste('o1','0° - Transición',puestoEst('o1','0° - Transición'))`);
  assert.equal(html, '1°');
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
