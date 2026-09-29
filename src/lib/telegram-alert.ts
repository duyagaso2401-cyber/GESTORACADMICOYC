// ════════════════════════════════════════════════════════════════════════════
// RONDA 89 (revisión) — ALERTAS POR TELEGRAM AL SÚPER ADMIN (Bot API oficial)
// ------------------------------------------------------------------------------
// Reemplaza el canal de WhatsApp/Twilio de la primera versión de esta ronda
// (que requería una cuenta de Twilio de pago) por el Bot API de Telegram,
// que es gratuito e indefinido — no tiene costo por mensaje ni vencimiento
// de "sandbox" — pedido explícito de esta revisión ("100% gratuita e
// indefinida"). El diseño es el mismo que ya tenía el canal de WhatsApp:
// credenciales de PLATAFORMA en variables de entorno (no multi-tenant,
// a diferencia de src/lib/sms-provider.ts), nunca lanza, y es un canal
// ADICIONAL al Push — si Telegram falla o está apagado, el Push web se
// intenta igual (ver infrastructure-alert-job.ts).
//
// CÓMO SE OBTIENEN LAS CREDENCIALES (para el Súper Admin, referencia
// rápida — no afecta el código, solo documenta el "gratis e indefinido"
// pedido):
//   1) TELEGRAM_BOT_TOKEN: se crea hablándole a @BotFather en Telegram
//      ("/newbot") — es gratis, no expira, no requiere tarjeta.
//   2) TELEGRAM_ADMIN_CHAT_ID: el chat_id del Súper Admin (o de un grupo
//      privado que solo él vea) — se obtiene enviándole un mensaje al bot
//      recién creado y consultando https://api.telegram.org/bot<TOKEN>/getUpdates.
// ════════════════════════════════════════════════════════════════════════════

const TELEGRAM_ENABLED = String(process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

export const TELEGRAM_CONFIGURADO = !!(TELEGRAM_ENABLED && TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID);

if (TELEGRAM_ENABLED && !TELEGRAM_CONFIGURADO) {
  console.warn('⚠️ TELEGRAM_ENABLED=true pero faltan TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_CHAT_ID: las alertas de Telegram quedan desactivadas hasta completarlas.');
}

export interface ResultadoTelegram { ok: boolean; detalle: string }

/**
 * Envía un mensaje (formato HTML, ver parse_mode) al chat del Súper Admin
 * vía el Bot API oficial de Telegram (gratuito e indefinido — sin cuenta
 * de pago ni vencimiento de sandbox). Si el canal está apagado o mal
 * configurado, retorna { ok:false } de inmediato sin intentar red — nunca
 * lanza, misma filosofía que push-provider.ts y el resto de este proyecto.
 */
export async function enviarAlertaTelegram(mensajeHtml: string): Promise<ResultadoTelegram> {
  if (!TELEGRAM_ENABLED) return { ok: false, detalle: 'TELEGRAM_ENABLED=false — canal desactivado' };
  if (!TELEGRAM_CONFIGURADO) return { ok: false, detalle: 'Faltan TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_CHAT_ID por configurar' };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_CHAT_ID,
        text: mensajeHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return { ok: resp.ok, detalle: `telegram:HTTP ${resp.status}` };
  } catch (e: any) {
    return { ok: false, detalle: 'Error de red al llamar a la API de Telegram: ' + (e?.message || 'desconocido') };
  }
}
