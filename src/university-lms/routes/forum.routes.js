// =====================================================================
// server/routes/forum.routes.js
// Sección 4 — Foros de discusión: general, debate sencillo, Q&A
// (responder antes de ver respuestas), evaluables con ponderación.
// Se monta en: /api/university/lms
// =====================================================================
import { Router } from 'express';
import { query } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, parsePaginacion, parseSince, respuestaConDelta } from '../utils/http.js';
import { registrarEvento } from '../utils/logger.js';

const router = Router();
const soloDocente = checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN, ROLES.AUXILIAR);

router.post('/actividades/:actividadId/foro', soloDocente, asyncHandler(async (req, res) => {
  const { tipo = 'general', responderAntesDeVer = false, esEvaluable = false, ponderacion = 0 } = req.body;
  const { rows } = await query(
    `INSERT INTO univ_lms_foros (actividad_id, tipo, responder_antes_de_ver, es_evaluable, ponderacion)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.actividadId, tipo, responderAntesDeVer, esEvaluable, ponderacion]
  );
  res.status(201).json(rows[0]);
}));

router.get('/foros/:foroId/temas', asyncHandler(async (req, res) => {
  const { limit, offset } = parsePaginacion(req);
  const since = parseSince(req);
  const params = [req.params.foroId];
  let cond = 't.foro_id = $1';
  if (since) { params.push(since); cond += ` AND t.updated_at > $${params.length}`; }
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT t.id, t.titulo, t.contenido, t.fijado, t.cerrado, t.updated_at, u.nombres, u.apellidos,
            (SELECT count(*) FROM univ_lms_foro_respuestas r WHERE r.tema_id = t.id) AS num_respuestas
       FROM univ_lms_foro_temas t JOIN univ_usuarios_perfil u ON u.id = t.autor_id
      WHERE ${cond}
      ORDER BY t.fijado DESC, t.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  respuestaConDelta(res, rows);
}));

router.post('/foros/:foroId/temas', asyncHandler(async (req, res) => {
  const { titulo, contenido } = req.body;
  if (!titulo || !contenido) return res.status(422).json({ error: 'titulo y contenido son obligatorios.' });
  const { rows } = await query(
    `INSERT INTO univ_lms_foro_temas (foro_id, autor_id, titulo, contenido) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.foroId, req.univPerfilId, titulo, contenido]
  );
  registrarEvento(req, 'creacion', { entidadTipo: 'univ_lms_foro_temas', entidadId: rows[0].id });
  res.status(201).json(rows[0]);
}));

// Modo Q&A: si el foro exige "responder antes de ver respuestas", un
// estudiante que aún no ha respondido no recibe las respuestas de otros
// en el payload — solo la cantidad, para no filtrar contenido por la red
// de más (además de cumplir la regla pedagógica).
router.get('/temas/:temaId/respuestas', asyncHandler(async (req, res) => {
  const tema = await query(
    `SELECT t.*, f.responder_antes_de_ver, f.es_evaluable FROM univ_lms_foro_temas t
       JOIN univ_lms_foros f ON f.id = t.foro_id WHERE t.id = $1`,
    [req.params.temaId]
  );
  if (!tema.rows.length) return res.status(404).json({ error: 'Tema no encontrado.' });
  const rol = req.sesionUniv.rol;
  const esStaff = rol !== 'estudiante';

  if (tema.rows[0].responder_antes_de_ver && !esStaff) {
    const yaRespondio = await query(
      `SELECT 1 FROM univ_lms_foro_respuestas WHERE tema_id = $1 AND autor_id = $2 LIMIT 1`,
      [req.params.temaId, req.univPerfilId]
    );
    if (!yaRespondio.rows.length) {
      const conteo = await query(`SELECT count(*)::int AS n FROM univ_lms_foro_respuestas WHERE tema_id = $1`, [req.params.temaId]);
      return res.json({ bloqueadoHastaResponder: true, numRespuestas: conteo.rows[0].n, respuestas: [] });
    }
  }

  const { rows } = await query(
    `SELECT r.id, r.contenido, r.respuesta_padre_id, r.nota_evaluacion, r.created_at, u.nombres, u.apellidos
       FROM univ_lms_foro_respuestas r JOIN univ_usuarios_perfil u ON u.id = r.autor_id
      WHERE r.tema_id = $1 ORDER BY r.created_at`,
    [req.params.temaId]
  );
  res.json({ bloqueadoHastaResponder: false, respuestas: rows });
}));

router.post('/temas/:temaId/respuestas', asyncHandler(async (req, res) => {
  const { contenido, respuestaPadreId } = req.body;
  if (!contenido) return res.status(422).json({ error: 'El contenido de la respuesta es obligatorio.' });
  const tema = await query(`SELECT cerrado FROM univ_lms_foro_temas WHERE id = $1`, [req.params.temaId]);
  if (!tema.rows.length) return res.status(404).json({ error: 'Tema no encontrado.' });
  if (tema.rows[0].cerrado) return res.status(409).json({ error: 'Este tema está cerrado para nuevas respuestas.' });
  const { rows } = await query(
    `INSERT INTO univ_lms_foro_respuestas (tema_id, autor_id, respuesta_padre_id, contenido) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.temaId, req.univPerfilId, respuestaPadreId || null, contenido]
  );
  await query(`UPDATE univ_lms_foro_temas SET updated_at = now() WHERE id = $1`, [req.params.temaId]);
  res.status(201).json(rows[0]);
}));

// Foro evaluable: el docente asigna nota a una respuesta puntual.
router.patch('/foro-respuestas/:id/calificar', soloDocente, asyncHandler(async (req, res) => {
  const { notaEvaluacion } = req.body;
  const { rows } = await query(`UPDATE univ_lms_foro_respuestas SET nota_evaluacion = $1 WHERE id = $2 RETURNING *`, [notaEvaluacion, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Respuesta no encontrada.' });
  res.json(rows[0]);
}));

router.patch('/temas/:id/estado', soloDocente, asyncHandler(async (req, res) => {
  const { fijado, cerrado } = req.body;
  const { rows } = await query(
    `UPDATE univ_lms_foro_temas SET fijado = COALESCE($1, fijado), cerrado = COALESCE($2, cerrado) WHERE id = $3 RETURNING *`,
    [fijado, cerrado, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Tema no encontrado.' });
  res.json(rows[0]);
}));

export default router;
