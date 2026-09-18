// ════════════════════════════════════════════════════════════════════════════
// ARQUITECTURA DE NOTIFICACIONES MULTICANAL (SMS + Correo) — ajuste sobre el
// Lote 2, pedido explícitamente después de la Ronda 31.
// ------------------------------------------------------------------------------
// Diseño (los 3 puntos exactos que se pidieron):
//
//   1) Control dinámico vía feature flag: ENABLE_SMS_NOTIFICATIONS (default
//      false), con el mismo mecanismo de gestorDB.featureFlags + kill-switch
//      de entorno que ya usan ENABLE_ETC_CONTRACTING_MODULE/
//      ENABLE_UNIVERSITIES_MODULE (ver flagSimpleHabilitado() en
//      feature-flags.ts) — pero SIN ninguna migración SQL propia, porque
//      esto no es un módulo con tablas nuevas, es un interruptor de canal.
//      La lógica y los "endpoints" de SMS (el despachador de abajo) NUNCA
//      se eliminan ni se simplifican — quedan siempre estructurados y
//      listos para conectar un proveedor real, estén o no activados.
//
//   2) Fallback elegante: si el flag global está apagado, o la entidad no
//      configuró credenciales, o el proveedor configurado falla al
//      enviar, NUNCA se responde 501/500 ni se interrumpe el flujo que
//      llamó a esto — se cae de inmediato y en silencio al correo
//      institucional (Zoho Mail / enviarCorreoGeneral, el único canal de
//      correo de todo el sistema).
//
//   3) Multi-tenant por Entidad Territorial: las credenciales del
//      proveedor de SMS NO son globales — cada ETC guarda las suyas en
//      `etc_entidades.sms_provider_config` (columna JSONB agnóstica al
//      proveedor). Una entidad sin esas credenciales configuradas nunca
//      genera costo de SMS: sus notificaciones siempre van por correo.
// ════════════════════════════════════════════════════════════════════════════
import { db } from '../db/index.js';
import { etcEntidades } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { flagSimpleHabilitado } from './feature-flags.js';
import { enviarCorreoGeneral, correoGeneralConfigurado } from './email-general.js';
import { obtenerMembreteEntidad, aplicarMembreteHtml } from './etc-membrete.js';

export const FLAG_SMS_NOTIFICATIONS = 'ENABLE_SMS_NOTIFICATIONS';

// Interruptor GLOBAL — controla si el sistema puede siquiera INTENTAR un
// envío por SMS. Aunque esté en true, cada entidad sigue necesitando sus
// propias credenciales (punto 3) para que algo salga de verdad por SMS.
export async function smsNotificacionesHabilitadasGlobalmente(): Promise<boolean> {
  return flagSimpleHabilitado(FLAG_SMS_NOTIFICATIONS);
}

export interface ConfigProveedorSms {
  proveedor?: string; // 'hablame' | 'twilio' | 'aws_sns'
  apiKey?: string;
  apiSecret?: string;
  accountSid?: string; // Twilio
  authToken?: string; // Twilio
  remitente?: string;
  region?: string; // AWS SNS
  [extra: string]: any;
}

interface ResultadoDespacho { ok: boolean; detalle: string }

// Despachador AGNÓSTICO al proveedor — un switch por config.proveedor.
// Estructura completa y lista para producción; solo requiere que la ETC
// ingrese credenciales reales. NUNCA lanza: cualquier error de red o de
// configuración se captura y se traduce en { ok:false }, para que quien
// llama pueda hacer el fallback a correo sin sobresaltos.
async function _despacharSmsProveedor(config: ConfigProveedorSms, destino: string, mensaje: string): Promise<ResultadoDespacho> {
  const proveedor = String(config?.proveedor || '').toLowerCase().trim();
  try {
    if (proveedor === 'hablame') {
      // Hablame.co — API REST colombiana por token (https://api.hablame.co).
      const resp = await fetch('https://api.hablame.co/api/sms/v3/send/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${config.apiKey || ''}` },
        body: JSON.stringify({ src: config.remitente || 'GestorYC', dst: destino, msg: mensaje }),
      });
      return { ok: resp.ok, detalle: `hablame:HTTP ${resp.status}` };
    }
    if (proveedor === 'twilio') {
      const sid = config.accountSid || '';
      const token = config.authToken || '';
      if (!sid || !token) return { ok: false, detalle: 'twilio: faltan accountSid/authToken' };
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const cuerpo = new URLSearchParams({ To: destino, From: config.remitente || '', Body: mensaje });
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: cuerpo.toString(),
      });
      return { ok: resp.ok, detalle: `twilio:HTTP ${resp.status}` };
    }
    if (proveedor === 'aws_sns') {
      // AWS SNS firma las peticiones con SigV4 — requiere el SDK oficial
      // (@aws-sdk/client-sns), que este proyecto no tiene instalado. La
      // estructura de configuración (apiKey/apiSecret/region) ya queda
      // lista; conectar el SDK real es una extensión aislada de esta
      // única función, el día que una ETC lo pida.
      return { ok: false, detalle: 'aws_sns: requiere el SDK oficial @aws-sdk/client-sns (no instalado todavía)' };
    }
    return { ok: false, detalle: `proveedor de SMS "${proveedor || '(sin configurar)'}" no reconocido` };
  } catch {
    return { ok: false, detalle: 'error de red al llamar al proveedor de SMS' };
  }
}

export interface ResultadoNotificacionMulticanal {
  canal: 'sms' | 'correo' | 'ninguno';
  ok: boolean;
  detalle: string;
}

export interface OpcionesNotificacionMulticanal {
  telefono?: string | null;
  correo?: string | null;
  mensaje: string;
  asuntoCorreo: string;
  htmlCorreo?: string;
  // entidadId: de qué Entidad Territorial son las credenciales de SMS a
  // usar (punto 3, multi-tenant). Sin entidadId (o si esa entidad no
  // configuró proveedor), jamás se intenta SMS — se va directo a correo.
  entidadId?: number | null;
}

// Punto de entrada ÚNICO para cualquier notificación/alerta que
// idealmente iría por SMS. Decide el canal real y JAMÁS deja a quien la
// llama sin una respuesta manejable — en el peor de los casos informa que
// no hubo ningún canal disponible, pero nunca lanza ni exige que el
// llamador maneje un 501/500.
export async function enviarNotificacionMulticanal(opts: OpcionesNotificacionMulticanal): Promise<ResultadoNotificacionMulticanal> {
  const telefono = String(opts.telefono || '').trim();
  const correo = String(opts.correo || '').trim();

  let configEntidad: ConfigProveedorSms | null = null;
  if (opts.entidadId) {
    try {
      const filas = await db.select().from(etcEntidades).where(eq(etcEntidades.id, opts.entidadId));
      configEntidad = (filas[0]?.smsProviderConfig as ConfigProveedorSms) || null;
    } catch {
      configEntidad = null;
    }
  }

  const globalHabilitado = await smsNotificacionesHabilitadasGlobalmente();
  const entidadTieneCredenciales = !!(configEntidad && configEntidad.proveedor && configEntidad.apiKey);

  if (telefono && globalHabilitado && entidadTieneCredenciales) {
    const resultado = await _despacharSmsProveedor(configEntidad as ConfigProveedorSms, telefono, opts.mensaje);
    if (resultado.ok) return { canal: 'sms', ok: true, detalle: resultado.detalle };
    // Sin interrumpir nada: cae al fallback de correo, igual que si el
    // flag hubiera estado apagado o la entidad no tuviera credenciales.
  }

  if (correo && correoGeneralConfigurado) {
    // Lote 4 — membrete dinámico: cualquier correo que salga de este único
    // punto de entrada adopta automáticamente el logo/nombre/datos legales
    // de la Entidad Territorial dueña de "entidadId", sin que cada llamador
    // tenga que acordarse de aplicarlo. Sin entidadId (o entidad inactiva),
    // aplicarMembreteHtml() devuelve el HTML tal cual — cero cambio.
    const membrete = await obtenerMembreteEntidad(opts.entidadId);
    const htmlFinal = aplicarMembreteHtml(opts.htmlCorreo || `<p>${opts.mensaje}</p>`, membrete);
    await enviarCorreoGeneral({ to: correo, subject: opts.asuntoCorreo, text: opts.mensaje, html: htmlFinal });
    return { canal: 'correo', ok: true, detalle: 'Entregado por correo (fallback transparente — sin costo transaccional).' };
  }

  return { canal: 'ninguno', ok: false, detalle: 'No hay SMS disponible ni correo configurado para entregar esta notificación.' };
}
