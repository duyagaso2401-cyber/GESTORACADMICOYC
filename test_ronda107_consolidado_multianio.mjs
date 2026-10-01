// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — ítem 3.4: exportación consolidada multi-año para
// autoevaluación institucional (reportes tipo Pruebas Saber). A diferencia
// del "Comparativo entre Años" (solo 2 años, por grado), esto agrega TODOS
// los años disponibles en una sola tabla institucional
// (_datosConsolidadoMultiAnio()). Prueba funcional en VM.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcDocs = fs.readFileSync(new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url), 'utf8');
const srcCoreFull = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

check('htmlHistoricoAnios() muestra el botón de exportar consolidado multi-año solo cuando SÍ hay historial', () => {
  assert.match(srcDocs, /!sinHistorico\?`<button[^`]*onclick="pdfConsolidadoMultiAnio\(\)"/);
});

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

let srcCore = srcCoreFull;
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = srcCore.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM'); process.exit(1); }
srcCore = srcCore.slice(0, idxCorte);

vm.createContext(ctx);
try { vm.runInContext(srcCore, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
try { vm.runInContext(srcDocs, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

function notaUniforme(v){ return {s:v,sb:v,h:v,rec:0,niv:0}; }

const dbFixture = {
  anio: '2026',
  config: { numPeriodos: 1, pesosArea: { 'MAT': 1 }, pesosAsig: { 'MAT': { 'Matemáticas': 1 } } },
  grados: [{ n: '1A', d: '' }],
  carga: [{ id: 'c1', g: '1A', m: 'Matemáticas', a: 'MAT' }],
  ests: [
    { id: 'e1', n: 'A', g: '1A', nts: { c1: { 1: notaUniforme(4.0) } } },
    { id: 'e2', n: 'B', g: '1A', nts: { c1: { 1: notaUniforme(2.0) } } },
  ],
  historialAnios: [
    { anio: '2025', datos: {
        config: { numPeriodos: 1, pesosArea: { 'MAT': 1 }, pesosAsig: { 'MAT': { 'Matemáticas': 1 } } },
        grados: [{ n: '1A', d: '' }],
        carga: [{ id: 'cOld', g: '1A', m: 'Matemáticas', a: 'MAT' }],
        ests: [
          { id: 'eOld1', n: 'C', g: '1A', nts: { cOld: { 1: notaUniforme(5.0) } } },
          { id: 'eOld2', n: 'D', g: '1A', nts: { cOld: { 1: notaUniforme(5.0) } } },
        ],
      } },
    // Año archivado sin datos usables (debe aparecer con conDatos:false, nunca lanzar)
    { anio: '2023', datos: null },
  ],
};
run('db = ' + JSON.stringify(dbFixture) + ';');

check('Incluye el año activo Y todos los años archivados, en orden cronológico', () => {
  const filas = run('_datosConsolidadoMultiAnio()');
  const anios = filas.map(f => f.anio);
  assert.equal(anios.length, 3);
  assert.equal(anios[0], '2023');
  assert.equal(anios[1], '2025');
  assert.equal(anios[2], '2026');
});

check('Calcula el promedio institucional agregado correctamente para el año activo (2 estudiantes: 4.0 y 2.0 → promedio 3.0, 50% aprobación)', () => {
  const filas = run('_datosConsolidadoMultiAnio()');
  const f2026 = filas.find(f => f.anio === '2026');
  assert.equal(f2026.totalEst, 2);
  assert.equal(f2026.promInst, 3.0);
  assert.equal(f2026.pctAprInst, 50);
  assert.equal(f2026.pctRepInst, 50);
  assert.equal(f2026.conDatos, true);
});

check('Calcula correctamente un año archivado con 100% de aprobación', () => {
  const filas = run('_datosConsolidadoMultiAnio()');
  const f2025 = filas.find(f => f.anio === '2025');
  assert.equal(f2025.totalEst, 2);
  assert.equal(f2025.promInst, 5.0);
  assert.equal(f2025.pctAprInst, 100);
});

check('Un año archivado con datos=null se refleja como conDatos:false sin lanzar excepción', () => {
  const filas = run('_datosConsolidadoMultiAnio()');
  const f2023 = filas.find(f => f.anio === '2023');
  assert.equal(f2023.conDatos, false);
  assert.equal(f2023.totalEst, 0);
});

check('db global queda restaurado tras construir el consolidado (sin fuga de estado)', () => {
  run('_datosConsolidadoMultiAnio()');
  assert.equal(run('db.anio'), '2026');
  assert.equal(run('db.ests.length'), 2);
});

check('pdfConsolidadoMultiAnio() avisa y NO intenta generar el PDF si no hay ningún año con datos usables', () => {
  run(`
    db = { anio:'2026', config:{numPeriodos:1}, grados:[], carga:[], ests:[], historialAnios:[{anio:'2022',datos:null}] };
    window._ultimaAlertaConsolidado = null;
    window.customAlert = function(m){ window._ultimaAlertaConsolidado = m; };
    window.jspdf = { jsPDF: function(){ throw new Error('NO debería intentar crear el PDF sin datos'); } };
  `);
  run('pdfConsolidadoMultiAnio()');
  const alerta = run('window._ultimaAlertaConsolidado');
  assert.ok(alerta && alerta.length > 0, 'Debió mostrar una alerta explicando que no hay datos suficientes');
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
