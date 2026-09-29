// ════════════════════════════════════════════════════════════════════════════
// RONDA 89 — ALERTAS POR WHATSAPP AL SÚPER ADMIN (Twilio WhatsApp API)
// ------------------------------------------------------------------------------
// Se separa de src/lib/sms-provider.ts a propósito: aquel es multi-tenant
// (credenciales POR Entidad Territorial, guardadas en
// etc_entidades.sms_provider_config, para SMS a docentes/acudientes) —
// esto es de PLATAFORMA (un solo destino fijo: el celular del Súper
// Admin), así que sus credenciales viven en variables de entorno, igual
// que RENDER_API_KEY/NEON_API_KEY (Ronda 88) o VAPID_* (push-provider.ts).
// Se reutiliza el MISMO mecanismo de despacho a Twilio ya probado en
// sms-provider.ts (POST a Messages.json con auth básica accountSid:authToken
// y cuerpo application/x-www-form-urlencoded) — la única diferencia real de
// WhatsApp sobre SMS en la API de Twilio es que "From"/"To" llevan el
// prefijo "whatsapp:".
//
// NUNCA LANZA: exactamente la misma filosofía que push-provider.ts y
// sms-provider.ts — un fallo de red, credenciales mal puestas o el canal
// apagado (WHATSAPP_ENABLED=false) jamás debe tumbar ni demorar el job de
// monitoreo que lo llama (ver infrastructure-alert-job.ts). El Push web
// siempre se intenta de todas formas — WhatsApp es un canal ADICIONAL, no
// el único.
// ════════════════════════════════════════════════════════════════════════════

const WHATSAPP_ENABLED = String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true';
const WHATSAPP_ADMIN_PHONE = process.env.WHATSAPP_ADMIN_PHONE || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '';

export const WHATSAPP_CONFIGURADO = !!(WHATSAPP_ENABLED && WHATSAPP_ADMIN_PHONE && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_NUMBER);

if (WHATSAPP_ENABLED && !WHATSAPP_CONFIGURADO) {
  console.warn('⚠️ WHATSAPP_ENABLED=true pero faltan WHATSAPP_ADMIN_PHONE/TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_NUMBER: las alertas de WhatsApp quedan desactivadas hasta completarlas.');
}

/** Antepone "whatsapp:" si el número (propio o del destino) todavía no lo
 * tiene — evita un error de formato tonto si alguien pega el número tal
 * cual lo copió de Twilio o tal cual lo tiene guardado en el celular. */
function _formatoWhatsapp(numero: string): string {
  const limpio = String(numero || '').trim();
  return limpio.startsWith('whatsapp:') ? limpio : `whatsapp:${limpio}`;
}

export interface ResultadoWhatsapp { ok: boolean; detalle: string }

/**
 * Envía un mensaje de texto directo al WhatsApp del Súper Admin
 * (WHATSAPP_ADMIN_PHONE). Si el canal está apagado o mal configurado,
 * retorna { ok:false } de inmediato sin intentar red — nunca lanza.
 */
export async function enviarAlertaWhatsapp(mensaje: string): Promise<ResultadoWhatsapp> {
  if (!WHATSAPP_ENABLED) return { ok: false, detalle: 'WHATSAPP_ENABLED=false — canal desactivado' };
  if (!WHATSAPP_CONFIGURADO) return { ok: false, detalle: 'Faltan variables de entorno de WhatsApp/Twilio por configurar' };
  try {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const cuerpo = new URLSearchParams({
      To: _formatoWhatsapp(WHATSAPP_ADMIN_PHONE),
      From: _formatoWhatsapp(TWILIO_WHATSAPP_NUMBER),
      Body: mensaje,
    });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    });
    return { ok: resp.ok, detalle: `twilio-whatsapp:HTTP ${resp.status}` };
  } catch (e: any) {
    return { ok: false, detalle: 'Error de red al llamar a la API de WhatsApp de Twilio: ' + (e?.message || 'desconocido') };
  }
}
