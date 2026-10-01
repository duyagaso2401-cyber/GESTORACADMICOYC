// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — ítem 1.8: verifica el cableado FRONTEND de la renovación
// deslizante del JWT (_intentarRenovarSesionJWT/_iniciarRenovacionSesionJWT
// en 03-app-core.js) — que llame a POST /api/auth/renovar con el Bearer
// correcto, que reemplace sesion.jwt solo cuando el servidor diga
// renovado:true, y que "nunca lance" si no hay sesión/jwt o si la llamada
// falla de red (debe seguir usando el token actual sin romper nada).
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

check('_iniciarRenovacionSesionJWT() nunca duplica el temporizador (guard sobre _intervaloRenovacionJWT)', () => {
  const idx = srcCore.indexOf('function _iniciarRenovacionSesionJWT()');
  const idxFin = srcCore.indexOf('\n}', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /if\(_intervaloRenovacionJWT\)\s*return/);
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
    textContent: '', value: '', offsetWidth: 300, offsetHeight: 200,
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
  fetchLog.push({ url, opts, headers: opts && opts.headers });
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
let _ultimoIntervalo = null;
ctx.setInterval = (fn, ms, ...a) => { _ultimoIntervalo = { fn, ms }; const t = setInterval(fn, ms, ...a); if (t.unref) t.unref(); return t; };
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

run('window._currentPlatSK="sk-ronda107-test";');

await check('Sin sesión (o sin jwt), _intentarRenovarSesionJWT() no llama a ningún endpoint', async () => {
  fetchLog = []; run('sesion = undefined;');
  await run('_intentarRenovarSesionJWT()');
  run("sesion = {u:'rector1', r:'admin'};"); // sin jwt
  await run('_intentarRenovarSesionJWT()');
  assert.equal(fetchLog.length, 0);
});

await check('Con sesión y jwt, llama a POST /api/auth/renovar con el Bearer correcto', async () => {
  run("sesion = {u:'rector1', r:'admin', jwt:'jwt-viejo'};");
  fetchRespuestas = { 'api/auth/renovar': { ok: true, renovado: false, token: 'jwt-viejo', exp: 123 } };
  fetchLog = [];
  await run('_intentarRenovarSesionJWT()');
  assert.ok(fetchLog.some(f => f.url.includes('api/auth/renovar') && f.headers['Authorization'] === 'Bearer jwt-viejo'));
});

await check('Si el servidor responde renovado:true, sesion.jwt se reemplaza por el token nuevo', async () => {
  run("sesion = {u:'rector1', r:'admin', jwt:'jwt-viejo'};");
  fetchRespuestas = { 'api/auth/renovar': { ok: true, renovado: true, token: 'jwt-NUEVO', exp: 999 } };
  await run('_intentarRenovarSesionJWT()');
  assert.equal(run('sesion.jwt'), 'jwt-NUEVO');
});

await check('Si el servidor responde renovado:false, sesion.jwt se mantiene sin cambios', async () => {
  run("sesion = {u:'rector1', r:'admin', jwt:'jwt-actual'};");
  fetchRespuestas = { 'api/auth/renovar': { ok: true, renovado: false, token: 'jwt-actual', exp: 999 } };
  await run('_intentarRenovarSesionJWT()');
  assert.equal(run('sesion.jwt'), 'jwt-actual');
});

await check('"NUNCA LANZA" — si la llamada falla de red, sesion.jwt se mantiene intacto (se sigue usando el token actual)', async () => {
  run("sesion = {u:'rector1', r:'admin', jwt:'jwt-actual'};");
  fetchRespuestas = { 'api/auth/renovar': null };
  await assert.doesNotReject(run('_intentarRenovarSesionJWT'));
  assert.equal(run('sesion.jwt'), 'jwt-actual');
});

await check('_iniciarRenovacionSesionJWT() programa un intervalo (cada 15 minutos) y nunca lo duplica en llamadas repetidas', () => {
  _ultimoIntervalo = null;
  run("sesion = {u:'rector1', r:'admin', jwt:'jwt-actual'};");
  fetchRespuestas = { 'api/auth/renovar': { ok: true, renovado: false, token: 'jwt-actual', exp: 999 } };
  run('_iniciarRenovacionSesionJWT()');
  assert.ok(_ultimoIntervalo, 'debía programar un setInterval');
  assert.equal(_ultimoIntervalo.ms, 15 * 60 * 1000);
  const primerIntervalo = run('_intervaloRenovacionJWT');
  run('_iniciarRenovacionSesionJWT()'); // segunda llamada: no debe crear un segundo intervalo
  assert.equal(run('_intervaloRenovacionJWT'), primerIntervalo);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
