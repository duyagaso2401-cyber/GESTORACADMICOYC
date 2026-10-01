// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — ítem 4.3: modo "compacto" para tablas grandes. Mismo patrón
// que el Modo Oscuro (atributo en <html>, persistido en localStorage,
// botones con data-* para refrescar su texto). Prueba funcional en VM +
// verificación estática de que el botón aparece en las pantallas clave.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
async function check(desc, fn) {
  try { await fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcCore = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');
const srcDocs = fs.readFileSync(new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./gestor-academico/dist/portal.html', import.meta.url), 'utf8');

check('El botón de densidad aparece junto al de Modo Oscuro en las 4 pantallas ya identificadas (admin/docente x2, portal del padre, portal del estudiante)', () => {
  const botonesCore = (srcCore.match(/<button[^>]*data-densidad-toggle/g) || []).length;
  const botonesDocs = (srcDocs.match(/<button[^>]*data-densidad-toggle/g) || []).length;
  assert.equal(botonesCore, 2);
  assert.equal(botonesDocs, 2);
});

check('El bootstrap de portal.html restaura la densidad guardada ANTES del primer pintado (evita el "salto" de tamaño)', () => {
  assert.match(html, /localStorage\.getItem\('gestorYcDensidad'\)/);
  assert.match(html, /data-densidad','compacta'/);
});

check('Existen las reglas CSS de modo compacto para table/th/td', () => {
  assert.match(html, /html\[data-densidad="compacta"\] table\{font-size:0\.74rem!important\}/);
  assert.match(html, /html\[data-densidad="compacta"\] td\{/);
});

let src1 = srcCore;
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = src1.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM'); process.exit(1); }
src1 = src1.slice(0, idxCorte);

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
  querySelector() { return null; }, querySelectorAll(sel) { return sel === '[data-densidad-toggle]' ? [fakeEl('button')] : []; },
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
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

await check('_densidadActual() es "comoda" por defecto (sin atributo en <html>)', () => {
  assert.equal(run('_densidadActual()'), 'comoda');
});

await check('toggleDensidadTabla() activa data-densidad="compacta" y lo guarda en localStorage', () => {
  run('toggleDensidadTabla()');
  assert.equal(htmlEl.getAttribute('data-densidad'), 'compacta');
  assert.equal(run("localStorage.getItem('gestorYcDensidad')"), 'compacta');
  assert.equal(run('_densidadActual()'), 'compacta');
});

await check('toggleDensidadTabla() de nuevo vuelve a "cómoda" (quita el atributo)', () => {
  run('toggleDensidadTabla()');
  assert.equal(htmlEl.getAttribute('data-densidad'), null);
  assert.equal(run("localStorage.getItem('gestorYcDensidad')"), 'comoda');
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
