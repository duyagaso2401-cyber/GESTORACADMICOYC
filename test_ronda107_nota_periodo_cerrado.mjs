// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — Extensión del ítem 1.6: detectar y marcar cambios de nota
// ocurridos DESPUÉS de que el periodo ya estaba cerrado (db.periodosActivos
// [per-1]===false). Solo un Admin/Rector puede llegar a guardar una nota en
// esas condiciones (la Planilla ya se lo impide a cualquier otro rol), así
// que esta es exactamente la "zona gris" que el documento de mejoras pedía
// poder auditar. Se verifica que saveNota() marca el registro del log con
// periodoCerrado:true y dispara un aviso al canal de notificaciones — y que
// con el periodo ABIERTO, nada de esto se activa (comportamiento idéntico
// al de siempre).
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

check('_registrarCambioNota() calcula "periodoCerrado" a partir de db.periodosActivos[per-1]', () => {
  const idx = srcCore.indexOf('function _registrarCambioNota(d,info)');
  const idxFin = srcCore.indexOf('\nfunction _alertarCambioNotaPeriodoCerradoSiAplica', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /periodosActivos\[Number\(info\.per\)-1\]===false/);
  assert.match(bloque, /periodoCerrado/);
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
const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){}; ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800; ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() }; })();
ctx.sessionStorage = ctx.localStorage;
ctx.fetch = async (url, opts) => {
  fetchLog.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
  if (url.includes('api/inetis/db')) return { ok: true, status: 200, json: async () => ({ ok: true, version: 'x' }) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
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

function instalar(periodosActivos) {
  const d = {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 107', anio: '2026', config: { numPeriodos: 2 },
    grados: [], carga: [{ id: 1, m: 'Matemáticas', g: '5°' }],
    ests: [{ id: 'e1', n: 'Luis Gómez', g: '5°', nts: {} }],
    periodosActivos, notasAct: {}, logNotas: [],
  };
  run('db = ' + JSON.stringify(d) + ';');
  run("sesion = {u:'rector1', n:'Rectora de Prueba', r:'admin'};");
  run('window._currentPlatSK="sk-ronda107-test";');
  run("planCId='1'; planPer='1';");
  fetchLog = [];
}

await check('Con el PERIODO ABIERTO, saveNota() guarda normalmente y NO marca periodoCerrado ni avisa a nadie', () => {
  instalar([true, true]);
  run("saveNota('e1','s',4.5)");
  const log = run('db.logNotas');
  assert.equal(log.length, 1);
  assert.equal(log[0].periodoCerrado, false);
  assert.ok(!fetchLog.some(f => f.url.includes('nota-cambiada-periodo-cerrado') || (f.body && f.body.kind === 'nota-cambiada-periodo-cerrado')));
});

await check('Con el PERIODO CERRADO (caso Admin bypass), saveNota() marca periodoCerrado:true en el log', () => {
  instalar([false, true]);
  run("saveNota('e1','s',4.5)");
  const log = run('db.logNotas');
  assert.equal(log.length, 1);
  assert.equal(log[0].periodoCerrado, true);
});

await check('Con el periodo cerrado, se dispara un aviso vía /api/inetis/notify de tipo "nota-cambiada-periodo-cerrado"', () => {
  instalar([false, true]);
  run("saveNota('e1','s',4.5)");
  const aviso = fetchLog.find(f => f.body && f.body.kind === 'nota-cambiada-periodo-cerrado');
  assert.ok(aviso, 'debía enviarse un aviso con kind=nota-cambiada-periodo-cerrado');
  assert.match(aviso.body.message, /Luis Gómez/);
  assert.equal(aviso.body.meta.per, 1);
});

await check('"NUNCA LANZA" — si la notificación falla de red, saveNota() no revienta (la nota ya quedó guardada antes)', () => {
  instalar([false, true]);
  ctx.fetch = async (url) => { if (url.includes('notify')) throw new Error('red caída'); return { ok: true, json: async () => ({ ok: true }) }; };
  assert.doesNotThrow(() => { run("saveNota('e1','s',4.5)"); });
  const log = run('db.logNotas');
  assert.equal(log[0].periodoCerrado, true, 'la nota y su marca de auditoría deben quedar igual, aunque el aviso falle');
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
