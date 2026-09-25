// ════════════════════════════════════════════════════════════════════════
// RONDA 80 — Optimización específica del PORTAL DE INGRESO (login).
//
// SÍNTOMA reportado: "la optimización anterior [Ronda 79] mejoró el
// rendimiento general, pero el portal de ingreso (login) todavía presenta
// tardanza al validar las credenciales del usuario en prueba local."
//
// Pedido explícito (5 puntos) y lo que realmente se hizo para cada uno,
// dada la arquitectura real del proyecto (NO existe una tabla SQL
// "usuarios": todo el personal/estudiantes/acudientes vive dentro de un
// blob JSON por institución, guardado como una sola fila en kv_store cuya
// PK es "sk" — ya un acceso indexado por definición):
//
//  1) "Índices y búsqueda de credenciales": el índice pedido
//     (CREATE INDEX ... ON usuarios(...)) no aplica a este esquema — no
//     existe esa tabla. Lo que SÍ era un gap real: POST /api/auth/login
//     hacía su PROPIA lectura de kv_store por fuera de la caché de 5s / la
//     deduplicación de lecturas concurrentes / el timeout+reintento por
//     arranque en frío que ya protegen a /api/inetis/db y a las 15 rutas
//     granulares desde la Ronda 79. Se alineó con el mismo mecanismo
//     (leerFilaKvStoreConDedup + conTimeoutYReintento). El payload de
//     respuesta ya era mínimo (ok/token/rol/rolEspecifico) — verificado,
//     no modificado.
//  2) "Pre-warm de conexión a la BD": nuevo endpoint GET
//     /api/inetis/prewarm (SÍ toca Neon, a diferencia de /api/health,
//     deliberadamente libre de BD) + nueva función frontend
//     _prewarmPoolBD(), disparada en segundo plano (fire-and-forget, con
//     límite de 1 vez/20s) desde renderGestorLanding() y
//     renderPortalInstitucion() — las dos pantallas de login.
//  3) "Optimización de hash/bcrypt": este proyecto NO usa bcrypt/argon2
//     (PBKDF2-HMAC-SHA256 nativo). Bajar las 100.000 iteraciones habría
//     sido un retroceso real de seguridad para ganar unos ms, así que NO
//     se tocó el costo — se corrigió la causa real: hashPasswordServidor()/
//     verificarPasswordServidor() (src/lib/reset-tokens.ts) usaban
//     crypto.pbkdf2Sync (BLOQUEA el hilo único de Node mientras corre) y
//     ahora usan crypto.pbkdf2 asíncrono (thread pool de libuv) — mismo
//     algoritmo/salt/iteraciones/formato, cero cambio de seguridad, ya no
//     bloquea otras peticiones concurrentes mientras verifica una clave.
//  4) "Feedback visual inmediato": doLoginInstitucional()/
//     btnLoginInstitucional YA tenía este tratamiento (ronda anterior). El
//     botón del portal POR INSTITUCIÓN (pEntrar/doLoginPortal — el que usa
//     la mayoría de usuarios finales) NO lo tenía — se agregó el mismo
//     patrón (disabled + "⏳ Verificando..." + restauración en finally).
//     De paso, _fetchPlatDB() (usada por ambos flujos de login) dejó de
//     usar fetch() plano — ahora usa _fetchConTimeout(), así una
//     institución/pool "fría" ya no puede colgar el login indefinidamente.
//  5) Esta suite + la suite completa (Rondas 74-80).
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}
async function checkAsync(desc, fn) {
  try { await fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}
const delay = (ms, val) => new Promise((resolve) => setTimeout(() => resolve(val), ms));

// ════════════════════════════════════════════════════════════════════════
// PARTE A — src/lib/reset-tokens.ts: _pbkdf2Async / hashPasswordServidor /
// verificarPasswordServidor. Se EXTRAE el bloque real (desde "RONDA 80 —
// PBKDF2 ASÍNCRONO" hasta el final del archivo — solo depende del módulo
// nativo "crypto", sin Drizzle/pg, mismo criterio ya usado en Rondas 78/79)
// a un módulo temporal y se ejecuta tal cual, sin reescribir la lógica.
// ════════════════════════════════════════════════════════════════════════
const srcReset = fs.readFileSync(new URL('./src/lib/reset-tokens.ts', import.meta.url), 'utf8');

check('src/lib/reset-tokens.ts: ya NO usa crypto.pbkdf2Sync (la versión síncrona y bloqueante) en ningún CÓDIGO ejecutable (solo puede mencionarse en comentarios explicando el porqué del cambio)', () => {
  const lineasEjecutables = srcReset.split('\n').filter(l => !l.trim().startsWith('//'));
  const conRastro = lineasEjecutables.filter(l => l.includes('pbkdf2Sync'));
  assert.equal(conRastro.length, 0, `no debe quedar ningún uso real de crypto.pbkdf2Sync fuera de comentarios: ${JSON.stringify(conRastro)}`);
});
check('src/lib/reset-tokens.ts: usa crypto.pbkdf2 (versión asíncrona, basada en callback/thread pool de libuv) para derivar la clave', () => {
  assert.match(srcReset, /crypto\.pbkdf2\(password,\s*salt,\s*iteraciones,\s*longitud,\s*'sha256',\s*\(err,\s*derivado\)\s*=>/, 'debe encontrarse la llamada callback-based a crypto.pbkdf2 dentro de _pbkdf2Async');
});
check('src/lib/reset-tokens.ts: el número de iteraciones sigue siendo 100000 en ambas funciones (no se debilitó la seguridad para "ganar velocidad")', () => {
  const ocurrencias = (srcReset.match(/100000/g) || []).length;
  assert.ok(ocurrencias >= 2, `se esperaban al menos 2 usos de 100000 iteraciones (hash + verificación), se encontraron ${ocurrencias}`);
});
check('src/lib/reset-tokens.ts: hashPasswordServidor() y verificarPasswordServidor() ahora declaran devolver Promise (firma async)', () => {
  assert.match(srcReset, /export async function hashPasswordServidor\(password: string\): Promise<string>/);
  assert.match(srcReset, /export async function verificarPasswordServidor\(passwordIngresada: string, valorGuardado: string \| null \| undefined\): Promise<boolean>/);
});

const idxBloqueReset = srcReset.indexOf('// RONDA 80 — PBKDF2 ASÍNCRONO');
if (idxBloqueReset === -1) {
  console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE INICIO DEL BLOQUE PBKDF2 EN reset-tokens.ts — revisar este test');
  process.exit(1);
}
const bloqueReset = srcReset.slice(idxBloqueReset);
if (!bloqueReset.includes('export async function hashPasswordServidor') || !bloqueReset.includes('export async function verificarPasswordServidor')) {
  console.error('❌ El bloque extraído de reset-tokens.ts no contiene las funciones bajo prueba — revisar los marcadores de extracción');
  process.exit(1);
}
const tmpFileReset = path.join(os.tmpdir(), `ronda80_pbkdf2_extraido_${Date.now()}.ts`);
fs.writeFileSync(tmpFileReset, `import crypto from 'crypto';\n${bloqueReset}`, 'utf8');
const { hashPasswordServidor, verificarPasswordServidor } = await import(`file://${tmpFileReset}?t=${Date.now()}`);

check('hashPasswordServidor()/verificarPasswordServidor() se extrajeron correctamente y son funciones', () => {
  assert.equal(typeof hashPasswordServidor, 'function');
  assert.equal(typeof verificarPasswordServidor, 'function');
});

await checkAsync('hashPasswordServidor() produce el formato esperado "pbkdf2$<saltHex>$<hashHex>" (16 bytes de salt, 32 bytes de hash, igual que antes de la Ronda 80)', async () => {
  const h = await hashPasswordServidor('miClaveSegura123');
  const partes = h.split('$');
  assert.equal(partes.length, 3);
  assert.equal(partes[0], 'pbkdf2');
  assert.equal(Buffer.from(partes[1], 'hex').length, 16, 'salt debe ser de 16 bytes');
  assert.equal(Buffer.from(partes[2], 'hex').length, 32, 'hash debe ser de 32 bytes');
});

await checkAsync('verificarPasswordServidor(): un hash generado por hashPasswordServidor() se verifica correctamente con la MISMA contraseña', async () => {
  const h = await hashPasswordServidor('otraClave!456');
  assert.equal(await verificarPasswordServidor('otraClave!456', h), true);
});

await checkAsync('verificarPasswordServidor(): rechaza una contraseña INCORRECTA contra un hash válido', async () => {
  const h = await hashPasswordServidor('claveCorrecta');
  assert.equal(await verificarPasswordServidor('claveIncorrecta', h), false);
});

await checkAsync('verificarPasswordServidor(): dos hashes de la MISMA contraseña son distintos entre sí (salt aleatorio por llamada) pero ambos verifican correctamente', async () => {
  const h1 = await hashPasswordServidor('mismaClave');
  const h2 = await hashPasswordServidor('mismaClave');
  assert.notEqual(h1, h2, 'el salt aleatorio debe producir hashes distintos aunque la contraseña sea igual');
  assert.equal(await verificarPasswordServidor('mismaClave', h1), true);
  assert.equal(await verificarPasswordServidor('mismaClave', h2), true);
});

await checkAsync('verificarPasswordServidor(): contraseñas HEREDADAS sin hashear (formato antiguo, texto plano) siguen funcionando por comparación directa', async () => {
  assert.equal(await verificarPasswordServidor('claveTextoPlano', 'claveTextoPlano'), true);
  assert.equal(await verificarPasswordServidor('otra', 'claveTextoPlano'), false);
});

await checkAsync('verificarPasswordServidor(): nunca lanza — valores guardados nulos/vacíos/corruptos devuelven simplemente false', async () => {
  assert.equal(await verificarPasswordServidor('x', null), false);
  assert.equal(await verificarPasswordServidor('x', undefined), false);
  assert.equal(await verificarPasswordServidor('x', ''), false);
  assert.equal(await verificarPasswordServidor('x', 'pbkdf2$noEsHexValido$tampoco'), false);
});

await checkAsync('hashPasswordServidor()/verificarPasswordServidor() se ejecutan de forma REALMENTE concurrente (no serializada) — 5 verificaciones en paralelo no tardan ~5x una sola', async () => {
  const h = await hashPasswordServidor('claveDeCarga');
  const t0 = Date.now();
  await verificarPasswordServidor('claveDeCarga', h); // una sola, referencia
  const unaSola = Date.now() - t0;
  const t1 = Date.now();
  await Promise.all(Array.from({ length: 5 }, () => verificarPasswordServidor('claveDeCarga', h)));
  const cincoEnParalelo = Date.now() - t1;
  // Con crypto.pbkdf2Sync (bloqueante) 5 verificaciones se hacen una tras
  // otra (≈5x el tiempo de una sola). Con crypto.pbkdf2 asíncrono (thread
  // pool de libuv) corren solapadas — se exige que 5 en paralelo tarden
  // claramente menos que 4x una sola (margen amplio para no ser flaky en
  // máquinas lentas, pero suficiente para distinguir async de síncrono).
  assert.ok(cincoEnParalelo < unaSola * 4 + 50, `5 verificaciones en paralelo tardaron ${cincoEnParalelo}ms, una sola tardó ${unaSola}ms — si fueran síncronas/bloqueantes se esperarían ~5x, no menos de 4x+50ms`);
});

fs.unlinkSync(tmpFileReset);

// ════════════════════════════════════════════════════════════════════════
// PARTE B — POST /api/auth/login (src/index.ts) ahora comparte el mismo
// mecanismo de caché/dedup/timeout+reintento que /api/inetis/db (Ronda 79),
// en vez de hacer su propia lectura de kv_store por fuera de esas
// protecciones. Verificación por inspección de código — este endpoint
// depende de Drizzle/pg/Express reales, igual criterio que en Ronda 79 para
// /api/inetis/db.
// ════════════════════════════════════════════════════════════════════════
const srcIndex = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
const idxLogin = srcIndex.indexOf("app.post('/api/auth/login'");
const idxLoginFin = srcIndex.indexOf("app.get('/api/inetis/db'", idxLogin);
const bloqueLogin = idxLogin > -1 && idxLoginFin > idxLogin ? srcIndex.slice(idxLogin, idxLoginFin) : '';

check('POST /api/auth/login: se pudo aislar el bloque del handler para inspeccionarlo', () => {
  assert.ok(bloqueLogin.length > 0, 'no se pudo extraer el cuerpo de app.post(\'/api/auth/login\', ...) — revisar marcadores de este test');
});
check('POST /api/auth/login: YA NO hace una lectura de kv_store suelta por fuera del mecanismo de caché/dedup — usa leerFilaKvStoreConDedup()', () => {
  assert.match(bloqueLogin, /await leerFilaKvStoreConDedup\(sk,/, 'debe usar leerFilaKvStoreConDedup(sk, ...) igual que /api/inetis/db desde la Ronda 79');
});
check('POST /api/auth/login: la consulta real sigue protegida con timeout + reintento por arranque en frío (conTimeoutYReintento)', () => {
  assert.match(bloqueLogin, /conTimeoutYReintento\(/, 'debe envolver la consulta con conTimeoutYReintento(...)');
  assert.match(bloqueLogin, /TIMEOUT_CONSULTA_BD_MS/, 'debe usar el mismo límite de tiempo que el resto de endpoints de lectura');
});
check('POST /api/auth/login: el payload de respuesta exitosa sigue siendo mínimo (ok/token/rol/rolEspecifico — sin datos de sesión de más)', () => {
  const respuestas = bloqueLogin.match(/res\.json\(\{[^}]*\}\)/g) || [];
  const conToken = respuestas.filter(r => r.includes('token'));
  assert.ok(conToken.length >= 1, 'debe existir al menos una respuesta con token');
  conToken.forEach(r => {
    assert.doesNotMatch(r, /platDB|password|\bp:\s*[a-zA-Z]/i, `una respuesta de login no debe filtrar campos de más: ${r}`);
  });
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — GET /api/inetis/prewarm (src/index.ts): nuevo endpoint de
// pre-warm que SÍ toca la base de datos (a diferencia de /api/health,
// deliberadamente libre de Neon). Verificación por inspección de código.
// ════════════════════════════════════════════════════════════════════════
check('existe GET /api/inetis/prewarm', () => {
  assert.match(srcIndex, /app\.get\('\/api\/inetis\/prewarm'/, 'debe existir el endpoint de pre-warm');
});
const idxPrewarm = srcIndex.indexOf("app.get('/api/inetis/prewarm'");
const bloquePrewarm = srcIndex.slice(idxPrewarm, idxPrewarm + 600);
check('GET /api/inetis/prewarm SÍ ejecuta una consulta real contra la base de datos (a diferencia de /api/health, que es deliberadamente liviano)', () => {
  assert.match(bloquePrewarm, /pool\.query\(/, 'debe usar el pool de pg directamente para una consulta mínima real');
});
check('GET /api/inetis/prewarm nunca debe poder tumbar el servidor: su consulta está protegida con try/catch y responde ok:false en vez de un error 500 duro', () => {
  assert.match(bloquePrewarm, /catch/, 'debe tener manejo de errores propio');
  assert.match(bloquePrewarm, /ok:\s*false/, 'un fallo del ping de pre-warm debe responder ok:false, no reventar');
});

fs.unlinkSync; // no-op, se mantiene el patrón de limpieza de temporales arriba

// ════════════════════════════════════════════════════════════════════════
// PARTE D — FRONTEND (03-app-core.js): misma técnica "vm" de las Rondas
// 74-79. Se carga el archivo REAL (truncado) en un contexto Node con un
// DOM/fetch simulados para probar _prewarmPoolBD(), _fetchPlatDB() con
// timeout, y el feedback visual inmediato de doLoginPortal()/pEntrar.
// ════════════════════════════════════════════════════════════════════════
const SRC1_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
let src1 = fs.readFileSync(SRC1_PATH, 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idx = src1.indexOf(marker);
if (idx === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src1 = src1.slice(0, idx);

check('renderGestorLanding() dispara _prewarmPoolBD() al pintar la pantalla de login principal', () => {
  const idxFn = src1.indexOf('function renderGestorLanding(){');
  const fragmento = src1.slice(idxFn, idxFn + 300);
  assert.match(fragmento, /_prewarmPoolBD\(\)/);
});
check('renderPortalInstitucion() dispara _prewarmPoolBD() al pintar el portal de login por institución', () => {
  const idxFn = src1.indexOf('function renderPortalInstitucion(platId,rolPre){');
  const fragmento = src1.slice(idxFn, idxFn + 700);
  assert.match(fragmento, /_prewarmPoolBD\(\)/);
});
check('_fetchPlatDB() ya NO usa fetch() plano sin límite de tiempo — usa _fetchConTimeout() (así una institución/pool "fría" no cuelga el login para siempre)', () => {
  const idxFn = src1.indexOf('async function _fetchPlatDB(sk){');
  const finFn = src1.indexOf('\n}', idxFn);
  const fragmento = src1.slice(idxFn, finFn);
  assert.match(fragmento, /_fetchConTimeout\(/, 'debe usar _fetchConTimeout(...) en vez de fetch(...) directo');
});
check('doLoginPortal(): el botón #pEntrar cambia a estado deshabilitado + "Verificando..." de inmediato al invocarse, ANTES de cualquier await de red', () => {
  const idxFn = src1.indexOf('async function doLoginPortal(platId){');
  const idxPrimerAwait = src1.indexOf('await _fetchPlatDB(p.sk)', idxFn);
  const fragmento = src1.slice(idxFn, idxPrimerAwait);
  assert.match(fragmento, /_btnPortal\.disabled\s*=\s*true/, 'debe deshabilitar el botón antes del fetch');
  assert.match(fragmento, /_btnPortal\.innerHTML\s*=\s*'⏳ Verificando\.\.\.'/, 'debe cambiar el texto a "⏳ Verificando..." antes del fetch, mismo patrón que btnLoginInstitucional');
});
check('doLoginPortal(): el botón se restaura en un bloque finally (se recupera pase lo que pase: credenciales incorrectas, error de red, éxito)', () => {
  const idxFn = src1.indexOf('async function doLoginPortal(platId){');
  const idxFinFn = src1.indexOf('\n  function previewLogoGestor', idxFn);
  const fragmento = src1.slice(idxFn, idxFinFn);
  assert.match(fragmento, /\}finally\{[\s\S]*_btnPortal\.disabled\s*=\s*false[\s\S]*_btnPortal\.innerHTML\s*=\s*_textoBtnPortalOriginal/, 'debe existir un finally que restaure disabled=false e innerHTML original');
});

function fakeEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(),
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], childNodes: [], attributes: {}, _listeners: {}, disabled: false,
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {}, remove() {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, select() {}, click() {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; },
    textContent: '', value: '',
    offsetWidth: 300, offsetHeight: 200,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  return el;
}
const elementosPorId = {};
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return elementosPorId[id] || null; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(tag) { return fakeEl(tag); }, createElementNS(_ns, tag) { return fakeEl(tag); },
  createTextNode(t) { return { textContent: t }; },
  activeElement: null,
};
class MutationObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class IntersectionObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class ResizeObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
const localStorageStub = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() };
})();

let _latenciaSimuladaMs = 0;
let _fetchDebeFallar = false;
const _fetchCalls = [];
async function fetchStub(url, opts) {
  _fetchCalls.push({ url: String(url), opts: opts || {} });
  if (_latenciaSimuladaMs > 0) await new Promise(r => setTimeout(r, _latenciaSimuladaMs));
  if (_fetchDebeFallar) throw new Error('Fallo de red simulado');
  if (opts && opts.signal && opts.signal.aborted) { const e = new Error('AbortError'); e.name = 'AbortError'; throw e; }
  return { ok: false, status: 0, json: async () => ({}), text: async () => '' };
}
class AbortSignalStub {
  constructor(){ this.aborted = false; this._listeners = []; }
  addEventListener(type, fn){ this._listeners.push(fn); }
  removeEventListener(){}
}
class AbortControllerStub {
  constructor(){ this.signal = new AbortSignalStub(); }
  abort(){ this.signal.aborted = true; this.signal._listeners.forEach(fn=>fn()); }
}

const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){};
ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800;
ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = localStorageStub; ctx.sessionStorage = localStorageStub;
ctx.fetch = fetchStub;
ctx.AbortController = AbortControllerStub;
ctx.console = console;
ctx.MutationObserver = MutationObserverStub; ctx.IntersectionObserver = IntersectionObserverStub; ctx.ResizeObserver = ResizeObserverStub;
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
ctx.Blob = function(parts, opts){ this.parts = parts; this.opts = opts; };
ctx.FormData = function(){ this._d = new Map(); this.append = (k,v)=>this._d.set(k,v); };
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
ctx.matchMedia = () => ({ matches: false, addListener(){}, addEventListener(){} });
ctx.Notification = function(){}; ctx.EventSource = function(){ this.close = () => {}; }; ctx.WebSocket = function(){};
ctx.performance = performance;
ctx.btoa = typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(String(s), 'binary').toString('base64');
ctx.atob = typeof atob !== 'undefined' ? atob : (s) => Buffer.from(String(s), 'base64').toString('binary');
ctx._delayRef = (ms) => new Promise((resolve) => { globalThis.setTimeout(resolve, ms); });

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }

function run(code) { return vm.runInContext(code, ctx); }

await checkAsync('_prewarmPoolBD(): dispara un fetch en segundo plano hacia /api/inetis/prewarm', async () => {
  _fetchCalls.length = 0;
  run('window._ultimoPrewarmTs = undefined;');
  run('_prewarmPoolBD();');
  await delay(10); // el fetch es fire-and-forget, se le da un tick para registrarse
  assert.ok(_fetchCalls.some(c => c.url.includes('/api/inetis/prewarm')), 'debe haberse llamado a fetch(".../api/inetis/prewarm")');
});

await checkAsync('_prewarmPoolBD(): NO repite la llamada si se invoca de nuevo dentro de la ventana de 20s (evita tráfico de más en re-renders seguidos de la pantalla de login)', async () => {
  _fetchCalls.length = 0;
  run('window._ultimoPrewarmTs = Date.now();'); // simula que ya se disparó "ahora mismo"
  run('_prewarmPoolBD();');
  await delay(10);
  assert.equal(_fetchCalls.filter(c => c.url.includes('/api/inetis/prewarm')).length, 0, 'no debe volver a llamar al ping de pre-warm si la ventana de 20s no expiró');
});

await checkAsync('_fetchPlatDB(): si la red se cuelga MÁS ALLÁ del límite de _fetchConTimeout, no espera para siempre — cae al fallback local (loadPlatformDB) en vez de bloquear el login indefinidamente', async () => {
  run('window._urlInstId=null;');
  run('localStorage.setItem("sk-timeout-80", JSON.stringify({nombre:"CACHEADA LOCAL", grados:[], ests:[], users:[]}));');
  _fetchCalls.length = 0;
  _latenciaSimuladaMs = 300; // fuerza a que gane la carrera del timeout simulado en fetchStub
  // TIMEOUT_FETCH_GRANULAR_MS es una constante (7000ms reales) — igual que en
  // el test análogo de la Ronda 77 para _pullDB(), en vez de reasignarla se
  // sustituye _fetchConTimeout() mismo por una versión que fuerza un límite
  // corto (50ms), preservando el resto de su comportamiento real (delega en
  // la función original con ese límite) y sin alargar esta prueba.
  run(`
    window._origFetchConTimeout80 = _fetchConTimeout;
    _fetchConTimeout = function(url, opts){ return window._origFetchConTimeout80(url, opts, 50); };
  `);
  const resultado = await run('_fetchPlatDB("sk-timeout-80")');
  run('_fetchConTimeout = window._origFetchConTimeout80;');
  _latenciaSimuladaMs = 0;
  assert.equal(resultado && resultado.nombre, 'CACHEADA LOCAL', 'ante un timeout de red, debe resolver con la copia local cacheada (loadPlatformDB), no quedarse esperando');
});

await checkAsync('doLoginPortal(): el botón #pEntrar queda deshabilitado con "⏳ Verificando..." MIENTRAS espera _fetchPlatDB, y se restaura al terminar (credenciales incorrectas)', async () => {
  run('window._urlInstId=null;');
  elementosPorId.pRol = Object.assign(fakeEl('select'), { value: 'docente' });
  elementosPorId.pUser = Object.assign(fakeEl('input'), { value: 'doc-inexistente' });
  elementosPorId.pPass = Object.assign(fakeEl('input'), { value: 'cualquiera' });
  const btn = Object.assign(fakeEl('button'), { innerHTML: '✅ INGRESAR AL PORTAL' });
  elementosPorId.pEntrar = btn;
  run('gestorDB = gestorDB || {}; gestorDB.platforms = [{ id: "plat-80", sk: "sk-plat-80", activa: true, bloqueada: false, pantallaBlanca: false }];');
  run('window._customAlertUltimaLlamada80 = null; window._customAlertOriginal80 = customAlert; customAlert = function(msg){ window._customAlertUltimaLlamada80 = msg; };');
  _latenciaSimuladaMs = 15;
  _fetchDebeFallar = false;
  const promesaLogin = run('doLoginPortal("plat-80")');
  await delay(3); // deja que el "async function" corra hasta su primer await
  assert.equal(btn.disabled, true, 'el botón debe quedar deshabilitado de inmediato, antes de que resuelva _fetchPlatDB');
  assert.equal(btn.innerHTML, '⏳ Verificando...', 'el botón debe mostrar el texto de verificación de inmediato');
  await promesaLogin;
  _latenciaSimuladaMs = 0;
  assert.equal(btn.disabled, false, 'tras terminar (credenciales incorrectas), el botón debe reactivarse');
  assert.equal(btn.innerHTML, '✅ INGRESAR AL PORTAL', 'tras terminar, el botón debe recuperar su texto original');
  run('customAlert = window._customAlertOriginal80;');
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) {
  console.log('✅ 100% de la suite en verde.');
  process.exit(0);
} else {
  console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
  process.exit(1);
}
