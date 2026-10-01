// ════════════════════════════════════════════════════════════════════════
// RONDA 106 — Códigos de respaldo de 2FA (extensión del ítem 1.5 de la hoja
// de ruta). Cierra una limitación que la Ronda 104 dejó documentada a
// propósito: si el Rector/Administrador pierde el celular con su app
// autenticadora, hasta ahora no había forma de recuperar el acceso sin
// soporte manual directamente en la base de datos. Estos códigos son el
// mecanismo estándar de la industria para ese caso: un lote de códigos de
// un solo uso, generados al activar 2FA (y regenerables después),
// guardados como HASH (nunca en texto plano) — cualquiera de ellos puede
// usarse una vez en vez del código de 6 dígitos, tanto para iniciar sesión
// como para desactivar 2FA.
//
// Funciones 100% puras — sin Drizzle, sin Express — se prueban
// directamente con `npx tsx`.
// ════════════════════════════════════════════════════════════════════════
import crypto from 'crypto';

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) — pensado para que un
// código IMPRESO o escrito a mano no genere dudas al transcribirlo.
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Genera UN código con formato XXXX-XXXX (8 caracteres del alfabeto de
 * arriba, agrupados para que sea más fácil de leer/transcribir). */
function _generarUnCodigo(): string {
  let codigo = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    codigo += ALFABETO_CODIGO[bytes[i] % ALFABETO_CODIGO.length];
    if (i === 3) codigo += '-';
  }
  return codigo;
}

/** Genera un lote de códigos de respaldo nuevos (8 por defecto, cantidad
 * estándar de la industria — ni tan pocos que se agoten rápido, ni tantos
 * que sean difíciles de guardar). Cada llamada es independiente: no hay
 * garantía matemática de no-colisión entre lotes distintos, pero con este
 * espacio de combinaciones (32^8) la probabilidad es despreciable — el
 * llamador igual puede validar unicidad contra lo ya emitido si lo desea. */
export function generarCodigosRespaldo(cantidad: number = 8): string[] {
  const codigos: string[] = [];
  for (let i = 0; i < cantidad; i++) codigos.push(_generarUnCodigo());
  return codigos;
}

/** Normaliza un código tal como lo escribiría una persona (mayúsculas/
 * minúsculas mezcladas, con o sin el guion, con espacios de más) antes de
 * hashear o comparar — para que "ab12-cd34", "AB12CD34" y " AB12-CD34 "
 * se traten como el mismo código. */
export function normalizarCodigoRespaldo(codigo: string): string {
  return String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** ¿El texto ingresado TIENE FORMA de código de respaldo (8 caracteres del
 * alfabeto, con o sin guion) — a diferencia de un código TOTP de 6 dígitos?
 * Se usa para decidir, del lado del servidor, contra cuál de las dos
 * tablas comparar sin que el usuario tenga que decir cuál está escribiendo. */
export function esFormatoCodigoRespaldo(codigo: string): boolean {
  const normalizado = normalizarCodigoRespaldo(codigo);
  return normalizado.length === 8 && /^[A-Z2-9]+$/.test(normalizado) && !/^\d{6}$/.test(String(codigo || '').trim());
}

/** Hash determinístico (SHA-256) de un código YA NORMALIZADO — se usa
 * tanto al generar el lote (guardar el hash) como al verificar (hashear lo
 * ingresado y comparar). No se usa un KDF lento (PBKDF2/bcrypt) a
 * propósito: estos códigos son aleatorios de alta entropía generados por
 * el propio servidor (32^8 ≈ 1.1×10^12 combinaciones), no contraseñas
 * elegidas por una persona — SHA-256 simple es apropiado y no penaliza la
 * verificación en el momento del login con cómputo innecesario. */
export function hashCodigoRespaldo(codigo: string): string {
  return crypto.createHash('sha256').update(normalizarCodigoRespaldo(codigo)).digest('hex');
}
