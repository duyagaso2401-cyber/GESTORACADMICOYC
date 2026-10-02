// ════════════════════════════════════════════════════════════════════════
// RONDA 109 — auditoría solicitada explícitamente por el usuario sobre dos
// frentes:
//   1) Asistencia → SER: ya se acumulaba el historial COMPLETO del periodo
//      y ya se distinguía Justificada de No-justificada (confirmado leyendo
//      el código real de las Rondas 72-74) — lo que faltaba era la fórmula
//      de conversión lineal pedida (100%→5.0, 90%→4.5, 80%→4.0, ...) en vez
//      de los 4 tramos agresivos que traía por defecto. Se mantiene
//      intacta la posibilidad de que una institución configure su propia
//      escala personalizada (comportamiento sin cambios para ellas).
//   2) Notas de Actividades → componente de Planilla: el promedio de TODAS
//      las actividades ya se calculaba bien (_promedioNotasActEst), pero
//      requería que el docente volviera a pulsar "Sincronizar" tras cada
//      actividad nueva. Ahora, una vez sincronizado una vez, el vínculo se
//      recuerda (db.notasActVinculoComponente) y cualquier actividad nueva
//      dispara el recálculo automático (_dispararAutoSyncNACSiAplica).
// Esta prueba cubre ambos frentes, más la previsualización del panel de
// Asistencia (Frente 3).
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

check('Existe _notaLinealPorPctAsistencia() y calcularNotaSERPorAsistencia() usa la escala personalizada SOLO si la institución la configuró', () => {
  assert.match(srcCoreFull, /function _notaLinealPorPctAsistencia\(pctAsistencia\)/);
  assert.match(srcCoreFull, /const escalaPersonalizada=Array\.isArray\(db\.config&&db\.config\.escalaAsistenciaSER\)&&db\.config\.escalaAsistenciaSER\.length;/);
});

check('htmlAsistencia() incluye la columna "Acumulado / Nota SER" y la leyenda de conversión', () => {
  assert.match(srcDocs, /Acumulado \/ Nota SER/);
  assert.match(srcDocs, /_previsualizacionAsistenciaSER/);
  assert.match(srcDocs, /_filasLeyendaEscalaAsistenciaSER/);
});

check('_confirmarSyncNAC() persiste el vínculo de componente y _dispararAutoSyncNACSiAplica() existe', () => {
  assert.match(srcCoreFull, /d\.notasActVinculoComponente\[cId\+'_'\+per\]=colKey;/);
  assert.match(srcCoreFull, /function _dispararAutoSyncNACSiAplica\(cId,per,estIds\)/);
});

check('_guardarNotaAct(), eliminarNotaAct(), aplicarReplicaNotaAct() y _aplicarNotasActPendientesEnDB() llaman al auto-sync', () => {
  assert.match(srcCoreFull, /_dispararAutoSyncNACSiAplica\(cId,per,estId\);/);
  assert.match(srcCoreFull, /_dispararAutoSyncNACSiAplica\(cId,per,ests\.map\(e=>e\.id\)\);/);
  assert.match(srcCoreFull, /porCombinacion\[combo\]=\{cId:p\.cId,per:p\.per,ests:\[\]\};/);
});

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

const marker = 'render();\n// Inyectar widget IA';
const idxCorte = srcCoreFull.indexOf(marker);
if (idxCorte === -1) { console.error('❌ NO SE ENCONTRÓ EL MARCADOR DE CORTE PARA EL ARRANQUE DEL VM'); process.exit(1); }
const srcCore = srcCoreFull.slice(0, idxCorte);

vm.createContext(ctx);
try { vm.runInContext(srcCore, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

// ── Frente 1/2.1: fórmula lineal por defecto ──────────────────────────────
check('_notaLinealPorPctAsistencia(): 100%→5.0, 90%→4.5, 80%→4.0, 50%→2.5, 0%→0.0', () => {
  assert.equal(run('_notaLinealPorPctAsistencia(100)'), 5.0);
  assert.equal(run('_notaLinealPorPctAsistencia(90)'), 4.5);
  assert.equal(run('_notaLinealPorPctAsistencia(80)'), 4.0);
  assert.equal(run('_notaLinealPorPctAsistencia(50)'), 2.5);
  assert.equal(run('_notaLinealPorPctAsistencia(0)'), 0.0);
});

check('calcularNotaSERPorAsistencia(): SIN escala personalizada, usa la fórmula lineal sobre % de ASISTENCIA (no de inasistencia)', () => {
  run("db={config:{}};");
  // 10 clases, 1 inasistencia no justificada → 90% de asistencia → 4.5
  assert.equal(run('calcularNotaSERPorAsistencia(1,10)'), 4.5);
  // 10 clases, 0 inasistencias → 100% → 5.0
  assert.equal(run('calcularNotaSERPorAsistencia(0,10)'), 5.0);
  // 10 clases, 10 inasistencias → 0% asistencia → 0.0
  assert.equal(run('calcularNotaSERPorAsistencia(10,10)'), 0.0);
  // sin clases de referencia → null (contrato sin cambios)
  assert.equal(run('calcularNotaSERPorAsistencia(0,0)'), null);
});

check('calcularNotaSERPorAsistencia(): CON escala personalizada configurada por la institución, se respeta tal cual (comportamiento sin cambios)', () => {
  run(`db={config:{escalaAsistenciaSER:[
    {min:0,max:10,nota:5.0},
    {min:10.1,max:100,nota:2.0}
  ]}};`);
  // 10 clases, 1 inasistencia → 10% inasistencia → tramo [0,10] → nota 5.0
  assert.equal(run('calcularNotaSERPorAsistencia(1,10)'), 5.0);
  // 10 clases, 3 inasistencias → 30% inasistencia → tramo [10.1,100] → nota 2.0
  assert.equal(run('calcularNotaSERPorAsistencia(3,10)'), 2.0);
});

// ── Frente 3: previsualización ────────────────────────────────────────────
check('_previsualizacionAsistenciaSER(): acumula TODO el historial del periodo, distingue Justificada de No-justificada, y coincide con calcularNotaSERPorAsistencia()', () => {
  run(`db={
    config:{},
    carga:[{id:1,g:'1A',m:'Matemáticas'}],
    ests:[{id:'e1',n:'EST UNO',g:'1A'}],
    asistencia:[
      {id:'a1',fecha:'2026-01-01',periodo:'1',grado:'1A',cargaId:1,presentes:[],ausentes:['e1'],justificados:[]},
      {id:'a2',fecha:'2026-01-02',periodo:'1',grado:'1A',cargaId:1,presentes:['e1'],ausentes:[],justificados:[]},
      {id:'a3',fecha:'2026-01-03',periodo:'1',grado:'1A',cargaId:1,presentes:[],ausentes:[],justificados:['e1']},
      {id:'a4',fecha:'2026-01-04',periodo:'1',grado:'1A',cargaId:1,presentes:['e1'],ausentes:[],justificados:[]},
      {id:'a5',fecha:'2026-01-05',periodo:'2',grado:'1A',cargaId:1,presentes:[],ausentes:['e1'],justificados:[]}
    ]
  };`);
  // Periodo 1: 4 clases totales, 1 inasistencia NO justificada (a1), 1
  // justificada (a3, NO cuenta como inasistencia) → asistencia = 3/4 = 75%.
  const prev = run("_previsualizacionAsistenciaSER(1,'1','e1','1A')");
  assert.equal(prev.totalClases, 4);
  assert.equal(prev.inasistencias, 1);
  assert.equal(prev.pctAsistencia, 75);
  assert.equal(prev.notaProyectada, 3.8); // round(75/100*5,1) = 3.75 → 3.8 (banker's/half-up vía Math.round)
  // El periodo 2 (solo 1 clase, con inasistencia) no debe mezclarse con el periodo 1.
  const prev2 = run("_previsualizacionAsistenciaSER(1,'2','e1','1A')");
  assert.equal(prev2.totalClases, 1);
  assert.equal(prev2.inasistencias, 1);
  assert.equal(prev2.pctAsistencia, 0);
  assert.equal(prev2.notaProyectada, 0.0);
});

check('_previsualizacionAsistenciaSER(): sin clases del periodo, "nunca lanza" y devuelve totalClases:0', () => {
  run(`db={config:{},carga:[{id:1,g:'1A',m:'Matemáticas'}],ests:[{id:'e1',n:'EST UNO',g:'1A'}],asistencia:[]};`);
  const prev = run("_previsualizacionAsistenciaSER(1,'1','e1','1A')");
  assert.equal(prev.totalClases, 0);
  assert.equal(prev.notaProyectada, null);
});

// ── Frente 2.2/4: promedio dinámico de Notas de Actividades ──────────────
function fixtureNAC() {
  return {
    anio:'2026',
    config:{numPeriodos:1},
    carga:[{id:1,g:'1A',m:'Matemáticas',d:'doc1'}],
    ests:[{id:'e1',n:'EST UNO',g:'1A',nts:{}}],
    notasActColumnas:[{id:'col1',tipo:'Talleres',numero:1,nombre:'Taller 1'}],
    notasActAsignadas:{'1_1':['col1']},
    notasAct:{'1_1_col1_e1':{valor:4.0,fecha:'2026-01-01',hora:'',obs:''}},
  };
}

check('_confirmarSyncNAC(): al sincronizar, queda recordado el vínculo asignatura+periodo → componente', () => {
  run('db = ' + JSON.stringify(fixtureNAC()) + ';');
  run("notaActCId='1'; notaActPer='1';");
  run("window.customAlert = function(){ return Promise.resolve(true); };");
  run("_confirmarSyncNAC('h')");
  assert.equal(run("db.notasActVinculoComponente['1_1']"), 'h');
  assert.equal(run("db.ests.find(e=>e.id==='e1').nts['1']['1'].h"), 4.0);
});

check('_dispararAutoSyncNACSiAplica(): una actividad NUEVA agregada DESPUÉS de sincronizar se incorpora SOLA al promedio (promedio dinámico, sin sobreescribir con solo la última)', () => {
  const fx = fixtureNAC();
  run('db = ' + JSON.stringify(fx) + ';');
  run("notaActCId='1'; notaActPer='1';");
  run("window.customAlert = function(){ return Promise.resolve(true); };");
  run("_confirmarSyncNAC('h')"); // vínculo: cId 1, per 1 → componente 'h', con 1 actividad (4.0) → h=4.0
  assert.equal(run("db.ests.find(e=>e.id==='e1').nts['1']['1'].h"), 4.0);

  // Se agrega una SEGUNDA columna de actividad (promedio esperado: (4.0+2.0)/2 = 3.0)
  run(`db.notasActColumnas.push({id:'col2',tipo:'Evaluación',numero:2,nombre:'Eval 1'});`);
  run(`db.notasActAsignadas['1_1']=['col1','col2'];`);
  // Simula el guardado de esta segunda actividad en modo Auto-guardar (como
  // haría _guardarNotaAct en la pantalla real): se escribe el valor y se
  // dispara el auto-sync, SIN que el docente vuelva a abrir el modal.
  run(`
    updDB(d=>{
      d.notasAct=d.notasAct||{};
      d.notasAct['1_1_col2_e1']={valor:2.0,fecha:'2026-01-02',hora:'',obs:''};
      return d;
    });
    _dispararAutoSyncNACSiAplica(1,1,'e1');
  `);
  assert.equal(run("db.ests.find(e=>e.id==='e1').nts['1']['1'].h"), 3.0, 'El componente vinculado debió recalcularse SOLO, promediando AMBAS actividades (4.0+2.0)/2=3.0, nunca sobreescrito con solo la última (2.0)');
});

check('_dispararAutoSyncNACSiAplica(): si NUNCA se sincronizó (no hay vínculo), no escribe nada ni lanza', () => {
  run('db = ' + JSON.stringify(fixtureNAC()) + ';');
  run('_dispararAutoSyncNACSiAplica(1,1,"e1")');
  const h = run("(db.ests.find(e=>e.id==='e1').nts['1']&&db.ests.find(e=>e.id==='e1').nts['1']['1'])||null");
  assert.equal(h, null, 'Sin vínculo previo, no debe crear ni modificar ninguna celda de la Planilla');
});

check('_dispararAutoSyncNACSiAplica(): al eliminar una actividad, el promedio del componente vinculado baja de inmediato (ya no sobreestima con la actividad borrada)', () => {
  const fx = fixtureNAC();
  fx.notasActColumnas.push({id:'col2',tipo:'Evaluación',numero:2,nombre:'Eval 1'});
  fx.notasActAsignadas['1_1']=['col1','col2'];
  fx.notasAct['1_1_col2_e1']={valor:2.0,fecha:'2026-01-02',hora:'',obs:''};
  run('db = ' + JSON.stringify(fx) + ';');
  run("notaActCId='1'; notaActPer='1';");
  run("window.customAlert = function(){ return Promise.resolve(true); };");
  run("_confirmarSyncNAC('sb')"); // promedio inicial: (4.0+2.0)/2=3.0
  assert.equal(run("db.ests.find(e=>e.id==='e1').nts['1']['1'].sb"), 3.0);
  // Se borra la actividad col2 (4.0 queda como única actividad restante)
  run(`
    updDB(d=>{ if(d.notasAct) delete d.notasAct['1_1_col2_e1']; return d; });
    _dispararAutoSyncNACSiAplica(1,1,'e1');
  `);
  assert.equal(run("db.ests.find(e=>e.id==='e1').nts['1']['1'].sb"), 4.0);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
