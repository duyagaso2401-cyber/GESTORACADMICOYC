// ════════════════════════════════════════════════════════════════════════
// RONDA 104 — Verifica el cableado FRONTEND de la verificación en dos
// pasos (2FA) tras moverla al servidor: _solicitarCodigo2FALogin() debe
// verificar el código contra /api/inetis/2fa/verificar (nunca localmente),
// _iniciarActivar2FA()/_iniciarDesactivar2FA() deben hablar con
// /api/inetis/2fa/configurar, /confirmar y /desactivar respectivamente, y
// el blob guardado con updDB() NUNCA debe terminar con un campo
// "tfaSecreto" — solo el booleano "tfaActivo".
//
// El algoritmo TOTP en sí (incluidos los vectores oficiales de la RFC
// 6238) ya se probó por separado, sin red, en test_ronda104_totp_servidor.ts
// — aquí se verifica que el NAVEGADOR llama a los endpoints correctos y
// reacciona correctamente a cada respuesta posible, con fetch() real
// simulado (stub controlado), igual que test_ronda101_bloqueo_login_frontend.mjs.
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

check('El secreto TOTP ya NO se genera en el navegador dentro de _iniciarActivar2FA() — se pide a /api/inetis/2fa/configurar', () => {
  const idx = srcCore.indexOf('async function _iniciarActivar2FA()');
  const idxFin = srcCore.indexOf('\nasync function _iniciarDesactivar2FA', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /\/api\/inetis\/2fa\/configurar/);
  assert.doesNotMatch(bloque, /_generarSecreto2FA\(\)/, 'no debe llamarse más a la generación local del secreto');
});

check('_iniciarActivar2FA() confirma el código contra /api/inetis/2fa/confirmar, y guarda SOLO tfaActivo en el blob (nunca tfaSecreto)', () => {
  const idx = srcCore.indexOf('async function _iniciarActivar2FA()');
  const idxFin = srcCore.indexOf('\nasync function _iniciarDesactivar2FA', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /\/api\/inetis\/2fa\/confirmar/);
  assert.match(bloque, /tfaActivo:true/);
  assert.doesNotMatch(bloque, /tfaSecreto:secreto/, 'el secreto ya no debe escribirse en el blob');
});

check('_iniciarDesactivar2FA() exige un código (ya no basta un simple customConfirm) y llama a /api/inetis/2fa/desactivar', () => {
  const idx = srcCore.indexOf('async function _iniciarDesactivar2FA()');
  const idxFin = srcCore.indexOf('\nasync function actualizarPerfil', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /customPrompt\(/);
  assert.match(bloque, /\/api\/inetis\/2fa\/desactivar/);
});

check('_solicitarCodigo2FALogin() verifica el código contra /api/inetis/2fa/verificar, no contra _totpVerificar local', () => {
  const idx = srcCore.indexOf('function _solicitarCodigo2FALogin');
  const idxFin = srcCore.indexOf('\n}\n', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /\/api\/inetis\/2fa\/verificar/);
  assert.doesNotMatch(bloque, /_totpVerificar\(sesionData\.tfaSecreto/, 'ya no debe compararse localmente contra un secreto guardado en la sesión');
});

// ════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN FUNCIONAL (vm): fetch() real simulado.
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
    focus() {}, blur() {}, select() {}, click() { (this._listeners.click || []).forEach(f => f()); }, get innerHTML() { return this._html || ''; }, set innerHTML(v) { this._html = v; },
    // RONDA 106 — _escaparHtmlModal() (usada ahora también por el modal de
    // códigos de respaldo) escapa texto creando un <div>, asignando
    // .textContent y leyendo de vuelta .innerHTML — truco que solo
    // funciona en un DOM real donde ambas propiedades están enlazadas. Se
    // enlazan aquí igual que en test_ronda106_bitacora_ui_frontend.mjs.
    get textContent() { return this._text || ''; },
    set textContent(v) { this._text = v; this._html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    value: '', offsetWidth: 300, offsetHeight: 200,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  Object.defineProperty(el, 'onclick', {
    get() { return this._onclick; },
    set(fn) { this._onclick = fn; this.click = () => fn && fn(); },
  });
  return el;
}
// A diferencia del stub mínimo de la Ronda 101 (que solo necesitaba 3
// campos fijos de login), aquí el código bajo prueba crea elementos por id
// DINÁMICAMENTE (los modales de 2FA) y los vuelve a buscar por
// document.getElementById() más adelante (para leer el código escrito,
// enganchar el botón de confirmar, etc.) — así que este stub cachea un
// elemento por id la primera vez que se pide, y SIEMPRE devuelve la MISMA
// referencia después, para que escribir ".value" en un paso y leerlo en
// otro funcione igual que en un navegador real.
const elementosPorId = {};
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener() {}, removeEventListener() {},
  getElementById(id) { if (!elementosPorId[id]) elementosPorId[id] = fakeEl('div'); return elementosPorId[id]; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(t) { return fakeEl(t); }, createElementNS(_n, t) { return fakeEl(t); }, createTextNode(t) { return { textContent: t }; },
};
const localStorageStub = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() }; })();

let fetchLog = [];
let fetchRespuestas = {};
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
ctx.speechSynthesis = null; ctx.SpeechSynthesisUtterance = function(){};
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
ctx.QRCode = { toDataURL: async () => 'data:image/png;base64,FAKE' };

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

let _ultimaAlerta = null, _ultimoConfirm = true, _ultimoPrompt = null;
ctx.customAlert = (msg) => { _ultimaAlerta = msg; };
ctx.customConfirm = async () => _ultimoConfirm;
ctx.customPrompt = async () => _ultimoPrompt;
ctx._showToast = () => {};

function instalarInstitucionConUsuarioAdmin() {
  const db = {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 104', anio: '2026',
    config: { numPeriodos: 1 },
    grados: [], users: [{ u: 'rector1', r: 'admin', n: 'Rectora de Prueba', p: 'pbkdf2$aa$bb' }],
    carga: [], ests: [], puestoOverrides: {},
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true], notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [], descriptores: [],
  };
  run('db = ' + JSON.stringify(db) + ';');
  run("sesion = {u:'rector1', r:'admin', n:'Rectora de Prueba', tfaActivo:false};");
  run('window._currentPlatSK="sk-ronda104-test";');
  fetchRespuestas = { 'api/inetis/db': { ok: true, version: 'x' } }; // saveDB() interno de updDB() no debe reventar la prueba
}

await check('_html2FAPerfil() muestra "Desactivada" cuando sesion.tfaActivo es false, y "Activada" cuando es true — sin depender de ningún "tfaSecreto"', () => {
  run("sesion = {u:'rector1', r:'admin', tfaActivo:false};");
  assert.match(run('_html2FAPerfil()'), /Desactivada/);
  run("sesion = {u:'rector1', r:'admin', tfaActivo:true};"); // sin tfaSecreto — ya no existe en el frontend
  assert.match(run('_html2FAPerfil()'), /Activada/);
});

await check('ACTIVACIÓN — _iniciarActivar2FA() pide el secreto al servidor (/2fa/configurar), y al confirmar con el código correcto (/2fa/confirmar) guarda tfaActivo:true SIN ningún tfaSecreto en db.users', async () => {
  instalarInstitucionConUsuarioAdmin();
  fetchRespuestas['api/inetis/2fa/configurar'] = { ok: true, secreto: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/GestorYC:rector1?secret=ABCDEFGHIJKLMNOP' };
  fetchRespuestas['api/inetis/2fa/confirmar'] = { ok: true };
  fetchRespuestas['api/inetis/db'] = { ok: true, version: 'x' };
  await run('_iniciarActivar2FA()');
  elementosPorId['_codigo2FASetupInput'].value = '123456';
  await elementosPorId['_btnConfirmar2FASetup'].onclick();
  assert.ok(fetchLog.some(f => f.url.includes('2fa/configurar') && f.body.usuario === 'rector1'));
  assert.ok(fetchLog.some(f => f.url.includes('2fa/confirmar') && f.body.codigo === '123456'));
  const usr = run("db.users.find(x=>x.u==='rector1')");
  assert.equal(usr.tfaActivo, true);
  assert.equal(usr.tfaSecreto, undefined, 'el secreto NUNCA debe terminar guardado en el blob de la institución');
  assert.equal(run('sesion.tfaActivo'), true);
});

await check('ACTIVACIÓN — si el código de confirmación es incorrecto, NO se activa 2FA y se muestra un error en el propio modal (no se cierra solo)', async () => {
  instalarInstitucionConUsuarioAdmin();
  fetchRespuestas['api/inetis/2fa/configurar'] = { ok: true, secreto: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/x' };
  fetchRespuestas['api/inetis/2fa/confirmar'] = { ok: false, error: 'Código incorrecto' };
  await run('_iniciarActivar2FA()');
  elementosPorId['_codigo2FASetupInput'].value = '000000';
  await elementosPorId['_btnConfirmar2FASetup'].onclick();
  const usr = run("db.users.find(x=>x.u==='rector1')");
  assert.equal(usr.tfaActivo, undefined, 'no debe activarse con un código incorrecto');
  assert.match(elementosPorId['_error2FASetup'].textContent || elementosPorId['_error2FASetup']._html || '', /[Cc]ódigo incorrecto/);
});

await check('DESACTIVACIÓN — _iniciarDesactivar2FA() pide el código vigente (customPrompt) y, si el servidor lo confirma, limpia tfaActivo y cualquier tfaSecreto heredado', async () => {
  instalarInstitucionConUsuarioAdmin();
  run("db.users[0].tfaActivo = true;"); // simula una cuenta que ya estaba activa
  run("sesion.tfaActivo = true;");
  _ultimoPrompt = '654321';
  fetchRespuestas['api/inetis/2fa/desactivar'] = { ok: true };
  await run('_iniciarDesactivar2FA()');
  assert.ok(fetchLog.some(f => f.url.includes('2fa/desactivar') && f.body.codigo === '654321'));
  const usr = run("db.users.find(x=>x.u==='rector1')");
  assert.equal(usr.tfaActivo, false);
  assert.equal(usr.tfaSecreto, undefined);
  assert.equal(run('sesion.tfaActivo'), false);
});

await check('DESACTIVACIÓN — si el código es incorrecto, el servidor la rechaza y 2FA sigue activa (no se desactiva "a medias" del lado del cliente)', async () => {
  instalarInstitucionConUsuarioAdmin();
  run("db.users[0].tfaActivo = true;");
  run("sesion.tfaActivo = true;");
  _ultimoPrompt = '000000';
  fetchRespuestas['api/inetis/2fa/desactivar'] = { ok: false, error: 'Código incorrecto — no se desactivó la verificación en dos pasos.' };
  _ultimaAlerta = null;
  await run('_iniciarDesactivar2FA()');
  const usr = run("db.users.find(x=>x.u==='rector1')");
  assert.equal(usr.tfaActivo, true, 'debe seguir activa: el servidor rechazó el código');
  assert.ok(_ultimaAlerta && /[Cc]ódigo incorrecto/.test(_ultimaAlerta));
});

await check('LOGIN — _solicitarCodigo2FALogin() con el código CORRECTO (según el servidor) completa el login y deja window._pendingLogin listo', async () => {
  fetchLog = [];
  fetchRespuestas = { 'api/inetis/2fa/verificar': { ok: true } };
  const sesionData = { u: 'rector1', r: 'admin', tfaActivo: true };
  const plat = { id: 'plat1', sk: 'sk-ronda104-test' };
  elementosPorId['_codigo2FALoginInput'] = fakeEl('input');
  ctx.renderBienvenidaInstitucion = () => {};
  const promesa = run('_solicitarCodigo2FALogin')(sesionData, {}, plat, 'tablero');
  elementosPorId['_codigo2FALoginInput'].value = '287082';
  await elementosPorId['_btnVerificar2FALogin'].onclick();
  await promesa;
  assert.ok(fetchLog.some(f => f.url.includes('2fa/verificar') && f.body.sk === 'sk-ronda104-test' && f.body.usuario === 'rector1' && f.body.codigo === '287082'));
  assert.ok(run('window._pendingLogin'), 'debe dejar pendingLogin listo para completar el ingreso');
});

await check('LOGIN — "NUNCA LANZA" — si /api/inetis/2fa/verificar falla de red, el código se trata como INVÁLIDO (fallar cerrado, nunca abierto, en una verificación de seguridad)', async () => {
  fetchLog = [];
  fetchRespuestas = { 'api/inetis/2fa/verificar': null }; // fetch lanza excepción (red caída)
  run('window._pendingLogin = undefined;');
  const sesionData = { u: 'rector1', r: 'admin', tfaActivo: true };
  const plat = { id: 'plat1', sk: 'sk-ronda104-test' };
  elementosPorId['_codigo2FALoginInput'] = fakeEl('input');
  const promesa = run('_solicitarCodigo2FALogin')(sesionData, {}, plat, 'tablero');
  elementosPorId['_codigo2FALoginInput'].value = '287082';
  await elementosPorId['_btnVerificar2FALogin'].onclick();
  assert.equal(run('window._pendingLogin'), undefined, 'un fallo de red NUNCA debe completar el login de una cuenta con 2FA activo');
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 106 — Códigos de respaldo de 2FA: se muestran una sola vez al
// activar, se pueden regenerar desde "Mi Perfil", y tanto el login como la
// desactivación aceptan uno en vez del código de 6 dígitos.
// ════════════════════════════════════════════════════════════════════════

await check('_html2FAPerfil() con 2FA activo muestra el botón para regenerar códigos de respaldo', () => {
  run("sesion = {u:'rector1', r:'admin', tfaActivo:true};");
  assert.match(run('_html2FAPerfil()'), /_regenerarCodigosRespaldo2FA\(\)/);
  assert.match(run('_html2FAPerfil()'), /[Rr]egenerar c[oó]digos de respaldo/);
});

await check('ACTIVACIÓN — al confirmar con éxito, si el servidor devuelve codigosRespaldo, se muestran en un modal de "una sola vez"', async () => {
  instalarInstitucionConUsuarioAdmin();
  fetchRespuestas['api/inetis/2fa/configurar'] = { ok: true, secreto: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/x' };
  fetchRespuestas['api/inetis/2fa/confirmar'] = { ok: true, codigosRespaldo: ['AB23-CD34', 'EF45-GH67'] };
  fetchRespuestas['api/inetis/db'] = { ok: true, version: 'x' };
  delete elementosPorId['_codigosRespaldo2FAContenido'];
  await run('_iniciarActivar2FA()');
  elementosPorId['_codigo2FASetupInput'].value = '123456';
  await elementosPorId['_btnConfirmar2FASetup'].onclick();
  const html = elementosPorId['_codigosRespaldo2FAContenido']._html || '';
  assert.match(html, /AB23-CD34/);
  assert.match(html, /EF45-GH67/);
});

await check('ACTIVACIÓN — si el servidor NO devuelve codigosRespaldo (respuesta antigua/inesperada), no revienta: simplemente no se muestra el modal', async () => {
  instalarInstitucionConUsuarioAdmin();
  fetchRespuestas['api/inetis/2fa/configurar'] = { ok: true, secreto: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/x' };
  fetchRespuestas['api/inetis/2fa/confirmar'] = { ok: true };
  fetchRespuestas['api/inetis/db'] = { ok: true, version: 'x' };
  delete elementosPorId['_codigosRespaldo2FAContenido'];
  await run('_iniciarActivar2FA()');
  elementosPorId['_codigo2FASetupInput'].value = '123456';
  await elementosPorId['_btnConfirmar2FASetup'].onclick();
  assert.equal(elementosPorId['_codigosRespaldo2FAContenido'], undefined, 'sin codigosRespaldo en la respuesta, no debe crearse el modal');
});

await check('REGENERAR — _regenerarCodigosRespaldo2FA() pide el código TOTP vigente, llama a /2fa/regenerar-codigos-respaldo, y muestra el lote nuevo', async () => {
  instalarInstitucionConUsuarioAdmin();
  _ultimoPrompt = '111222';
  fetchRespuestas['api/inetis/2fa/regenerar-codigos-respaldo'] = { ok: true, codigosRespaldo: ['QR45-ST67'] };
  delete elementosPorId['_codigosRespaldo2FAContenido'];
  await run('_regenerarCodigosRespaldo2FA()');
  assert.ok(fetchLog.some(f => f.url.includes('2fa/regenerar-codigos-respaldo') && f.body.codigo === '111222'));
  const html = elementosPorId['_codigosRespaldo2FAContenido']._html || '';
  assert.match(html, /QR45-ST67/);
});

await check('REGENERAR — si el servidor rechaza el código, se avisa con un error y NO se muestra ningún modal de códigos', async () => {
  instalarInstitucionConUsuarioAdmin();
  _ultimoPrompt = '000000';
  fetchRespuestas['api/inetis/2fa/regenerar-codigos-respaldo'] = { ok: false, error: 'Código incorrecto — verifique el código de su app autenticadora (no un código de respaldo).' };
  delete elementosPorId['_codigosRespaldo2FAContenido'];
  _ultimaAlerta = null;
  await run('_regenerarCodigosRespaldo2FA()');
  assert.ok(_ultimaAlerta && /[Cc]ódigo incorrecto/.test(_ultimaAlerta));
  assert.equal(elementosPorId['_codigosRespaldo2FAContenido'], undefined);
});

await check('DESACTIVACIÓN — acepta un código de respaldo (formato XXXX-XXXX) tal cual lo escribió el usuario, sin intentar "limpiarlo" como si fuera un TOTP de 6 dígitos', async () => {
  instalarInstitucionConUsuarioAdmin();
  run("db.users[0].tfaActivo = true;");
  run("sesion.tfaActivo = true;");
  _ultimoPrompt = 'QR45-ST67';
  fetchRespuestas['api/inetis/2fa/desactivar'] = { ok: true };
  await run('_iniciarDesactivar2FA()');
  assert.ok(fetchLog.some(f => f.url.includes('2fa/desactivar') && f.body.codigo === 'QR45-ST67'));
  const usr = run("db.users.find(x=>x.u==='rector1')");
  assert.equal(usr.tfaActivo, false);
});

await check('LOGIN — _solicitarCodigo2FALogin() también puede enviar un código de respaldo (formato XXXX-XXXX) al servidor, sin truncarlo a 6 caracteres', async () => {
  fetchLog = [];
  fetchRespuestas = { 'api/inetis/2fa/verificar': { ok: true } };
  const sesionData = { u: 'rector1', r: 'admin', tfaActivo: true };
  const plat = { id: 'plat1', sk: 'sk-ronda104-test' };
  elementosPorId['_codigo2FALoginInput'] = fakeEl('input');
  ctx.renderBienvenidaInstitucion = () => {};
  const promesa = run('_solicitarCodigo2FALogin')(sesionData, {}, plat, 'tablero');
  elementosPorId['_codigo2FALoginInput'].value = 'QR45-ST67';
  await elementosPorId['_btnVerificar2FALogin'].onclick();
  await promesa;
  assert.ok(fetchLog.some(f => f.url.includes('2fa/verificar') && f.body.codigo === 'QR45-ST67'));
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
