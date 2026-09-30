// ════════════════════════════════════════════════════════════════════════
// RONDA 97 — ELIMINACIÓN DE NOTIFICACIONES PUSH EMERGENTES AL INICIAR SESIÓN
// (rol Docente) + PANEL DE NOVEDADES INTERNO EN EL DASHBOARD
//
// SÍNTOMA REPORTADO POR EL USUARIO: al iniciar sesión como docente, el
// navegador lanzaba notificaciones emergentes NATIVAS del sistema operativo
// (Web Notification API, no Web Push del servidor) sobre el estado de los
// estudiantes — algo que el usuario no pidió ni esperaba justo después de
// entrar a la plataforma.
//
// INVESTIGACIÓN (antes de escribir código): se confirmó, con un grep
// exhaustivo sobre TODOS los módulos del frontend, que la única función
// causante era _solicitarYMostrarNotifNavegador() (03-app-core.js), y que
// su ÚNICO punto de llamada era guardarAsistencia() (06-documentos-y-
// resto.js) — disparada cada vez que un docente guardaba asistencia con al
// menos un estudiante ausente. Como tomar asistencia suele ser lo primero
// que hace un docente tras iniciar sesión, el permiso nativo del navegador
// (y luego el popup) aparecía inmediatamente después del login — de ahí el
// síntoma reportado. El login en sí (funciones de autenticación, en
// 03-app-core.js y 06-documentos-y-resto.js) NUNCA llamó a Notification ni
// a pushManager — se confirmó también por grep.
//
// Los flujos de Web Push que SÍ existían y son legítimos (activarNotifica
// cionesPush() para padres/estudiantes, _activarAlertasPushSuperAdmin()
// para el Súper Admin) son 100% opt-in, detrás de un botón explícito — no
// forman parte de este bug y se verifican aquí como que siguen intactos.
//
// CORRECCIÓN:
//   1) Se elimina por completo _solicitarYMostrarNotifNavegador() y su
//      único punto de llamada (no se deja código muerto).
//   2) Blindaje en el backend (push-provider.ts): los "kind" de alerta que
//      son específicamente sobre el ESTADO DE UN ESTUDIANTE (ausencia,
//      alerta-inasistencia, alerta-academica, alerta-observador) ahora
//      excluyen explícitamente cualquier suscripción con rol='docente',
//      como defensa en profundidad (antes ese efecto era solo un
//      subproducto accidental de cómo se arma la suscripción).
//   3) Nuevo panel interno "🔔 Panel de Novedades" en el Dashboard —
//      ausencias recientes, notas bajas, novedades del Observador — visible
//      en "Mi Panel" del Docente (acotado a sus asignaturas) y en el
//      Tablero del Admin (alcance institucional), sin ningún popup.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const srcCore = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');
const srcResto = fs.readFileSync(new URL('./gestor-academico/dist/modules/06-documentos-y-resto.js', import.meta.url), 'utf8');
const srcPushProvider = fs.readFileSync(new URL('./src/lib/push-provider.ts', import.meta.url), 'utf8');

// Los comentarios de este mismo round MENCIONAN a propósito, por nombre, la
// función/llamada eliminada (para documentar honestamente el porqué del
// cambio) — así que las aserciones de "ya no existe/ya no se llama" deben
// mirar el código SIN comentarios de línea, o darían un falso positivo
// contra el propio comentario que explica la eliminación.
function _sinComentariosDeLinea(src) {
  return src.split('\n').map((linea) => linea.replace(/\/\/.*$/, '')).join('\n');
}
const srcCoreSinComentarios = _sinComentariosDeLinea(srcCore);
const srcRestoSinComentarios = _sinComentariosDeLinea(srcResto);

// ════════════════════════════════════════════════════════════════════════
// PARTE A — la función causante y su único punto de llamada quedaron
// eliminados por completo (no solo desactivados/comentados con código
// muerto que alguien pudiera reconectar por error).
// ════════════════════════════════════════════════════════════════════════
check('03-app-core.js: _solicitarYMostrarNotifNavegador() ya NO existe (era la función que llamaba a Notification.requestPermission()/new Notification() sin que el docente lo pidiera)', () => {
  assert.doesNotMatch(srcCore, /function _solicitarYMostrarNotifNavegador/);
});
check('06-documentos-y-resto.js: guardarAsistencia() ya NO llama a _solicitarYMostrarNotifNavegador() tras registrar ausencias', () => {
  assert.doesNotMatch(srcRestoSinComentarios, /_solicitarYMostrarNotifNavegador\s*\(/);
});
check('Ningún módulo del frontend construye notificaciones nativas del navegador (new Notification(...))', () => {
  assert.doesNotMatch(srcCoreSinComentarios, /new Notification\(/);
  assert.doesNotMatch(srcRestoSinComentarios, /new Notification\(/);
});
check('guardarAsistencia() sigue confirmando el guardado y notificando a los padres DENTRO de la plataforma (toast + /api/inetis/notify), sin depender del popup nativo eliminado', () => {
  const idxFn = srcResto.indexOf('function guardarAsistencia(');
  const idxFin = srcResto.indexOf('\nfunction ', idxFn + 10);
  const bloque = srcResto.slice(idxFn, idxFin);
  assert.match(bloque, /_showToast\('✅ Asistencia guardada/);
  assert.match(bloque, /\/api\/inetis\/notify/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — el login en sí nunca disparó Notification/pushManager, y se
// mantiene así (verificación de regresión: si alguna futura ronda agregara
// esa llamada al flujo de login, esta prueba lo detectaría).
// ════════════════════════════════════════════════════════════════════════
check('Ningún flujo de login (funciones que asignan "sesion=") dispara Notification.requestPermission() ni pushManager.subscribe() en el mismo bloque', () => {
  // Se buscan bloques de hasta 600 caracteres alrededor de cada asignación
  // "sesion=" en ambos módulos — ninguno debe contener las llamadas de push.
  [srcCore, srcResto].forEach((src) => {
    let idx = 0;
    while (true) {
      const m = src.indexOf('sesion=', idx);
      if (m === -1) break;
      const bloque = src.slice(m, m + 600);
      assert.doesNotMatch(bloque, /Notification\.requestPermission/);
      assert.doesNotMatch(bloque, /pushManager\.subscribe/);
      idx = m + 7;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — los flujos de Web Push legítimos (opt-in, por botón explícito)
// siguen intactos: no son parte de este bug y no debían tocarse.
// ════════════════════════════════════════════════════════════════════════
check('activarNotificacionesPush() (padres/estudiantes) sigue existiendo y solo se llama desde onclick explícitos, nunca automáticamente', () => {
  assert.match(srcCore, /function activarNotificacionesPush\(/);
  const llamadasOnclick = (srcResto.match(/onclick="activarNotificacionesPush\(\)"/g) || []).length;
  assert.ok(llamadasOnclick >= 1, 'debe seguir habiendo al menos un botón explícito que la dispare');
});
check('_activarAlertasPushSuperAdmin() (Súper Admin) sigue existiendo y solo se llama desde un botón explícito', () => {
  assert.match(srcCore, /function _activarAlertasPushSuperAdmin\(/);
  assert.match(srcCore, /onclick="_activarAlertasPushSuperAdmin\(\)"/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE D — src/lib/push-provider.ts: blindaje explícito para que un
// docente NUNCA reciba Web Push sobre el estado de un estudiante, sin
// depender solo del filtro implícito por estId.
// ════════════════════════════════════════════════════════════════════════
const idxFnNotif = srcPushProvider.indexOf('export async function enviarPushParaNotificacion');
const idxFinNotif = srcPushProvider.indexOf('\n}\n', idxFnNotif);
const bloqueNotif = srcPushProvider.slice(idxFnNotif, idxFinNotif);

check('enviarPushParaNotificacion(): excluye explícitamente las suscripciones con rol==="docente" para los "kind" de alerta de estado de un estudiante', () => {
  assert.match(bloqueNotif, /KINDS_ESTADO_ESTUDIANTE/);
  assert.match(bloqueNotif, /'ausencia'/);
  assert.match(bloqueNotif, /'alerta-inasistencia'/);
  assert.match(bloqueNotif, /'alerta-academica'/);
  assert.match(bloqueNotif, /'alerta-observador'/);
  assert.match(bloqueNotif, /subs\.filter\(s => s\.rol !== 'docente'\)/);
});
check('enviarPushParaNotificacion(): el filtro por rol docente se aplica DESPUÉS de resolver los filtros existentes por estId/grado, sin reemplazarlos (defensa en profundidad, no un sustituto)', () => {
  const idxFiltroEstId = bloqueNotif.indexOf('meta.estId');
  const idxFiltroDocente = bloqueNotif.indexOf('KINDS_ESTADO_ESTUDIANTE');
  assert.ok(idxFiltroEstId !== -1 && idxFiltroDocente !== -1 && idxFiltroEstId < idxFiltroDocente);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE E — nuevo panel interno "🔔 Panel de Novedades": reemplaza el
// popup eliminado, mostrando ausencias recientes/notas bajas/novedades
// DENTRO de la plataforma, acotado por ámbito (Docente: sus asignaturas;
// Admin: toda la institución).
// ════════════════════════════════════════════════════════════════════════
check('03-app-core.js: existe _htmlPanelNovedades(docenteU) — acepta un docente opcional para acotar el ámbito', () => {
  assert.match(srcCore, /function _htmlPanelNovedades\(docenteU\)\{/);
});
check('_htmlPanelNovedades(): recopila las 3 señales pedidas por el usuario — ausencias, notas bajas y novedades del Observador', () => {
  const idxFn = srcCore.indexOf('function _htmlPanelNovedades(docenteU){');
  const idxFin = srcCore.indexOf('\nfunction htmlPanelDocente', idxFn);
  const bloque = srcCore.slice(idxFn, idxFin);
  assert.match(bloque, /Ausencias recientes/);
  assert.match(bloque, /Notas bajas/);
  assert.match(bloque, /Novedades recientes \(Observador\)/);
  assert.match(bloque, /gravedad==='Moderada'\|\|o\.gravedad==='Grave'/);
});
check('_htmlPanelNovedades(): cuando se le pasa un docente, acota ausencias/notas a SUS asignaturas (cargaIdsAmbito/gradosAmbito), no a toda la institución', () => {
  const idxFn = srcCore.indexOf('function _htmlPanelNovedades(docenteU){');
  const idxFin = srcCore.indexOf('\nfunction htmlPanelDocente', idxFn);
  const bloque = srcCore.slice(idxFn, idxFin);
  assert.match(bloque, /cargasAmbito\s*=\s*docenteU\s*\?\s*\(db\.carga\|\|\[\]\)\.filter/);
  assert.match(bloque, /if\(docenteU\s*&&\s*!cargaIdsAmbito\.has\(String\(reg\.cargaId\)\)\)\s*return;/);
});
check('_htmlPanelNovedades(): nunca dispara Notification/pushManager — es un widget puramente de HTML dentro de la plataforma', () => {
  const idxFn = srcCore.indexOf('function _htmlPanelNovedades(docenteU){');
  const idxFin = srcCore.indexOf('\nfunction htmlPanelDocente', idxFn);
  const bloque = srcCore.slice(idxFn, idxFin);
  assert.doesNotMatch(bloque, /Notification/);
  assert.doesNotMatch(bloque, /pushManager/);
});
check('htmlPanelDocente(): inserta el Panel de Novedades acotado a SU propio usuario (sesion.u) — cumple "Docente en su respectivo ámbito"', () => {
  const idxFn = srcCore.indexOf('function htmlPanelDocente(){');
  const idxFin = srcCore.indexOf('\nfunction htmlPlanilla', idxFn);
  const bloque = srcCore.slice(idxFn, idxFin);
  assert.match(bloque, /_htmlPanelNovedades\(sesion\.u\)/);
});
check('htmlTablero() (Admin): inserta el Panel de Novedades SIN argumento (alcance institucional) — cumple "Admin en su respectivo ámbito"', () => {
  const idxFn = srcResto.indexOf('function htmlTablero(){');
  const idxFin = srcResto.indexOf('return `<h3 class="sec-title">📊 Tablero', idxFn);
  const bloque = srcResto.slice(idxFn, idxFin) + srcResto.slice(idxFin, srcResto.indexOf('grafGrado}', idxFin) + 20);
  assert.match(bloque, /_htmlPanelNovedades\(\)/);
});

console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
