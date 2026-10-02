// ════════════════════════════════════════════════════════════════════════
// RONDA 110 — HALLAZGO CRÍTICO DE PERSISTENCIA OFFLINE reportado por el
// usuario con un caso real de campo: se tomó asistencia sin internet en
// 6°2 Matemáticas, se presionó "Guardar Asistencia", pero al recuperar
// internet la asistencia nunca apareció ni se sincronizó.
//
// Diagnóstico confirmado (ver roadmap, sección correspondiente a esta
// ronda, para el detalle completo con líneas de código):
//   - El guardado local (localStorage, vía saveDB()) YA era síncrono e
//     incondicional, independiente de si la red respondía — eso nunca fue
//     el problema.
//   - La causa raíz real era doble:
//     (A) _fusionarAsistenciaEnDB() (el adaptador granular que recarga la
//         Asistencia cada vez que el docente entra al módulo) reemplazaba
//         a ciegas TODO el subconjunto grado+cargaId con lo que devolviera
//         el GET /api/asistencia, sin fijarse si había un registro local
//         recién guardado que el servidor todavía no tenía confirmado —
//         a diferencia de _pullDB(), que desde la Ronda 98 SÍ respeta
//         "window._hayCambiosSinSincronizar".
//     (B) "window._hayCambiosSinSincronizar" nunca se rehidrataba desde
//         "db._syncMeta.pending_sync" al recargar la página — si la pestaña
//         se cerraba/recargaba antes de que el backoff confirmara el
//         guardado, la bandera arrancaba en false y tanto el "boot check"
//         de la Ronda 98 como la protección de _pullDB() quedaban inermes.
// Esta prueba cubre ambas causas, más el sellado por-registro de
// "asistencia" (antes solo 'ests'/'actas') y el nuevo indicador visual de
// pendientes.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcCoreFull = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');
const srcDocs = fs.readFileSync(new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url), 'utf8');
const srcSw = fs.readFileSync(new URL('./gestor-academico/dist/sw.js', import.meta.url), 'utf8');

// ── Comprobaciones estáticas ───────────────────────────────────────────────
check('_sellarSyncMetaCambios() y la limpieza de pending_sync en _pushDB() ahora cubren también "asistencia" (antes solo ests/actas)', () => {
  assert.match(srcCoreFull, /\['ests','actas','asistencia'\]\.forEach\(function\(coleccion\)\{\s*\n\s*if\(!Array\.isArray\(dbNuevo\[coleccion\]\)\)/);
  assert.match(srcCoreFull, /\['ests','actas','asistencia'\]\.forEach\(function\(coleccion\)\{\s*\n\s*if\(Array\.isArray\(db\[coleccion\]\)\)/);
});

check('window._hayCambiosSinSincronizar se rehidrata desde db._syncMeta.pending_sync justo después de loadDB()', () => {
  assert.match(srcCoreFull, /let db = loadDB\(\);[\s\S]{0,1600}window\._hayCambiosSinSincronizar=!!\(db&&db\._syncMeta&&db\._syncMeta\.pending_sync===true\);/);
});

check('_fusionarAsistenciaEnDB() preserva los registros locales marcados pending_sync que el servidor todavía no confirmó', () => {
  assert.match(srcCoreFull, /const pendientesLocales=previos\.filter\(function\(a\)\{/);
  assert.match(srcCoreFull, /&&!!\(a\._syncMeta&&a\._syncMeta\.pending_sync===true\);/);
  assert.match(srcCoreFull, /db\.asistencia=\[\.\.\.otros,\.\.\.\(registrosNuevos\|\|\[\]\),\.\.\.pendientesLocales\];/);
});

check('Existe _contarAsistenciaPendienteSync() y htmlAsistencia() muestra la insignia + botón "Sincronizar Ahora"', () => {
  assert.match(srcCoreFull, /function _contarAsistenciaPendienteSync\(\)/);
  assert.match(srcDocs, /\+' pendiente'\+\(nPendSync===1\?'':'s'\)\+' de sincronizar/);
  assert.match(srcDocs, /onclick="_sincronizarAhoraManual\(\)"/);
});

check('guardarAsistencia() muestra el toast específico de "Modo Offline" cuando navigator.onLine===false', () => {
  assert.match(srcDocs, /navigator\.onLine===false/);
  assert.match(srcDocs, /Asistencia guardada localmente \(Modo Offline\)\. Se sincronizará automáticamente al detectar internet\./);
});

check('sw.js subió de versión (Ronda 110)', () => {
  assert.match(srcSw, /gestor-yc-shell-v16-20261002/);
});

// ── Arnés VM (mismo patrón de las rondas anteriores) ──────────────────────
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
function construirContexto(localStorageSeed) {
  const htmlEl = fakeEl('html');
  const bodyEl = fakeEl('body');
  const documentStub = {
    body: bodyEl, documentElement: htmlEl, readyState: 'complete', _listeners: {},
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
  const seed = new Map(Object.entries(localStorageSeed || {}));
  ctx.localStorage = { getItem: k => (seed.has(k) ? seed.get(k) : null), setItem: (k, v) => { seed.set(k, String(v)); }, removeItem: k => { seed.delete(k); }, clear: () => seed.clear() };
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
  return ctx;
}

const marker = 'render();\n// Inyectar widget IA';
const idxCorte = srcCoreFull.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM'); process.exit(1); }
const srcCore = srcCoreFull.slice(0, idxCorte);

// ── Arnés principal (sin nada pendiente al cargar) ────────────────────────
const ctx = construirContexto();
vm.createContext(ctx);
try { vm.runInContext(srcCore, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

check('updDB() sella _syncMeta.pending_sync=true en TODO registro de asistencia nuevo/editado (antes solo ests/actas)', () => {
  run(`db={config:{},carga:[{id:1,g:'1A',m:'Matemáticas'}],ests:[{id:'e1',n:'EST UNO',g:'1A'}],asistencia:[]};`);
  run(`updDB(d=>{ d.asistencia.push({id:'aOffline1',fecha:'2026-09-28',periodo:'1',grado:'1A',cargaId:1,docente:'doc1',presentes:[],ausentes:['e1'],justificados:[]}); return d; });`);
  const reg = run("db.asistencia.find(a=>a.id==='aOffline1')");
  assert.ok(reg._syncMeta && reg._syncMeta.pending_sync === true, 'El registro recién guardado debe quedar marcado pending_sync=true');
  assert.equal(run('window._hayCambiosSinSincronizar'), true);
});

check('CASO REAL REPORTADO: una asistencia guardada offline sobrevive a un reingreso al módulo (GET que todavía no la trae) en vez de desaparecer', () => {
  // Estado inicial: ya había 1 clase confirmada por el servidor (a0), y el
  // docente acaba de guardar una SEGUNDA (aOffline) mientras no había señal
  // (o mientras el POST seguía en backoff) — todavía no llegó al servidor.
  run(`db={config:{},carga:[{id:1,g:'6B',m:'Matemáticas'}],ests:[{id:'e1',n:'EST UNO',g:'6B'}],
    asistencia:[{id:'a0',fecha:'2026-09-01',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:['e1'],ausentes:[],justificados:[],_syncMeta:{pending_sync:false}}]};`);
  run(`updDB(d=>{ d.asistencia.push({id:'aOffline',fecha:'2026-09-28',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:[],ausentes:['e1'],justificados:[]}); return d; });`);
  assert.equal(run("db.asistencia.length"), 2);

  // El docente reingresa al módulo de Asistencia: dispara _cargarAsistenciaGranular()
  // → _fusionarAsistenciaEnDB(). El GET respondió con éxito, pero el servidor
  // SOLO tiene el registro viejo (a0) — "aOffline" todavía no se subió.
  run(`_fusionarAsistenciaEnDB('6B','1',[{id:'a0',fecha:'2026-09-01',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:['e1'],ausentes:[],justificados:[]}])`);

  const sigueAhi = run("db.asistencia.find(a=>a.id==='aOffline')");
  assert.ok(sigueAhi, 'ANTES de esta ronda este registro se perdía aquí mismo — es exactamente el bug reportado por el usuario');
  assert.equal(JSON.stringify(sigueAhi.ausentes), JSON.stringify(['e1']));
  assert.equal(run("db.asistencia.length"), 2, 'no debe duplicarse ni perderse ningún registro');
});

check('_fusionarAsistenciaEnDB(): un registro YA confirmado por el servidor (presente en la respuesta) se reemplaza con normalidad, sin duplicarse', () => {
  run(`db={config:{},asistencia:[{id:'a1',fecha:'2026-09-01',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:[],ausentes:['e1'],justificados:[],_syncMeta:{pending_sync:true}}]};`);
  // El servidor ya confirmó "a1" (viene en la respuesta) — se adopta esa versión (ya sin pending_sync).
  run(`_fusionarAsistenciaEnDB('6B','1',[{id:'a1',fecha:'2026-09-01',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:['e1'],ausentes:[],justificados:[]}])`);
  assert.equal(run("db.asistencia.length"), 1);
  assert.equal(JSON.stringify(run("db.asistencia[0].presentes")), JSON.stringify(['e1']));
});

check('_fusionarAsistenciaEnDB(): un registro viejo YA eliminado/reemplazado (sin pending_sync, y ausente de la respuesta del servidor) NO se preserva — se respeta al servidor como autoritativo', () => {
  run(`db={config:{},asistencia:[{id:'aViejo',fecha:'2026-01-01',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:[],ausentes:[],justificados:[],_syncMeta:{pending_sync:false}}]};`);
  run(`_fusionarAsistenciaEnDB('6B','1',[])`);
  assert.equal(run("db.asistencia.length"), 0, 'sin bandera de pendiente, el servidor manda (comportamiento histórico, sin cambios)');
});

check('_fusionarAsistenciaEnDB(): preserva registros pendientes de un grado/carga, sin tocar los de otro grado/carga ya cargado en memoria', () => {
  run(`db={config:{},asistencia:[
    {id:'pendA',fecha:'2026-09-28',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:[],ausentes:['e1'],justificados:[],_syncMeta:{pending_sync:true}},
    {id:'otroGrado',fecha:'2026-09-20',periodo:'1',grado:'7A',cargaId:2,docente:'doc2',presentes:['e9'],ausentes:[],justificados:[],_syncMeta:{pending_sync:false}}
  ]};`);
  run(`_fusionarAsistenciaEnDB('6B','1',[])`);
  const ids = run("db.asistencia.map(a=>a.id).slice().sort().join(',')");
  assert.equal(ids, ['otroGrado','pendA'].sort().join(','), 'el registro pendiente de 6B se preserva Y el de 7A (otro grado/carga) queda intacto');
});

check('_pushDB() exitoso limpia pending_sync=false en los registros de asistencia confirmados (igual que ya hacía con ests/actas)', async () => {
  ctx.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: 7 }) });
  run(`db={config:{},asistencia:[]};`);
  run(`updDB(d=>{ d.asistencia.push({id:'aPush',fecha:'2026-09-28',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:[],ausentes:['e1'],justificados:[]}); return d; });`);
  assert.equal(run("db.asistencia[0]._syncMeta.pending_sync"), true);
  await run('_pushDB()');
  assert.equal(run("db.asistencia[0]._syncMeta.pending_sync"), false, 'tras confirmar el servidor, la marca de pendiente debe apagarse también para asistencia');
  assert.equal(run('window._hayCambiosSinSincronizar'), false);
  ctx.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

check('_contarAsistenciaPendienteSync(): cuenta solo los registros propios del docente marcados pendientes (Admin ve el total)', () => {
  run(`db={config:{},asistencia:[
    {id:'p1',grado:'6B',cargaId:1,docente:'doc1',deletedAt:null,_syncMeta:{pending_sync:true}},
    {id:'p2',grado:'7A',cargaId:2,docente:'doc2',deletedAt:null,_syncMeta:{pending_sync:true}},
    {id:'p3',grado:'6B',cargaId:1,docente:'doc1',deletedAt:null,_syncMeta:{pending_sync:false}},
    {id:'p4',grado:'6B',cargaId:1,docente:'doc1',deletedAt:'2026-09-01',_syncMeta:{pending_sync:true}}
  ]};`);
  run(`sesion={u:'doc1',r:'docente'};`);
  assert.equal(run('_contarAsistenciaPendienteSync()'), 1, 'solo "p1" es de doc1, no está borrado y está pendiente');
  run(`sesion={u:'admin1',r:'admin'};`);
  assert.equal(run('_contarAsistenciaPendienteSync()'), 2, 'un admin ve TODOS los pendientes de la institución (p1 y p2, excluyendo el borrado p4)');
});

// ── Arnés aislado: rehidratación de la bandera al RECARGAR la página ──────
check('CAUSA B DEL BUG: al recargar la app con un cambio todavía pendiente en localStorage, window._hayCambiosSinSincronizar debe arrancar en true (no en false/undefined)', () => {
  const dbPendienteGuardada = JSON.stringify({
    config:{}, ests:[], carga:[], asistencia:[
      {id:'aNoConfirmado',fecha:'2026-09-28',periodo:'1',grado:'6B',cargaId:1,docente:'doc1',presentes:[],ausentes:['e1'],justificados:[],_syncMeta:{pending_sync:true,updated_at:'2026-09-28T10:00:00.000Z'}}
    ],
    _syncMeta:{pending_sync:true,updated_at:'2026-09-28T10:00:00.000Z'}
  });
  const ctx2 = construirContexto({ 'ie_sincelejito_db_v4': dbPendienteGuardada });
  vm.createContext(ctx2);
  vm.runInContext(srcCore, ctx2, { filename: '03-app-core.js (recarga simulada)' });
  assert.equal(vm.runInContext('window._hayCambiosSinSincronizar', ctx2), true,
    'ANTES de esta ronda esto arrancaba en false aunque hubiera un cambio real sin confirmar — dejaba sin efecto el boot-check de la Ronda 98 y la protección de _pullDB()');
  assert.equal(vm.runInContext("db.asistencia.find(a=>a.id==='aNoConfirmado')!=null", ctx2), true,
    'el registro pendiente debe seguir presente en memoria tras la recarga');
});

check('Control: al recargar SIN nada pendiente, window._hayCambiosSinSincronizar arranca en false (comportamiento normal, sin cambios)', () => {
  const dbSinPendientes = JSON.stringify({ config:{}, ests:[], carga:[], asistencia:[], _syncMeta:{pending_sync:false,updated_at:'2026-09-28T10:00:00.000Z'} });
  const ctx3 = construirContexto({ 'ie_sincelejito_db_v4': dbSinPendientes });
  vm.createContext(ctx3);
  vm.runInContext(srcCore, ctx3, { filename: '03-app-core.js (recarga sin pendientes)' });
  assert.equal(vm.runInContext('window._hayCambiosSinSincronizar', ctx3), false);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
