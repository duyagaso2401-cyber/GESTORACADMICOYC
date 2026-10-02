// ════════════════════════════════════════════════════════════════════════
// RONDA 108 — el usuario reportó que las alertas de "estado de los
// estudiantes" (Panel de Novedades: ausencias, notas bajas, observaciones)
// se seguían mostrando al iniciar sesión como docente, y pidió que vivieran
// en una sección propia a la que entre cuando él decida, no de frente en
// cada login. Se sacó _htmlPanelNovedades() de dentro de htmlPanelDocente()
// (la pantalla de aterrizaje forzada al iniciar sesión) y se movió a una
// página nueva, independiente, "novedades-docente" ("🔔 Mis Novedades"),
// con su propio ítem de menú.
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

check('htmlPanelDocente() (la pantalla de aterrizaje al iniciar sesión) YA NO incrusta el Panel de Novedades', () => {
  // Se busca la llamada LITERAL que existía antes (no basta con buscar el
  // nombre de la función en todo el archivo, porque el comentario de la
  // función nueva htmlNovedadesDocente(), justo debajo, lo menciona a
  // propósito como explicación).
  assert.doesNotMatch(srcFull, /mats\.length&&typeof _htmlPanelNovedades==='function'\?_htmlPanelNovedades\(sesion\.u\):''/);
});

check('Existe una función dedicada htmlNovedadesDocente() que sí renderiza el Panel de Novedades', () => {
  const idx = srcFull.indexOf('function htmlNovedadesDocente');
  assert.ok(idx !== -1, 'Debió existir la función htmlNovedadesDocente');
  const idxFin = srcFull.indexOf('\nfunction ', idx + 10);
  const bloque = srcFull.slice(idx, idxFin === -1 ? idx + 1000 : idxFin);
  assert.match(bloque, /_htmlPanelNovedades\(sesion\.u\)/);
});

check('El menú lateral del docente incluye un ítem separado "novedades-docente" ("🔔 Mis Novedades")', () => {
  assert.match(srcFull, /menu\.splice\(1,0,\{id:'novedades-docente',label:'🔔 Mis Novedades'\}\)/);
});

check('El despachador de páginas rutea "novedades-docente" a htmlNovedadesDocente() para el rol docente', () => {
  assert.match(srcFull, /pag==='novedades-docente'&&sesion\.r==='docente'\)\s*contenido=htmlNovedadesDocente\(\)/);
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
  // _periodoActualPorFecha(), sin cronograma configurado, cae al último
  // elemento de db.periodosActivos marcado como activo (o al último
  // periodo si no hay ninguno) — con numPeriodos:2 y sin periodosActivos
  // explícito, eso es el periodo 2. Se pone la nota baja ahí para que la
  // detección de "Notas bajas" de _htmlPanelNovedades() la encuentre,
  // sea cual sea el periodo que _periodoActualPorFecha() calcule hoy.
  ests: [{ id: 'e1', n: 'ESTUDIANTE UNO', g: '1A', nts: { '1': { '1': { s: 2, sb: 2, h: 2, rec: 0, niv: 0 }, '2': { s: 2, sb: 2, h: 2, rec: 0, niv: 0 } } }, observaciones: [] }],
  asistencia: [],
};
run('db = ' + JSON.stringify(dbFixture) + ';');
run("sesion = {u:'doc1', n:'PROFESOR UNO', r:'docente'};");

check('htmlPanelDocente() en tiempo de ejecución NO contiene el texto del Panel de Novedades', () => {
  const html = run('htmlPanelDocente()');
  assert.doesNotMatch(html, /Panel de Novedades/);
});

check('htmlNovedadesDocente() en tiempo de ejecución SÍ contiene el Panel de Novedades y refleja la nota baja del estudiante', () => {
  const html = run('htmlNovedadesDocente()');
  assert.match(html, /Panel de Novedades/);
  assert.match(html, /Notas bajas/);
  assert.match(html, /ESTUDIANTE UNO/);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
