// ════════════════════════════════════════════════════════════════════════
// RONDA 74 — Inasistencias manuales en Planilla/Notas de Actividades y su
// reflejo en Boletines/Informes PDF.
//
// Metodología: se carga el módulo monolítico REAL
// (gestor-academico/dist/modules/03-app-core.js, tal cual del repositorio,
// SIN copias ni parches) dentro de un contexto Node "vm", truncado justo
// antes del bootstrap final (render()), con un DOM/browser stub mínimo.
// Esto permite invocar las funciones reales del sistema (no reimplementadas
// ni simuladas) contra fixtures de datos controlados.
//
// Cobertura pedida por la Ronda 74:
//  (a) La columna/función de Inasistencias solo aparece/actúa cuando
//      db.config.mostrarInasistenciasEnPlanilla === true.
//  (b) El guardado de inasistencias SIEMPRE viaja por la cola granular
//      serializada (_marcarFilaEnEdicion/_encolarFilaNotas/guardar-fila) y
//      JAMÁS dispara el guardado monolítico del blob completo
//      (_pushDB/POST /api/inetis/db) — la "regla de oro" de esta ronda.
//  (c) El switch opcional "vincular a SER" recalcula la nota del SER con
//      calcularNotaSERPorAsistencia() al guardar inasistencias, y NO lo hace
//      cuando el switch está desactivado.
//  (d) Los datos se reflejan correctamente en la estructura de datos que
//      consume el PDF del boletín/informe (_totalInasistenciasManualPeriodo/
//      _totalInasistenciasManualAnual), respetando el flag global.
//  (e) Aislamiento estricto por contexto [estudiante][cId][periodo]: cambiar
//      de asignatura o periodo nunca mezcla datos de otro contexto.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC_PATH = new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url);
let src = fs.readFileSync(SRC_PATH, 'utf8');

const marker = 'render();\n// Inyectar widget IA';
const idx = src.indexOf(marker);
if (idx === -1) { console.error('NO SE ENCONTRÓ EL MARCADOR DE CORTE'); process.exit(1); }
src = src.slice(0, idx);

// ── DOM/browser stub mínimo (misma técnica ya probada) ──
function fakeEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(),
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], childNodes: [],
    attributes: {},
    _listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {},
    remove() {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {}, blur() {}, select() {}, click() {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; },
    textContent: '',
    value: '',
    offsetWidth: 300, offsetHeight: 200,
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
  return el;
}
const _idRegistry = {};
const documentStub = {
  body: fakeEl('body'),
  documentElement: fakeEl('html'),
  readyState: 'complete',
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  getElementById(id) { return _idRegistry[id] || null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(tag) { return fakeEl(tag); },
  createElementNS(_ns, tag) { return fakeEl(tag); },
  createTextNode(t) { return { textContent: t }; },
};
class MutationObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class IntersectionObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
class ResizeObserverStub { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} }
const localStorageStub = (() => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
  };
})();

// ── Captura de red: nos deja verificar EXACTAMENTE qué endpoint recibió cada guardado ──
const _fetchCalls = [];
async function fetchStub(url, opts) {
  _fetchCalls.push({ url: String(url), opts: opts || {} });
  if (String(url).includes('/api/inetis/notas/guardar-fila')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, version: new Date().toISOString() }), text: async () => '' };
  }
  if (String(url).includes('/api/inetis/db')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, version: new Date().toISOString() }), text: async () => '' };
  }
  return { ok: false, status: 0, json: async () => ({}), text: async () => '' };
}

const ctx = {};
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
ctx.addEventListener = function(){};
ctx.removeEventListener = function(){};
ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; };
ctx.print = function(){};
ctx.scrollTo = function(){};
ctx.innerWidth = 1280;
ctx.innerHeight = 800;
ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = localStorageStub;
ctx.sessionStorage = localStorageStub;
ctx.fetch = fetchStub;
ctx.console = console;
ctx.MutationObserver = MutationObserverStub;
ctx.IntersectionObserver = IntersectionObserverStub;
ctx.ResizeObserver = ResizeObserverStub;
ctx.setTimeout = (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); if (t.unref) t.unref(); return t; };
ctx.clearTimeout = clearTimeout;
ctx.setInterval = (fn, ms, ...a) => { const t = setInterval(fn, ms, ...a); if (t.unref) t.unref(); return t; };
ctx.clearInterval = clearInterval;
ctx.requestAnimationFrame = (fn) => setTimeout(fn, 0);
ctx.URLSearchParams = URLSearchParams;
ctx.location = { search: '', pathname: '/', href: 'http://localhost/', hostname: 'localhost' };
ctx.history = { pushState(){}, replaceState(){} };
ctx.speechSynthesis = null;
ctx.SpeechSynthesisUtterance = function(){};
ctx.alert = () => {};
ctx.confirm = () => true;
ctx.prompt = () => null;
ctx.Image = function(){ return fakeEl('img'); };
ctx.FileReader = function(){ return { readAsDataURL(){}, readAsText(){} }; };
ctx.Blob = function(parts, opts){ this.parts = parts; this.opts = opts; };
ctx.FormData = function(){ this._d = new Map(); this.append = (k,v)=>this._d.set(k,v); };
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
ctx.matchMedia = () => ({ matches: false, addListener(){}, addEventListener(){} });
ctx.Notification = function(){};
ctx.EventSource = function(){ this.close = () => {}; };
ctx.WebSocket = function(){};
ctx.performance = performance;
ctx.btoa = typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(String(s), 'binary').toString('base64');
ctx.atob = typeof atob !== 'undefined' ? atob : (s) => Buffer.from(String(s), 'base64').toString('binary');

vm.createContext(ctx);

try {
  vm.runInContext(src, ctx, { filename: '03-app-core.js' });
} catch (e) {
  console.error('❌ ERROR AL CARGAR EL MÓDULO REAL:', e && e.stack ? e.stack : e);
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════
// Arnés de aserciones
// ════════════════════════════════════════════════════════════════════════
let pass = 0, fail = 0;
function check(desc, fn) {
  try {
    fn();
    pass++;
    console.log('✅ ' + desc);
  } catch (e) {
    fail++;
    console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e));
  }
}
function run(code) { return vm.runInContext(code, ctx); }
function runAsync(code) { return vm.runInContext('(async()=>{' + code + '})()', ctx); }

// ── Fixture de institución de prueba ──
function fixtureDB() {
  return {
    nombre: 'INSTITUCIÓN DE PRUEBA RONDA 74',
    anio: '2026',
    config: {
      numPeriodos: 4,
      pesosPeriodos: [25,25,25,25],
      pctSer: 0.25, pctSaber: 0.35, pctHacer: 0.40,
      nomSer: 'SER', nomSaber: 'SABER', nomHacer: 'HACER',
      escalaS: 4.7, escalaA: 4.0, escalaB: 3.0,
      mostrarInasistenciasEnPlanilla: false, // por defecto OFF
    },
    grados: [{ n: '10°', d: 'doc1' }],
    users: [{ u: 'doc1', r: 'docente', n: 'Docente Uno', p: 'x' }],
    carga: [
      { id: 101, g: '10°', m: 'Matemáticas', a: 'Matemáticas', d: 'doc1', dn: 'Docente Uno', ih: 5 },
      { id: 102, g: '10°', m: 'Español', a: 'Español', d: 'doc1', dn: 'Docente Uno', ih: 2 },
      { id: 103, g: '10°', m: 'Ética', a: 'Ética', d: 'doc1', dn: 'Docente Uno' }, // sin "ih" definida a propósito, para probar el valor base por defecto
    ],
    ests: [
      { id: 'e1', n: 'ANA PEREZ', g: '10°', nts: {} },
      { id: 'e2', n: 'BRAYAN LOPEZ', g: '10°', nts: {} },
    ],
    asistencia: [
      // 10 clases registradas de Matemáticas (cId 101) en el periodo 1, e1 faltó a 2
      ...Array.from({ length: 10 }, (_, i) => ({
        grado: '10°', cargaId: 101, periodo: '1',
        ausentes: i < 2 ? ['e1'] : [],
      })),
    ],
    periodosActivos: [true, true, true, true],
    notasAct: {}, notasActColumnas: [], notasActAsignadas: {},
    logNotas: [],
  };
}

function instalarDB(dbObj) {
  run('db = ' + JSON.stringify(dbObj) + ';');
  run('sesion = { u: "doc1", r: "docente", n: "Docente Uno" };');
  run('window._filaEnEdicion=null; window._loteFilasEnEdicion=null;');
  run('window._colaGuardadoFilas=[]; window._colaGuardadoFilasInfo={};');
  run('planCId="101"; planPer="1"; notaActCId="101"; notaActPer="1";');
  _fetchCalls.length = 0;
}

// ════════════════════════════════════════════════════════════════════════
// (a) Mostrar/ocultar columna según el flag global
// ════════════════════════════════════════════════════════════════════════
check('htmlPlanilla() NO incluye la columna INASIST. cuando el flag está en false', () => {
  instalarDB(fixtureDB());
  const html = run('htmlPlanilla()');
  assert.ok(!html.includes('INASIST.'), 'no debería aparecer la cabecera de Inasistencias');
  assert.ok(!html.includes('ina-input-e1'), 'no debería aparecer el input de inasistencias del estudiante');
});
check('htmlPlanilla() SÍ incluye la columna INASIST. cuando el flag está en true', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  const html = run('htmlPlanilla()');
  assert.ok(html.includes('INASIST.'), 'debería aparecer la cabecera de Inasistencias');
  assert.ok(html.includes('id="ina-input-e1"'), 'debería aparecer el input de inasistencias de e1');
  assert.ok(html.includes('id="ina-input-e2"'), 'debería aparecer el input de inasistencias de e2');
});
check('htmlNotasActividades() respeta el mismo flag (oculto por defecto)', () => {
  const d = fixtureDB();
  d.notasActColumnas = [{ id: 'c1', tipo: 'Actividad en clase', numero: 1, nombre: 'Actividad en clase 1' }];
  d.notasActAsignadas = { '101_1': ['c1'] };
  instalarDB(d);
  const html = run('htmlNotasActividades()');
  assert.ok(!html.includes('INASIST.'));
  assert.ok(!html.includes('ina-input-nac-e1'));
});
check('htmlNotasActividades() muestra la columna cuando el flag está activo', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  d.notasActColumnas = [{ id: 'c1', tipo: 'Actividad en clase', numero: 1, nombre: 'Actividad en clase 1' }];
  d.notasActAsignadas = { '101_1': ['c1'] };
  instalarDB(d);
  const html = run('htmlNotasActividades()');
  assert.ok(html.includes('INASIST.'));
  assert.ok(html.includes('id="ina-input-nac-e1"'));
});

// ════════════════════════════════════════════════════════════════════════
// (b) REGLA DE ORO — guardado SIEMPRE granular, nunca el blob completo
// ════════════════════════════════════════════════════════════════════════
check('guardarInasistenciaManual() marca la fila en edición y NUNCA deja window._filaEnEdicion activo después (se desmarca)', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',3)");
  assert.equal(run('window._filaEnEdicion'), null, '_filaEnEdicion debe quedar limpio tras guardar (ya se encoló)');
});
check('guardarInasistenciaManual() envía el guardado por /api/inetis/notas/guardar-fila (cola granular), NUNCA por /api/inetis/db', async () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',3)");
  // Esperar a que la cola serializada (async) despache el fetch encolado.
  await new Promise(r => setTimeout(r, 50));
  const llamadasGuardarFila = _fetchCalls.filter(c => c.url.includes('/api/inetis/notas/guardar-fila'));
  const llamadasBlobCompleto = _fetchCalls.filter(c => c.url.includes('/api/inetis/db'));
  assert.ok(llamadasGuardarFila.length >= 1, 'debe haber al menos un POST a guardar-fila');
  assert.equal(llamadasBlobCompleto.length, 0, 'JAMÁS debe dispararse el guardado monolítico del blob completo');
  const body = JSON.parse(llamadasGuardarFila[0].opts.body);
  assert.equal(body.tipo, 'planilla');
  assert.equal(body.estId, 'e1');
  assert.equal(Number(body.cId), 101);
  assert.equal(Number(body.per), 1);
  assert.equal(body.notas.ina, 3, 'el payload de la fila debe llevar el campo "ina" fusionado con el resto de la celda');
});
check('el valor de inasistencias queda escrito en el contexto real db.ests[].nts[cId][per].ina', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',5)");
  const val = run("db.ests.find(x=>x.id==='e1').nts[101][1].ina");
  assert.equal(val, 5);
});
check('valores negativos o no numéricos se sanean a 0 (entero >= 0)', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',-7)");
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[101][1].ina"), 0);
  run("guardarInasistenciaManual('e1','101','1','abc')");
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[101][1].ina"), 0);
  run("guardarInasistenciaManual('e1','101','1','4.9')");
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[101][1].ina"), 5, 'debe redondear a entero');
});

// ════════════════════════════════════════════════════════════════════════
// (e) Aislamiento estricto por contexto [estudiante][cId][periodo]
// ════════════════════════════════════════════════════════════════════════
check('el valor guardado en (cId=101,per=1) NO se filtra a (cId=102,per=1) ni a (cId=101,per=2) del mismo estudiante', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',7)");
  run("guardarInasistenciaManual('e1','102','1',2)");
  run("guardarInasistenciaManual('e1','101','2',9)");
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[101][1].ina"), 7);
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[102][1].ina"), 2);
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[101][2].ina"), 9);
});
check('el valor de un estudiante nunca contamina el de otro en el mismo contexto', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',4)");
  run("guardarInasistenciaManual('e2','101','1',1)");
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[101][1].ina"), 4);
  assert.equal(run("db.ests.find(x=>x.id==='e2').nts[101][1].ina"), 1);
});
check('_leerInasistenciaManual() devuelve 0 (no null/undefined) cuando el contexto no tiene datos aún', () => {
  instalarDB(fixtureDB());
  assert.equal(run("_leerInasistenciaManual('e2','102','3')"), 0);
});

// ════════════════════════════════════════════════════════════════════════
// (c) AJUSTE ESTRUCTURAL — motor de conversión % inasistencia -> nota del
// SER 100% PARAMETRIZABLE (db.config.escalaAsistenciaSER). Ya no hay NINGÚN
// tramo ni nota fijo en el código: calcularNotaSERPorAsistencia() es ahora
// el ÚNICO motor, usado tanto por el vínculo manual como por el botón
// automático "Asistencia → SER", y siempre lee la escala vigente de
// db.config en el momento del cálculo (sin caché ni estado previo).
// ════════════════════════════════════════════════════════════════════════
check('_escalaAsistenciaSERDefault() tiene los 4 tramos de inicialización pedidos', () => {
  // Comparación vía JSON.stringify: los objetos que cruzan la frontera del
  // sandbox "vm" no comparten prototipo de Object con los literales del
  // host, así que assert.deepEqual/deepStrictEqual los marca como distintos
  // aunque su forma sea idéntica — JSON.stringify evita ese falso negativo.
  const d = run('JSON.stringify(_escalaAsistenciaSERDefault())');
  assert.equal(d, JSON.stringify([
    { min: 0, max: 5, nota: 5.0 },
    { min: 5.1, max: 15, nota: 4.0 },
    { min: 15.1, max: 24.9, nota: 3.0 },
    { min: 25, max: 100, nota: 1.0 },
  ]));
});
check('_escalaAsistenciaSERActiva() usa los tramos de inicialización cuando la institución no ha configurado los suyos', () => {
  instalarDB(fixtureDB()); // fixtureDB() no define escalaAsistenciaSER
  assert.equal(run('db.config.escalaAsistenciaSER'), undefined);
  assert.deepEqual(run('_escalaAsistenciaSERActiva()'), run('_escalaAsistenciaSERDefault()'));
});
check('REQUISITO (a): 0 inasistencias asigna la nota del Rango 1 (por defecto 5.0)', () => {
  instalarDB(fixtureDB());
  assert.equal(run('calcularNotaSERPorAsistencia(0,10)'), 5.0);
  assert.equal(run('calcularNotaSERPorAsistencia(0,100)'), 5.0);
});
check('calcularNotaSERPorAsistencia() con la escala de inicialización: cae en cada uno de los 4 tramos exactamente donde corresponde', () => {
  instalarDB(fixtureDB());
  assert.equal(run('calcularNotaSERPorAsistencia(5,100)'), 5.0);   // 5%   -> tramo 1 (0–5)
  assert.equal(run('calcularNotaSERPorAsistencia(6,100)'), 4.0);   // 6%   -> tramo 2 (5.1–15)
  assert.equal(run('calcularNotaSERPorAsistencia(15,100)'), 4.0);  // 15%  -> tramo 2
  assert.equal(run('calcularNotaSERPorAsistencia(16,100)'), 3.0);  // 16%  -> tramo 3 (15.1–24.9)
  assert.equal(run('calcularNotaSERPorAsistencia(24.9,100)'), 3.0);// 24.9% -> tramo 3 (límite exacto pedido)
  assert.equal(run('calcularNotaSERPorAsistencia(25,100)'), 1.0);  // 25%  -> tramo 4 (crítico)
  assert.equal(run('calcularNotaSERPorAsistencia(80,100)'), 1.0);  // muy por encima -> sigue en el último tramo
});
check('calcularNotaSERPorAsistencia() sigue devolviendo null cuando no hay ninguna base real (total=0), sin importar la escala configurada', () => {
  instalarDB(fixtureDB());
  assert.equal(run('calcularNotaSERPorAsistencia(0,0)'), null);
  assert.equal(run('calcularNotaSERPorAsistencia(5,0)'), null);
});
check('REQUISITO (b): al modificar dinámicamente db.config.escalaAsistenciaSER, el cálculo cambia AL INSTANTE, sin reiniciar la app', () => {
  const d = fixtureDB();
  instalarDB(d);
  // Con la escala de inicialización, 10% de inasistencia da 4.0 (tramo 2).
  assert.equal(run('calcularNotaSERPorAsistencia(1,10)'), 4.0);
  // El "administrador" reconfigura la escala en caliente, EN LA MISMA
  // SESIÓN, sin recargar ni reinstalar nada — solo mutando db.config.
  run(`db.config.escalaAsistenciaSER = [
    {min:0, max:100, nota:3.5}
  ];`);
  // La MISMA llamada, con los MISMOS argumentos, ahora refleja la nueva
  // configuración de inmediato.
  assert.equal(run('calcularNotaSERPorAsistencia(1,10)'), 3.5);
  assert.equal(run('calcularNotaSERPorAsistencia(9,10)'), 3.5);
  // Y se puede volver a reconfigurar cuantas veces se quiera.
  run(`db.config.escalaAsistenciaSER = [
    {min:0, max:49.9, nota:5.0},
    {min:50, max:100, nota:0.0}
  ];`);
  assert.equal(run('calcularNotaSERPorAsistencia(4,10)'), 5.0); // 40%
  assert.equal(run('calcularNotaSERPorAsistencia(5,10)'), 0.0); // 50%
});
check('una escala institucional vacía ([]) no deja a la institución sin motor de cálculo: se vuelve a la escala de inicialización', () => {
  const d = fixtureDB(); d.config.escalaAsistenciaSER = [];
  instalarDB(d);
  assert.deepEqual(run('_escalaAsistenciaSERActiva()'), run('_escalaAsistenciaSERDefault()'));
  assert.equal(run('calcularNotaSERPorAsistencia(0,10)'), 5.0);
});
check('_totalHorasEstimadasPeriodo(): Intensidad Horaria Semanal × 10 semanas', () => {
  instalarDB(fixtureDB());
  assert.equal(run("_totalHorasEstimadasPeriodo({ih:5})"), 50);
  assert.equal(run("_totalHorasEstimadasPeriodo({ih:2})"), 20);
});
check('_totalHorasEstimadasPeriodo(): sin "ih" definida usa 1 hora/semana (=10 horas) por defecto', () => {
  instalarDB(fixtureDB());
  assert.equal(run("_totalHorasEstimadasPeriodo({})"), 10);
  assert.equal(run("_totalHorasEstimadasPeriodo(db.carga.find(c=>c.id===103))"), 10);
});
check('con el switch de vínculo DESACTIVADO (por defecto), guardar inasistencias NO toca la nota del SER', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("db.ests.find(x=>x.id==='e1').nts[101]={1:{s:4.2,sb:0,h:0,rec:0,niv:0}};");
  run("guardarInasistenciaManual('e1','101','1',9)");
  const serVal = run("db.ests.find(x=>x.id==='e1').nts[101][1].s");
  assert.equal(serVal, 4.2, 'la nota del SER no debe cambiar cuando el vínculo está desactivado');
});
check('con el switch de vínculo ACTIVADO, guardar inasistencias manuales SÍ recalcula el SER usando el MISMO motor parametrizable, con la asistencia REAL cuando existe', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("_toggleVincularInasistManualSER('101')"); // activa el vínculo para cId=101
  assert.equal(run("_vincularInasistManualSERActivo('101')"), true);
  // 10 clases REALES registradas para cId=101/per=1 (ver fixtureDB.asistencia) — 1 inasistencia = 10% -> tramo 2 (5.1-15) = 4.0
  run("guardarInasistenciaManual('e1','101','1',1)");
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[101][1].s"), 4.0);
});
check('el vínculo a SER es POR ASIGNATURA (cId): activarlo en 101 no activa 102', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("_toggleVincularInasistManualSER('101')");
  assert.equal(run("_vincularInasistManualSERActivo('101')"), true);
  assert.equal(run("_vincularInasistManualSERActivo('102')"), false);
});
check('sin registros de asistencia automática, el vínculo manual usa la Intensidad Horaria Semanal de la asignatura (ih×10) y SÍ recalcula el SER con la escala configurada', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true; // 102 (Español) tiene ih:2 -> 20 horas estimadas, y NO tiene registros de asistencia en el fixture
  instalarDB(d);
  run("_toggleVincularInasistManualSER('102')");
  run("db.ests.find(x=>x.id==='e1').nts[102]={1:{s:3.3,sb:0,h:0,rec:0,niv:0}};");
  run("guardarInasistenciaManual('e1','102','1',1)"); // 1/20 = 5% -> tramo 1 (0-5) = 5.0
  const serVal = run("db.ests.find(x=>x.id==='e1').nts[102][1].s");
  assert.notEqual(serVal, 3.3, 'debe recalcularse (antes este caso quedaba sin tocar por falta de una referencia de horas)');
  assert.equal(serVal, 5.0);
});
check('la asistencia automática REAL sigue teniendo prioridad sobre la estimación por Intensidad Horaria cuando ambas existen', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true; // 101 tiene ih:5 (50h estimadas) PERO además 10 registros reales en el fixture — deben usarse los reales
  instalarDB(d);
  run("_toggleVincularInasistManualSER('101')");
  run("guardarInasistenciaManual('e1','101','1',5)"); // 5 de 10 REALES = 50% (crítico) vs. 5 de 50 estimadas = 10% (tramo 2) — deben ganar los 10 reales
  const serVal = run("db.ests.find(x=>x.id==='e1').nts[101][1].s");
  assert.equal(serVal, 1.0, 'debe usar los 10 registros reales de asistencia (50% => tramo crítico), no la estimación de 50 horas por ih');
});
check('REQUISITO (b, extendido): reconfigurar la escala también cambia AL INSTANTE lo que calcula guardarInasistenciaManual() en la misma sesión', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("_toggleVincularInasistManualSER('102')"); // 102: ih=2 -> 20 horas estimadas
  run("guardarInasistenciaManual('e1','102','1',1)"); // 5% -> tramo 1 por defecto = 5.0
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[102][1].s"), 5.0);
  // El administrador cambia la escala institucional EN CALIENTE...
  run(`db.config.escalaAsistenciaSER = [{min:0, max:100, nota:2.0}];`);
  // ...y la SIGUIENTE edición del mismo docente, en la misma sesión, ya usa la nueva escala.
  run("guardarInasistenciaManual('e1','102','1',2)"); // 10% -> con la nueva escala única, sigue siendo 2.0
  assert.equal(run("db.ests.find(x=>x.id==='e1').nts[102][1].s"), 2.0);
});

// ════════════════════════════════════════════════════════════════════════
// (d) Reflejo en la estructura de datos que consume el PDF del boletín
// ════════════════════════════════════════════════════════════════════════
check('_totalInasistenciasManualPeriodo() suma correctamente todas las asignaturas del grado en un periodo', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',3)"); // Matemáticas P1
  run("guardarInasistenciaManual('e1','102','1',2)"); // Español P1
  assert.equal(run("_totalInasistenciasManualPeriodo('e1','10°','1')"), 5);
});
check('_totalInasistenciasManualAnual() suma los 4 periodos configurados', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',1)");
  run("guardarInasistenciaManual('e1','101','2',2)");
  run("guardarInasistenciaManual('e1','101','3',3)");
  run("guardarInasistenciaManual('e1','101','4',4)");
  assert.equal(run("_totalInasistenciasManualAnual('e1','10°')"), 10);
});
check('_generarBoletinesPDF NO incluye el bloque de Inasistencias en el PDF cuando el flag está en false (comprobado por código fuente de la función)', () => {
  // Verificación estructural: el bloque de inasistencias del boletín está
  // condicionado por "if((db.config||{}).mostrarInasistenciasEnPlanilla===true)"
  // dentro de _generarBoletinesPDF — se verifica que ese guard exista
  // envolviendo el texto "INASISTENCIAS" para asegurar que años/instituciones
  // con el flag apagado no vean ningún cambio en su boletín.
  const fnSrc = run('_generarBoletinesPDF.toString()');
  const guardIdx = fnSrc.indexOf('mostrarInasistenciasEnPlanilla===true');
  const inasIdx = fnSrc.indexOf("INASISTENCIAS");
  assert.ok(guardIdx !== -1, 'debe existir el guard del flag dentro de _generarBoletinesPDF');
  assert.ok(inasIdx !== -1 && inasIdx > guardIdx, 'el texto de inasistencias debe estar DESPUÉS del guard (dentro del if)');
});
check('con el flag activo, el texto de Inasistencias por periodo se arma con los totales reales del estudiante', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',6)");
  const totalPer = run("_totalInasistenciasManualPeriodo('e1','10°','1')");
  const txt = 'INASISTENCIAS DEL PERIODO 1: ' + totalPer;
  assert.equal(txt, 'INASISTENCIAS DEL PERIODO 1: 6');
});
check('en el Informe Final (incluirResumenFinal), el texto también incluye el acumulado anual', () => {
  const d = fixtureDB(); d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  run("guardarInasistenciaManual('e1','101','1',2)");
  run("guardarInasistenciaManual('e1','101','2',3)");
  const per = 2, incluirResumenFinal = true;
  const inasPer = run(`_totalInasistenciasManualPeriodo('e1','10°','${per}')`);
  const inasAnual = run("_totalInasistenciasManualAnual('e1','10°')");
  const txt = incluirResumenFinal
    ? 'INASISTENCIAS — PERIODO '+per+': '+inasPer+'   |   ACUMULADO ANUAL: '+inasAnual
    : 'INASISTENCIAS DEL PERIODO '+per+': '+inasPer;
  assert.equal(txt, 'INASISTENCIAS — PERIODO 2: 3   |   ACUMULADO ANUAL: 5');
});

// ════════════════════════════════════════════════════════════════════════
// Config: switch global en el panel de Configuración
// ════════════════════════════════════════════════════════════════════════
check('htmlConfigEvalPedagogica() incluye el checkbox del switch global, marcado según db.config', () => {
  const d = fixtureDB();
  instalarDB(d);
  let html = run('htmlConfigEvalPedagogica()');
  assert.ok(html.includes('id="cfgMostrarInasistPlanilla"'));
  assert.ok(!/id="cfgMostrarInasistPlanilla"[^>]*checked/.test(html), 'debe aparecer SIN checked cuando el flag es false');
  d.config.mostrarInasistenciasEnPlanilla = true;
  instalarDB(d);
  html = run('htmlConfigEvalPedagogica()');
  assert.ok(/id="cfgMostrarInasistPlanilla"[^>]*checked/.test(html), 'debe aparecer CON checked cuando el flag es true');
});
check('guardarConfigPedagogica() persiste el checkbox en db.config.mostrarInasistenciasEnPlanilla', () => {
  const d = fixtureDB();
  instalarDB(d);
  // Stub de los demás campos que lee guardarConfigPedagogica() para que no falle por elementos ausentes del DOM real.
  run(`
    document.getElementById=function(id){
      if(id==='cfgMostrarInasistPlanilla') return {checked:true};
      if(id==='cfgNumPer') return {value:'4'};
      if(id==='cfgPctInasistCritica') return {value:'25'};
      if(id==='cfgPctInasistPreventiva') return {value:'20'};
      if(id.startsWith('pesPer_')) return {value:'25'};
      return null; // sin stub de cfgEscalaAsistSERLista: guardarConfigPedagogica() debe tolerarlo sin fallar
    };
  `);
  run('guardarConfigPedagogica()');
  assert.equal(run('db.config.mostrarInasistenciasEnPlanilla'), true);
});
check('CORRECCIÓN — htmlConfigEvalPedagogica() YA NO muestra el campo manual de "Total de clases dictadas por periodo" (se eliminó según lo pedido)', () => {
  instalarDB(fixtureDB());
  const html = run('htmlConfigEvalPedagogica()');
  assert.ok(!html.includes('cfgTotalClasesInasistManual'));
  assert.ok(!html.includes('Total de clases dictadas por periodo'));
  assert.ok(html.includes('id="cfgMostrarInasistPlanilla"'));
});
check('htmlConfigEvalPedagogica() renderiza un tramo por cada fila de la escala activa, con sus valores min/max/nota', () => {
  const d = fixtureDB();
  instalarDB(d); // sin escala propia -> usa la de inicialización (4 tramos)
  const html = run('htmlConfigEvalPedagogica()');
  assert.ok(html.includes('id="cfgEscalaAsistSERLista"'));
  assert.ok(html.includes('data-tramoidx="0"') && html.includes('data-tramoidx="3"'));
  assert.ok(html.includes('value="5.1"'), 'debe reflejar el mínimo del segundo tramo por defecto');
  assert.ok(html.includes('onclick="agregarTramoEscalaSER()"'));
});
check('htmlConfigEvalPedagogica() renderiza la escala PROPIA de la institución cuando ya la configuró (no la de inicialización)', () => {
  const d = fixtureDB();
  d.config.escalaAsistenciaSER = [{min:0,max:100,nota:2.5}];
  instalarDB(d);
  const html = run('htmlConfigEvalPedagogica()');
  assert.ok(html.includes('data-tramoidx="0"'));
  assert.ok(!html.includes('data-tramoidx="1"'), 'no debe haber un segundo tramo — la institución solo configuró uno');
  assert.ok(html.includes('value="2.5"'));
});
check('guardarConfigPedagogica() persiste una escala editada por el administrador leyendo fila por fila del editor', () => {
  const d = fixtureDB();
  instalarDB(d);
  // Simula 2 filas del editor dinámico, tal como quedarían en el DOM real
  // tras usar "➕ Agregar tramo" / "✕" y escribir los valores.
  const fakeRow = (min, max, nota) => ({
    querySelector(sel) {
      if (sel.includes('"min"')) return { value: String(min) };
      if (sel.includes('"max"')) return { value: String(max) };
      if (sel.includes('"nota"')) return { value: String(nota) };
      return null;
    },
  });
  const fakeLista = { querySelectorAll: () => [fakeRow(0, 49.9, 5.0), fakeRow(50, 100, 1.0)] };
  run(`
    document.getElementById=function(id){
      if(id==='cfgMostrarInasistPlanilla') return {checked:true};
      if(id==='cfgNumPer') return {value:'4'};
      if(id==='cfgPctInasistCritica') return {value:'25'};
      if(id==='cfgPctInasistPreventiva') return {value:'20'};
      if(id.startsWith('pesPer_')) return {value:'25'};
      return null;
    };
  `);
  const _baseGetById = run('document.getElementById');
  ctx.document.getElementById = (id) => (id === 'cfgEscalaAsistSERLista' ? fakeLista : _baseGetById(id));
  run('guardarConfigPedagogica()');
  assert.equal(run('JSON.stringify(db.config.escalaAsistenciaSER)'), JSON.stringify([
    { min: 0, max: 49.9, nota: 5.0 },
    { min: 50, max: 100, nota: 1.0 },
  ]));
  // Y el motor de cálculo usa esa escala recién guardada de inmediato.
  assert.equal(run('calcularNotaSERPorAsistencia(4,10)'), 5.0); // 40%
  assert.equal(run('calcularNotaSERPorAsistencia(5,10)'), 1.0); // 50%
});
check('guardarConfigPedagogica() rechaza (no guarda) un tramo con nota fuera de 0.0–5.0, sin bloquear el resto del guardado', () => {
  const d = fixtureDB();
  instalarDB(d);
  const fakeRow = (min, max, nota) => ({
    querySelector(sel) {
      if (sel.includes('"min"')) return { value: String(min) };
      if (sel.includes('"max"')) return { value: String(max) };
      if (sel.includes('"nota"')) return { value: String(nota) };
      return null;
    },
  });
  const fakeLista = { querySelectorAll: () => [fakeRow(0, 100, 7.5)] }; // nota inválida (>5)
  run(`
    document.getElementById=function(id){
      if(id==='cfgMostrarInasistPlanilla') return {checked:true};
      if(id==='cfgNumPer') return {value:'4'};
      if(id==='cfgPctInasistCritica') return {value:'25'};
      if(id==='cfgPctInasistPreventiva') return {value:'20'};
      if(id.startsWith('pesPer_')) return {value:'25'};
      return null;
    };
  `);
  const _baseGetById = run('document.getElementById');
  ctx.document.getElementById = (id) => (id === 'cfgEscalaAsistSERLista' ? fakeLista : _baseGetById(id));
  run('guardarConfigPedagogica()');
  assert.equal(run('db.config.mostrarInasistenciasEnPlanilla'), true, 'el resto de la configuración debe guardarse igual');
  assert.equal(run('db.config.escalaAsistenciaSER'), undefined, 'un tramo inválido no debe dejar guardada una escala parcial/incorrecta');
});
check('el texto visible del panel de administración ya NO menciona "Ronda 74" (para no confundir al administrador)', () => {
  const d = fixtureDB();
  instalarDB(d);
  const html = run('htmlConfigEvalPedagogica()');
  assert.ok(!html.includes('Ronda 74'));
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
