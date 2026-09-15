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
import { enviarPorApiHttp, emailApiConfigurado } from './email-http-provider.js';

// Mismo problema y misma solución que en email-http-provider.ts: si al
// pegar estas variables en el panel de Render quedaron comillas literales
// envolviendo el valor (ej. SMTP_FROM = "\"Gestor Académico YC <...>\""),
// eso rompe el remitente/credenciales sin que salte ningún error de
// "variable faltante". _limpiarEnv() quita un único par de comillas
// (dobles o simples) que envuelvan TODO el valor, y recorta espacios.
function _limpiarEnv(v: string | undefined): string {
  let s = (v || '').trim();
  if (s.length >= 2) {
    const primera = s[0];
    const ultima = s[s.length - 1];
    if ((primera === '"' && ultima === '"') || (primera === "'" && ultima === "'")) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

const SMTP_HOST = _limpiarEnv(process.env.SMTP_HOST);
const SMTP_PORT = Number(_limpiarEnv(process.env.SMTP_PORT) || 587);
const SMTP_USER = _limpiarEnv(process.env.SMTP_USER);
const SMTP_PASS = _limpiarEnv(process.env.SMTP_PASS);
const SMTP_FROM = _limpiarEnv(process.env.SMTP_FROM) || SMTP_USER;

// SMTP_SECURE es OPCIONAL: si no se define explícitamente, se infiere del
// puerto (465 = SSL directo; cualquier otro = STARTTLS), que es lo correcto
// para el 99% de los proveedores (Zoho, Gmail, Office365, SendGrid, etc.).
// Si el hosting o el proveedor exige forzarlo manualmente, "true"/"1" fuerza
// SSL directo y "false"/"0" fuerza STARTTLS sin importar el puerto.
const SMTP_SECURE_ENV = (process.env.SMTP_SECURE || '').trim().toLowerCase();
const SMTP_SECURE = SMTP_SECURE_ENV === '' ? SMTP_PORT === 465 : (SMTP_SECURE_ENV === 'true' || SMTP_SECURE_ENV === '1');

export const smtpGeneralConfigurado = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
// "Algo" está configurado si hay SMTP O el canal de API HTTP (ver
// email-http-provider.ts) — ambos pueden convivir; esto solo se usa para
// decidir si el endpoint responde 503 "no configurado" o intenta enviar.
export const correoGeneralConfigurado = smtpGeneralConfigurado || emailApiConfigurado;

// Códigos/mensajes típicos cuando el puerto SMTP saliente está bloqueado por
// el proveedor de hosting (ej. Render.com bloquea los puertos salientes
// 25/465/587 en sus "free web services" desde septiembre de 2025) en vez de
// ser un problema de credenciales. Detectarlo permite devolver una pista
// mucho más útil que "Error al enviar" cuando esto ocurre en producción.
function esErrorDeBloqueoDePuerto(err: any): boolean {
  const codigo = String(err?.code || '').toUpperCase();
  const msj = String(err?.message || '').toLowerCase();
  return (
    codigo === 'ETIMEDOUT' ||
    codigo === 'ECONNREFUSED' ||
    codigo === 'ESOCKET' ||
    msj.includes('timeout') ||
    msj.includes('econnrefused') ||
    msj.includes('connect etimedout')
  );
}
const PISTA_BLOQUEO_PUERTO =
  'No se pudo establecer conexión con el servidor SMTP (tiempo de espera agotado o conexión rechazada). ' +
  'Si el servidor está desplegado en un plan gratuito de Render.com, ese plan BLOQUEA el tráfico saliente ' +
  'a los puertos SMTP 25/465/587 desde septiembre de 2025 — esto NO es un problema de usuario/contraseña. ' +
  'Soluciones: (1) actualizar el servicio web de Render a un plan pago (Starter o superior), donde el bloqueo ' +
  'no aplica, o (2) usar un proveedor de correo transaccional por API HTTP (ej. Zoho ZeptoMail, Resend, SendGrid, Brevo) en vez de SMTP.';

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
    secure: SMTP_SECURE, // ver SMTP_SECURE arriba: inferido del puerto salvo que se defina explícitamente
    connectionTimeout: 10000, // 10s — para no dejar la petición HTTP colgada si el puerto está bloqueado
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
  if (!correoGeneralConfigurado) {
    return { ok: false, error: 'El servicio de correo no está configurado en el servidor (faltan SMTP_HOST/SMTP_USER/SMTP_PASS, o EMAIL_API_PROVIDER/EMAIL_API_KEY).', hint: 'SMTP no configurado' };
  }

  // ── CANAL 1: API HTTP (si está configurada) ──────────────────────────
  // Se intenta PRIMERO porque usa el puerto 443 (HTTPS), que ningún plan
  // de hosting bloquea — a diferencia de los puertos SMTP, que Render.com
  // sí bloquea en su plan gratuito. Si no está configurada, o falla, se
  // cae de inmediato al canal SMTP de abajo (ambos canales conviven).
  if (emailApiConfigurado) {
    const rApi = await enviarPorApiHttp({ to, subject, text, html });
    if (rApi.ok) return { ok: true };
    // El detalle completo del error (incluida la respuesta cruda del
    // proveedor) ya quedó registrado dentro de enviarPorApiHttp() — aquí
    // solo se dice que, por ese motivo, se está cayendo al respaldo SMTP.
    console.error('❌ [inetis/send-email] Falló el envío por API HTTP (' + rApi.error + ') — cayendo al respaldo SMTP.');
    // continúa abajo al intento por SMTP, si está configurado
  }

  // ── CANAL 2: SMTP (de siempre) ────────────────────────────────────────
  if (!smtpGeneralConfigurado || !transportadorGeneral) {
    return {
      ok: false,
      error: emailApiConfigurado
        ? 'El envío por API HTTP falló y no hay SMTP configurado como respaldo.'
        : 'El servicio de correo no está configurado en el servidor (faltan SMTP_HOST/SMTP_USER/SMTP_PASS).',
      hint: 'Error al enviar',
    };
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
    if (esErrorDeBloqueoDePuerto(err)) {
      console.warn('⚠️  [inetis/send-email] Conexión SMTP bloqueada/expirada (posible bloqueo de puerto saliente del hosting):', err?.code || err?.message);
      return { ok: false, error: PISTA_BLOQUEO_PUERTO, hint: 'Puerto SMTP bloqueado por el hosting' };
    }
    console.warn('⚠️  [inetis/send-email] No se pudo enviar el correo:', err?.message || err);
    return { ok: false, error: err?.message || 'Error desconocido al enviar el correo.', hint: 'Error al enviar' };
  }
}

export default { enviarCorreoGeneral, smtpGeneralConfigurado, correoGeneralConfigurado };
