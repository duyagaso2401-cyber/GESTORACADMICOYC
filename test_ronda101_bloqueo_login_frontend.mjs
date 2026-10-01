// ════════════════════════════════════════════════════════════════════════
// RONDA 101 — Verifica el cableado FRONTEND del bloqueo de cuenta tras
// intentos fallidos de login: doLogin() debe consultar el estado de
// bloqueo ANTES de comparar la contraseña, registrar el fallo cuando la
// contraseña no coincide, y limpiar el contador tras un login exitoso —
// todo con fetch() real simulado (stub controlado), reproduciendo los 3
// escenarios completos: cuenta ya bloqueada, credenciales incorrectas
// (con y sin bloqueo resultante) y login correcto.
//
// El motor de decisión (cuántos intentos, cuánto dura el bloqueo) vive en
// el servidor y ya se probó por separado, sin red, en
// test_ronda101_bloqueo_cuenta_login.ts — aquí se verifica que el
// NAVEGADOR llama a los endpoints correctos, en el orden correcto, y
// reacciona correctamente a cada respuesta posible.
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

check('Existen los 3 helpers _consultarBloqueoLogin/_registrarFalloLogin/_registrarExitoLogin, cada uno llamando al endpoint correcto', () => {
  assert.match(srcCore, /async function _consultarBloqueoLogin\(usuario\)\{[\s\S]{0,300}?\/api\/inetis\/login-estado/);
  assert.match(srcCore, /async function _registrarFalloLogin\(usuario\)\{[\s\S]{0,300}?\/api\/inetis\/login-fallido/);
  assert.match(srcCore, /function _registrarExitoLogin\(usuario\)\{[\s\S]{0,300}?\/api\/inetis\/login-exitoso/);
});
check('doLogin() consulta _consultarBloqueoLogin(u) ANTES de llamar a _verificarPassword (el orden importa: nunca debe intentar comparar la contraseña de una cuenta ya bloqueada)', () => {
  const idx = srcCore.indexOf('async function doLogin(){');
  const idxFin = srcCore.indexOf('\n}', idx);
  const bloque = srcCore.slice(idx, idxFin);
  const idxConsulta = bloque.indexOf('_consultarBloqueoLogin');
  const idxVerificar = bloque.indexOf('_verificarPassword');
  assert.ok(idxConsulta !== -1 && idxVerificar !== -1, 'ambas llamadas deben existir dentro de doLogin()');
  assert.ok(idxConsulta < idxVerificar, 'la consulta de bloqueo debe ejecutarse ANTES de verificar la contraseña');
});
check('doLogin() solo llama a _consultarBloqueoLogin si el usuario existe (no gasta una petición de red por un usuario inexistente)', () => {
  const idx = srcCore.indexOf('async function doLogin(){');
  const idxFin = srcCore.indexOf('\n}', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /if\(user\)\{\s*const estadoBloqueo=await _consultarBloqueoLogin\(u\);/);
});

// ════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN FUNCIONAL (vm): fetch() real simulado, 4 escenarios completos.
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
// Stub de los 3 <select>/<input> que lee doLogin() por id: lRol/lUser/lPass.
const camposLogin = { lRol: 'docente', lUser: '', lPass: '' };
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener() {}, removeEventListener() {},
  getElementById(id) {
    if (id === 'lRol' || id === 'lUser' || id === 'lPass') return { value: camposLogin[id] };
    return fakeEl('div');
  },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(t) { return fakeEl(t); }, createElementNS(_n, t) { return fakeEl(t); }, createTextNode(t) { return { textContent: t }; },
};
const localStorageStub = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() }; })();

// Registro de TODAS las llamadas a fetch(), para poder verificar qué
// endpoints se llamaron y en qué orden, además de controlar la respuesta.
let fetchLog = [];
let fetchRespuestas = {}; // url-suffix -> objeto de respuesta (o null para simular fallo de red)
function urlMatch(url) {
  for (const sufijo of Object.keys(fetchRespuestas)) { if (url.includes(sufijo)) return sufijo; }
  return null;
}
const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){}; ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800; ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = localStorageStub; ctx.sessionStorage = localStorageStub;
ctx.fetch = async (url, opts) => {
  fetchLog.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
  const sufijo = urlMatch(url);
  if (sufijo === null) return { ok: false, status: 404, json: async () => ({}) };
  const respuesta = fetchRespuestas[sufijo];
  if (respuesta === null) throw new Error('Fallo de red simulado'); // "nunca lanza": el código debe sobrevivir esto
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
ctx.speechSynthesis = null; ctx.SpeechSynthesisUtterance = function(){};
ctx.alert = () => {}; ctx.confirm = () => true; ctx.prompt = () => null;
ctx.Image = function(){ return fakeEl('img'); };
ctx.FileReader = function(){ return { readAsDataURL(){}, readAsText(){} }; };
ctx.Blob = function(p, o){ this.parts = p; this.opts = o; };
ctx.FormData = function(){ this._d = new Map(); this.append = (k,v)=>this._d.set(k,v); };
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2), ...(globalThis.crypto && globalThis.crypto.subtle ? { subtle: globalThis.crypto.subtle, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) } : {}) };
// _hashPassword()/_verificarPassword() (PBKDF2 real) necesitan estas APIs
// de la Web Platform, que un vm.createContext() no trae por defecto.
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

let _ultimaAlerta = null;
ctx.customAlert = (msg) => { _ultimaAlerta = msg; };

function instalarInstitucion() {
  const db = {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 101', anio: '2026',
    config: { numPeriodos: 1, pctSer: 1, pctSaber: 0, pctHacer: 0, escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, pesosArea: {}, pesosAsig: {} },
    grados: [], users: [], carga: [], ests: [], puestoOverrides: {},
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true], notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [], descriptores: [],
  };
  run('db = ' + JSON.stringify(db) + ';');
  run('sesion = null;');
  run('window._currentPlatSK="sk-ronda101-test";');
}
async function crearUsuarioConPassword(u, p) {
  // Usa el mismo helper real de hash que usa el sistema (PBKDF2), para que
  // _verificarPassword() compare contra un hash genuino, no un valor falso.
  const hash = await run(`_hashPassword(${JSON.stringify(p)})`);
  run(`db.users.push({u:${JSON.stringify(u)}, r:'docente', n:'Docente de Prueba', p:${JSON.stringify(hash)}});`);
}
function prepararCampos(u, p, rol = 'docente') {
  camposLogin.lRol = rol; camposLogin.lUser = u; camposLogin.lPass = p;
}

await check('ESCENARIO 1 — cuenta ya bloqueada: doLogin() NUNCA llega a comparar la contraseña, muestra el aviso con los minutos restantes, y NO llama a login-fallido', async () => {
  instalarInstitucion();
  await crearUsuarioConPassword('doc1', 'claveCorrecta123');
  prepararCampos('doc1', 'cualquier-cosa'); // contraseña deliberadamente incorrecta, para probar que ni siquiera se evalúa
  fetchLog = [];
  fetchRespuestas = { 'login-estado': { bloqueado: true, minutosRestantes: 7, intentosRestantes: 0, maxIntentos: 5 } };
  _ultimaAlerta = null;
  await run('doLogin()');
  assert.ok(_ultimaAlerta && /bloqueada temporalmente/.test(_ultimaAlerta) && /7 minuto/.test(_ultimaAlerta));
  const llamoFallido = fetchLog.some(f => f.url.includes('login-fallido'));
  assert.equal(llamoFallido, false, 'no debe registrar un fallo adicional si ya estaba bloqueada');
  assert.equal(run('sesion'), null, 'no debe iniciar sesión');
});

await check('ESCENARIO 2 — contraseña incorrecta (cuenta NO bloqueada aún): se registra el fallo en el servidor y se muestra cuántos intentos quedan', async () => {
  instalarInstitucion();
  await crearUsuarioConPassword('doc2', 'claveCorrecta123');
  prepararCampos('doc2', 'claveIncorrecta');
  fetchLog = [];
  fetchRespuestas = {
    'login-estado': { bloqueado: false, minutosRestantes: 0, intentosRestantes: 5, maxIntentos: 5 },
    'login-fallido': { bloqueado: false, minutosRestantes: 0, intentosRestantes: 2, maxIntentos: 5 },
  };
  _ultimaAlerta = null;
  await run('doLogin()');
  assert.ok(_ultimaAlerta && /Credenciales incorrectas/.test(_ultimaAlerta) && /2 intento/.test(_ultimaAlerta));
  assert.ok(fetchLog.some(f => f.url.includes('login-fallido') && f.body.usuario === 'doc2'));
  assert.equal(run('sesion'), null);
});

await check('ESCENARIO 3 — el intento que AGOTA el límite: el servidor responde bloqueado=true y doLogin() lo comunica claramente en el mismo momento del fallo', async () => {
  instalarInstitucion();
  await crearUsuarioConPassword('doc3', 'claveCorrecta123');
  prepararCampos('doc3', 'claveIncorrecta');
  fetchRespuestas = {
    'login-estado': { bloqueado: false, minutosRestantes: 0, intentosRestantes: 1, maxIntentos: 5 },
    'login-fallido': { bloqueado: true, minutosRestantes: 15, intentosRestantes: 0, maxIntentos: 5 },
  };
  _ultimaAlerta = null;
  await run('doLogin()');
  assert.ok(_ultimaAlerta && /bloqueada temporalmente/.test(_ultimaAlerta) && /15 minuto/.test(_ultimaAlerta));
});

await check('ESCENARIO 4 — login CORRECTO: se registra el éxito (limpiando el contador) y la sesión se inicia con total normalidad', async () => {
  instalarInstitucion();
  await crearUsuarioConPassword('doc4', 'claveCorrecta123');
  prepararCampos('doc4', 'claveCorrecta123');
  fetchLog = [];
  fetchRespuestas = {
    'login-estado': { bloqueado: false, minutosRestantes: 0, intentosRestantes: 5, maxIntentos: 5 },
    'login-exitoso': { ok: true },
    'notify': { ok: true },
  };
  _ultimaAlerta = null;
  await run('doLogin()');
  assert.equal(_ultimaAlerta, null, 'no debe mostrarse ninguna alerta en un login correcto');
  const sesionActual = run('sesion');
  assert.ok(sesionActual && sesionActual.u === 'doc4', 'la sesión debe quedar iniciada');
  assert.ok(fetchLog.some(f => f.url.includes('login-exitoso') && f.body.usuario === 'doc4'));
});

await check('"NUNCA LANZA" — si /api/inetis/login-estado falla de red (servidor caído), el login sigue funcionando con normalidad (no se bloquea a nadie por un problema de infraestructura)', async () => {
  instalarInstitucion();
  await crearUsuarioConPassword('doc5', 'claveCorrecta123');
  prepararCampos('doc5', 'claveCorrecta123');
  fetchRespuestas = { 'login-estado': null, 'login-exitoso': null }; // null = fetch() lanza una excepción (red caída)
  _ultimaAlerta = null;
  await run('doLogin()');
  assert.equal(_ultimaAlerta, null, 'un fallo de red en la consulta de bloqueo NO debe impedir un login con credenciales correctas');
  const sesionActual = run('sesion');
  assert.ok(sesionActual && sesionActual.u === 'doc5');
});

await check('"NUNCA LANZA" — si /api/inetis/login-fallido falla de red tras una contraseña incorrecta, igual se muestra el mensaje genérico de siempre (sin reventar ni colgar la pantalla)', async () => {
  instalarInstitucion();
  await crearUsuarioConPassword('doc6', 'claveCorrecta123');
  prepararCampos('doc6', 'claveIncorrecta');
  fetchRespuestas = { 'login-estado': { bloqueado: false, minutosRestantes: 0, intentosRestantes: 5, maxIntentos: 5 }, 'login-fallido': null };
  _ultimaAlerta = null;
  await run('doLogin()');
  assert.ok(_ultimaAlerta && /Credenciales incorrectas/.test(_ultimaAlerta));
  assert.equal(run('sesion'), null);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
