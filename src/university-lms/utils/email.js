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

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

export const smtpConfigurado = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transportador = null;

if (smtpConfigurado) {
  transportador = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true = SSL directo (465); false = STARTTLS (587/25)
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
    console.warn('⚠️  [university-lms] No se pudo enviar el correo de notificación:', err.message);
    return false;
  }
}

export default { enviarCorreoNotificacion, smtpConfigurado };
