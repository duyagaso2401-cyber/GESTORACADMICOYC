// =====================================================================
// server/routes/messaging.routes.js
// Sección 5 — Mensajería interna, Centro de notificaciones multicanal y
// Supletorios/exámenes extemporáneos.
// Se monta en: /api/university/messaging
// =====================================================================
import { Router } from 'express';
import { query } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, parsePaginacion, parseSince, respuestaConDelta, enviarConEtag } from '../utils/http.js';
import { uploadMemoria, subirBufferACloudinary } from '../../lib/upload.js';
import { crearNotificacion } from '../utils/notificaciones.js';

const router = Router();
const soloDireccion = checkUniversityRole(ROLES.SUPER_ADMIN, ROLES.RECTOR, ROLES.DECANO);

// =====================================================================
// MENSAJERÍA INTERNA (Chat/Buzón)
// =====================================================================

router.get('/conversaciones', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, tipo, titulo, participantes, ultimo_mensaje_at
       FROM univ_mensajes_conversaciones
      WHERE institucion_sk = $1 AND $2 = ANY(participantes)
      ORDER BY ultimo_mensaje_at DESC NULLS LAST LIMIT 50`,
    [req.sesionUniv.sk, req.univPerfilId]
  );
  enviarConEtag(req, res, { items: rows }, { cacheControl: 'private, max-age=10, must-revalidate' });
}));

router.post('/conversaciones', asyncHandler(async (req, res) => {
  const { participantes, titulo, tipo = 'directo' } = req.body;
  if (!Array.isArray(participantes) || participantes.length < 1) {
    return res.status(422).json({ error: 'participantes debe ser un arreglo con al menos un usuario destino.' });
  }
  const todos = [...new Set([req.univPerfilId, ...participantes])];
  // Evita duplicar conversaciones 1-a-1 ya existentes.
  if (tipo === 'directo' && todos.length === 2) {
    const existente = await query(
      `SELECT id FROM univ_mensajes_conversaciones
        WHERE institucion_sk = $1 AND tipo = 'directo' AND participantes @> $2::uuid[] AND participantes <@ $2::uuid[]`,
      [req.sesionUniv.sk, todos]
    );
    if (existente.rows.length) return res.json(existente.rows[0]);
  }
  const { rows } = await query(
    `INSERT INTO univ_mensajes_conversaciones (institucion_sk, tipo, titulo, participantes, creado_por)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.sesionUniv.sk, tipo, titulo || null, todos, req.univPerfilId]
  );
  res.status(201).json(rows[0]);
}));

router.get('/conversaciones/:id/mensajes', asyncHandler(async (req, res) => {
  const { limit, offset } = parsePaginacion(req, { limitPorDefecto: 30 });
  const since = parseSince(req);
  const conv = await query(`SELECT participantes FROM univ_mensajes_conversaciones WHERE id = $1`, [req.params.id]);
  if (!conv.rows.length) return res.status(404).json({ error: 'Conversación no encontrada.' });
  if (!conv.rows[0].participantes.includes(req.univPerfilId)) return res.status(403).json({ error: 'No pertenece a esta conversación.' });

  const params = [req.params.id];
  let cond = 'conversacion_id = $1';
  if (since) { params.push(since); cond += ` AND created_at > $${params.length}`; }
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT id, autor_id, contenido, adjunto_url, created_at FROM univ_mensajes_texto
      WHERE ${cond} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  respuestaConDelta(res, rows.reverse(), { columnaFecha: 'created_at' });
}));

router.post('/conversaciones/:id/mensajes', asyncHandler(async (req, res) => {
  const { contenido, adjuntoUrl } = req.body;
  if (!contenido && !adjuntoUrl) return res.status(422).json({ error: 'El mensaje no puede estar vacío.' });
  const conv = await query(`SELECT participantes FROM univ_mensajes_conversaciones WHERE id = $1`, [req.params.id]);
  if (!conv.rows.length) return res.status(404).json({ error: 'Conversación no encontrada.' });
  if (!conv.rows[0].participantes.includes(req.univPerfilId)) return res.status(403).json({ error: 'No pertenece a esta conversación.' });

  const { rows } = await query(
    `INSERT INTO univ_mensajes_texto (conversacion_id, autor_id, contenido, adjunto_url, leido_por)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, req.univPerfilId, contenido || '', adjuntoUrl || null, [req.univPerfilId]]
  );
  await query(`UPDATE univ_mensajes_conversaciones SET ultimo_mensaje_at = now() WHERE id = $1`, [req.params.id]);

  // Notifica a los demás participantes (no al autor).
  const destinatarios = conv.rows[0].participantes.filter((p) => p !== req.univPerfilId);
  for (const destino of destinatarios) {
    await crearNotificacion({
      institucionSk: req.sesionUniv.sk, usuarioId: destino, tipo: 'mensaje', titulo: 'Nuevo mensaje',
      cuerpo: contenido?.slice(0, 140) || 'Adjunto recibido', urlAccion: `/mensajes/${req.params.id}`,
    });
  }
  res.status(201).json(rows[0]);
}));

router.post('/conversaciones/:id/adjunto', uploadMemoria.single('archivo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'No se recibió ningún archivo.' });
  const resultado = await subirBufferACloudinary(req.file.buffer, { folder: 'gestor-yc/mensajeria', resourceType: 'auto' });
  res.json({ adjuntoUrl: resultado.url });
}));

// =====================================================================
// CENTRO DE NOTIFICACIONES MULTICANAL
// =====================================================================

// Nunca se hace polling agresivo de esto — el frontend debe pedirlo con
// ?since= (delta) y solo cuando document.hidden === false (ver la
// sección "Optimización de red" del sync-engine).
router.get('/notificaciones', asyncHandler(async (req, res) => {
  const since = parseSince(req);
  const { limit } = parsePaginacion(req, { limitPorDefecto: 20, limitMaximo: 50 });
  const params = [req.univPerfilId];
  let cond = 'usuario_id = $1';
  if (since) { params.push(since); cond += ` AND created_at > $${params.length}`; }
  params.push(limit);
  const { rows } = await query(
    `SELECT id, tipo, titulo, cuerpo, url_accion, leida, created_at FROM univ_notificaciones
      WHERE ${cond} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  respuestaConDelta(res, rows, { columnaFecha: 'created_at' });
}));

router.get('/notificaciones/no-leidas/contador', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT count(*)::int AS n FROM univ_notificaciones WHERE usuario_id = $1 AND leida = FALSE`, [req.univPerfilId]);
  enviarConEtag(req, res, { noLeidas: rows[0].n }, { cacheControl: 'private, max-age=20, must-revalidate' });
}));

router.patch('/notificaciones/:id/leida', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE univ_notificaciones SET leida = TRUE, leida_at = now() WHERE id = $1 AND usuario_id = $2 RETURNING *`,
    [req.params.id, req.univPerfilId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Notificación no encontrada.' });
  res.json(rows[0]);
}));

router.post('/notificaciones/marcar-todas-leidas', asyncHandler(async (req, res) => {
  await query(`UPDATE univ_notificaciones SET leida = TRUE, leida_at = now() WHERE usuario_id = $1 AND leida = FALSE`, [req.univPerfilId]);
  res.json({ ok: true });
}));

/** Crea un anuncio para TODA una sección (docente) o toda la
 * institución (dirección) — usado también internamente por otras rutas
 * (nueva tarea, calificación publicada, recordatorio de vencimiento). */
router.post('/notificaciones/anuncio', checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN), asyncHandler(async (req, res) => {
  const { seccionId, titulo, cuerpo } = req.body;
  if (!titulo) return res.status(422).json({ error: 'El título es obligatorio.' });
  let destinatarios;
  if (seccionId) {
    destinatarios = await query(`SELECT estudiante_id AS id FROM univ_ent_matriculas WHERE seccion_id = $1 AND estado = 'Activa'`, [seccionId]);
  } else {
    destinatarios = await query(`SELECT id FROM univ_usuarios_perfil WHERE institucion_sk = $1 AND activo = TRUE`, [req.sesionUniv.sk]);
  }
  for (const d of destinatarios.rows) {
    await crearNotificacion({ institucionSk: req.sesionUniv.sk, usuarioId: d.id, tipo: 'anuncio', titulo, cuerpo });
  }
  res.status(201).json({ ok: true, enviadas: destinatarios.rows.length });
}));

// =====================================================================
// SUPLETORIOS Y EXÁMENES EXTEMPORÁNEOS
// =====================================================================

router.post('/supletorios', checkUniversityRole(ROLES.ESTUDIANTE), asyncHandler(async (req, res) => {
  const { seccionId, actividadId, motivo, urlExcusaAdjunta } = req.body;
  if (!seccionId || !motivo) return res.status(422).json({ error: 'seccionId y motivo son obligatorios.' });
  const { rows } = await query(
    `INSERT INTO univ_solicitudes_supletorios (estudiante_id, seccion_id, actividad_id, motivo, url_excusa_adjunta)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.univPerfilId, seccionId, actividadId || null, motivo, urlExcusaAdjunta || null]
  );
  // Notifica al docente titular de la sección para que revise.
  const doc = await query(`SELECT docente_titular_id FROM univ_ent_secciones WHERE id = $1`, [seccionId]);
  if (doc.rows[0]?.docente_titular_id) {
    await crearNotificacion({
      institucionSk: req.sesionUniv.sk, usuarioId: doc.rows[0].docente_titular_id, tipo: 'anuncio',
      titulo: 'Nueva solicitud de supletorio', cuerpo: 'Un estudiante solicitó un supletorio pendiente de revisión.',
    });
  }
  res.status(201).json(rows[0]);
}));

router.post('/supletorios/adjunto', checkUniversityRole(ROLES.ESTUDIANTE), uploadMemoria.single('excusa'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'No se recibió ningún archivo.' });
  const esPdf = !/^image\//.test(req.file.mimetype);
  const resultado = await subirBufferACloudinary(req.file.buffer, { folder: 'gestor-yc/supletorios', resourceType: esPdf ? 'raw' : 'image' });
  res.json({ urlExcusaAdjunta: resultado.url });
}));

router.get('/supletorios', checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN), asyncHandler(async (req, res) => {
  const { estado } = req.query;
  const params = [];
  let cond = '1=1';
  if (estado) { params.push(estado); cond += ` AND ss.estado = $${params.length}`; }
  const { rows } = await query(
    `SELECT ss.*, u.nombres, u.apellidos FROM univ_solicitudes_supletorios ss
       JOIN univ_usuarios_perfil u ON u.id = ss.estudiante_id WHERE ${cond} ORDER BY ss.created_at DESC`,
    params
  );
  enviarConEtag(req, res, { items: rows });
}));

router.patch('/supletorios/:id/revisar', checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN), asyncHandler(async (req, res) => {
  const { estado, comentarioRevision, fechaPropuestaExamen } = req.body;
  if (!['Aprobada', 'Rechazada'].includes(estado)) return res.status(422).json({ error: 'Estado inválido.' });
  const { rows } = await query(
    `UPDATE univ_solicitudes_supletorios SET
       estado = $1, comentario_revision = $2, fecha_propuesta_examen = $3, revisado_por = $4, revisado_at = now()
     WHERE id = $5 RETURNING *`,
    [estado, comentarioRevision || null, fechaPropuestaExamen || null, req.univPerfilId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  await crearNotificacion({
    institucionSk: req.sesionUniv.sk, usuarioId: rows[0].estudiante_id, tipo: 'anuncio',
    titulo: `Solicitud de supletorio ${estado.toLowerCase()}`, cuerpo: comentarioRevision || '',
  });
  res.json(rows[0]);
}));

export default router;
