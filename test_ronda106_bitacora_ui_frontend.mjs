// ════════════════════════════════════════════════════════════════════════
// RONDA 106 — Verifica el visor dentro del sistema para la Bitácora de
// Auditoría (ver detectarAccionesSensibles(), Ronda 103): hasta esta
// ronda, esos datos solo se podían consultar por API — _abrirBitacoraAuditoria()
// es la primera pantalla visual para verlos. Se prueba con fetch() real
// simulado, igual que los demás wiring tests de este proyecto.
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

check('_htmlBitacoraAuditoriaPerfil() solo se incluye en "Mi Perfil" cuando sesion.r==="admin" (mismo criterio que el bloque de 2FA)', () => {
  assert.match(srcCore, /sesion\.r==='admin'\?_htmlBitacoraAuditoriaPerfil\(\):''/);
});

check('_abrirBitacoraAuditoria() llama a GET /api/inetis/auditoria-acciones, enviando el JWT (si existe) y, de respaldo, actorRol=admin', () => {
  const idx = srcCore.indexOf('async function _abrirBitacoraAuditoria()');
  const idxFin = srcCore.indexOf('\nasync function actualizarPerfil', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /\/api\/inetis\/auditoria-acciones/);
  assert.match(bloque, /sesion\.jwt/);
  assert.match(bloque, /actorRol:'admin'/);
});

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
    // _escaparHtmlModal() en el código real (03-app-core.js) escapa texto
    // creando un <div>, asignando .textContent y leyendo de vuelta
    // .innerHTML — un truco que SOLO funciona en un DOM real, donde ambas
    // propiedades están enlazadas. Este stub las simula enlazadas de la
    // misma forma (con un escape básico de &/</>), para que esa función
    // real se comporte aquí igual que en un navegador de verdad.
    get textContent() { return this._text || ''; },
    set textContent(v) { this._text = v; this._html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    value: '', offsetWidth: 300, offsetHeight: 200,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  return el;
}
const elementosPorId = {};
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener() {}, removeEventListener() {},
  getElementById(id) { if (!elementosPorId[id]) elementosPorId[id] = fakeEl('div'); return elementosPorId[id]; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(t) { return fakeEl(t); }, createElementNS(_n, t) { return fakeEl(t); }, createTextNode(t) { return { textContent: t }; },
};
let fetchLog = [];
let fetchRespuestas = {};
function urlMatch(url) { for (const sufijo of Object.keys(fetchRespuestas)) { if (url.includes(sufijo)) return sufijo; } return null; }
const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){}; ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800; ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() }; })();
ctx.sessionStorage = ctx.localStorage;
ctx.fetch = async (url, opts) => {
  fetchLog.push({ url, opts });
  const sufijo = urlMatch(url);
  if (sufijo === null) return { ok: false, status: 404, json: async () => ({}) };
  const respuesta = fetchRespuestas[sufijo];
  if (respuesta === null) throw new Error('Fallo de red simulado');
  return { ok: true, status: 200, json: async () => respuesta };
};
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

run("window._currentPlatSK='sk-ronda106-test';");
run("sesion = {u:'rector1', n:'Rectora de Prueba', r:'admin', jwt:'jwt-de-prueba'};");

await check('Con eventos en la bitácora, se construye una tabla con la etiqueta legible de cada acción (no el código interno crudo)', async () => {
  fetchLog = [];
  fetchRespuestas = {
    'api/inetis/auditoria-acciones': { ok: true, eventos: [
      { accion: 'ajuste_puesto_manual', usuario: 'carla', usuarioNombre: 'Carla Pérez', creadoEn: '2026-10-01T10:00:00Z', detalle: { clave: '5_5°', puestoAnterior: null, puestoNuevo: { puesto: 2 } } },
      { accion: 'estudiante_eliminado', usuario: 'rector1', usuarioNombre: 'Rectora de Prueba', creadoEn: '2026-10-01T11:00:00Z', detalle: { id: 7, nombre: 'Luis Gómez' } },
    ] },
  };
  await run('_abrirBitacoraAuditoria()');
  const html = elementosPorId['_bitacoraAuditoriaContenido']._html || '';
  assert.match(html, /Ajuste manual de puesto/);
  assert.match(html, /Estudiante eliminado/);
  assert.match(html, /Carla Pérez/);
  assert.match(html, /Luis Gómez/);
  assert.ok(fetchLog.some(f => f.url.includes('auditoria-acciones') && f.opts.headers['Authorization'] === 'Bearer jwt-de-prueba'));
});

await check('Con la bitácora VACÍA, se muestra un mensaje claro en vez de una tabla vacía confusa', async () => {
  fetchRespuestas = { 'api/inetis/auditoria-acciones': { ok: true, eventos: [] } };
  await run('_abrirBitacoraAuditoria()');
  const html = elementosPorId['_bitacoraAuditoriaContenido']._html || '';
  assert.match(html, /Todavía no hay ninguna acción registrada/);
});

await check('"NUNCA LANZA" — si la consulta falla de red, se muestra un aviso de error sin reventar la pantalla', async () => {
  fetchRespuestas = { 'api/inetis/auditoria-acciones': null };
  await run('_abrirBitacoraAuditoria()');
  const html = elementosPorId['_bitacoraAuditoriaContenido']._html || '';
  assert.match(html, /No se pudo cargar la bitácora/);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
