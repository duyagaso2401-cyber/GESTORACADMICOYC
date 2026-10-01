// ════════════════════════════════════════════════════════════════════════
// RONDA 105 — ALERTAS DE SALUD DE LOS RESPALDOS AUTOMÁTICOS (ítem 2.3 de la
// hoja de ruta de mejoras).
//
// HALLAZGO QUE MOTIVA ESTE MÓDULO (ver la corrección al ítem 1.7 de la
// hoja de ruta, hecha en la Ronda 103): el sistema YA tiene un respaldo
// automático semanal de cada institución hacia Cloudinary
// (ejecutarRespaldosAutomaticosPendientes() en src/index.ts) — funciona
// bien, pero corre en silencio. Si Cloudinary no está configurado, o si un
// respaldo puntual falla, lo único que queda es un console.warn/error en
// los logs del servidor, que nadie revisa de forma proactiva. Este módulo
// no cambia el mecanismo de respaldo en sí — solo le agrega una voz: avisa
// de verdad (Telegram + Push al Súper Admin) cuando algo necesita atención.
//
// REUTILIZA, a propósito, la misma infraestructura de alertas ya construida
// en la Ronda 89 (infra-alert-thresholds.ts / infrastructure-alert-job.ts)
// en vez de inventar un mecanismo nuevo: el mismo canal (Telegram + Push a
// todos los Súper Admins) y el mismo concepto de "cooldown" persistido
// (tabla infra_alert_cooldown, con una clave propia por tipo de alerta) —
// ver debeEnviarAlerta() en infra-alert-thresholds.ts, reutilizada aquí tal
// cual, sin duplicarla.
//
// Funciones 100% puras aquí (sin Drizzle, sin Express, sin red) — el
// envío real y la lectura/escritura del cooldown viven en
// src/index.ts, igual que ya separa infrastructure-alert-job.ts su propia
// lógica pura de su propio I/O.
// ════════════════════════════════════════════════════════════════════════

export const COOLDOWN_ALERTA_RESPALDO_MS = 24 * 60 * 60 * 1000; // 24 horas — mismo criterio que las alertas de cuotas

/** Clave de cooldown para el respaldo FALLIDO de una institución puntual
 * — una clave por institución, para que el fallo de una no "tape" el
 * aviso de otra que falle el mismo día. */
export function claveCooldownRespaldoFallido(skInstitucion: string): string {
  return `respaldo-fallido:${skInstitucion}`;
}

/** Clave de cooldown para el aviso GLOBAL de "Cloudinary no está
 * configurado" — una sola clave para todo el sistema (no una por
 * institución): es un problema de configuración de la plataforma, no de
 * una institución en particular, así que un solo aviso consolidado basta
 * aunque haya decenas de instituciones con el respaldo pendiente. */
export const CLAVE_COOLDOWN_RESPALDO_SIN_CONFIGURAR = 'respaldo-sin-configurar';

export interface MensajeAlertaRespaldo { titulo: string; cuerpo: string }

/** Mensaje para cuando el respaldo de UNA institución específica falló
 * (ej. error de red subiendo a Cloudinary, cuota de Cloudinary agotada,
 * etc.) — incluye el error real para que quien lo revise no tenga que ir a
 * buscar en los logs del servidor para saber qué pasó. */
export function construirMensajeRespaldoFallido(skInstitucion: string, nombreInstitucion: string, detalleError: string): MensajeAlertaRespaldo {
  const nombre = nombreInstitucion || skInstitucion;
  return {
    titulo: `🔴 Falló el respaldo automático de "${nombre}"`,
    cuerpo: `El respaldo automático semanal de la institución "${nombre}" (${skInstitucion}) falló. Detalle: ${detalleError}. Revise la configuración de Cloudinary o intente un respaldo manual ("Descargar Respaldo") mientras tanto.`,
  };
}

/** Mensaje consolidado para cuando Cloudinary no está configurado del todo
 * y por eso NINGÚN respaldo automático se puede completar — `cantidad` es
 * cuántas instituciones tienen un respaldo pendiente en este momento, para
 * que el mensaje transmita la urgencia real (no es lo mismo 1 institución
 * que 50). */
export function construirMensajeRespaldoSinConfigurar(cantidadInstitucionesPendientes: number): MensajeAlertaRespaldo {
  return {
    titulo: '🟠 Los respaldos automáticos están pendientes: falta configurar Cloudinary',
    cuerpo: `${cantidadInstitucionesPendientes} institución(es) tienen un respaldo automático pendiente, pero Cloudinary no está configurado en el servidor — ningún respaldo automático se puede completar hasta que se configuren las credenciales de Cloudinary en las variables de entorno.`,
  };
}

// Telegram exige escapar &, < y > incluso en modo HTML — mismo criterio
// exacto que _escaparHtmlTelegram() en infra-alert-thresholds.ts (no se
// importa de ahí porque es una función privada de ese módulo; se duplica
// aquí deliberadamente, a propósito, porque es de una sola línea y así
// este archivo no depende de un detalle interno de otro).
function _escaparHtmlTelegram(texto: string): string {
  return String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Variante en HTML del mensaje de respaldo fallido, lista para
 * enviarAlertaTelegram() (parse_mode: 'HTML'). */
export function construirMensajeRespaldoFallidoTelegramHtml(skInstitucion: string, nombreInstitucion: string, detalleError: string): string {
  const { titulo, cuerpo } = construirMensajeRespaldoFallido(skInstitucion, nombreInstitucion, detalleError);
  return `<b>${_escaparHtmlTelegram(titulo)}</b>\n\n${_escaparHtmlTelegram(cuerpo)}`;
}

/** Variante en HTML del mensaje de "Cloudinary no configurado". */
export function construirMensajeRespaldoSinConfigurarTelegramHtml(cantidadInstitucionesPendientes: number): string {
  const { titulo, cuerpo } = construirMensajeRespaldoSinConfigurar(cantidadInstitucionesPendientes);
  return `<b>${_escaparHtmlTelegram(titulo)}</b>\n\n${_escaparHtmlTelegram(cuerpo)}`;
}
