// ════════════════════════════════════════════════════════════════════════════
// RONDA 101 — BLOQUEO DE CUENTA TRAS INTENTOS FALLIDOS DE LOGIN
// ------------------------------------------------------------------------------
// CONTEXTO ARQUITECTÓNICO IMPORTANTE (léase antes de tocar este archivo o el
// flujo de login): en este sistema, el login de Admin/Docente NO es un
// endpoint tradicional "usuario+clave → el servidor responde sí/no". El
// cliente descarga el blob completo de la institución (GET /api/inetis/db,
// con las contraseñas ya cifradas con PBKDF2) y la COMPARACIÓN de la
// contraseña ocurre en el navegador, contra ese blob ya descargado — ver
// doLogin() en 03-app-core.js. Eso significa que el `limitadorLogin` (rate
// limit por IP) de src/index.ts protege cuántas veces se puede descargar el
// blob completo, pero NO protege cuántas contraseñas se pueden probar EN EL
// NAVEGADOR contra un blob que ya está en memoria — ese es un límite que,
// por diseño de la arquitectura actual, el servidor no puede exigir de forma
// absoluta (alguien con herramientas de desarrollador podría seguir
// intentando localmente). Mover la verificación de contraseña al servidor
// por completo sería la solución definitiva, pero es un cambio de
// arquitectura mucho más grande y riesgoso — ver el documento de hoja de
// ruta entregado junto con esta ronda.
//
// Lo que SÍ se puede hacer, de forma aditiva y segura, es exactamente esto:
// un bloqueo temporal de cuenta, verificado y aplicado en el SERVIDOR,
// independiente del blob — el navegador consulta este endpoint ANTES de
// intentar comparar la contraseña localmente, y si la cuenta está
// bloqueada, ni siquiera se hace el intento. Esto detiene de raíz cualquier
// ataque automatizado contra la PANTALLA DE LOGIN normal (que es, en la
// práctica, el vector de ataque real para cualquiera que no tenga ya acceso
// al código fuente ni a una consola de desarrollador abierta).
//
// Todas las funciones de este archivo son PURAS (sin acceso a base de
// datos, sin fetch, sin reloj real salvo el que se les pase explícitamente)
// para poder probarse con `npx tsx` sin necesitar una conexión a Neon — el
// mismo espíritu que el resto de la suite de pruebas de este proyecto
// (funciones puras y directamente verificables). El archivo que sí toca la
// base de datos es src/index.ts (los 3 endpoints nuevos), que se limita a
// leer/escribir el estado y delegar TODA la decisión a estas funciones.
// ════════════════════════════════════════════════════════════════════════════

// 5 intentos fallidos seguidos bloquean la cuenta 15 minutos. Son valores
// conservadores y ampliamente usados en la industria (ej. OWASP recomienda
// entre 3 y 5 intentos); se exportan como constantes para que un futuro
// ajuste (ej. hacerlos configurables por institución) sea un cambio de una
// sola línea, no una búsqueda por todo el código.
export const MAX_INTENTOS_FALLIDOS = 5;
export const DURACION_BLOQUEO_MS = 15 * 60 * 1000; // 15 minutos

export interface EstadoIntentosLogin {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

export const ESTADO_INICIAL: EstadoIntentosLogin = { intentosFallidos: 0, bloqueadoHasta: null };

// ¿La cuenta está bloqueada EN ESTE MOMENTO? (bloqueadoHasta en el futuro)
export function estaBloqueado(estado: EstadoIntentosLogin | null | undefined, ahora: Date = new Date()): boolean {
  if (!estado || !estado.bloqueadoHasta) return false;
  return estado.bloqueadoHasta.getTime() > ahora.getTime();
}

// Minutos que faltan para que expire el bloqueo (0 si no está bloqueada).
// Siempre redondea HACIA ARRIBA y nunca devuelve menos de 1 mientras siga
// bloqueada — así el mensaje al usuario nunca dice "0 minutos" cuando en
// realidad todavía está bloqueado por unos segundos más.
export function minutosRestantesBloqueo(estado: EstadoIntentosLogin | null | undefined, ahora: Date = new Date()): number {
  if (!estaBloqueado(estado, ahora)) return 0;
  return Math.max(1, Math.ceil((estado!.bloqueadoHasta!.getTime() - ahora.getTime()) / 60000));
}

// Cuántos intentos le quedan antes de bloquearse (0 si ya está bloqueada).
export function intentosRestantes(estado: EstadoIntentosLogin | null | undefined, ahora: Date = new Date()): number {
  if (estaBloqueado(estado, ahora)) return 0;
  const usados = estado?.intentosFallidos || 0;
  return Math.max(0, MAX_INTENTOS_FALLIDOS - usados);
}

// Calcula el NUEVO estado tras un intento fallido. Reglas:
//  1) Si ya estaba bloqueada y el bloqueo SIGUE vigente: no se suma ni se
//     extiende el bloqueo por reintentar mientras está activo (evita que
//     alguien alargue indefinidamente su propio castigo solo martillando
//     el botón, y evita que un atacante "resetee el reloj" de un bloqueo
//     ajeno a propósito).
//  2) Si había un bloqueo anterior que YA EXPIRÓ: se le da a la cuenta un
//     comienzo limpio (cuenta vuelve a 0 antes de sumar este fallo) — ya
//     "pagó" su bloqueo.
//  3) En cualquier otro caso (nunca bloqueada, o bajo el máximo): se suma
//     normalmente, y si al sumar se alcanza el máximo, se activa el
//     bloqueo a partir de AHORA.
export function registrarFallo(estadoActual: EstadoIntentosLogin | null | undefined, ahora: Date = new Date()): EstadoIntentosLogin {
  if (estaBloqueado(estadoActual, ahora)) {
    return { intentosFallidos: estadoActual!.intentosFallidos, bloqueadoHasta: estadoActual!.bloqueadoHasta };
  }
  const huboBloqueoQueYaExpiro = !!(estadoActual && estadoActual.bloqueadoHasta && estadoActual.bloqueadoHasta.getTime() <= ahora.getTime());
  const base = huboBloqueoQueYaExpiro ? 0 : (estadoActual?.intentosFallidos || 0);
  const intentosFallidos = base + 1;
  const bloqueadoHasta = intentosFallidos >= MAX_INTENTOS_FALLIDOS ? new Date(ahora.getTime() + DURACION_BLOQUEO_MS) : null;
  return { intentosFallidos, bloqueadoHasta };
}

// Un login exitoso siempre limpia el contador por completo — "nunca lanza"
// a la siguiente persona que use la cuenta correctamente un castigo que ya
// no aplica.
export function registrarExito(): EstadoIntentosLogin {
  return { ...ESTADO_INICIAL };
}

// Forma serializable (para la respuesta JSON de los endpoints y para
// guardar/leer de la tabla login_intentos) — evita que cada llamador tenga
// que saber el nombre exacto de los campos internos.
export function resumenParaCliente(estado: EstadoIntentosLogin | null | undefined, ahora: Date = new Date()) {
  return {
    bloqueado: estaBloqueado(estado, ahora),
    minutosRestantes: minutosRestantesBloqueo(estado, ahora),
    intentosRestantes: intentosRestantes(estado, ahora),
    maxIntentos: MAX_INTENTOS_FALLIDOS,
  };
}
