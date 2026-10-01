// ════════════════════════════════════════════════════════════════════════
// RONDA 101 — Pruebas del motor de bloqueo de cuenta tras intentos fallidos
// de login (src/lib/login-lockout.ts). Funciones 100% puras (sin red, sin
// base de datos), por eso se prueban directamente con `npx tsx`, sin
// necesitar una conexión a Neon — mismo espíritu que el resto de la suite
// de este proyecto, que siempre que puede verifica comportamiento REAL en
// vez de solo inspeccionar el código fuente.
//
// Cómo correr esta prueba:  npx tsx test_ronda101_bloqueo_cuenta_login.ts
// ════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import {
  MAX_INTENTOS_FALLIDOS,
  DURACION_BLOQUEO_MS,
  estaBloqueado,
  minutosRestantesBloqueo,
  intentosRestantes,
  registrarFallo,
  registrarExito,
  resumenParaCliente,
  type EstadoIntentosLogin,
} from './src/lib/login-lockout.ts';

let pass = 0, fail = 0;
function check(desc: string, fn: () => void) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e: any) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const AHORA = new Date('2026-10-01T12:00:00.000Z');
const minutos = (n: number) => n * 60 * 1000;

check('Cuenta nueva (sin estado previo): nunca está bloqueada', () => {
  assert.equal(estaBloqueado(null, AHORA), false);
  assert.equal(estaBloqueado(undefined, AHORA), false);
});
check('MAX_INTENTOS_FALLIDOS=5 y DURACION_BLOQUEO_MS=15 minutos (valores documentados en el código)', () => {
  assert.equal(MAX_INTENTOS_FALLIDOS, 5);
  assert.equal(DURACION_BLOQUEO_MS, 15 * 60 * 1000);
});
check('4 fallos seguidos (por debajo del máximo) NO bloquean la cuenta', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 4; i++) estado = registrarFallo(estado, AHORA);
  assert.equal(estado!.intentosFallidos, 4);
  assert.equal(estaBloqueado(estado, AHORA), false);
  assert.equal(intentosRestantes(estado, AHORA), 1, 'debe quedar exactamente 1 intento antes del bloqueo');
});
check('El 5° fallo seguido SÍ bloquea la cuenta, con bloqueadoHasta = ahora + 15 minutos', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  assert.equal(estado!.intentosFallidos, 5);
  assert.equal(estaBloqueado(estado, AHORA), true);
  assert.equal(estado!.bloqueadoHasta!.getTime(), AHORA.getTime() + DURACION_BLOQUEO_MS);
});
check('Mientras está bloqueada, reintentar NO extiende el bloqueo ni sigue sumando intentos', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  const bloqueadoHastaOriginal = estado!.bloqueadoHasta!.getTime();
  // 2 minutos después, todavía dentro del bloqueo, se reintenta 3 veces más
  const dosMinDespues = new Date(AHORA.getTime() + minutos(2));
  for (let i = 0; i < 3; i++) estado = registrarFallo(estado, dosMinDespues);
  assert.equal(estado!.intentosFallidos, 5, 'el contador no debe seguir subiendo mientras está bloqueada');
  assert.equal(estado!.bloqueadoHasta!.getTime(), bloqueadoHastaOriginal, 'el bloqueo NO debe extenderse por reintentar durante el castigo');
});
check('A los 15 minutos exactos, el bloqueo ya expiró (estaBloqueado es estrictamente ">", no ">=")', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  const justoAlLimite = new Date(AHORA.getTime() + DURACION_BLOQUEO_MS);
  assert.equal(estaBloqueado(estado, justoAlLimite), false);
});
check('Tras expirar el bloqueo, un nuevo fallo le da a la cuenta un comienzo limpio (vuelve a 1, no sigue en 6)', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  const muchoDespues = new Date(AHORA.getTime() + DURACION_BLOQUEO_MS + minutos(5)); // bloqueo ya expirado
  estado = registrarFallo(estado, muchoDespues);
  assert.equal(estado!.intentosFallidos, 1, 'debe reiniciar el conteo tras cumplir el bloqueo, no seguir acumulando');
  assert.equal(estaBloqueado(estado, muchoDespues), false);
});
check('minutosRestantesBloqueo() nunca devuelve 0 mientras SIGUE bloqueada — redondea hacia arriba (ej. 30s restantes → "1 minuto", nunca "0")', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  const faltanTreintaSeg = new Date(estado!.bloqueadoHasta!.getTime() - 30 * 1000);
  assert.equal(minutosRestantesBloqueo(estado, faltanTreintaSeg), 1);
});
check('minutosRestantesBloqueo() calcula correctamente minutos intermedios (ej. a los 5 min de un bloqueo de 15, quedan 10)', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  const cincoMinDespues = new Date(AHORA.getTime() + minutos(5));
  assert.equal(minutosRestantesBloqueo(estado, cincoMinDespues), 10);
});
check('registrarExito() limpia el contador por completo, incluso si venía de un bloqueo activo (login correcto de una cuenta que ya cumplió su castigo, o del admin desbloqueándola manualmente)', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  const limpio = registrarExito();
  assert.equal(limpio.intentosFallidos, 0);
  assert.equal(limpio.bloqueadoHasta, null);
  assert.equal(estaBloqueado(limpio, AHORA), false);
});
check('resumenParaCliente() da toda la información que necesita el mensaje al usuario, sin exponer el objeto interno', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 3; i++) estado = registrarFallo(estado, AHORA);
  const r = resumenParaCliente(estado, AHORA);
  assert.equal(r.bloqueado, false);
  assert.equal(r.intentosRestantes, 2);
  assert.equal(r.maxIntentos, 5);
  assert.equal(r.minutosRestantes, 0);
});
check('resumenParaCliente() de una cuenta bloqueada reporta bloqueado=true y los minutos correctos', () => {
  let estado: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) estado = registrarFallo(estado, AHORA);
  const tresMinDespues = new Date(AHORA.getTime() + minutos(3));
  const r = resumenParaCliente(estado, tresMinDespues);
  assert.equal(r.bloqueado, true);
  assert.equal(r.minutosRestantes, 12);
  assert.equal(r.intentosRestantes, 0);
});
check('Dos cuentas distintas son independientes entre sí (el estado vive por fuera de estas funciones puras, pero se confirma que no hay estado global oculto compartido)', () => {
  let cuentaA: EstadoIntentosLogin | null = null;
  let cuentaB: EstadoIntentosLogin | null = null;
  for (let i = 0; i < 5; i++) cuentaA = registrarFallo(cuentaA, AHORA);
  cuentaB = registrarFallo(cuentaB, AHORA);
  assert.equal(estaBloqueado(cuentaA, AHORA), true);
  assert.equal(estaBloqueado(cuentaB, AHORA), false);
  assert.equal(cuentaB.intentosFallidos, 1);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
