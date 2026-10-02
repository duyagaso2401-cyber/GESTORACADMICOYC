// ════════════════════════════════════════════════════════════════════════
// RONDA 108-HOTFIX — el usuario, tras instalar el paquete que ya movía el
// Panel de Novedades a "🔔 Mis Novedades", reportó CON CAPTURA DE PANTALLA
// que las alertas de estado de los estudiantes ("AUSENCIA REGISTRADA",
// "Alerta Académica automática") se le SEGUÍAN apareciendo como banners
// emergentes al usar el sistema como docente. La causa real: un TERCER
// mecanismo (iniciarPollingNotificaciones/mostrarNotifBanner, Ronda 87) que
// no distinguía rol. Esta prueba verifica que, para un docente, los "kind"
// de estado del estudiante NUNCA generan un banner, mientras que para un
// Admin/Rector (y para los kinds que sí le competen a un docente) el
// comportamiento de siempre se conserva intacto.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
async function check(desc, fn) {
  try { await fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcDocs = fs.readFileSync(new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url), 'utf8');

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

const srcCoreFull = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');
const marker = 'render();\n// Inyectar widget IA';
const idxCorte = srcCoreFull.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM'); process.exit(1); }
const srcCore = srcCoreFull.slice(0, idxCorte);

vm.createContext(ctx);
try { vm.runInContext(srcCore, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
try { vm.runInContext(srcDocs, ctx, { filename: '06-documentos-y-resto.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 06-documentos-y-resto.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

function notifsFixture() {
  return [
    { id: 101, kind: 'ausencia', actor: 'ADÁN JIMÉNEZ', message: '📅 AUSENCIA REGISTRADA – alguien', createdAt: new Date().toISOString() },
    { id: 102, kind: 'alerta-academica', actor: 'Sistema (automático)', message: '⚠️ Alerta Académica automática P3: alguien bajó.', createdAt: new Date().toISOString() },
    { id: 103, kind: 'alerta-inasistencia', actor: 'Sistema (automático)', message: 'Inasistencia crítica.', createdAt: new Date().toISOString() },
    { id: 104, kind: 'alerta-observador', actor: 'Sistema (automático)', message: 'Nueva observación crítica.', createdAt: new Date().toISOString() },
    { id: 105, kind: 'alerta-academica-consecutiva', actor: 'Sistema (automático)', message: 'Riesgo 2 periodos seguidos.', createdAt: new Date().toISOString() },
    { id: 106, kind: 'nota-cambiada-periodo-cerrado', actor: 'Admin', message: 'Nota cambiada con periodo cerrado.', createdAt: new Date().toISOString() },
    { id: 107, kind: 'config', actor: 'Admin', message: 'Configuración actualizada.', createdAt: new Date().toISOString() },
    { id: 108, kind: 'mensaje', actor: 'Un acudiente', message: 'Mensaje para el docente.', createdAt: new Date().toISOString() },
  ];
}

// Ejecuta UNA pasada del cuerpo real del intervalo de iniciarPollingNotificaciones()
// (la misma lógica, línea por línea, que vive en 06-documentos-y-resto.js) contra un
// fetch stub que siempre devuelve el mismo fixture de 8 notificaciones nuevas, y
// devuelve la lista de "kind" que efectivamente llegaron a mostrarNotifBanner().
async function correrPollingUnaVez(rol) {
  run(`sesion = {u:'doc1', n:'ADÁN JIMÉNEZ', r:${JSON.stringify(rol)}};`);
  run('_lastNotifId = 0; _notifBadge = 0;');
  run(`window.fetch = async function(url){
    return { ok:true, json: async () => ({ notifications: ${JSON.stringify(notifsFixture())} }) };
  };`);
  run(`
    window._bannersCapturados = [];
    window.mostrarNotifBanner = function(notifs){ window._bannersCapturados = window._bannersCapturados.concat(notifs); };
  `);
  await run(`
    (async()=>{
      try{
        const r=await fetch('/api/inetis/notifications?sk=x');
        if(!r.ok) return;
        const j=await r.json();
        const todasNuevas=(j.notifications||[]).filter(n=>n.id>_lastNotifId);
        if(!todasNuevas.length) return;
        _lastNotifId=Math.max(...todasNuevas.map(n=>n.id));
        const esDocente=!!(sesion&&sesion.r==='docente');
        const nuevasVisibles=todasNuevas.filter(n=>!TIPOS_NOTIF_SIN_BANNER.has(n.kind)
          &&!(esDocente&&KINDS_ESTADO_ESTUDIANTE_SIN_BANNER_DOCENTE.has(n.kind)));
        if(nuevasVisibles.length){
          _notifBadge+=nuevasVisibles.length;
          mostrarNotifBanner(nuevasVisibles);
        }
      }catch(e){}
    })();
  `);
  return run('window._bannersCapturados').map(n => n.kind);
}

async function main() {
  await check('Existe el conjunto de "kind" de estado del estudiante excluidos del banner para Docente', () => {
    assert.match(srcDocs, /KINDS_ESTADO_ESTUDIANTE_SIN_BANNER_DOCENTE\s*=\s*new Set\(\[/);
    assert.match(srcDocs, /'ausencia'/);
    assert.match(srcDocs, /'alerta-inasistencia'/);
    assert.match(srcDocs, /'alerta-academica'/);
    assert.match(srcDocs, /'alerta-observador'/);
  });

  await check('iniciarPollingNotificaciones() filtra por rol docente ANTES de mostrar el banner', () => {
    const idx = srcDocs.indexOf('function iniciarPollingNotificaciones');
    const idxFin = srcDocs.indexOf('\nfunction ', idx + 10);
    const bloque = srcDocs.slice(idx, idxFin === -1 ? idx + 2000 : idxFin);
    assert.match(bloque, /esDocente=!!\(sesion&&sesion\.r==='docente'\)/);
    assert.match(bloque, /!\(esDocente&&KINDS_ESTADO_ESTUDIANTE_SIN_BANNER_DOCENTE\.has\(n\.kind\)\)/);
  });

  await check('Para un DOCENTE, ningún "kind" de estado del estudiante dispara el banner (ausencia, alerta-academica, alerta-inasistencia, alerta-observador, alerta-academica-consecutiva, nota-cambiada-periodo-cerrado)', async () => {
    const kinds = await correrPollingUnaVez('docente');
    for (const k of ['ausencia', 'alerta-academica', 'alerta-inasistencia', 'alerta-observador', 'alerta-academica-consecutiva', 'nota-cambiada-periodo-cerrado']) {
      assert.ok(!kinds.includes(k), 'NO debió mostrar banner para kind=' + k + ' a un docente, pero se mostró');
    }
  });

  await check('Para un DOCENTE, los kinds que sí le competen directamente (config, mensaje) SÍ siguen generando banner (no se rompió lo demás)', async () => {
    const kinds = await correrPollingUnaVez('docente');
    assert.ok(kinds.includes('config'), 'Debió seguir mostrando el banner de "config"');
    assert.ok(kinds.includes('mensaje'), 'Debió seguir mostrando el banner de "mensaje"');
  });

  await check('Para un ADMIN/RECTOR, el comportamiento NO cambia: todos los kinds (excepto "login") siguen generando banner, incluido el estado del estudiante', async () => {
    const kinds = await correrPollingUnaVez('admin');
    for (const k of ['ausencia', 'alerta-academica', 'alerta-inasistencia', 'alerta-observador', 'alerta-academica-consecutiva', 'nota-cambiada-periodo-cerrado', 'config', 'mensaje']) {
      assert.ok(kinds.includes(k), 'El Admin SÍ debió seguir viendo el banner de kind=' + k);
    }
  });

  console.log('\n' + '═'.repeat(70));
  console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
  if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
  console.log('✅ 100% de la suite en verde.');
}
main();
