// ════════════════════════════════════════════════════════════════════════
// RONDA 108 — bug real reportado por el usuario tras usar el sistema: al
// sincronizar el promedio de "Notas de Actividades en Clase" con una
// columna de la Planilla (_confirmarSyncNAC), solo una PARTE de los
// estudiantes quedaba reflejada tras cerrar/reabrir sesión — había que
// repetir la sincronización. Causa raíz: la función tocaba varios
// estudiantes en un solo updDB() SIN marcar el lote de filas afectadas
// (window._loteFilasEnEdicion), cayendo al guardado monolítico del blob
// completo (_pushDB, llamado además manualmente) en vez de la cola
// granular fila-por-fila — exactamente la condición de carrera que la
// Ronda 71 ya había corregido en TODAS las funciones hermanas
// (aplicarReplicaNotaAct, sincronizarAsistenciaASER, etc.).
// Esta prueba verifica que _confirmarSyncNAC ahora sigue el mismo patrón.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcFull = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

check('_confirmarSyncNAC ya NO llama a _pushDB() manualmente (eso era lo que causaba el guardado monolítico que colisionaba con la cola granular)', () => {
  const idx = srcFull.indexOf('function _confirmarSyncNAC');
  const idxFin = srcFull.indexOf('\nfunction ', idx + 10);
  const bloque = srcFull.slice(idx, idxFin === -1 ? idx + 3000 : idxFin);
  assert.doesNotMatch(bloque, /\n\s*_pushDB\(\);/);
});

check('_confirmarSyncNAC marca el lote de filas afectadas (tipo:\'planilla\') ANTES de que updDB() termine, igual que sus funciones hermanas', () => {
  const idx = srcFull.indexOf('function _confirmarSyncNAC');
  const idxFin = srcFull.indexOf('\nfunction ', idx + 10);
  const bloque = srcFull.slice(idx, idxFin === -1 ? idx + 3000 : idxFin);
  assert.match(bloque, /_filasAfectadas\.push\(\{tipo:'planilla',estId:est\.id,cId,per\}\)/);
  assert.match(bloque, /if\(_filasAfectadas\.length\) _marcarLoteFilasEnEdicion\(_filasAfectadas\);/);
  assert.match(bloque, /_desmarcarLoteFilasEnEdicion\(\);/);
});

const marker = 'render();\n// Inyectar widget IA';
const idxCorte = srcFull.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM'); process.exit(1); }
const src = srcFull.slice(0, idxCorte);

function fakeEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(), style: {}, dataset: {}, attributes: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], childNodes: [], _listeners: {},
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
const htmlEl = fakeEl('html');
const documentStub = {
  body: fakeEl('body'), documentElement: htmlEl, readyState: 'complete', _listeners: {},
  addEventListener() {}, removeEventListener() {},
  getElementById() { return fakeEl('div'); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(t) { return fakeEl(t); }, createElementNS(_n, t) { return fakeEl(t); }, createTextNode(t) { return { textContent: t }; },
};
const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){}; ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800; ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() }; })();
ctx.sessionStorage = ctx.localStorage;
ctx.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
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
ctx.alert = () => {}; ctx.confirm = () => true; ctx.prompt = () => null;
ctx.Image = function(){ return fakeEl('img'); };
ctx.FileReader = function(){ return { readAsDataURL(){}, readAsText(){} }; };
ctx.Blob = function(p, o){ this.parts = p; this.opts = o; };
ctx.FormData = function(){ this._d = new Map(); this.append = (k,v)=>this._d.set(k,v); };
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2), ...(globalThis.crypto && globalThis.crypto.subtle ? { subtle: globalThis.crypto.subtle, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) } : {}) };
ctx.TextEncoder = TextEncoder; ctx.TextDecoder = TextDecoder;
ctx.Uint8Array = Uint8Array; ctx.ArrayBuffer = ArrayBuffer; ctx.DataView = DataView;
ctx.matchMedia = () => ({ matches: false, addListener(){}, addEventListener(){} });
ctx.Notification = function(){}; ctx.EventSource = function(){ this.close = () => {}; }; ctx.WebSocket = function(){};
ctx.performance = performance;
ctx.btoa = s => Buffer.from(String(s), 'binary').toString('base64');
ctx.atob = s => Buffer.from(String(s), 'base64').toString('binary');

vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

const dbFixture = {
  anio: '2026',
  config: { numPeriodos: 2 },
  carga: [{ id: 1, g: '1A', m: 'Matemáticas', d: 'doc1' }],
  ests: Array.from({ length: 6 }, (_, i) => ({ id: 'e' + (i + 1), n: 'EST ' + (i + 1), g: '1A', nts: {} })),
  notasActColumnas: [{ id: 'col1', nom: 'Taller 1' }],
  notasActAsignadas: { '1_1': ['col1'] },
  notasAct: Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => ['1_1_col1_e' + (i + 1), { valor: 4.5 }])
  ),
};
run('db = ' + JSON.stringify(dbFixture) + ';');
run("notaActCId='1'; notaActPer='1';");
// customAlert() real abre un modal casero cuyo cierre depende de
// overlay.querySelector(), que nuestro stub mínimo de DOM (pensado para
// probar lógica, no UI) no simula por completo — se reemplaza por un
// stub de registro simple, igual que en otras pruebas de esta ronda.
run("window.customAlert = function(msg){ window._ultimoAlertNAC = msg; return Promise.resolve(true); };");

check('_confirmarSyncNAC marca window._loteFilasEnEdicion con una fila por CADA estudiante del grado durante el updDB() (nunca se queda sin marcar a mitad de camino)', () => {
  // Interceptamos _marcarLoteFilasEnEdicion para capturar exactamente lo
  // que se le pasó DURANTE la ejecución de updDB() — antes de que
  // _desmarcarLoteFilasEnEdicion() lo borre justo después.
  run(`
    window._loteCapturado = null;
    window._marcarLoteFilasEnEdicion = function(lista){ window._loteCapturado = lista; };
  `);
  run("_confirmarSyncNAC('s')");
  const lote = run('window._loteCapturado');
  assert.ok(lote, 'Debió llamar a _marcarLoteFilasEnEdicion con un lote no vacío');
  assert.equal(lote.length, 6, 'Debió marcar una fila por cada uno de los 6 estudiantes del grado');
  const estsEnLote = new Set(lote.map(f => f.estId));
  for (let i = 1; i <= 6; i++) assert.ok(estsEnLote.has('e' + i), 'Falta el estudiante e' + i + ' en el lote');
});

check('_confirmarSyncNAC efectivamente escribe la nota sincronizada para TODOS los estudiantes del grado en db.ests[].nts', () => {
  run('db = ' + JSON.stringify(dbFixture) + ';');
  run("notaActCId='1'; notaActPer='1';");
  run("_confirmarSyncNAC('s')");
  for (let i = 1; i <= 6; i++) {
    const s = run(`db.ests.find(e=>e.id==='e${i}').nts['1']['1'].s`);
    assert.equal(s, 4.5, 'El estudiante e' + i + ' debió recibir la nota sincronizada (4.5) en la columna "s"');
  }
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
