// =====================================================================
// src/lib/email-http-provider.ts
// ------------------------------------------------------------------------
// Envío de correo por API HTTP (puerto 443, el que ningún plan de hosting
// bloquea) como CANAL ADICIONAL — no un reemplazo — al envío por SMTP que
// ya existe en src/lib/email-general.ts y src/university-lms/utils/email.js.
//
// Motivo: desde septiembre de 2025, Render.com bloquea en su plan
// gratuito todo el tráfico saliente a los puertos SMTP (25, 465, 587),
// así que un servidor en ese plan nunca puede enviar correo por SMTP sin
// importar qué tan bien configuradas estén las credenciales. Este módulo
// permite seguir enviando correo igual, sin necesidad de cambiar de plan,
// usando la API HTTP del mismo proveedor (o de otro) en su lugar.
//
// LAS DOS FORMAS CONVIVEN: email-general.ts y email.js intentan primero
// este canal (si está configurado) y, si falla o no está configurado,
// caen automáticamente al SMTP de siempre — así que si en algún momento
// se pasa a un plan pago de Render (donde el SMTP sí funciona), no hace
// falta tocar nada: basta con no configurar las variables de este
// archivo y todo sigue funcionando exactamente como hoy.
//
// Proveedores soportados (se elige UNO con la variable de entorno
// EMAIL_API_PROVIDER):
//
//   "resend"    → https://resend.com — 100 correos/día gratis. Requiere
//                 crear una cuenta, verificar un dominio propio por DNS
//                 (agregar unos registros TXT/CNAME que Resend te indica)
//                 y generar una API key.
//
//   "zeptomail" → https://www.zoho.com/zeptomail/ — producto de correo
//                 TRANSACCIONAL de Zoho (distinto del Zoho Mail normal
//                 que ya usas por SMTP). Como ya tienes una cuenta y un
//                 dominio verificado en Zoho, probablemente sea el más
//                 rápido de activar. Requiere activar ZeptoMail dentro de
//                 tu cuenta Zoho y generar una "Send Mail Token".
//
// Variables de entorno nuevas (todas opcionales — si no se definen,
// simplemente no se usa este canal y todo sigue por SMTP como hasta
// ahora):
//   EMAIL_API_PROVIDER = "resend" | "zeptomail"
//   EMAIL_API_KEY      = la API key / token de ese proveedor
//   EMAIL_API_FROM     = remitente a mostrar (si no se define, se usa
//                        SMTP_FROM o SMTP_USER como respaldo)
// =====================================================================

const EMAIL_API_PROVIDER = (process.env.EMAIL_API_PROVIDER || '').trim().toLowerCase();
const EMAIL_API_KEY = process.env.EMAIL_API_KEY || '';
const EMAIL_API_FROM = process.env.EMAIL_API_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '';

export const emailApiConfigurado = Boolean(EMAIL_API_PROVIDER && EMAIL_API_KEY);

if (EMAIL_API_PROVIDER && !EMAIL_API_KEY) {
  console.warn('⚠️  [email-http-provider] EMAIL_API_PROVIDER="' + EMAIL_API_PROVIDER + '" definido pero falta EMAIL_API_KEY — este canal quedará inactivo hasta que se defina.');
}
if (emailApiConfigurado) {
  console.log('✅ [email-http-provider] Canal de correo por API HTTP activo (' + EMAIL_API_PROVIDER + ') — se intentará primero, con SMTP como respaldo automático si falla o no está configurado.');
} else {
  console.log('ℹ️  [email-http-provider] Canal de correo por API HTTP no configurado (opcional) — el envío sigue funcionando por SMTP como hasta ahora. Para activarlo (recomendado si el hosting bloquea puertos SMTP, ej. Render.com plan gratuito), define EMAIL_API_PROVIDER + EMAIL_API_KEY.');
}

export interface ResultadoEnvioApi {
  ok: boolean;
  error?: string;
}

interface ParametrosEnvioApi {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

/** Envía un correo por la API HTTP configurada. Nunca lanza: siempre
 * resuelve con {ok:true} o {ok:false, error} para que el llamador pueda
 * decidir con calma si cae de inmediato al respaldo SMTP. */
export async function enviarPorApiHttp(params: ParametrosEnvioApi): Promise<ResultadoEnvioApi> {
  if (!emailApiConfigurado) {
    return { ok: false, error: 'Canal de API HTTP no configurado (EMAIL_API_PROVIDER/EMAIL_API_KEY).' };
  }
  try {
    if (EMAIL_API_PROVIDER === 'resend') return await enviarConResend(params);
    if (EMAIL_API_PROVIDER === 'zeptomail') return await enviarConZeptoMail(params);
    return { ok: false, error: 'EMAIL_API_PROVIDER="' + EMAIL_API_PROVIDER + '" no reconocido (valores válidos: "resend", "zeptomail").' };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error desconocido al enviar por API HTTP.' };
  }
}

async function enviarConResend(p: ParametrosEnvioApi): Promise<ResultadoEnvioApi> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + EMAIL_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_API_FROM,
      to: [p.to],
      subject: p.subject,
      text: p.text || undefined,
      html: p.html || undefined,
    }),
  });
  if (resp.ok) return { ok: true };
  const cuerpo = await resp.text().catch(() => '');
  return { ok: false, error: 'Resend respondió ' + resp.status + ': ' + cuerpo.slice(0, 300) };
}

async function enviarConZeptoMail(p: ParametrosEnvioApi): Promise<ResultadoEnvioApi> {
  // ZeptoMail espera la cabecera Authorization con el valor COMPLETO que
  // el panel de Zoho entrega (normalmente algo como "Zoho-enczapikey
  // wSs...") — por eso aquí se manda EMAIL_API_KEY tal cual, sin agregarle
  // ningún prefijo "Bearer".
  const resp = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      Authorization: EMAIL_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { address: EMAIL_API_FROM },
      to: [{ email_address: { address: p.to } }],
      subject: p.subject,
      htmlbody: p.html || (p.text ? '<pre style="font-family:inherit;white-space:pre-wrap">' + _escaparHtml(p.text) + '</pre>' : undefined),
      textbody: p.text || undefined,
    }),
  });
  if (resp.ok) return { ok: true };
  const cuerpo = await resp.text().catch(() => '');
  return { ok: false, error: 'ZeptoMail respondió ' + resp.status + ': ' + cuerpo.slice(0, 300) };
}

function _escaparHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export default { enviarPorApiHttp, emailApiConfigurado };
