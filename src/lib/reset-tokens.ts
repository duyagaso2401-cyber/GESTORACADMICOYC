// ════════════════════════════════════════════════════════════════════════════
// RESTABLECIMIENTO DE CONTRASEÑA CON TOKEN DE UN SOLO USO (JWT)
// ------------------------------------------------------------------------------
// "4 pilares de autonomía" — Pilar 1 (Self-Service Onboarding): recuperación
// de contraseña autónoma mediante tokens de un solo uso, ADICIONAL al flujo
// existente de "¿Olvidó su contraseña?" (que envía una contraseña temporal
// por correo vía POST /api/inetis/send-email) — ese flujo YA es frágil y
// costó varias rondas estabilizar la entrega real de correos (ZeptoMail),
// así que este módulo NO lo reemplaza ni lo toca: agrega un mecanismo más
// seguro (el enlace expira solo y solo sirve una vez) que el frontend puede
// adoptar de forma progresiva sin arriesgar el flujo que ya funciona.
//
// Alcance de esta ronda: cuentas de "personal" (admin, rector, gestor,
// docente, directivo) almacenadas en db.users[] del blob de la institución
// (campo de correo: user.correo, con user.email como alternativa). El
// restablecimiento de estudiantes/acudientes (identificados por número de
// documento, sin correo propio en la mayoría de los casos) queda fuera de
// este mecanismo por ahora — su modelo de identidad es distinto y merece su
// propio diseño; se documenta como pendiente en el checklist.
//
// Diseño (por qué NO es un JWT "puro" sin estado):
// Un JWT firmado ya garantiza que el token no fue alterado y que expiró a
// los 30 minutos — pero por sí solo NO garantiza que sirva "una sola vez"
// (nada impide reenviar el mismo JWT válido dos veces). Para lograr el uso
// único real, cada token emitido registra una fila de una sola vez en
// kv_store (reutilizando la misma tabla genérica de clave/valor que ya usa
// todo el proyecto — sin migraciones nuevas): al confirmarse el cambio de
// contraseña, esa fila se borra. Un segundo intento con el mismo token ya
// no encuentra la fila y se rechaza, aunque la firma y la fecha de
// expiración del JWT sigan siendo válidas.
//
// Nota sobre la implementación del JWT: es un JWT real (HS256 — header,
// payload y firma en base64url, exactamente como especifica el estándar
// RFC 7519), firmado y verificado a mano con el módulo "crypto" nativo de
// Node (HMAC-SHA256 + comparación de firma en tiempo constante), en vez de
// añadir la librería "jsonwebtoken" como dependencia nueva. Se optó por
// esto porque (a) el proyecto ya tiene una preferencia establecida por
// evitar dependencias nuevas cuando el módulo nativo alcanza (ver
// db-cache.ts, que evita "node-cache" por la misma razón), y (b) en el
// momento de este cambio no fue posible verificar de forma confiable la
// instalación de un paquete nuevo contra el registro de npm desde este
// entorno — y una dependencia sin verificar no se agrega a un sistema en
// producción. El resultado es funcionalmente idéntico (mismo formato de
// token, misma garantía de firma y expiración) y quedó cubierto por
// pruebas automatizadas (ver checklist).
// ════════════════════════════════════════════════════════════════════════════
import crypto from 'crypto';
import { db } from '../db/index.js';
import { kvStore } from '../db/schema.js';
import { eq, like } from 'drizzle-orm';

// Se recomienda configurar JWT_RESET_SECRET en Render con un valor propio y
// secreto. Si no está configurada, se usa un valor por defecto para que el
// sistema no se caiga por falta de configuración — pero un atacante que
// conociera este valor por defecto (por ser público en este código fuente)
// podría fabricar tokens de restablecimiento válidos, así que en producción
// SIEMPRE debe sobrescribirse con una variable de entorno propia.
const JWT_RESET_SECRET = process.env.JWT_RESET_SECRET || 'gestor-academico-yc__cambiar-este-secreto-en-produccion__2026';
if (!process.env.JWT_RESET_SECRET) {
  console.warn('⚠️  JWT_RESET_SECRET no configurada: se está usando un valor por defecto (inseguro para producción). Configure JWT_RESET_SECRET en Render con un valor propio y secreto.');
}

const RESET_TOKEN_TTL_SEG = 30 * 60; // 30 minutos de vigencia del enlace
const RESET_KEY_PREFIX = '__reset_pw__'; // prefijo de las claves de kv_store usadas para el registro de un solo uso

function claveReset(sk: string, jti: string): string {
  return `${RESET_KEY_PREFIX}${sk}__${jti}`;
}

// ── JWT HS256 mínimo, sin dependencias — ver nota de diseño arriba ─────────
function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input: string): Buffer {
  const normal = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normal.length % 4 === 0 ? '' : '='.repeat(4 - (normal.length % 4));
  return Buffer.from(normal + pad, 'base64');
}
function firmarJWT<T extends object>(payload: T, secreto: string, expiraEnSeg: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat, exp: iat + expiraEnSeg };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(fullPayload))}`;
  const firma = crypto.createHmac('sha256', secreto).update(signingInput).digest();
  return `${signingInput}.${base64url(firma)}`;
}
function verificarJWT(token: string, secreto: string): any | null {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const [headerB64, payloadB64, firmaB64] = partes;
  const firmaEsperada = crypto.createHmac('sha256', secreto).update(`${headerB64}.${payloadB64}`).digest();
  let firmaRecibida: Buffer;
  try {
    firmaRecibida = base64urlDecode(firmaB64);
  } catch {
    return null;
  }
  if (firmaRecibida.length !== firmaEsperada.length || !crypto.timingSafeEqual(firmaRecibida, firmaEsperada)) return null;
  let payload: any;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

export interface PayloadReset {
  sk: string;
  usuario: string; // el "u" del registro en db.users a actualizar
  jti: string;
}

/** Genera un token de restablecimiento (JWT firmado, 30 min de vigencia) y registra su ficha de un solo uso en kv_store. */
export async function emitirTokenRestablecimiento(sk: string, usuario: string): Promise<string> {
  const jti = crypto.randomBytes(16).toString('hex');
  const payload: PayloadReset = { sk, usuario, jti };
  const token = firmarJWT(payload, JWT_RESET_SECRET, RESET_TOKEN_TTL_SEG);
  const expiraEn = new Date(Date.now() + RESET_TOKEN_TTL_SEG * 1000).toISOString();
  const clave = claveReset(sk, jti);
  await db
    .insert(kvStore)
    .values({ key: clave, value: { sk, usuario, expiraEn }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: kvStore.key, set: { value: { sk, usuario, expiraEn }, updatedAt: new Date() } });
  return token;
}

/**
 * Verifica la firma y expiración del JWT y, si es válido, consume (borra) su
 * ficha de un solo uso — una segunda llamada con el mismo token ya no
 * encuentra la ficha y devuelve null, aunque el JWT en sí siga siendo
 * criptográficamente válido.
 */
export async function verificarYConsumirTokenRestablecimiento(token: string): Promise<PayloadReset | null> {
  const payload = verificarJWT(token, JWT_RESET_SECRET) as PayloadReset | null;
  if (!payload || !payload.sk || !payload.usuario || !payload.jti) return null; // firma inválida, corrupto, o ya expiró
  const clave = claveReset(payload.sk, payload.jti);
  const filas = await db.select().from(kvStore).where(eq(kvStore.key, clave));
  if (!filas.length) return null; // ya se usó antes, o la ficha nunca existió (jti fabricado)
  await db.delete(kvStore).where(eq(kvStore.key, clave));
  return payload;
}

/**
 * Limpieza periódica ("4 pilares de autonomía" — Pilar 4-c: limpieza
 * periódica de tokens de sesión/temporales vencidos en Neon). Borra fichas
 * de restablecimiento que expiraron sin llegar a usarse — un enlace de
 * restablecimiento que nadie abrió en 30 minutos no debe quedar ocupando
 * espacio en kv_store indefinidamente.
 */
export async function limpiarTokensRestablecimientoExpirados(): Promise<number> {
  const filas = await db.select().from(kvStore).where(like(kvStore.key, `${RESET_KEY_PREFIX}%`));
  const ahoraIso = new Date().toISOString();
  const vencidas = filas.filter(f => {
    const v: any = f.value;
    return v && typeof v.expiraEn === 'string' && v.expiraEn < ahoraIso;
  });
  for (const f of vencidas) {
    await db.delete(kvStore).where(eq(kvStore.key, f.key));
  }
  return vencidas.length;
}

/**
 * Genera un hash de contraseña en el MISMO formato que produce el frontend
 * (PBKDF2-HMAC-SHA256, 100000 iteraciones, salt de 16 bytes, formato
 * "pbkdf2$<saltHex>$<hashHex>" — ver _hashPassword() en 03-app-core.js).
 * Se usa Node "crypto".pbkdf2Sync (nativo, sin dependencias nuevas) en vez
 * de Web Crypto (que no existe en Node en todas las versiones soportadas);
 * el algoritmo PBKDF2-HMAC-SHA256 es un estándar y produce el mismo
 * resultado en ambos lados para las mismas entradas, así que una contraseña
 * fijada por el servidor con esta función es reconocida sin problema por
 * _verificarPassword() en el navegador al iniciar sesión.
 */
export function hashPasswordServidor(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return 'pbkdf2$' + salt.toString('hex') + '$' + hash.toString('hex');
}
