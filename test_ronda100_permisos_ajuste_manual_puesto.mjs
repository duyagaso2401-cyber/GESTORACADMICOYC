// ════════════════════════════════════════════════════════════════════════
// RONDA 100 — AUDITORÍA DE PERMISOS: ajuste manual de puesto (✏️ /
// db.puestoOverrides) restringido por autoridad pedagógica sobre el grado.
//
// FALLO DETECTADO: cualquier docente con acceso de solo lectura a un
// Consolidado (ej. un docente de área que solo dicta UNA asignatura en ese
// curso) también podía ver el botón ✏️ y guardar un ajuste manual de
// puesto en grados de los que NO es responsable — rompiendo la soberanía
// del Director de Grupo/titular sobre su propio curso.
//
// MATRIZ DE PERMISOS IMPLEMENTADA (_puedeEditarPuestoManual(grado)):
//   • admin/Rectoría                         → todos los grados y sedes.
//   • Transición a 5° (primaria/preescolar)  → solo el docente TITULAR del
//     grado/grupo (modelado como grado.d, igual que el Director de Grupo).
//   • 6° a 11° (secundaria/media)            → solo el DIRECTOR DE GRUPO
//     asignado a ese grado específico (también grado.d).
//   • Cualquier otro docente (de área, sin ser titular/director en ese
//     curso) → puede seguir consultando notas/consolidados/puestos, pero
//     JAMÁS ve el ícono ✏️ ni puede guardar (doble barrera: UI + guardado).
//
// La plataforma modela "titular de primaria" y "Director de Grupo de
// secundaria" con el MISMO campo (grado.d / _gradoDirigidoPor) — por eso
// una sola función (_puedeEditarPuestoManual) cubre ambos casos de la
// matriz sin lógica separada por nivel educativo.
//
// METODOLOGÍA: mismo harness "vm" de Rondas 74-99 para probar con datos
// reales el guardado real (db.puestoOverrides) y el HTML generado por
// _celdaPuestoConAjuste(); regex sobre el código fuente para confirmar que
// las 3 capas de defensa (UI, apertura del diálogo, guardado) están
// efectivamente cableadas.
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

const srcCore = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

// ════════════════════════════════════════════════════════════════════════
// PARTE 1 — CABLEADO DE LAS 3 CAPAS DE DEFENSA (regex sobre el código)
// ════════════════════════════════════════════════════════════════════════
check('Existe _puedeEditarPuestoManual(grado): admin siempre autorizado, y para los demás roles depende de _gradoDirigidoPor(g.d,...) sobre ESE grado específico', () => {
  const idx = srcCore.indexOf('function _puedeEditarPuestoManual(grado){');
  assert.ok(idx !== -1, 'debe existir la función centralizada de permisos');
  const bloque = srcCore.slice(idx, srcCore.indexOf('\n}', idx));
  assert.match(bloque, /sesion\.r==='admin'/, 'admin debe estar autorizado en todos los grados');
  assert.match(bloque, /_gradoDirigidoPor\(g\.d,\{u:sesion\.u,n:sesion\.n\}\)/, 'para los demás, debe exigir ser el titular/Director de Grupo de ESE grado (grado.d)');
});
check('CAPA 1 (UI) — _celdaPuestoConAjuste() nunca dibuja el botón ✏️ si _puedeEditarPuestoManual(grado) es falso, incluso habiendo empate o ajuste manual vigente', () => {
  const idx = srcCore.indexOf('function _celdaPuestoConAjuste(estId,grado,puestoMostrado,empatadoForzado){');
  assert.ok(idx !== -1);
  const bloque = srcCore.slice(idx, srcCore.indexOf('\n}', idx));
  assert.match(bloque, /if\(!_puedeEditarPuestoManual\(grado\)\) return `\$\{puestoMostrado\}°`;/, 'debe cortar ANTES de construir el botón cuando no hay permiso');
});
check('CAPA 2 (apertura del diálogo) — _abrirAjustePuestoManual() vuelve a verificar el permiso al inicio, por si se invoca directamente sin pasar por el botón (ej. desde la consola del navegador)', () => {
  const idx = srcCore.indexOf('async function _abrirAjustePuestoManual(estId,grado,puestoActual){');
  assert.ok(idx !== -1);
  const bloque = srcCore.slice(idx, idx + 400);
  assert.match(bloque, /if\(!_puedeEditarPuestoManual\(grado\)\)\{/, 'debe verificar el permiso de nuevo antes de abrir customPrompt');
});
check('CAPA 3 (guardado/"backend") — _setPuestoManual(), el ÚNICO punto que escribe en db.puestoOverrides, rechaza el guardado si no hay permiso — "nunca lanza": no revienta, simplemente no persiste', () => {
  const idx = srcCore.indexOf('function _setPuestoManual(estId,grado,valor){');
  assert.ok(idx !== -1);
  const bloque = srcCore.slice(idx, srcCore.indexOf('\n}\n', idx) + 2);
  assert.match(bloque, /if\(!_puedeEditarPuestoManual\(grado\)\)\{/, 'debe validar el permiso ANTES de updDB(...)');
  const idxValidacion = bloque.indexOf('_puedeEditarPuestoManual');
  const idxUpdDB = bloque.indexOf('updDB(');
  assert.ok(idxValidacion !== -1 && idxUpdDB !== -1 && idxValidacion < idxUpdDB, 'la validación debe ejecutarse ANTES de la escritura real en la base');
});

// ════════════════════════════════════════════════════════════════════════
// PARTE 2 — VERIFICACIÓN FUNCIONAL (vm): datos reales, 3 roles distintos.
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

// customAlert()/customPrompt() reales abren un modal con DOM real (botones,
// listeners) que nuestro fakeEl/documentStub no reproduce fielmente — se
// reemplazan por versiones mínimas que solo registran la llamada, igual
// que ya hacen los harnesses de Rondas 80/85/86 para este mismo problema.
let _ultimaAlerta = null;
ctx.customAlert = (msg) => { _ultimaAlerta = msg; };
ctx.customPrompt = async () => null;

// Escenario: Grado 5° (primaria) dirigido por "laura" (titular), con
// "pedro" como docente de área (dicta una asignatura pero NO es titular) y
// "rector1" como admin. Grado 10° (secundaria) dirigido por "carla"
// (Director de Grupo), con "pedro" también dictando allí como docente de
// área no-director.
function instalarEscenarioPermisos(){
  const db = {
    nombre: 'INSTITUCIÓN EDUCATIVA TÉCNICA EN INFORMÁTICA DE SINCELEJITO', anio: '2026',
    config: { numPeriodos: 1, pctSer: 1, pctSaber: 0, pctHacer: 0, escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, pesosArea: {}, pesosAsig: {} },
    grados: [
      { n: '5°', d: 'laura' },   // titular de primaria = laura
      { n: '10°', d: 'carla' },  // Director de Grupo de secundaria = carla
    ],
    users: [
      { u: 'laura', r: 'docente', n: 'Laura Martinez', p: 'x' },
      { u: 'carla', r: 'docente', n: 'Carla Torres', p: 'x' },
      { u: 'pedro', r: 'docente', n: 'Pedro Sanchez', p: 'x' },
      { u: 'rector1', r: 'admin', n: 'Rector Uno', p: 'x' },
    ],
    carga: [
      { id: 1, g: '5°', m: 'Matemáticas', a: 'Matemáticas', d: 'laura', dn: 'Laura Martinez', ih: 5 },
      { id: 2, g: '5°', m: 'Inglés', a: 'Inglés', d: 'pedro', dn: 'Pedro Sanchez', ih: 3 },
      { id: 3, g: '10°', m: 'Física', a: 'Ciencias Naturales', d: 'carla', dn: 'Carla Torres', ih: 4 },
      { id: 4, g: '10°', m: 'Artística', a: 'Artística', d: 'pedro', dn: 'Pedro Sanchez', ih: 2 },
    ],
    ests: [
      { id: 'e1', n: 'ALVAREZ PEREZ JUAN', g: '5°', nts: { 1: { 1: { s: 4.50, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'e2', n: 'BRAVO ROJAS LUISA', g: '5°', nts: { 1: { 1: { s: 4.50, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
    ],
    puestoOverrides: {},
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true], notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [], descriptores: [],
  };
  run('db = ' + JSON.stringify(db) + ';');
  run('window._currentPlatSK="sk-verif-ronda100";');
}
function sesionComo(u, r, n) { run(`sesion = { u: ${JSON.stringify(u)}, r: ${JSON.stringify(r)}, n: ${JSON.stringify(n)} };`); }

check('admin/Rectoría tiene permiso de ajuste manual en CUALQUIER grado, incluso uno que no dirige ni dicta', () => {
  instalarEscenarioPermisos();
  sesionComo('rector1', 'admin', 'Rector Uno');
  assert.equal(run(`_puedeEditarPuestoManual('5°')`), true);
  assert.equal(run(`_puedeEditarPuestoManual('10°')`), true);
});
check('La TITULAR de primaria (laura, grado.d="laura" en 5°) SÍ tiene permiso en 5°, pero NO en 10° (un grado que no dirige)', () => {
  instalarEscenarioPermisos();
  sesionComo('laura', 'docente', 'Laura Martinez');
  assert.equal(run(`_puedeEditarPuestoManual('5°')`), true);
  assert.equal(run(`_puedeEditarPuestoManual('10°')`), false);
});
check('La DIRECTORA DE GRUPO de secundaria (carla, grado.d="carla" en 10°) SÍ tiene permiso en 10°, pero NO en 5°', () => {
  instalarEscenarioPermisos();
  sesionComo('carla', 'docente', 'Carla Torres');
  assert.equal(run(`_puedeEditarPuestoManual('10°')`), true);
  assert.equal(run(`_puedeEditarPuestoManual('5°')`), false);
});
check('EL DOCENTE DE ÁREA (pedro, dicta Inglés en 5° y Artística en 10°, pero no es titular NI director de ninguno de los dos) NO tiene permiso en NINGÚN grado, aunque sí dicta clases allí', () => {
  instalarEscenarioPermisos();
  sesionComo('pedro', 'docente', 'Pedro Sanchez');
  assert.equal(run(`_puedeEditarPuestoManual('5°')`), false, 'dictar una asignatura en el curso NO lo convierte en titular/director');
  assert.equal(run(`_puedeEditarPuestoManual('10°')`), false);
});

check('CONSULTA SIN EDICIÓN — _celdaPuestoConAjuste() le muestra a Pedro (docente de área, sin permiso) solo el número de puesto ("1°"), SIN el botón ✏️, aunque haya un empate real', () => {
  instalarEscenarioPermisos();
  sesionComo('pedro', 'docente', 'Pedro Sanchez');
  const html = run(`_celdaPuestoConAjuste('e1','5°',1,true)`); // empatadoForzado=true: SÍ hay empate real
  assert.equal(html, '1°');
  assert.doesNotMatch(html, /✏️/);
});
check('CON EDICIÓN — a Laura (titular de 5°), el mismo empate real SÍ le muestra el botón ✏️ en su propio grado', () => {
  instalarEscenarioPermisos();
  sesionComo('laura', 'docente', 'Laura Martinez');
  const html = run(`_celdaPuestoConAjuste('e1','5°',1,true)`);
  assert.match(html, /✏️/);
});
check('A Laura (titular de 5°) NO le aparece el botón ✏️ si intenta verlo para el grado 10°, que no dirige', () => {
  instalarEscenarioPermisos();
  sesionComo('laura', 'docente', 'Laura Martinez');
  const html = run(`_celdaPuestoConAjuste('e1','10°',1,true)`);
  assert.equal(html, '1°');
  assert.doesNotMatch(html, /✏️/);
});

await checkAsync('GUARDADO BLOQUEADO — _abrirAjustePuestoManual() invocado directamente por Pedro (sin permiso) en 5° NO modifica db.puestoOverrides y le avisa con un mensaje claro', async () => {
  instalarEscenarioPermisos();
  sesionComo('pedro', 'docente', 'Pedro Sanchez');
  _ultimaAlerta = null;
  await run(`_abrirAjustePuestoManual('e1','5°',1)`);
  const overrides = run('JSON.stringify(db.puestoOverrides||{})');
  assert.equal(overrides, '{}', 'no debe haberse guardado absolutamente nada en db.puestoOverrides');
  assert.ok(_ultimaAlerta && /permiso/i.test(_ultimaAlerta), 'debe mostrarle un aviso explicando que no tiene permiso');
});
check('GUARDADO BLOQUEADO A BAJO NIVEL — incluso llamando _setPuestoManual() directamente (saltándose el diálogo), Pedro NO logra persistir un ajuste en un grado que no dirige', () => {
  instalarEscenarioPermisos();
  sesionComo('pedro', 'docente', 'Pedro Sanchez');
  run(`_setPuestoManual('e1','5°',1)`);
  assert.equal(run(`_puestoManualDe('e1','5°')`), null, '_setPuestoManual debe haber rechazado silenciosamente el guardado');
});
check('GUARDADO PERMITIDO — Laura (titular de 5°) SÍ logra persistir un ajuste manual válido en su propio grado', () => {
  instalarEscenarioPermisos();
  sesionComo('laura', 'docente', 'Laura Martinez');
  run(`_setPuestoManual('e1','5°',1)`);
  assert.equal(run(`_puestoManualDe('e1','5°')`), 1);
  run(`_setPuestoManual('e1','5°',null)`); // limpieza
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
