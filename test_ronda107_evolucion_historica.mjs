// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — ítem 3.1: vista de evolución histórica del estudiante.
// _evolucionHistoricaEstudiante(estId) construye la línea de tiempo
// periodo-a-periodo del promedio general, cruzando incluso años
// archivados (db.historialAnios[]), vinculando al estudiante entre años
// por numDoc (su id interno puede cambiar de un año archivado a otro).
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

function notaUniforme(v){ return {s:v,sb:v,h:v,rec:0,niv:0}; }

vm.runInContext(src, ctx, { filename: '03-app-core.js' });
function run(code) { return vm.runInContext(code, ctx); }

// ── Año actual: grado 1A, 1 estudiante (numDoc '111'), 1 asignatura, 2 periodos ──
const dbFixture = {
  anio: '2026',
  config: { numPeriodos: 2, pesosArea: { 'MAT': 1 }, pesosAsig: { 'MAT': { 'Matemáticas': 1 } } },
  grados: [{ n: '1A', d: '' }],
  carga: [{ id: 'c1', g: '1A', m: 'Matemáticas', a: 'MAT' }],
  ests: [{ id: 'eNew2026', n: 'JUAN PEREZ', g: '1A', numDoc: '111', nts: { c1: { 1: notaUniforme(2.5), 2: notaUniforme(4.0) } } }],
  historialAnios: [
    { anio: '2024', datos: {
        config: { numPeriodos: 2, pesosArea: { 'MAT': 1 }, pesosAsig: { 'MAT': { 'Matemáticas': 1 } } },
        grados: [{ n: '1A', d: '' }],
        carga: [{ id: 'cOld', g: '1A', m: 'Matemáticas', a: 'MAT' }],
        ests: [{ id: 'eOld2024', n: 'JUAN PEREZ', g: '1A', numDoc: '111', nts: { cOld: { 1: notaUniforme(3.0), 2: notaUniforme(3.5) } } }],
      } },
    { anio: '2025', datos: {
        config: { numPeriodos: 2, pesosArea: { 'MAT': 1 }, pesosAsig: { 'MAT': { 'Matemáticas': 1 } } },
        grados: [{ n: '1A', d: '' }],
        carga: [{ id: 'cOld2', g: '1A', m: 'Matemáticas', a: 'MAT' }],
        ests: [{ id: 'eOld2025', n: 'JUAN PEREZ', g: '1A', numDoc: '111', nts: { cOld2: { 1: notaUniforme(2.0), 2: notaUniforme(2.8) } } }],
      } },
    // Año archivado SIN datos usables (debe omitirse sin lanzar excepción)
    { anio: '2023', datos: null },
    // Año archivado con OTRO estudiante (numDoc distinto, no debe mezclarse)
    { anio: '2022', datos: {
        config: { numPeriodos: 2 }, grados: [{ n: '1A', d: '' }],
        carga: [{ id: 'cX', g: '1A', m: 'Matemáticas', a: 'MAT' }],
        ests: [{ id: 'eOtro', n: 'OTRO ALUMNO', g: '1A', numDoc: '999', nts: { cX: { 1: notaUniforme(5) } } }],
      } },
  ],
};
run('db = ' + JSON.stringify(dbFixture) + ';');

check('Devuelve [] si el estudiante no existe (nunca lanza)', () => {
  assert.equal(run("_evolucionHistoricaEstudiante('no-existe').length"), 0);
});

check('Incluye los periodos del año actual (2026)', () => {
  const puntos = run("_evolucionHistoricaEstudiante('eNew2026')");
  const actuales = puntos.filter(p => p.anio === '2026');
  assert.equal(actuales.length, 2);
  assert.equal(actuales[0].prom, 2.5);
  assert.equal(actuales[1].prom, 4.0);
});

check('Cruza años archivados vinculando por numDoc, en orden cronológico ascendente', () => {
  const puntos = run("_evolucionHistoricaEstudiante('eNew2026')");
  const anios = puntos.map(p => p.anio);
  // 2024 y 2025 deben aparecer ANTES que 2026, y en ese orden entre sí
  assert.ok(anios.indexOf('2024') < anios.indexOf('2025'));
  assert.ok(anios.indexOf('2025') < anios.indexOf('2026'));
  const p2024 = puntos.filter(p => p.anio === '2024');
  assert.equal(p2024[0].prom, 3.0);
  assert.equal(p2024[1].prom, 3.5);
});

check('NO mezcla el historial de otro estudiante con distinto numDoc', () => {
  const puntos = run("_evolucionHistoricaEstudiante('eNew2026')");
  assert.ok(!puntos.some(p => p.anio === '2022'));
});

check('Un año archivado con datos=null se omite sin lanzar excepción', () => {
  assert.doesNotThrow(() => run("_evolucionHistoricaEstudiante('eNew2026')"));
});

check('db global queda restaurado a su valor original tras recorrer los años archivados (no hay fuga de estado)', () => {
  run("_evolucionHistoricaEstudiante('eNew2026')");
  assert.equal(run('db.anio'), '2026');
  assert.equal(run('db.ests.length'), 1);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
