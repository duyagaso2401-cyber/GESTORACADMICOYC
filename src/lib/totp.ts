// ════════════════════════════════════════════════════════════════════════
// RONDA 104 — TOTP del lado del SERVIDOR (ítem 1.5 de la hoja de ruta).
//
// HALLAZGO IMPORTANTE AL INVESTIGAR ESTE ÍTEM: la verificación en dos
// pasos (2FA) NO era algo que faltara — ya estaba completamente construida
// en el frontend (_generarSecreto2FA/_totpVerificar/_solicitarCodigo2FALogin
// en 03-app-core.js), con una implementación TOTP (RFC 6238) correcta y
// compatible con Google Authenticator. El problema real, descubierto al
// revisar DÓNDE vivía el secreto: se guardaba en `db.users[].tfaSecreto`,
// es decir, dentro del MISMO blob JSON que ya contiene los hashes de
// contraseña de toda la institución (el mismo blob que cualquiera con el
// "sk" puede descargar completo — ver la nota de arquitectura del ítem 1.2
// en la hoja de ruta). Esto anula el propósito de un "segundo factor": si
// alguien obtiene el blob (el escenario exacto contra el que un segundo
// factor debería proteger), obtiene TAMBIÉN el secreto de 2FA, en texto
// plano, justo al lado de la contraseña. Y la verificación del código
// ocurría enteramente en el navegador (`_totpVerificar` local), sin que el
// servidor participara en absoluto — cualquiera con acceso a las
// herramientas de desarrollador del navegador podía alterar el resultado
// de esa comprobación.
//
// LA CORRECCIÓN (mismo criterio que la Ronda 101 con el bloqueo de
// cuenta): el ALGORITMO TOTP que ya existía en el frontend queda
// EXACTAMENTE IGUAL (HMAC-SHA1, 6 dígitos, pasos de 30 segundos, ventana
// de tolerancia ±1 paso — mismos parámetros, para que cualquier cuenta que
// ya haya escaneado un código QR con Google Authenticator/Authy/Microsoft
// Authenticator siga funcionando sin tener que volver a configurarlo). Lo
// que cambia es DÓNDE vive el secreto y QUIÉN verifica el código: ahora
// ambas cosas pasan exclusivamente por el servidor (tabla `totp_secretos`,
// nunca el blob JSON ni localStorage) — ver los endpoints nuevos en
// src/index.ts (/api/inetis/2fa/...).
//
// Funciones 100% puras aquí (sin Drizzle, sin Express) — se prueban
// directamente con `npx tsx`, verificadas además contra los vectores de
// prueba OFICIALES del Apéndice B de la RFC 6238.
// ════════════════════════════════════════════════════════════════════════
import crypto from 'crypto';

const BASE32_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Codifica un Buffer/Uint8Array a Base32 (RFC 4648, sin relleno "=") —
 * mismo alfabeto y misma ausencia de padding que _base32Codificar() en el
 * frontend (03-app-core.js), para que ambos lados sean 100% compatibles. */
export function base32Codificar(bytes: Uint8Array): string {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let salida = '';
  for (let i = 0; i < bits.length; i += 5) {
    const trozo = bits.substr(i, 5).padEnd(5, '0');
    salida += BASE32_ALFABETO[parseInt(trozo, 2)];
  }
  return salida;
}

/** Decodifica Base32 (RFC 4648) a Buffer — inversa de la anterior, mismo
 * criterio de "ignorar caracteres no válidos" que ya usaba el frontend. */
export function base32Decodificar(base32: string): Buffer {
  const limpio = base32.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const c of limpio) {
    const val = BASE32_ALFABETO.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return Buffer.from(bytes);
}

/** Genera un secreto nuevo de 20 bytes (160 bits, el tamaño recomendado
 * por la RFC para HMAC-SHA1) usando el generador criptográficamente
 * seguro de Node, codificado en Base32 listo para mostrar/guardar. */
export function generarSecretoTOTP(): string {
  return base32Codificar(crypto.randomBytes(20));
}

/** Calcula el código TOTP de `digitos` dígitos para el secreto y el
 * instante dados (RFC 6238 sobre RFC 4226/HOTP). Implementación con el
 * módulo nativo `crypto` de Node (HMAC-SHA1 síncrono) — no se necesita
 * Web Crypto aquí porque este código corre en el servidor, no en el
 * navegador. */
export function generarCodigoTOTP(
  secretoBase32: string,
  tiempoUnixSegundos: number = Math.floor(Date.now() / 1000),
  pasoSegundos: number = 30,
  digitos: number = 6
): string {
  const contador = Math.floor(tiempoUnixSegundos / pasoSegundos);
  const claveBytes = base32Decodificar(secretoBase32);
  const contadorBuffer = Buffer.alloc(8);
  // Escribe el contador de 64 bits en big-endian (partido en dos mitades
  // de 32 bits porque JS no maneja enteros de 64 bits de forma nativa en
  // operaciones a nivel de bits) — mismo truco ya usado en el frontend.
  contadorBuffer.writeUInt32BE(Math.floor(contador / 4294967296), 0);
  contadorBuffer.writeUInt32BE(contador >>> 0, 4);
  const hmac = crypto.createHmac('sha1', claveBytes).update(contadorBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binario % Math.pow(10, digitos)).toString().padStart(digitos, '0');
}

/** Verifica un código de 6 dígitos ingresado por el usuario contra el
 * secreto guardado, tolerando ±1 paso (30s) de diferencia de reloj entre
 * el celular y el servidor — mismo margen que ya usaba `_totpVerificar()`
 * en el frontend. */
export function verificarCodigoTOTP(
  secretoBase32: string,
  codigoIngresado: string,
  tiempoUnixSegundos: number = Math.floor(Date.now() / 1000),
  ventanaPasos: number = 1
): boolean {
  if (!codigoIngresado || !/^\d{6}$/.test(String(codigoIngresado).trim())) return false;
  const codigoLimpio = String(codigoIngresado).trim();
  for (let delta = -ventanaPasos; delta <= ventanaPasos; delta++) {
    const esperado = generarCodigoTOTP(secretoBase32, tiempoUnixSegundos + delta * 30);
    if (esperado === codigoLimpio) return true;
  }
  return false;
}

/** Arma la URI `otpauth://` que se codifica en el código QR que el
 * usuario escanea con su aplicación autenticadora — mismo formato que ya
 * generaba el frontend, para que la experiencia de activación no cambie
 * en nada para quien la usa. */
export function construirURIOtpAuth(secretoBase32: string, cuenta: string, emisor: string = 'GestorYC'): string {
  const etiqueta = encodeURIComponent(emisor + ':' + cuenta);
  return 'otpauth://totp/' + etiqueta + '?secret=' + secretoBase32 + '&issuer=' + encodeURIComponent(emisor) + '&algorithm=SHA1&digits=6&period=30';
}
