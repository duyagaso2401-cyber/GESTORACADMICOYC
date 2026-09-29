// ════════════════════════════════════════════════════════════════════════════
// RONDA 89 — LÓGICA PURA DEL SISTEMA DE ALERTAS PROACTIVAS DE INFRAESTRUCTURA
// (Render/Neon), SIN dependencias externas — mismo criterio ya usado en
// infra-thresholds.ts (Ronda 49) y resource-quota-thresholds.ts (Ronda 88):
// separar "qué decide disparar una alerta y cada cuánto puede repetirse" de
// la parte con I/O real (fetch a Push/WhatsApp, lectura/escritura en la
// base de datos), para poder probar la primera con ejecución real y datos
// simulados, sin depender de credenciales ni de una base de datos.
//
// UMBRALES PEDIDOS: 85% (Advertencia) y 90% (Crítico) — DISTINTOS de los
// umbrales 80%/90% que ya usa el resto del panel de Súper Admin
// (_colorPorPorcentaje en 03-app-core.js, UMBRAL_PREVENTIVO_PCT/
// UMBRAL_CRITICO_PCT en infra-thresholds.ts). Esto es intencional y se deja
// documentado para que no se confunda con un error de copiar/pegar: el
// COLOR de la barra de progreso del panel (Ronda 88) sigue usando 80/90
// para consistencia visual con el resto del sistema, pero el DISPARO de
// notificaciones proactivas (Push/WhatsApp) —que si se manda de más se
// vuelve spam molesto, y si se manda de menos deja pasar un riesgo real de
// sobrecosto— usa exactamente los umbrales que pidió el usuario para esta
// ronda: 85/90.
// ════════════════════════════════════════════════════════════════════════════

export const UMBRAL_ADVERTENCIA_PCT = 85;
export const UMBRAL_CRITICO_ALERTA_PCT = 90;
export const COOLDOWN_ALERTA_MS = 24 * 60 * 60 * 1000; // 24 horas, pedido explícitamente
export const INTERVALO_JOB_ALERTAS_MS = 2 * 60 * 60 * 1000; // cada 2 horas, pedido explícitamente

export type NivelAlertaCuota = 'advertencia' | 'critica';

/** Determina si un porcentaje de consumo dispara alerta, y en qué nivel.
 * null (dato no disponible, ej. la API de Render/Neon no respondió) NUNCA
 * dispara nada — no hay alerta falsa por falta de dato. */
export function nivelAlertaDisparado(pct: number | null | undefined): NivelAlertaCuota | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  if (pct >= UMBRAL_CRITICO_ALERTA_PCT) return 'critica';
  if (pct >= UMBRAL_ADVERTENCIA_PCT) return 'advertencia';
  return null;
}

/** Clave única de cooldown por servicio+nivel — ej. 'render:critica'. Se
 * usa una clave DISTINTA por nivel (no solo por servicio) a propósito: si
 * el consumo pasa de 85% a 90% se considera una alerta nueva y se avisa de
 * inmediato aunque ya se hubiera avisado el 85% hace menos de 24h — subir a
 * "crítico" es información nueva y relevante, no un reenvío de la misma
 * alerta. */
export function claveCooldown(servicio: 'render' | 'neon', nivel: NivelAlertaCuota): string {
  return `${servicio}:${nivel}`;
}

/** ¿Ya pasó el cooldown de 24h desde el último envío de ESTA alerta
 * (mismo servicio+nivel)? `ultimoEnvioMs` es null si nunca se ha enviado —
 * en ese caso SIEMPRE se debe enviar. */
export function debeEnviarAlerta(ultimoEnvioMs: number | null, ahoraMs: number): boolean {
  if (ultimoEnvioMs === null || ultimoEnvioMs === undefined) return true;
  return (ahoraMs - ultimoEnvioMs) >= COOLDOWN_ALERTA_MS;
}

export interface MensajeAlertaCuota { titulo: string; cuerpo: string }

const NOMBRE_SERVICIO: Record<'render' | 'neon', string> = {
  render: 'Render (Outbound Bandwidth)',
  neon: 'Neon (Net Transfer)',
};

/** Redacta el texto de la alerta (mismo mensaje base para Push y Telegram,
 * cada canal lo ajusta a su propio formato de envío — ver
 * construirMensajeAlertaTelegramHtml() más abajo para la variante HTML) —
 * función pura, fácil de probar palabra por palabra. */
export function construirMensajeAlerta(servicio: 'render' | 'neon', nivel: NivelAlertaCuota, pct: number): MensajeAlertaCuota {
  const nombre = NOMBRE_SERVICIO[servicio];
  const emoji = nivel === 'critica' ? '🔴' : '🟠';
  const etiqueta = nivel === 'critica' ? 'CRÍTICO' : 'ADVERTENCIA';
  return {
    titulo: `${emoji} ${etiqueta}: consumo de ${nombre} al ${pct}%`,
    cuerpo: `${nombre} lleva consumido el ${pct}% de su cuota del mes. Revise el panel "📡 Recursos y Cuotas" del Gestor Académico YC para evitar bloqueos o sobrecostos en la facturación.`,
  };
}

/**
 * Variante en HTML del mismo mensaje, para el Bot de Telegram
 * (sendMessage con parse_mode: 'HTML' — ver src/lib/telegram-alert.ts).
 * Usa únicamente las etiquetas que Telegram permite en modo HTML (b/i/code),
 * y dice explícitamente el recurso afectado y el porcentaje consumido, tal
 * como se pidió. Función pura y separada de construirMensajeAlerta() para
 * poder probar el escape/formato de Telegram sin duplicar la redacción
 * base del mensaje.
 */
export function construirMensajeAlertaTelegramHtml(servicio: 'render' | 'neon', nivel: NivelAlertaCuota, pct: number): string {
  const { titulo, cuerpo } = construirMensajeAlerta(servicio, nivel, pct);
  const nombre = NOMBRE_SERVICIO[servicio];
  return `<b>${_escaparHtmlTelegram(titulo)}</b>\n\n${_escaparHtmlTelegram(cuerpo)}\n\nRecurso: <b>${_escaparHtmlTelegram(nombre)}</b>\nConsumo: <b>${pct}%</b>`;
}

// Telegram exige escapar &, < y > incluso en modo HTML (de lo contrario
// rechaza el mensaje con "can't parse entities" si el texto tuviera algún
// símbolo que pareciera una etiqueta) — nuestros textos son fijos y no
// deberían tenerlos nunca, pero se escapa de todas formas por si acaso.
function _escaparHtmlTelegram(texto: string): string {
  return String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
