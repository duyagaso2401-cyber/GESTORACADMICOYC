// =====================================================================
// server/routes/lms.routes.js
// Sección 4 — LMS robusto tipo Moodle: estructura del aula virtual
// (módulos semanales/temas), recursos, rúbricas, actividades (tareas) y
// entregas. El quiz engine, foros, taller de coevaluación y asistencia
// viven en sus propios archivos (quiz.routes.js, forum.routes.js,
// workshop.routes.js, attendance.routes.js) para mantener cada uno
// manejable — todos se agregan en university.routes.js.
// Se monta en: /api/university/lms
// =====================================================================
import { Router } from 'express';
import { query } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, parseSince, respuestaConDelta, enviarConEtag } from '../utils/http.js';
import { registrarEvento } from '../utils/logger.js';
import { crearNotificacion } from '../utils/notificaciones.js';
import { subirBufferACloudinary, uploadMemoria } from '../../lib/upload.js';

const router = Router();
const soloDocente = checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN, ROLES.AUXILIAR);

async function seccionPerteneceAInstitucion(seccionId, sk) {
  const { rows } = await query(`SELECT id FROM univ_ent_secciones WHERE id = $1 AND institucion_sk = $2`, [seccionId, sk]);
  return rows.length > 0;
}

// ── Módulos (estructura semanal o por temas) ────────────────────────
router.get('/secciones/:seccionId/modulos', asyncHandler(async (req, res) => {
  const since = parseSince(req);
  const params = [req.params.seccionId];
  let cond = 'modulo.seccion_id = $1';
  if (since) { params.push(since); cond += ` AND modulo.updated_at > $${params.length}`; }
  const { rows } = await query(
    `SELECT modulo.id, modulo.titulo, modulo.descripcion, modulo.orden, modulo.tipo,
            modulo.fecha_inicio, modulo.fecha_fin, modulo.visible, modulo.updated_at
       FROM univ_lms_modulos modulo WHERE ${cond} ORDER BY modulo.orden`,
    params
  );
  respuestaConDelta(res, rows);
}));

router.post('/secciones/:seccionId/modulos', soloDocente, asyncHandler(async (req, res) => {
  const { titulo, descripcion, tipo = 'tema', orden = 0, fechaInicio, fechaFin } = req.body;
  if (!titulo) return res.status(422).json({ error: 'El título del módulo es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_lms_modulos (seccion_id, titulo, descripcion, tipo, orden, fecha_inicio, fecha_fin)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.seccionId, titulo, descripcion || null, tipo, orden, fechaInicio || null, fechaFin || null]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/modulos/:id', soloDocente, asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `UPDATE univ_lms_modulos SET
       titulo = COALESCE($1, titulo), descripcion = COALESCE($2, descripcion),
       orden = COALESCE($3, orden), visible = COALESCE($4, visible),
       fecha_inicio = COALESCE($5, fecha_inicio), fecha_fin = COALESCE($6, fecha_fin)
     WHERE id = $7 RETURNING *`,
    [b.titulo, b.descripcion, b.orden, b.visible, b.fechaInicio, b.fechaFin, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Módulo no encontrado.' });
  res.json(rows[0]);
}));

router.delete('/modulos/:id', soloDocente, asyncHandler(async (req, res) => {
  await query(`DELETE FROM univ_lms_modulos WHERE id = $1`, [req.params.id]);
  res.status(204).end();
}));

// ── Recursos (archivos, enlaces, páginas HTML, carpetas) ────────────
router.get('/modulos/:moduloId/recursos', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, tipo, titulo, descripcion, url_archivo, url_externa, contenido_html, carpeta_padre_id, orden, visible, updated_at
       FROM univ_lms_recursos WHERE modulo_id = $1 ORDER BY orden`,
    [req.params.moduloId]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/modulos/:moduloId/recursos', soloDocente, asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.tipo || !b.titulo) return res.status(422).json({ error: 'tipo y titulo son obligatorios.' });
  const { rows } = await query(
    `INSERT INTO univ_lms_recursos (modulo_id, tipo, titulo, descripcion, url_archivo, url_externa, contenido_html, carpeta_padre_id, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.params.moduloId, b.tipo, b.titulo, b.descripcion || null, b.urlArchivo || null, b.urlExterna || null,
     b.contenidoHtml || null, b.carpetaPadreId || null, b.orden ?? 0]
  );
  res.status(201).json(rows[0]);
}));

// Subida directa de archivo de recurso (PDF/Word/Slides/ZIP) → Cloudinary.
router.post('/modulos/:moduloId/recursos/archivo', soloDocente, uploadMemoria.single('archivo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'No se recibió ningún archivo.' });
  const esPdfODoc = !/^image\//.test(req.file.mimetype);
  const resultado = await subirBufferACloudinary(req.file.buffer, {
    folder: `gestor-yc/lms/recursos`,
    resourceType: esPdfODoc ? 'raw' : 'image',
  });
  const { rows } = await query(
    `INSERT INTO univ_lms_recursos (modulo_id, tipo, titulo, url_archivo, orden)
     VALUES ($1,'archivo',$2,$3,$4) RETURNING *`,
    [req.params.moduloId, req.body.titulo || req.file.originalname, resultado.url, req.body.orden ?? 0]
  );
  res.status(201).json(rows[0]);
}));

// Vista de un recurso — registra telemetría (para la analítica de
// "cobertura de contenidos" y el audit trail).
router.get('/recursos/:id/ver', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM univ_lms_recursos WHERE id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Recurso no encontrado.' });
  registrarEvento(req, 'vista', { entidadTipo: 'univ_lms_recursos', entidadId: req.params.id });
  res.json(rows[0]);
}));
router.post('/recursos/:id/descarga', asyncHandler(async (req, res) => {
  registrarEvento(req, 'descarga', { entidadTipo: 'univ_lms_recursos', entidadId: req.params.id });
  res.json({ ok: true });
}));

// ── Rúbricas (reutilizables) ─────────────────────────────────────────
router.post('/secciones/:seccionId/rubricas', soloDocente, asyncHandler(async (req, res) => {
  const { nombre, tipo = 'rubrica', criterios = [] } = req.body;
  if (!nombre) return res.status(422).json({ error: 'El nombre de la rúbrica es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_lms_rubricas (seccion_id, nombre, tipo) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.seccionId, nombre, tipo]
  );
  const rubrica = rows[0];
  for (let i = 0; i < criterios.length; i++) {
    const c = criterios[i];
    await query(
      `INSERT INTO univ_lms_rubrica_criterios (rubrica_id, criterio, descripcion, puntaje_maximo, niveles, orden)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [rubrica.id, c.criterio, c.descripcion || null, c.puntajeMaximo ?? 1, JSON.stringify(c.niveles || []), i]
    );
  }
  res.status(201).json(rubrica);
}));

router.get('/rubricas/:id', asyncHandler(async (req, res) => {
  const rub = await query(`SELECT * FROM univ_lms_rubricas WHERE id = $1`, [req.params.id]);
  if (!rub.rows.length) return res.status(404).json({ error: 'Rúbrica no encontrada.' });
  const crit = await query(`SELECT * FROM univ_lms_rubrica_criterios WHERE rubrica_id = $1 ORDER BY orden`, [req.params.id]);
  enviarConEtag(req, res, { ...rub.rows[0], criterios: crit.rows });
}));

// ── Actividades (tareas / entregas avanzadas) ───────────────────────
router.get('/modulos/:moduloId/actividades', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, tipo, titulo, tipo_entrega, fecha_apertura, fecha_limite, fecha_penalizacion, fecha_corte,
            penalizacion_por_dia, puntaje_maximo, rubrica_id, es_grupal, ponderable, visible, updated_at
       FROM univ_lms_actividades WHERE modulo_id = $1 ORDER BY orden`,
    [req.params.moduloId]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/modulos/:moduloId/actividades', soloDocente, asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.titulo) return res.status(422).json({ error: 'El título de la actividad es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_lms_actividades
       (modulo_id, tipo, titulo, descripcion, tipo_entrega, fecha_apertura, fecha_limite, fecha_penalizacion,
        fecha_corte, penalizacion_por_dia, puntaje_maximo, rubrica_id, es_grupal, ponderable, categoria_gradebook_id, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [req.params.moduloId, b.tipo || 'tarea', b.titulo, b.descripcion || null, b.tipoEntrega || 'archivo',
     b.fechaApertura || null, b.fechaLimite || null, b.fechaPenalizacion || null, b.fechaCorte || null,
     b.penalizacionPorDia ?? 0, b.puntajeMaximo ?? 5, b.rubricaId || null, !!b.esGrupal, b.ponderable !== false,
     b.categoriaGradebookId || null, b.orden ?? 0]
  );
  registrarEvento(req, 'creacion', { entidadTipo: 'univ_lms_actividades', entidadId: rows[0].id });
  res.status(201).json(rows[0]);
}));

router.patch('/actividades/:id', soloDocente, asyncHandler(async (req, res) => {
  const b = req.body;
  const campos = {
    titulo: b.titulo, descripcion: b.descripcion, tipo_entrega: b.tipoEntrega, fecha_apertura: b.fechaApertura,
    fecha_limite: b.fechaLimite, fecha_penalizacion: b.fechaPenalizacion, fecha_corte: b.fechaCorte,
    penalizacion_por_dia: b.penalizacionPorDia, puntaje_maximo: b.puntajeMaximo, rubrica_id: b.rubricaId,
    visible: b.visible, orden: b.orden,
  };
  const set = []; const params = [];
  Object.entries(campos).forEach(([col, val]) => { if (val !== undefined) { params.push(val); set.push(`${col} = $${params.length}`); } });
  if (!set.length) return res.status(422).json({ error: 'Nada que actualizar.' });
  params.push(req.params.id);
  const { rows } = await query(`UPDATE univ_lms_actividades SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: 'Actividad no encontrada.' });
  res.json(rows[0]);
}));

// ── Entregas de estudiantes ──────────────────────────────────────────
router.get('/actividades/:actividadId/entregas', soloDocente, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT e.id, e.estudiante_id, e.grupo_id, e.intento_numero, e.estado, e.entregado_tarde, e.nota,
            e.retroalimentacion, e.updated_at, u.nombres, u.apellidos
       FROM univ_lms_entregas e LEFT JOIN univ_usuarios_perfil u ON u.id = e.estudiante_id
      WHERE e.actividad_id = $1 ORDER BY e.updated_at DESC`,
    [req.params.actividadId]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.get('/actividades/:actividadId/mi-entrega', checkUniversityRole(ROLES.ESTUDIANTE), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM univ_lms_entregas WHERE actividad_id = $1 AND estudiante_id = $2 ORDER BY intento_numero DESC LIMIT 1`,
    [req.params.actividadId, req.univPerfilId]
  );
  res.json(rows[0] || null);
}));

router.post('/actividades/:actividadId/entregas', checkUniversityRole(ROLES.ESTUDIANTE), asyncHandler(async (req, res) => {
  const act = await query(`SELECT * FROM univ_lms_actividades WHERE id = $1`, [req.params.actividadId]);
  if (!act.rows.length) return res.status(404).json({ error: 'Actividad no encontrada.' });
  const actividad = act.rows[0];
  const ahora = new Date();
  if (actividad.fecha_corte && ahora > new Date(actividad.fecha_corte)) {
    return res.status(409).json({ error: 'La fecha de corte para esta actividad ya pasó. No se aceptan más entregas.' });
  }
  const tarde = actividad.fecha_limite ? ahora > new Date(actividad.fecha_limite) : false;

  const { contenidoTexto, urlArchivo, urlEnlace } = req.body;
  const previa = await query(
    `SELECT max(intento_numero) AS n FROM univ_lms_entregas WHERE actividad_id = $1 AND estudiante_id = $2`,
    [req.params.actividadId, req.univPerfilId]
  );
  const siguienteIntento = (previa.rows[0].n || 0) + 1;
  const { rows } = await query(
    `INSERT INTO univ_lms_entregas (actividad_id, estudiante_id, contenido_texto, url_archivo, url_enlace, intento_numero, entregado_tarde, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'enviada') RETURNING *`,
    [req.params.actividadId, req.univPerfilId, contenidoTexto || null, urlArchivo || null, urlEnlace || null, siguienteIntento, tarde]
  );
  registrarEvento(req, 'envio_tarea', { entidadTipo: 'univ_lms_actividades', entidadId: req.params.actividadId });
  res.status(201).json(rows[0]);
}));

router.post('/actividades/:actividadId/entregas/archivo', checkUniversityRole(ROLES.ESTUDIANTE), uploadMemoria.single('archivo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'No se recibió ningún archivo.' });
  const resultado = await subirBufferACloudinary(req.file.buffer, {
    folder: `gestor-yc/lms/entregas`,
    resourceType: /^image\//.test(req.file.mimetype) ? 'image' : 'raw',
  });
  res.json({ urlArchivo: resultado.url });
}));

// Calificar una entrega (con o sin rúbrica). El gradebook recalcula
// automáticamente al guardar (ver gradebook.routes.js → recalcularNota()).
router.patch('/entregas/:id/calificar', soloDocente, asyncHandler(async (req, res) => {
  const { nota, retroalimentacion, calificacionRubrica } = req.body;
  const { rows } = await query(
    `UPDATE univ_lms_entregas SET
       nota = $1, retroalimentacion = $2, calificacion_rubrica = $3,
       estado = 'calificada', calificado_por = $4, calificado_at = now()
     WHERE id = $5 RETURNING *`,
    [nota ?? null, retroalimentacion || null, JSON.stringify(calificacionRubrica || {}), req.univPerfilId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Entrega no encontrada.' });

  // Notifica al estudiante (centro de notificaciones — sección 5).
  await crearNotificacion({
    institucionSk: req.sesionUniv.sk, usuarioId: rows[0].estudiante_id, tipo: 'calificacion_publicada',
    titulo: 'Calificación publicada', cuerpo: 'Tu entrega ha sido calificada.',
  });
  res.json(rows[0]);
}));

export default router;
