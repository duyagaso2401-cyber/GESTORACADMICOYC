// =====================================================================
// server/utils/logger.js
// Trazabilidad y Telemetría de Aprendizaje (Audit Trail) — sección 5.
// Inserta en univ_lms_logs SIN bloquear la respuesta al usuario: el
// registro de auditoría nunca debe ser la razón de que una petición se
// sienta lenta. Si el insert de log falla, se registra en consola pero
// jamás se propaga como error de la petición original.
// =====================================================================
import { query } from '../lib/db.js';

/**
 * @param {object} req  - request de Express (para IP/user-agent/sesión)
 * @param {string} tipoEvento - 'login' | 'vista' | 'descarga' | 'inicio_examen' | 'envio_examen' | ...
 * @param {object} [opts]
 * @param {string} [opts.entidadTipo]
 * @param {string} [opts.entidadId]
 * @param {string} [opts.seccionId]
 * @param {object} [opts.detalle]
 */
export function registrarEvento(req, tipoEvento, opts = {}) {
  const sesion = req.sesionUniv || req.univUser || {};
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
  const userAgent = req.headers['user-agent'] || '';

  // Fire-and-forget: no usamos `await` en el llamador. Esto es a
  // propósito — el log NUNCA debe añadir latencia a la respuesta real.
  query(
    `INSERT INTO univ_lms_logs
       (institucion_sk, usuario_id, seccion_id, tipo_evento, entidad_tipo, entidad_id, ip_address, user_agent, detalle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      sesion.sk || null,
      req.univPerfilId || null, // UUID de univ_usuarios_perfil, NUNCA el id legado de sesionUniv.userId
      opts.seccionId || null,
      tipoEvento,
      opts.entidadTipo || null,
      opts.entidadId || null,
      ip || null,
      userAgent,
      JSON.stringify(opts.detalle || {}),
    ]
  ).catch((err) => console.error('[univ-lms] No se pudo registrar el evento de auditoría', tipoEvento, err.message));
}

export default { registrarEvento };
