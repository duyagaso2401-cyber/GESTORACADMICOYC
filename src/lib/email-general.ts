// =====================================================================
// src/lib/email-general.ts
// Envío de correo de PROPÓSITO GENERAL para el sistema K-12 original
// (recuperación de contraseña, alertas académicas automáticas a
// acudientes, comunicados masivos, credenciales de pre-matrícula, etc.).
//
// Esta es una pieza DISTINTA de src/university-lms/utils/email.js: aquella
// solo sirve al Centro de Notificaciones del módulo universitario nuevo
// (LMS/SIS). Esta sirve al frontend K-12 original (03-app-core.js y
// 06-documentos-y-resto.js), que ya llamaba a un endpoint
// POST /api/inetis/send-email que nunca había sido registrado en el
// servidor — por eso el navegador reportaba 404 al intentar recuperar
// contraseña.
//
// Reutiliza exactamente las mismas variables de entorno SMTP ya
// configuradas para el módulo universitario, así que basta con tenerlas
// puestas una sola vez en el .env / Render para que AMBOS sistemas de
// correo (el K-12 original y el universitario nuevo) queden operativos:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (opcional)
//
// Si no están configuradas, esta función nunca lanza excepción: devuelve
// { ok:false, error, hint } de forma controlada para que el frontend
// muestre su mensaje de "correo no disponible" ya existente, sin romper
// el resto del flujo (ej. la recuperación de contraseña sigue generando
// y guardando la contraseña temporal aunque el correo falle).
// =====================================================================
import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

export const smtpGeneralConfigurado = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

// Se tipa como "any" a propósito: el proyecto no declara @types/nodemailer
// (igual que src/university-lms/utils/email.js, que es plano JS) y se
// ejecuta siempre con "tsx" sin paso de chequeo de tipos, así que esto
// no afecta en nada al comportamiento real — solo evita depender de un
// paquete de tipos que no está instalado.
let transportadorGeneral: any = null;

if (smtpGeneralConfigurado) {
  transportadorGeneral = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true = SSL directo (465); false = STARTTLS (587/25)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  transportadorGeneral.verify().then(
    () => console.log('✅ [inetis/send-email] SMTP verificado y operativo (' + SMTP_HOST + ') — recuperación de contraseña y correos generales activos.'),
    (err: any) => console.warn('⚠️  [inetis/send-email] SMTP configurado pero la verificación de conexión falló:', err?.message, '— se seguirá intentando enviar correos igualmente.')
  );
} else {
  console.warn(
    '⚠️  [inetis/send-email] Envío de correo general (recuperación de contraseña, alertas a acudientes, comunicados) no configurado todavía. ' +
    'Define SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (y opcionalmente SMTP_FROM) para activarlo.'
  );
}

export interface ResultadoEnvioCorreo {
  ok: boolean;
  error?: string;
  hint?: string;
}

/** Envío genérico {to, subject, text|html}. Nunca lanza: siempre resuelve
 * con { ok:true } o { ok:false, error, hint } para que la ruta HTTP
 * simplemente traduzca el resultado a un código de estado. */
export async function enviarCorreoGeneral(opts: { to: string; subject: string; text?: string; html?: string }): Promise<ResultadoEnvioCorreo> {
  const { to, subject, text, html } = opts;
  if (!to || !subject) {
    return { ok: false, error: 'Faltan campos requeridos (to, subject).', hint: 'Datos incompletos' };
  }
  if (!smtpGeneralConfigurado || !transportadorGeneral) {
    return { ok: false, error: 'El servicio de correo no está configurado en el servidor (faltan SMTP_HOST/SMTP_USER/SMTP_PASS).', hint: 'SMTP no configurado' };
  }
  try {
    await transportadorGeneral.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
    });
    return { ok: true };
  } catch (err: any) {
    console.warn('⚠️  [inetis/send-email] No se pudo enviar el correo:', err?.message || err);
    return { ok: false, error: err?.message || 'Error desconocido al enviar el correo.', hint: 'Error al enviar' };
  }
}

export default { enviarCorreoGeneral, smtpGeneralConfigurado };
