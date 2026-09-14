// =====================================================================
// server/utils/notificaciones.js
// Punto único para crear una notificación del Centro de Notificaciones
// Multicanal: guarda el registro in-app (univ_notificaciones) Y, si hay
// SMTP configurado (ver utils/email.js), dispara la plantilla de correo
// — sin bloquear al llamador y sin que un fallo de correo afecte la
// notificación in-app (que ya quedó guardada de todos modos).
// =====================================================================
import { query } from '../lib/db.js';
import { enviarCorreoNotificacion } from './email.js';

export async function crearNotificacion({ institucionSk, usuarioId, tipo, titulo, cuerpo, urlAccion }) {
  const { rows } = await query(
    `INSERT INTO univ_notificaciones (institucion_sk, usuario_id, tipo, titulo, cuerpo, url_accion)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [institucionSk, usuarioId, tipo, titulo, cuerpo || null, urlAccion || null]
  );

  // Fire-and-forget: la notificación in-app ya está guardada; el correo
  // es un canal adicional, nunca una condición para lo anterior.
  query(`SELECT correo FROM univ_usuarios_perfil WHERE id = $1`, [usuarioId])
    .then(async (r) => {
      const correo = r.rows[0]?.correo;
      if (!correo) return;
      const enviado = await enviarCorreoNotificacion({ destinatarioEmail: correo, titulo, cuerpo, urlAccion });
      if (enviado) await query(`UPDATE univ_notificaciones SET canal_email_enviado = TRUE WHERE id = $1`, [rows[0].id]);
    })
    .catch((err) => console.warn('⚠️  [univ-lms] No se pudo procesar el envío de correo de la notificación:', err.message));

  return rows[0];
}

export default { crearNotificacion };
