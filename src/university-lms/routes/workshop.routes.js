// =====================================================================
// server/routes/workshop.routes.js
// Sección 4 — Taller de Coevaluación (Peer Review):
// Fase de envío -> evaluación entre pares -> calificación final.
// Se monta en: /api/university/lms
// =====================================================================
import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, enviarConEtag } from '../utils/http.js';

const router = Router();
const soloDocente = checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN, ROLES.AUXILIAR);
const soloEstudiante = checkUniversityRole(ROLES.ESTUDIANTE);

router.post('/actividades/:actividadId/taller', soloDocente, asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO univ_lms_talleres
       (actividad_id, rubrica_id, evaluaciones_por_estudiante, fecha_fin_envio, fecha_fin_evaluacion, ponderacion_autoevaluacion)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.actividadId, b.rubricaId || null, b.evaluacionesPorEstudiante ?? 3, b.fechaFinEnvio || null,
     b.fechaFinEvaluacion || null, b.ponderacionAutoevaluacion ?? 0]
  );
  res.status(201).json(rows[0]);
}));

router.post('/talleres/:id/envios', soloEstudiante, asyncHandler(async (req, res) => {
  const taller = await query(`SELECT * FROM univ_lms_talleres WHERE id = $1`, [req.params.id]);
  if (!taller.rows.length) return res.status(404).json({ error: 'Taller no encontrado.' });
  if (taller.rows[0].fase_actual !== 'envio') return res.status(409).json({ error: 'La fase de envío ya cerró.' });
  const { contenidoTexto, urlArchivo } = req.body;
  const { rows } = await query(
    `INSERT INTO univ_lms_taller_envios (taller_id, estudiante_id, contenido_texto, url_archivo)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (taller_id, estudiante_id) DO UPDATE SET contenido_texto = EXCLUDED.contenido_texto, url_archivo = EXCLUDED.url_archivo
     RETURNING *`,
    [req.params.id, req.univPerfilId, contenidoTexto || null, urlArchivo || null]
  );
  res.status(201).json(rows[0]);
}));

/** Cierra la fase de envío y reparte aleatoriamente N envíos por
 * estudiante para evaluar (excluyendo su propio envío, salvo que se
 * incluya autoevaluación como asignación aparte). Se ejecuta una sola
 * vez por taller — es la operación más delicada del módulo, por eso va
 * en una transacción completa. */
router.post('/talleres/:id/repartir', soloDocente, asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const taller = await client.query(`SELECT * FROM univ_lms_talleres WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!taller.rows.length) { const e = new Error('Taller no encontrado.'); e.status = 404; e.expose = true; throw e; }
    if (taller.rows[0].fase_actual !== 'envio') { const e = new Error('El reparto ya se hizo o el taller no está en fase de envío.'); e.status = 409; e.expose = true; throw e; }

    const envios = await client.query(`SELECT id, estudiante_id FROM univ_lms_taller_envios WHERE taller_id = $1`, [req.params.id]);
    const n = taller.rows[0].evaluaciones_por_estudiante;
    const lista = envios.rows;
    if (lista.length < 2) { const e = new Error('Se necesitan al menos 2 envíos para repartir evaluaciones.'); e.status = 422; e.expose = true; throw e; }

    for (const envio of lista) {
      const candidatos = lista.filter((e2) => e2.estudiante_id !== envio.estudiante_id);
      const barajados = candidatos.sort(() => Math.random() - 0.5).slice(0, Math.min(n, candidatos.length));
      for (const cand of barajados) {
        await client.query(
          `INSERT INTO univ_lms_taller_asignaciones (taller_id, envio_id, evaluador_id)
           VALUES ($1,$2,$3) ON CONFLICT (envio_id, evaluador_id) DO NOTHING`,
          [req.params.id, envio.id, cand.estudiante_id]
        );
      }
      if (taller.rows[0].ponderacion_autoevaluacion > 0) {
        await client.query(
          `INSERT INTO univ_lms_taller_asignaciones (taller_id, envio_id, evaluador_id, es_autoevaluacion)
           VALUES ($1,$2,$3,TRUE) ON CONFLICT (envio_id, evaluador_id) DO NOTHING`,
          [req.params.id, envio.id, envio.estudiante_id]
        );
      }
    }
    await client.query(`UPDATE univ_lms_talleres SET fase_actual = 'evaluacion' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, enviosRepartidos: lista.length });
  });
}));

router.get('/talleres/:id/mis-evaluaciones', soloEstudiante, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT a.id AS asignacion_id, a.completada, a.es_autoevaluacion, e.contenido_texto, e.url_archivo
       FROM univ_lms_taller_asignaciones a JOIN univ_lms_taller_envios e ON e.id = a.envio_id
      WHERE a.taller_id = $1 AND a.evaluador_id = $2`,
    [req.params.id, req.univPerfilId]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.patch('/talleres/asignaciones/:id/calificar', soloEstudiante, asyncHandler(async (req, res) => {
  const { calificacionRubrica, notaAsignada, comentario } = req.body;
  const { rows } = await query(
    `UPDATE univ_lms_taller_asignaciones SET calificacion_rubrica = $1, nota_asignada = $2, comentario = $3, completada = TRUE
     WHERE id = $4 AND evaluador_id = $5 RETURNING *`,
    [JSON.stringify(calificacionRubrica || {}), notaAsignada, comentario || null, req.params.id, req.univPerfilId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada.' });
  res.json(rows[0]);
}));

/** Cierra la fase de evaluación y calcula la nota final de cada envío
 * como el promedio de las evaluaciones que recibió. */
router.post('/talleres/:id/calificar-final', soloDocente, asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const envios = await client.query(`SELECT id FROM univ_lms_taller_envios WHERE taller_id = $1`, [req.params.id]);
    for (const envio of envios.rows) {
      const notas = await client.query(
        `SELECT avg(nota_asignada)::numeric(6,2) AS promedio FROM univ_lms_taller_asignaciones WHERE envio_id = $1 AND completada = TRUE`,
        [envio.id]
      );
      await client.query(
        `INSERT INTO univ_lms_entregas (actividad_id, estudiante_id, nota, estado, calificado_at)
         SELECT t.actividad_id, e.estudiante_id, $1, 'calificada', now()
           FROM univ_lms_taller_envios e JOIN univ_lms_talleres t ON t.id = e.taller_id WHERE e.id = $2
         ON CONFLICT DO NOTHING`,
        [notas.rows[0].promedio || 0, envio.id]
      );
    }
    await client.query(`UPDATE univ_lms_talleres SET fase_actual = 'cerrado' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  });
}));

export default router;
