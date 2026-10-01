// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — extensión del ítem 4.2: los 4 modales de seguridad/auditoría
// tocados en Rondas 104-106 (login 2FA, activación 2FA, códigos de
// respaldo, bitácora de auditoría) ahora atrapan el foco y se cierran con
// Escape, usando el mismo mecanismo ya probado (_activarAccesibilidadPopup)
// que antes solo cubría los popups de notas de la Planilla. Prueba
// estática de código fuente — no requiere DOM real.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const src = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

function bloqueDeFuncion(nombreFn, marcaFin) {
  const idx = src.indexOf(nombreFn);
  if (idx === -1) throw new Error('No se encontró ' + nombreFn);
  const idxFin = src.indexOf(marcaFin, idx);
  return src.slice(idx, idxFin === -1 ? idx + 4000 : idxFin);
}

check('_solicitarCodigo2FALogin() activa accesibilidad (foco atrapado + Escape)', () => {
  const bloque = bloqueDeFuncion('function _solicitarCodigo2FALogin', '\nfunction _htmlSelectorConmutacionRol');
  assert.match(bloque, /_activarAccesibilidadPopup\(ov,/);
});

check('_iniciarActivar2FA() activa accesibilidad en el modal de configuración', () => {
  const bloque = bloqueDeFuncion('async function _iniciarActivar2FA()', '\nasync function _iniciarDesactivar2FA');
  assert.match(bloque, /_activarAccesibilidadPopup\(ov,/);
});

check('_mostrarModalCodigosRespaldo() activa accesibilidad', () => {
  const bloque = bloqueDeFuncion('function _mostrarModalCodigosRespaldo', '\nasync function _regenerarCodigosRespaldo2FA');
  assert.match(bloque, /_activarAccesibilidadPopup\(ov,/);
});

check('_abrirBitacoraAuditoria() activa accesibilidad', () => {
  const bloque = bloqueDeFuncion('async function _abrirBitacoraAuditoria()', '\nfunction actualizarPerfil');
  assert.match(bloque, /_activarAccesibilidadPopup\(ov,/);
});

check('Modo Oscuro (4.1): existen reglas de sobrescritura de FONDO (no solo de texto) para el patrón más común de modal casero (background:#fff)', () => {
  const html = fs.readFileSync(new URL('./gestor-academico/dist/portal.html', import.meta.url), 'utf8');
  assert.match(html, /html\[data-theme="dark"\] \[style\*="background:#fff" i\]\{background:var\(--modal-bg\)/);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
