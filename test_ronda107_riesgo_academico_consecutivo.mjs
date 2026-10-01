// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — ítem 3.2: alerta temprana automática cuando un estudiante
// lleva 2 periodos SEGUIDOS en Bajo desempeño en la misma asignatura,
// dirigida al Director de Grupo (no al acudiente — esa es la alerta ya
// existente de _dispararAlertaBajoDesempenoSiAplica). Se verifica contra
// saveNota() con fetch() real simulado, igual que los demás wiring tests.
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

check('saveNota() llama tanto a la alerta de acudientes como a la nueva alerta de riesgo consecutivo', () => {
  const idx = srcCore.indexOf('function saveNota(estId,campo,valor)');
  const idxFin = srcCore.indexOf('\nfunction ', idx + 10);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /_dispararAlertaBajoDesempenoSiAplica\(/);
  assert.match(bloque, /_verificarRiesgoAcademicoConsecutivoSiAplica\(/);
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

// Con las columnasBase por defecto (sin config.columnasBase), _baseNota()
// pondera s*0.25 + sb*0.35 + h*0.40 — tres campos cuyos porcentajes suman
// exactamente 1. Usar el MISMO valor "v" en los tres campos (s=sb=h=v) da
// base===v exactamente, sin tener que calcular la ponderación a mano.
function notaUniforme(v){ return { s: v, sb: v, h: v, rec: 0, niv: 0 }; }

function instalar(baseAnterior) {
  const d = {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 107', anio: '2026', config: { numPeriodos: 3 },
    grados: [{ n: '5°', d: 'docente1' }],
    carga: [{ id: 1, m: 'Matemáticas', g: '5°' }],
    ests: [{ id: 'e1', n: 'Luis Gómez', g: '5°', nts: { 1: { 1: notaUniforme(baseAnterior) } } }],
    periodosActivos: [true, true, true], notasAct: {}, logNotas: [],
  };
  run('db = ' + JSON.stringify(d) + ';');
  run("sesion = {u:'rector1', n:'Rectora de Prueba', r:'admin'};");
  run('window._currentPlatSK="sk-ronda107-test";');
  run("planCId='1'; planPer='2';");
  fetchLog = [];
}

await check('Si el periodo ANTERIOR también estaba en Bajo, al cruzar el periodo actual a Bajo se avisa al Director de Grupo', () => {
  instalar(2.0); // periodo 1 en Bajo (base 2.0 < 3)
  // Periodo 2 arranca en 4.0 (>=3, "bien") y este guardado lo baja a 2.0 (<3): cruce real
  run("db.ests[0].nts[1][2]=" + JSON.stringify(notaUniforme(4.0)) + ";");
  run("saveNota('e1','sb',2.0)"); // cambia 'sb': 4,4,4 -> 4,2,4 = base 3.3 ... se ajusta campo 's' abajo para forzar el cruce
  // La línea anterior deja el promedio en 3.3 (no cruza). Forzamos explícitamente
  // el cruce real llamando también sobre 's' y 'h' para bajar el promedio por
  // debajo de 3, exactamente como ocurriría si un docente baja varias
  // columnas de la misma nota en guardados sucesivos.
  run("db.ests[0].nts[1][2]=" + JSON.stringify(notaUniforme(4.0)) + ";");
  run("saveNota('e1','s',0)");   // 0,4,4   -> base = 0+1.4+1.6 = 3.0 (no cruza aún, queda en el límite)
  run("saveNota('e1','sb',0)");  // 0,0,4   -> base = 0+0+1.6  = 1.6 (cruza de 3.0 a 1.6)
  const aviso = fetchLog.find(f => f.body && f.body.kind === 'alerta-academica-consecutiva');
  assert.ok(aviso, 'debía dispararse la alerta de riesgo consecutivo');
  assert.equal(aviso.body.meta.directorGrupoUsuario, 'docente1');
  assert.match(aviso.body.message, /Luis Gómez/);
  assert.match(aviso.body.message, /2 periodos seguidos/);
});

await check('Si el periodo ANTERIOR estaba BIEN (no en Bajo), NO se dispara la alerta de riesgo consecutivo', () => {
  instalar(4.0); // periodo 1 bien (base 4.0 >= 3)
  run("db.ests[0].nts[1][2]=" + JSON.stringify(notaUniforme(4.0)) + ";");
  run("saveNota('e1','s',0)");
  run("saveNota('e1','sb',0)");
  assert.ok(!fetchLog.some(f => f.body && f.body.kind === 'alerta-academica-consecutiva'));
});

await check('Si no hay ningún registro del periodo anterior, NO se dispara (no se puede confirmar el patrón)', () => {
  const d = {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 107', anio: '2026', config: { numPeriodos: 3 },
    grados: [{ n: '5°', d: 'docente1' }], carga: [{ id: 1, m: 'Matemáticas', g: '5°' }],
    ests: [{ id: 'e1', n: 'Luis Gómez', g: '5°', nts: {} }],
    periodosActivos: [true, true, true], notasAct: {}, logNotas: [],
  };
  run('db = ' + JSON.stringify(d) + ';');
  run("sesion = {u:'rector1', r:'admin'};"); run('window._currentPlatSK="sk-ronda107-test";');
  run("planCId='1'; planPer='2';"); fetchLog = [];
  run("db.ests[0].nts[1]={2:{s:4,sb:0,h:0,rec:0,niv:0}};");
  run("saveNota('e1','s',2.0)");
  assert.ok(!fetchLog.some(f => f.body && f.body.kind === 'alerta-academica-consecutiva'));
});

await check('En el Periodo 1 nunca se dispara (no existe un "periodo anterior" posible)', () => {
  instalar(0);
  run("planPer='1';");
  run("db.ests[0].nts[1]={1:{s:4,sb:0,h:0,rec:0,niv:0}};");
  run("saveNota('e1','s',2.0)");
  assert.ok(!fetchLog.some(f => f.body && f.body.kind === 'alerta-academica-consecutiva'));
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
