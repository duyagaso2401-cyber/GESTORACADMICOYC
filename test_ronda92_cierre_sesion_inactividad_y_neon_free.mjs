// ════════════════════════════════════════════════════════════════════════
// RONDA 92 — DOS AJUSTES INDEPENDIENTES PEDIDOS POR EL USUARIO:
//
// 1) src/lib/resource-monitor.ts (Neon, plan Free): cubierto en
//    test_ronda88_monitoreo_recursos_render_neon.mjs (ahí ya vivían todas
//    las pruebas de _consultarNeon()) — se agregaron ahí las pruebas del
//    respaldo GET /projects/{id} y del mensaje amigable de restricción de
//    plan, en vez de duplicar el andamiaje de importación en este archivo.
//
// 2) Cierre automático de sesión por inactividad (10 min, global,
//    configurable) — frontend (03-app-core.js) + nuevo endpoint de
//    auditoría POST /api/auth/logout (src/index.ts). Es lo que prueba este
//    archivo.
//
// METODOLOGÍA para el frontend: 03-app-core.js es un script de navegador
// (variables globales, sin exports) de más de 20000 líneas — igual que ya
// hacen otras rondas (ver test_ronda88, Parte D), se verifica con
// aserciones de regex tolerantes sobre el código FUENTE real, no con
// ejecución en un DOM simulado (no hay jsdom en este entorno de pruebas).
// Para el endpoint nuevo del backend, se reutiliza la técnica ya
// establecida de extraer el bloque de la ruta por marcador de texto (ver
// _extraerBloqueRuta en test_ronda88) en vez de levantar un servidor Express
// real — mismo criterio que ya se usó para /api/admin/resource-quotas-status.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

// ════════════════════════════════════════════════════════════════════════
// PARTE A — src/index.ts: POST /api/auth/logout
// ════════════════════════════════════════════════════════════════════════
const srcIndex = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');

function _extraerBloqueRuta(src, marcador, metodo) {
  const idxInicio = src.indexOf(marcador);
  if (idxInicio === -1) return null;
  const idxApp = src.lastIndexOf(`app.${metodo}(`, idxInicio);
  const idxCierre = src.indexOf('\n});', idxInicio);
  return src.slice(idxApp, idxCierre + 4);
}
// NOTA: el marcador debe ser la ruta ENTRE COMILLAS tal como aparece en la
// llamada real a app.post(...) — usar solo "/api/auth/logout" (sin comillas)
// encuentra primero la mención en el comentario de cabecera de este mismo
// endpoint (que aparece ANTES de la línea app.post real) y hace que
// lastIndexOf('app.post(', ...) devuelva por error el endpoint ANTERIOR
// (/api/auth/login).
const bloqueLogout = _extraerBloqueRuta(srcIndex, "'/api/auth/logout'", 'post');

check('src/index.ts: existe POST /api/auth/logout', () => {
  assert.ok(bloqueLogout, 'debe encontrarse el bloque del endpoint');
  assert.match(bloqueLogout, /app\.post\('\/api\/auth\/logout'/);
});
check('POST /api/auth/logout: lee el JWT (si viene) con extraerBearer/verificarJWT, pero NUNCA lo exige — siempre responde ok:true', () => {
  assert.match(bloqueLogout, /extraerBearer\(req\.headers\.authorization\)/);
  assert.match(bloqueLogout, /verificarJWT\(tokenJWT\)/);
  // Ni el camino feliz ni el catch deben depender de un JWT válido para responder ok.
  assert.match(bloqueLogout, /return res\.json\(\{\s*ok:\s*true\s*\}\)/);
});
check('POST /api/auth/logout: registra auditoría distinguiendo motivo "inactividad" de un cierre manual, sin romper la respuesta si falla', () => {
  assert.match(bloqueLogout, /agentAuditLogs/);
  assert.match(bloqueLogout, /category:\s*'Seguridad'/);
  assert.match(bloqueLogout, /motivo === 'inactividad'/);
  assert.match(bloqueLogout, /catch\s*\(eAudit/);
});
check('POST /api/auth/logout: el bloque catch externo también responde 200 ok:true (nunca lanza / nunca bloquea el cierre de sesión del cliente)', () => {
  const partes = bloqueLogout.split('} catch (e) {');
  assert.equal(partes.length, 2, 'debe haber un único catch externo');
  assert.match(partes[1], /return res\.json\(\{\s*ok:\s*true\s*\}\)/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — gestor-academico/dist/modules/03-app-core.js: watcher global de
// inactividad (10 minutos configurables, eventos con throttle, limpieza +
// logout + redirección + aviso flotante).
// ════════════════════════════════════════════════════════════════════════
const srcFront = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

check('03-app-core.js: el tiempo de inactividad es una constante configurable de 10 minutos (INACTIVIDAD_TIMEOUT_MS)', () => {
  assert.match(srcFront, /const INACTIVIDAD_TIMEOUT_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
});
check('03-app-core.js: escucha exactamente los 5 eventos pedidos (mousemove, keydown, click, scroll, touchstart)', () => {
  const m = srcFront.match(/const INACTIVIDAD_EVENTOS\s*=\s*(\[[^\]]*\])/);
  assert.ok(m, 'debe existir la lista de eventos');
  const lista = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual(lista.slice().sort(), ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].sort());
});
check('03-app-core.js: aplica throttle al listener (no reinicia el temporizador en cada evento) para no sobrecargar el hilo del navegador', () => {
  assert.match(srcFront, /const INACTIVIDAD_THROTTLE_MS\s*=\s*1000/);
  assert.match(srcFront, /function _reiniciarTemporizadorInactividad\(\)\{[\s\S]{0,800}ahora-_inactUltimoReset<INACTIVIDAD_THROTTLE_MS/);
});
check('03-app-core.js: los 5 eventos se registran como listeners globales de window, pasivos, apuntando al reinicio del temporizador', () => {
  assert.match(srcFront, /INACTIVIDAD_EVENTOS\.forEach\(function\(ev\)\{\s*window\.addEventListener\(ev,_reiniciarTemporizadorInactividad,\{passive:true\}\)/);
});
check('03-app-core.js: al vencer el temporizador, _cerrarSesionPorInactividad() solo actúa si hay una sesión activa (institucional o del Gestor)', () => {
  assert.match(srcFront, /async function _cerrarSesionPorInactividad\(\)\{[\s\S]{0,300}haySesionActiva[\s\S]{0,200}if\(!haySesionActiva\)\s*return;/);
});
check('03-app-core.js: invoca POST /api/auth/logout con el JWT de la sesión (si existe) antes de limpiar — "mejor esfuerzo" (no bloquea el cierre si falla)', () => {
  const bloque = srcFront.slice(srcFront.indexOf('async function _cerrarSesionPorInactividad'), srcFront.indexOf('function _instalarWatcherInactividad'));
  assert.match(bloque, /\/api\/auth\/logout/);
  assert.match(bloque, /method:\s*'POST'/);
  assert.match(bloque, /motivo:\s*'inactividad'/);
  assert.match(bloque, /try\s*\{[\s\S]*fetch\([\s\S]*\/api\/auth\/logout[\s\S]*\}\s*catch\s*\(e\)\s*\{/);
});
check('03-app-core.js: limpia la sesión local llamando a _cerrarSesionReal() (borra sesión/token y redirige al login vía render())', () => {
  const bloque = srcFront.slice(srcFront.indexOf('async function _cerrarSesionPorInactividad'), srcFront.indexOf('function _instalarWatcherInactividad'));
  assert.match(bloque, /_cerrarSesionReal\(\)/);
});
check('03-app-core.js: muestra el aviso flotante EXACTO pedido por el usuario, después de cerrar la sesión', () => {
  const bloque = srcFront.slice(srcFront.indexOf('async function _cerrarSesionPorInactividad'), srcFront.indexOf('function _instalarWatcherInactividad'));
  const idxCierre = bloque.indexOf('_cerrarSesionReal()');
  const idxToast = bloque.indexOf('_showToast(');
  assert.ok(idxCierre !== -1 && idxToast !== -1 && idxToast > idxCierre, 'el aviso debe mostrarse DESPUÉS de cerrar la sesión');
  assert.match(bloque, /Tu sesión ha sido cerrada por inactividad para proteger tu cuenta/);
});
check('03-app-core.js: el watcher se instala globalmente al cargar el script (no depende de que ya exista una sesión)', () => {
  assert.match(srcFront, /function _instalarWatcherInactividad\(\)\{[\s\S]{0,300}\}\n_instalarWatcherInactividad\(\);/);
});

console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
