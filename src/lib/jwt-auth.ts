// ════════════════════════════════════════════════════════════════════════════
// RONDA 40 — BLINDAJE DE AUTENTICACIÓN: JWT firmado en servidor (HMAC-SHA256)
// ------------------------------------------------------------------------------
// Este archivo es DELIBERADAMENTE independiente de cualquier base de datos —
// solo firma/verifica tokens — para poder probarse con ejecución REAL (no
// solo inspección de código fuente) sin necesitar una conexión a Neon.
//
// DECISIÓN DE INGENIERÍA (transparencia total): el entorno de despliegue de
// este proyecto no tiene acceso al registro de npm para instalar paquetes
// nuevos, y `jsonwebtoken` NO está en node_modules (se verificó con
// `require('jsonwebtoken')` antes de escribir este archivo). En vez de
// bloquear la ronda por esa dependencia, se implementó un JWT MÍNIMO pero
// ESTÁNDAR (formato de 3 partes header.payload.signature, todo en
// Base64URL, algoritmo HS256) usando ÚNICAMENTE el módulo `crypto` nativo
// de Node — el mismo patrón de firma HMAC que ya usaba este proyecto para
// los tokens de sesión del sistema universitario
// (`src/routes/university.ts`, `generarTokenSesion`/`verificarTokenSesion`)
// y para los códigos de verificación de certificados (`_firmarBlob`,
// `src/index.ts`). Un token generado aquí es un JWT HS256 válido y
// verificable por CUALQUIER librería JWT estándar (jwt.io, jsonwebtoken,
// etc.) si en el futuro se instala una — el formato es compatible, solo el
// código que lo genera es artesanal en vez de depender de un paquete.
// ════════════════════════════════════════════════════════════════════════════
import crypto from 'crypto';

// Se usa una variable de entorno DEDICADA (JWT_SECRET) en vez de reutilizar
// DOC_SIGN_SECRET — son dominios de seguridad distintos (uno firma
// documentos/certificados públicos que cualquiera puede verificar sin
// autenticarse; el otro firma la IDENTIDAD de quien está autenticado en el
// sistema) y mezclarlos habría significado que rotar uno rompiera al otro
// sin que nadie lo esperara. Si JWT_SECRET no está configurada, se cae a
// un valor de emergencia CLARAMENTE marcado como inseguro (igual que el
// patrón ya usado por DOC_SIGN_SECRET en el resto del proyecto) — el
// servidor sigue funcionando (no se cae la plataforma por un secreto
// faltante) pero cualquier operador que revise logs/código verá de
// inmediato que falta configurarlo en producción.
const JWT_SECRET = process.env.JWT_SECRET || 'inseguro-configure-JWT_SECRET';

export interface PayloadSesionJWT {
  sub: string;           // identidad (usuario) autenticado
  sk: string;            // institución (multi-tenant) a la que pertenece esta sesión
  rol: string;           // rol genérico real detectado por el SERVIDOR al autenticar (admin/docente/padre/estudiante/elecciones)
  rolEspecifico?: string;// clasificación fina (RONDA35_ROLES_ESPECIFICOS) — ej. 'Docente Orientador', 'Tutor PTA'
  nombre?: string;
  estId?: string | number; // solo para rol==='estudiante'/'padre'
  iat: number;            // emitido (segundos unix)
  exp: number;            // expira (segundos unix)
}

function _base64url(buf: Buffer): string {
  return buf.toString('base64url');
}
function _firmarHS256(encHeaderYPayload: string): string {
  return _base64url(crypto.createHmac('sha256', JWT_SECRET).update(encHeaderYPayload).digest());
}

const HORAS_VALIDEZ_JWT = 8; // jornada laboral típica — se puede volver a pedir el token con el mismo login rápido si expira

/** Firma un JWT HS256 real (header.payload.signature) a partir de los datos
 * de sesión ya validados por el servidor. NUNCA se firma un rol que venga
 * tal cual del cliente sin verificar contra el blob real de la institución
 * (eso es responsabilidad de quien llama a esta función, ver
 * POST /api/auth/login en src/index.ts). */
export function firmarJWT(datos: Omit<PayloadSesionJWT, 'iat' | 'exp'>, horasValidez = HORAS_VALIDEZ_JWT): string {
  const ahora = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: PayloadSesionJWT = { ...datos, iat: ahora, exp: ahora + Math.round(horasValidez * 3600) };
  const encHeader = _base64url(Buffer.from(JSON.stringify(header)));
  const encPayload = _base64url(Buffer.from(JSON.stringify(payload)));
  const firma = _firmarHS256(encHeader + '.' + encPayload);
  return encHeader + '.' + encPayload + '.' + firma;
}

/** Verifica la firma criptográfica y la expiración de un JWT HS256 emitido
 * por firmarJWT(). Devuelve el payload decodificado solo si la firma es
 * válida y el token no ha expirado — null en cualquier otro caso (formato
 * inválido, firma alterada, o vencido). La comparación de la firma usa
 * `crypto.timingSafeEqual` para no filtrar información por tiempo de
 * respuesta (mismo cuidado que ya tenía `_compararHashesSeguro` en
 * src/index.ts para los hashes de contraseña). */
export function verificarJWT(token: string | null | undefined): PayloadSesionJWT | null {
  try {
    if (!token || typeof token !== 'string') return null;
    const partes = token.split('.');
    if (partes.length !== 3) return null;
    const [encHeader, encPayload, firmaRecibida] = partes;
    const firmaEsperada = _firmarHS256(encHeader + '.' + encPayload);
    const bufRecibida = Buffer.from(firmaRecibida);
    const bufEsperada = Buffer.from(firmaEsperada);
    if (bufRecibida.length !== bufEsperada.length) return null;
    if (!crypto.timingSafeEqual(bufRecibida, bufEsperada)) return null;
    const payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf-8')) as PayloadSesionJWT;
    const ahora = Math.floor(Date.now() / 1000);
    if (!payload.exp || ahora > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extrae el token del header "Authorization: Bearer <token>", o null si no
 * viene en ese formato. Centralizado aquí para que todos los puntos de
 * verificación del proyecto lean el header exactamente de la misma forma. */
export function extraerBearer(authorizationHeader: string | undefined | null): string | null {
  const h = String(authorizationHeader || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() || null : null;
}

// Roles/clasificaciones que la Ronda 40 bloquea explícitamente para
// escritura de notas/planillas — mismos valores de texto que ya usa el
// frontend (RONDA35_ROLES_ESPECIFICOS) y que ya bloqueaba, del lado del
// cliente, la Ronda 39 (_bloqueadoNotasPlanillas()). Aquí se vuelve a
// aplicar la MISMA regla, pero ahora contra un rol que el SERVIDOR mismo
// determinó al autenticar (dentro del JWT firmado) — no algo que el
// cliente pueda simplemente omitir o falsear en el body de la petición.
const ROLES_ESPECIFICOS_BLOQUEADOS_NOTAS = new Set(['Docente Orientador', 'Tutor PTA']);
const ROLES_GENERICOS_BLOQUEADOS_NOTAS = new Set(['estudiante', 'padre']);

/** true si, según el payload de un JWT ya verificado criptográficamente,
 * este actor NO debe poder escribir notas/planillas. Cubre los 4 roles que
 * pidió expresamente el coordinador para la Ronda 40: DOCENTE_ORIENTADOR,
 * TUTOR_PTA (vía rolEspecifico), ESTUDIANTE y ACUDIENTE (vía rol genérico
 * — en este sistema el acudiente se guarda internamente como rol 'padre'). */
export function rolBloqueadoParaNotas(payload: Pick<PayloadSesionJWT, 'rol' | 'rolEspecifico'> | null | undefined): boolean {
  if (!payload) return false; // sin JWT válido: esta función no decide nada — ver la nota de alcance en el endpoint que la llama
  if (ROLES_GENERICOS_BLOQUEADOS_NOTAS.has(payload.rol)) return true;
  if (payload.rolEspecifico && ROLES_ESPECIFICOS_BLOQUEADOS_NOTAS.has(payload.rolEspecifico)) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// RONDA 107 — ítem 1.8: renovación de sesión ("refresh"), diseñada
// deliberadamente para NO tocar el flujo de login/sincronización
// offline-first del que depende toda la plataforma (la razón por la que
// este ítem se había declinado antes de que el usuario pidiera resolverlo
// explícitamente). En vez de introducir un segundo tipo de token (access +
// refresh, con su propia tabla y rotación — el diseño "de libro de texto"
// que SÍ tocaría ese flujo), se implementa una renovación DESLIZANTE sobre
// el mismo JWT: mientras el token actual siga siendo criptográficamente
// válido y no haya expirado, el cliente puede pedir uno nuevo (mismos
// datos de sesión, "iat"/"exp" frescos). Un token YA expirado NUNCA se
// renueva — eso exige un login nuevo, como siempre, así que no se debilita
// la seguridad del esquema actual en absoluto.
//
// VENTANA DE RENOVACIÓN: solo se permite (y el frontend solo lo pide)
// dentro del último 25% de la vida útil del token — para un token de 8h
// (el valor por defecto), eso son las últimas 2 horas. Renovar más seguido
// no aporta nada (el token seguía siendo válido) y renovar fuera de esa
// ventana sería indistinguible de "renovar en cada petición", lo cual
// anularía el propósito de que un token tenga una duración definida.
//
// COMPATIBILIDAD TOTAL CON EL USO SIN CONEXIÓN: esto es, a propósito, un
// mecanismo que el cliente puede IGNORAR por completo. Un docente sin
// señal sigue trabajando con su token actual hasta que expire de verdad —
// la renovación es una llamada de red en segundo plano, "nunca lanza": si
// falla (sin conexión, servidor caído), el cliente simplemente sigue
// usando el token que ya tenía, ni mejor ni peor que el comportamiento
// antes de esta ronda.
const FRACCION_VENTANA_RENOVACION = 0.25;

/** true si, dado el "iat"/"exp" de un JWT ya verificado, está dentro de la
 * ventana final de su vida útil en la que vale la pena renovarlo (último
 * 25%). No decide nada sobre la validez del token en sí — eso ya lo validó
 * verificarJWT() antes de llegar aquí. */
export function debeRenovarseJWT(payload: Pick<PayloadSesionJWT, 'iat' | 'exp'>, ahoraSegundos = Math.floor(Date.now() / 1000)): boolean {
  const vidaUtilTotal = payload.exp - payload.iat;
  if (vidaUtilTotal <= 0) return false; // payload corrupto/inconsistente: no se decide renovar sobre datos sin sentido
  const restante = payload.exp - ahoraSegundos;
  if (restante <= 0) return false; // ya expirado — verificarJWT() ya lo habría rechazado, pero por defensa en profundidad no se renueva aquí tampoco
  return restante <= vidaUtilTotal * FRACCION_VENTANA_RENOVACION;
}

/** Renueva un JWT ya verificado: emite un token NUEVO con los mismos datos
 * de identidad/sesión pero "iat"/"exp" frescos. Devuelve null si el token
 * no está dentro de la ventana de renovación (todavía le queda vida
 * sobrada) — el llamador decide si eso es un error o simplemente "nada que
 * hacer todavía". NUNCA se llama con un token no verificado: el único
 * punto de entrada (POST /api/auth/renovar en src/index.ts) siempre pasa
 * primero por verificarJWT().
 */
export function renovarJWTSiAplica(payloadVerificado: PayloadSesionJWT, horasValidez = HORAS_VALIDEZ_JWT): { token: string; payload: PayloadSesionJWT } | null {
  if (!debeRenovarseJWT(payloadVerificado)) return null;
  const { iat: _iat, exp: _exp, ...datos } = payloadVerificado;
  const nuevoToken = firmarJWT(datos, horasValidez);
  const nuevoPayload = verificarJWT(nuevoToken)!; // recién firmado: siempre verifica correctamente
  return { token: nuevoToken, payload: nuevoPayload };
}

export { JWT_SECRET as _JWT_SECRET_PARA_PRUEBAS_INTERNAS };
