// =====================================================================
// src/university-lms/utils/email.js
// Plantilla de correo para el Centro de Notificaciones Multicanal
// (sección 5): nuevas tareas, recordatorios, calificaciones publicadas,
// anuncios importantes, aprobación/rechazo de supletorios.
//
// INTEGRACIÓN 100% OPERATIVA — nodemailer es una dependencia real y
// obligatoria del proyecto (agregada a package.json), importada de forma
// ESTÁTICA (no dynamic-import con fallback). En cuanto las variables de
// entorno SMTP estén configuradas en Render/Replit/tu servidor, el envío
// de correo queda activo de inmediato sin ningún paso adicional.
//
// Variables de entorno requeridas para activar el envío real:
//   SMTP_HOST   — ej. smtp.gmail.com, smtp.sendgrid.net, smtp.office365.com
//   SMTP_PORT   — 587 (STARTTLS, por defecto) o 465 (SSL directo)
//   SMTP_USER   — usuario/cuenta SMTP
//   SMTP_PASS   — contraseña o app-password del proveedor SMTP
//   SMTP_FROM   — remitente que verá el destinatario, ej.
//                 "Gestor Académico YC <no-reply@tu-dominio.edu>"
//                 (si no se define, se usa SMTP_USER)
//
// Si estas variables NO están configuradas todavía (por ejemplo, en un
// entorno de desarrollo local recién clonado), el módulo NO rompe el
// arranque del servidor: registra un aviso claro en consola una sola vez
// y las notificaciones siguen guardándose normalmente en el Centro de
// Notificaciones in-app (univ_notificaciones) — el correo es un canal
// adicional, nunca un requisito para que el resto del sistema funcione.
// =====================================================================
import nodemailer from 'nodemailer';
import { enviarPorApiHttp, emailApiConfigurado } from '../../lib/email-http-provider.js';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

// SMTP_SECURE es OPCIONAL: si no se define explícitamente, se infiere del
// puerto (465 = SSL directo; cualquier otro = STARTTLS). Ver la misma
// constante en src/lib/email-general.ts para más detalle.
const SMTP_SECURE_ENV = (process.env.SMTP_SECURE || '').trim().toLowerCase();
const SMTP_SECURE = SMTP_SECURE_ENV === '' ? SMTP_PORT === 465 : (SMTP_SECURE_ENV === 'true' || SMTP_SECURE_ENV === '1');

export const smtpConfigurado = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
// "Algo" está configurado si hay SMTP O el canal de API HTTP (ver
// src/lib/email-http-provider.js) — ambos pueden convivir.
export const correoNotifConfigurado = smtpConfigurado || emailApiConfigurado;

// Detecta si el fallo de envío se debe a que el puerto SMTP saliente está
// bloqueado por el hosting (ej. Render.com en su plan gratuito bloquea los
// puertos 25/465/587 desde septiembre de 2025) en vez de a credenciales
// incorrectas — ver detalle en src/lib/email-general.ts.
function esErrorDeBloqueoDePuerto(err) {
  const codigo = String(err?.code || '').toUpperCase();
  const msj = String(err?.message || '').toLowerCase();
  return (
    codigo === 'ETIMEDOUT' ||
    codigo === 'ECONNREFUSED' ||
    codigo === 'ESOCKET' ||
    msj.includes('timeout') ||
    msj.includes('econnrefused')
  );
}

let transportador = null;

if (smtpConfigurado) {
  transportador = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE, // inferido del puerto salvo que SMTP_SECURE lo fuerce explícitamente
    connectionTimeout: 10000, // 10s — evita dejar la notificación colgada si el puerto está bloqueado
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  // Verificación de conexión en segundo plano al arrancar — solo informativa,
  // nunca bloquea el arranque del servidor ni lanza una excepción.
  transportador.verify().then(
    () => console.log('✅ [university-lms] SMTP verificado y operativo (' + SMTP_HOST + ') — envío real de correo activo.'),
    (err) => console.warn('⚠️  [university-lms] SMTP configurado pero la verificación de conexión falló:', err.message, '— se seguirá intentando enviar correos igualmente.')
  );
} else {
  console.warn(
    '⚠️  [university-lms] Envío de correo SMTP no configurado todavía. ' +
    'Define SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (y opcionalmente SMTP_FROM) ' +
    'como variables de entorno para activarlo. Mientras tanto, las notificaciones ' +
    'del Centro de Notificaciones se siguen guardando normalmente (solo el canal de correo queda inactivo).'
  );
}

function plantillaHtml({ titulo, cuerpo, urlAccion }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e2e2e2;border-radius:8px;overflow:hidden">
    <div style="background:#1a3a5c;color:#fff;padding:16px 20px;font-size:16px;font-weight:bold">🎓 Gestor Académico YC</div>
    <div style="padding:20px;color:#222">
      <h2 style="margin:0 0 12px;font-size:18px;color:#1a3a5c">${escaparHtml(titulo)}</h2>
      <p style="line-height:1.5;font-size:14px">${escaparHtml(cuerpo || '')}</p>
      ${urlAccion ? `<a href="${urlAccion}" style="display:inline-block;margin-top:12px;background:#1a3a5c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Ver detalle</a>` : ''}
    </div>
    <div style="padding:12px 20px;background:#f5f5f5;color:#888;font-size:11px">Este es un mensaje automático — no responda a este correo.</div>
  </div>`;
}
function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Envío best-effort: nunca lanza, nunca bloquea al llamador (igual
 * filosofía que registrarEvento en logger.js). Devuelve true/false solo
 * para quien quiera loguear el resultado. */
export async function enviarCorreoNotificacion({ destinatarioEmail, titulo, cuerpo, urlAccion }) {
  if (!destinatarioEmail) return false;
  if (!correoNotifConfigurado) return false;

  // ── CANAL 1: API HTTP (si está configurada) — puerto 443, nunca
  // bloqueado por el hosting. Se intenta primero; si falla o no está
  // configurada, cae al SMTP de siempre (ambos canales conviven).
  if (emailApiConfigurado) {
    const rApi = await enviarPorApiHttp({ to: destinatarioEmail, subject: titulo, html: plantillaHtml({ titulo, cuerpo, urlAccion }) });
    if (rApi.ok) return true;
    console.warn('⚠️  [university-lms] Falló el envío por API HTTP (' + rApi.error + ') — se intentará por SMTP como respaldo.');
  }

  // ── CANAL 2: SMTP (de siempre) ────────────────────────────────────────
  if (!smtpConfigurado || !transportador) return false;
  try {
    await transportador.sendMail({
      from: SMTP_FROM,
      to: destinatarioEmail,
      subject: titulo,
      html: plantillaHtml({ titulo, cuerpo, urlAccion }),
    });
    return true;
  } catch (err) {
    if (esErrorDeBloqueoDePuerto(err)) {
      console.warn(
        '⚠️  [university-lms] Conexión SMTP bloqueada o expirada (código: ' + (err?.code || 'desconocido') + '). ' +
        'Si el servidor corre en un plan gratuito de Render.com, ese plan bloquea los puertos SMTP 25/465/587 ' +
        'desde septiembre de 2025 (no es un problema de usuario/contraseña). Soluciones: actualizar el servicio ' +
        'de Render a un plan pago, o usar un proveedor de correo por API HTTP (Zoho ZeptoMail, Resend, SendGrid, Brevo).'
      );
      return false;
    }
    console.warn('⚠️  [university-lms] No se pudo enviar el correo de notificación:', err.message);
    return false;
  }
}

export default { enviarCorreoNotificacion, smtpConfigurado, correoNotifConfigurado };
