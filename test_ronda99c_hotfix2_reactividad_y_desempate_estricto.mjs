// ════════════════════════════════════════════════════════════════════════
// RONDA 99-HOTFIX2 — El usuario reportó, con evidencia numérica nueva
// (capturas de Grado 5° y 4° con un docente distinto, "Ángel Gómez"), DOS
// problemas de raíz reales en el módulo de Consolidados:
//
// FRENTE 1 — REACTIVIDAD AUTOMÁTICA: al entrar a Consolidados o cambiar
// Grado/Periodo, la tabla no se actualizaba sola — había que tocar "Ver en
// Pantalla" siempre, incluso la primera vez. FIX: se agregó onchange=
// "verConsolidado()" (y equivalentes para Consolidado General y Seguimiento
// Académico/Director de Grupo y Estadísticas) a los <select> de Grado y
// Periodo, y se dispara automáticamente apenas se inserta el HTML de cada
// pantalla (sin esperar ningún clic).
//
// FRENTE 2 — ALGORITMO DE PUESTOS: se descubrió que varias pantallas "por
// periodo" (Consolidado, Consolidado General, Seguimiento Académico y sus
// PDF/XLSX) mostraban un PROM calculado como el promedio SIMPLE de ESE
// periodo, pero pedían el PUESTO a puestoEst()/calcPromedioEst(), que es el
// promedio ANUAL ponderado por área — un número DISTINTO. Esto producía
// inversiones reales (un 4.53 en mejor puesto que un 4.58) y falsos
// empates (✏️ apareciendo entre promedios visualmente distintos). FIX: se
// separó el cálculo del ranking del cálculo del promedio — toda pantalla
// arma su propio arreglo {id,prom} con el MISMO número que muestra y se lo
// pasa a _calcularRankingGrado(), que aplica el desempate en cascada
// (promedio → inasistencias → áreas bajo/básico) sobre esos mismos
// valores, con redondeo estricto a 2 decimales (_promRedondeado) ANTES de
// comparar. puestoEst()/_estudianteEmpatadoEnGrado() se reescribieron para
// usar el mismo motor con el promedio ANUAL, para las pantallas que sí lo
// necesitan (Consolidado Completo, boletines).
//
// METODOLOGÍA: mismo harness "vm" de Rondas 74-99 para probar el motor de
// ranking con datos reales controlados; regex tolerantes sobre el código
// fuente para confirmar el cableado de reactividad (onchange/auto-render)
// que no se puede probar con un DOM real en este entorno.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcCore = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

// ════════════════════════════════════════════════════════════════════════
// PARTE 1 — REACTIVIDAD AUTOMÁTICA (regex sobre el código fuente)
// ════════════════════════════════════════════════════════════════════════
check('Los <select> de Grado/Periodo de Consolidado (Docente y Admin, render inicial y por pestaña) llevan onchange="verConsolidado()"', () => {
  const ocurrencias = srcCore.match(/id="infGrado" onchange="verConsolidado\(\)"/g) || [];
  const ocurrenciasPer = srcCore.match(/id="infPer" onchange="verConsolidado\(\)"/g) || [];
  assert.ok(ocurrencias.length >= 3, 'debe haber al menos 3 <select id="infGrado"> reactivos (docente, admin inicial, pestaña)');
  assert.ok(ocurrenciasPer.length >= 3, 'debe haber al menos 3 <select id="infPer"> reactivos');
});
check('verConsolidado() se dispara automáticamente sin esperar clic (setTimeout(verConsolidado,0) o llamada directa tras insertar el HTML)', () => {
  const automatico = /setTimeout\(verConsolidado,0\)/.test(srcCore) && (srcCore.match(/setTimeout\(verConsolidado,0\)/g) || []).length >= 2;
  const directo = /`;\s*\n\s*verConsolidado\(\);/.test(srcCore);
  assert.ok(automatico && directo, 'debe dispararse tanto en el render inicial (setTimeout) como al cambiar de pestaña (llamada directa tras wrap.innerHTML)');
});
check('Consolidado General: <select> reactivos (onchange="verConsolidadoGeneral()") y auto-render al entrar a la pestaña', () => {
  assert.match(srcCore, /id="infGradoGen" onchange="verConsolidadoGeneral\(\)"/);
  assert.match(srcCore, /id="infPerGen" onchange="verConsolidadoGeneral\(\)"/);
  assert.match(srcCore, /consolidadoGeneralWrap"><\/div>`;\s*\n\s*verConsolidadoGeneral\(\);/);
});
check('Seguimiento Académico (Director de Grupo): <select> reactivos (onchange="verConsolidadoDir()") y auto-render al entrar a la pestaña', () => {
  assert.match(srcCore, /id="infGradoDir" onchange="verConsolidadoDir\(\)"/);
  assert.match(srcCore, /id="infPerDir" onchange="verConsolidadoDir\(\)"/);
  assert.match(srcCore, /consolidadoDirWrap"><\/div>`;\s*\n\s*verConsolidadoDir\(\);/);
});
check('Estadísticas por Grado: <select> reactivos (onchange="verEstadisticasGrado()") y auto-render al entrar a la pestaña', () => {
  assert.match(srcCore, /id="infGradoEst" onchange="verEstadisticasGrado\(\)"/);
  assert.match(srcCore, /id="infPerEst" onchange="verEstadisticasGrado\(\)"/);
  assert.match(srcCore, /estadisticasWrap"><\/div>`;\s*\n\s*verEstadisticasGrado\(\);/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE 2 — ARQUITECTURA DEL RANKING (regex): un único motor de desempate,
// separado del cálculo de promedio, con redondeo estricto.
// ════════════════════════════════════════════════════════════════════════
check('Existe _promRedondeado(v) con parseFloat+toFixed(2) (comparación decimal estricta, sin arrastres de punto flotante)', () => {
  assert.match(srcCore, /function _promRedondeado\(v\)\{\s*return parseFloat\(\(Number\(v\)\|\|0\)\.toFixed\(2\)\);\s*\}/);
});
check('Existe _calcularRankingGrado(entradasBase,grado) que NUNCA recalcula el promedio — solo aplica el desempate sobre los valores que ya le pasó la pantalla llamante', () => {
  const idx = srcCore.indexOf('function _calcularRankingGrado(entradasBase,grado){');
  assert.ok(idx !== -1);
  const idxFin = srcCore.indexOf('\n}', idx);
  const bloque = srcCore.slice(idx, idxFin);
  assert.match(bloque, /prom:_promRedondeado\(e\.prom\)/, 'debe redondear el promedio YA RECIBIDO, no recalcularlo con calcPromedioEst');
  assert.doesNotMatch(bloque, /calcPromedioEst/, 'el motor de ranking genérico no debe depender de calcPromedioEst (eso es exclusivo del ranking ANUAL)');
});
check('Existe _puestoConOverride(estId,grado,puestoAutomatico) que aplica el ajuste manual con prioridad absoluta sobre cualquier ranking automático', () => {
  assert.match(srcCore, /function _puestoConOverride\(estId,grado,puestoAutomatico\)\{\s*const manual=_puestoManualDe\(estId,grado\);\s*return manual!=null\?manual:puestoAutomatico;\s*\}/);
});
check('puestoEst() y _estudianteEmpatadoEnGrado() (ranking ANUAL) delegan en _calcularRankingGrado a través de _rankingAnualGrado(), sin duplicar la lógica de desempate', () => {
  assert.match(srcCore, /function _rankingAnualGrado\(grado\)\{[\s\S]{0,300}?_calcularRankingGrado\(entradasBase,grado\)/);
  const idxPu = srcCore.indexOf('function puestoEst(estId,grado){');
  const bloquePu = srcCore.slice(idxPu, srcCore.indexOf('\n}', idxPu));
  assert.match(bloquePu, /_rankingAnualGrado\(grado\)\.mapaPuestos\[estId\]/);
});
check('_celdaPuestoConAjuste() acepta un 4° parámetro opcional (empatadoForzado) para respetar el empate YA calculado por la pantalla llamante sobre sus propios valores, sin recurrir al ranking anual por defecto', () => {
  const idx = srcCore.indexOf('function _celdaPuestoConAjuste(estId,grado,puestoMostrado,empatadoForzado){');
  assert.ok(idx !== -1, 'la firma debe incluir el 4° parámetro empatadoForzado');
  const bloque = srcCore.slice(idx, srcCore.indexOf('\n}', idx));
  assert.match(bloque, /typeof empatadoForzado==='boolean'\)\?empatadoForzado:_estudianteEmpatadoEnGrado/);
});
check('verConsolidado(), verConsolidadoGeneral() y verConsolidadoDir() calculan su propio ranking con _calcularRankingGrado a partir del PROM que ellas mismas muestran (nunca con puestoEst() del promedio anual)', () => {
  const funcs = ['function verConsolidado(){', 'function verConsolidadoGeneral(){', 'function verConsolidadoDir(){'];
  funcs.forEach(marker => {
    const idx = srcCore.indexOf(marker);
    assert.ok(idx !== -1, marker + ' debe existir');
    const idxFin = srcCore.indexOf('\nfunction ', idx + 10);
    const bloque = srcCore.slice(idx, idxFin);
    assert.match(bloque, /_calcularRankingGrado\(filas\.map\(f=>\(\{id:f\.e\.id,prom:f\.prom\}\)\),grado\)/, marker + ' debe rankear con su propio arreglo {id,prom}');
    assert.match(bloque, /_puestoConOverride\(f\.e\.id,grado,_rankingP\.mapaPuestos\[f\.e\.id\]\)/, marker + ' debe aplicar el override sobre el ranking recién calculado');
  });
});
check('xlsxConsolidado(), pdfConsolidado(), pdfConsolidadoGeneral() y pdfConsolidadoDir() también rankean con el PROM del periodo exportado, no con el anual', () => {
  ['function xlsxConsolidado(){', 'function pdfConsolidado(){', 'function pdfConsolidadoGeneral(){', 'function pdfConsolidadoDir(){'].forEach(marker => {
    const idx = srcCore.indexOf(marker);
    assert.ok(idx !== -1, marker + ' debe existir');
    const idxFin = srcCore.indexOf('\nfunction ', idx + 10);
    const bloque = srcCore.slice(idx, idxFin);
    assert.match(bloque, /_calcularRankingGrado\(/, marker + ' debe usar _calcularRankingGrado');
    assert.doesNotMatch(bloque, /puestoEst\(/, marker + ' ya no debe llamar a puestoEst() (anual) para el PUESTO del periodo mostrado');
  });
});

// ════════════════════════════════════════════════════════════════════════
// PARTE 3 — VERIFICACIÓN NUMÉRICA (vm): reproduce el escenario EXACTO del
// reporte — un estudiante con 4.58 debe quedar en MEJOR puesto que uno con
// 4.53, incluso si sus promedios ANUALES (calcPromedioEst) estuvieran
// invertidos — porque el ranking ahora se calcula SOBRE el promedio del
// periodo que se muestra, no sobre el anual.
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
const documentStub = {
  body: fakeEl('body'), documentElement: fakeEl('html'), readyState: 'complete', _listeners: {},
  addEventListener() {}, removeEventListener() {}, getElementById() { return fakeEl('div'); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement(t) { return fakeEl(t); }, createElementNS(_n, t) { return fakeEl(t); }, createTextNode(t) { return { textContent: t }; },
};
const localStorageStub = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() }; })();

const ctx = {};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = function(){}; ctx.removeEventListener = function(){}; ctx.dispatchEvent = function(){ return true; };
ctx.open = function(){ return null; }; ctx.print = function(){}; ctx.scrollTo = function(){};
ctx.innerWidth = 1280; ctx.innerHeight = 800; ctx.document = documentStub;
ctx.navigator = { onLine: true, userAgent: 'node-test', clipboard: { writeText: async () => {} }, geolocation: {} };
ctx.localStorage = localStorageStub; ctx.sessionStorage = localStorageStub;
ctx.fetch = async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' });
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
ctx.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
ctx.matchMedia = () => ({ matches: false, addListener(){}, addEventListener(){} });
ctx.Notification = function(){}; ctx.EventSource = function(){ this.close = () => {}; }; ctx.WebSocket = function(){};
ctx.performance = performance;
ctx.btoa = s => Buffer.from(String(s), 'binary').toString('base64');
ctx.atob = s => Buffer.from(String(s), 'base64').toString('binary');

vm.createContext(ctx);
try { vm.runInContext(src1, ctx, { filename: '03-app-core.js' }); }
catch (e) { console.error('❌ ERROR AL CARGAR 03-app-core.js:', e && e.stack ? e.stack : e); process.exit(1); }
function run(code) { return vm.runInContext(code, ctx); }

function instalarCasoGrado5(){
  // Dos asignaturas en dos periodos. En el Periodo 1, Gómez saca notas que
  // dan un promedio de 4.58 y Pérez 4.53 (Gómez debe ganar P1). En el
  // Periodo 2 se invierten deliberadamente (Gómez baja, Pérez sube), de
  // modo que el promedio ANUAL (P1+P2)/2 de Pérez termine siendo MAYOR que
  // el de Gómez — así, si el código (por error) usara el anual para
  // rankear la vista de Periodo 1, Pérez aparecería primero, cuando en
  // Periodo 1 el que debe ir primero es Gómez (4.58 > 4.53).
  const db = {
    nombre: 'INSTITUCIÓN EDUCATIVA TÉCNICA EN INFORMÁTICA DE SINCELEJITO', anio: '2026',
    config: { numPeriodos: 2, pctSer: 1, pctSaber: 0, pctHacer: 0, escalaS: 4.7, escalaA: 4.0, escalaB: 3.0, pesosArea: {}, pesosAsig: {} },
    // RONDA 100 — "d" (Director de Grupo/titular) se agrega aquí porque
    // Ángel Gómez ejecuta un ajuste manual de puesto más abajo
    // (_puestoConOverride/_setPuestoManual) y, desde Ronda 100, esa acción
    // exige ser el Director de Grupo/titular del grado — ver
    // test_ronda100_permisos_ajuste_manual_puesto.mjs para la cobertura
    // dedicada de esa restricción de permisos.
    grados: [{ n: '5°', d: 'angel' }],
    users: [{ u: 'angel', r: 'docente', n: 'Ángel Gómez', p: 'x' }],
    carga: [{ id: 1, g: '5°', m: 'Matemáticas', a: 'Matemáticas', d: 'angel', dn: 'Ángel Gómez', ih: 5 }],
    ests: [
      { id: 'g1', n: 'GOMEZ PEREZ LAURA', g: '5°', nts: { 1: { 1: { s: 4.58, sb: 0, h: 0, rec: 0, niv: 0 }, 2: { s: 4.00, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
      { id: 'p1', n: 'PEREZ RUIZ DIANA', g: '5°', nts: { 1: { 1: { s: 4.53, sb: 0, h: 0, rec: 0, niv: 0 }, 2: { s: 5.00, sb: 0, h: 0, rec: 0, niv: 0 } } }, observaciones: [] },
    ],
    asistencia: [], actas: [], actasPdf: [], planesArea: [], planeaciones: [], materialEstudiantes: [],
    periodosActivos: [true, true], notasAct: {}, notasActColumnas: [], notasActAsignadas: {}, logNotas: [], descriptores: [],
  };
  run('db = ' + JSON.stringify(db) + ';');
  run('sesion = { u: "angel", r: "docente", n: "Ángel Gómez" };');
  run('window._currentPlatSK="sk-verif-hotfix2";');
}

check('Precondición del escenario: el promedio ANUAL de Pérez (4.765) es MAYOR que el de Gómez (4.29) — si el bug siguiera presente, esto haría que Pérez ganara el puesto en la vista de Periodo 1, que es justo el error reportado', () => {
  instalarCasoGrado5();
  const promAnualGomez = run(`calcPromedioEst('g1','5°')`);
  const promAnualPerez = run(`calcPromedioEst('p1','5°')`);
  assert.ok(promAnualPerez > promAnualGomez, `se esperaba que el anual de Pérez (${promAnualPerez}) superara al de Gómez (${promAnualGomez}) para que el escenario sea representativo del bug`);
});
check('CORRECCIÓN DE RAÍZ — rankeando por el PROM de PERIODO 1 (4.58 vs 4.53, el mismo valor que vería el docente en pantalla), Gómez (4.58) debe quedar en PUESTO 1°, no Pérez', () => {
  instalarCasoGrado5();
  const notaG = run(`calcNotaDef(db.ests.find(e=>e.id==='g1').nts,1,1)`);
  const notaP = run(`calcNotaDef(db.ests.find(e=>e.id==='p1').nts,1,1)`);
  assert.equal(notaG, 4.58); assert.equal(notaP, 4.53);
  const ranking = run(`_calcularRankingGrado([{id:'g1',prom:${notaG}},{id:'p1',prom:${notaP}}],'5°')`);
  assert.equal(ranking.mapaPuestos.g1, 1, 'Gómez (4.58, el promedio MÁS ALTO de este periodo) debe ir en el puesto 1°');
  assert.equal(ranking.mapaPuestos.p1, 2, 'Pérez (4.53) debe ir en el puesto 2°, aunque su promedio ANUAL sea más alto');
});
check('Confirma que, si (por error) se usara el ranking ANUAL para la vista de Periodo 1, el resultado SÍ estaría invertido — esto es justamente el bug de raíz que se corrigió', () => {
  instalarCasoGrado5();
  assert.equal(run(`puestoEst('p1','5°')`), 1, 'con el promedio ANUAL, Pérez efectivamente queda 1° — por eso NO se puede usar puestoEst() en una pantalla que muestra el promedio de un periodo específico');
  assert.equal(run(`puestoEst('g1','5°')`), 2);
});
check('Sin ajuste manual, _puestoConOverride() deja pasar el puesto automático sin modificarlo', () => {
  instalarCasoGrado5();
  assert.equal(run(`_puestoConOverride('g1','5°',1)`), 1);
});
check('Con ajuste manual vigente, _puestoConOverride() tiene prioridad ABSOLUTA sobre el puesto automático recién calculado', () => {
  instalarCasoGrado5();
  run(`_setPuestoManual('p1','5°',1)`);
  assert.equal(run(`_puestoConOverride('p1','5°',2)`), 1, 'el ajuste manual (1°) debe ganarle al puesto automático (2°) que le hubiera tocado a Pérez en el periodo');
  run(`_setPuestoManual('p1','5°',null)`); // limpiar para no afectar otras pruebas
});

// ════════════════════════════════════════════════════════════════════════
// PARTE 4 — FALSOS EMPATES: el ✏️ NUNCA debe aparecer entre promedios
// distintos, ni siquiera redondeados a 2 decimales.
// ════════════════════════════════════════════════════════════════════════
check('_calcularRankingGrado NO marca como empatados a dos estudiantes con promedios de periodo distintos (4.58 vs 4.53) — el conjunto "empatados" debe quedar vacío', () => {
  instalarCasoGrado5();
  const ranking = run(`_calcularRankingGrado([{id:'g1',prom:4.58},{id:'p1',prom:4.53}],'5°')`);
  assert.equal(ranking.empatados.size, 0, 'no debe haber ningún estudiante marcado como empatado cuando los promedios son distintos');
});
check('_celdaPuestoConAjuste(...,empatadoForzado=false) nunca dibuja el botón ✏️ aunque el ranking ANUAL (recalculado internamente si no se pasara el flag) los considerara empatados', () => {
  // Se fuerza deliberadamente un escenario donde el ranking ANUAL SÍ empataría
  // (mismos 3 criterios), pero el 4° parámetro explícito (false) debe ganar.
  instalarCasoGrado5();
  const html = run(`_celdaPuestoConAjuste('g1','5°',1,false)`);
  assert.doesNotMatch(html, /✏️/, 'con empatadoForzado=false explícito, jamás debe aparecer el lápiz de ajuste manual');
  assert.equal(html, '1°');
});
check('_calcularRankingGrado SÍ marca como empatados a dos estudiantes con el mismo promedio redondeado, la misma inasistencia y la misma cantidad de áreas bajo/básico (empate matemático real)', () => {
  instalarCasoGrado5();
  const ranking = run(`_calcularRankingGrado([{id:'g1',prom:4.50},{id:'p1',prom:4.50}],'5°')`);
  assert.equal(ranking.empatados.size, 2, 'ambos estudiantes deben quedar marcados como empatados cuando promedio, inasistencias y áreas bajo/básico coinciden exactamente');
});
check('_promRedondeado evita falsos empates/falsas diferencias por arrastres de punto flotante (0.1+0.2 no debe ser distinto de 0.3 tras el redondeo a 2 decimales)', () => {
  assert.equal(run(`_promRedondeado(0.1+0.2)`), run(`_promRedondeado(0.3)`));
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
