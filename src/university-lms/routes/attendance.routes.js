// =====================================================================
// server/routes/attendance.routes.js
// Sección 4 — Registro de Asistencia diario/semanal.
// Se monta en: /api/university/lms
//
// IMPORTANTE (sección 6/7 — batching + optimistic UI): el registro de
// asistencia de un salón completo (30-40 estudiantes) es EXACTAMENTE el
// caso de uso que pide "batching" — el docente marca la lista completa
// y el cliente la envía en UNA sola petición, no 40 peticiones sueltas.
// =====================================================================
import { Router } from 'express';
import { withTransaction, query } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, validarLoteCambios, parsePaginacion, enviarConEtag } from '../utils/http.js';

const router = Router();
const soloDocente = checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN, ROLES.AUXILIAR);

router.get('/secciones/:seccionId/asistencia', soloDocente, asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(422).json({ error: 'El parámetro fecha (YYYY-MM-DD) es obligatorio.' });
  const { rows } = await query(
    `SELECT a.id, a.estudiante_id, a.estado, a.observacion, u.nombres, u.apellidos
       FROM univ_ent_matriculas m
       JOIN univ_usuarios_perfil u ON u.id = m.estudiante_id
       LEFT JOIN univ_lms_asistencia a ON a.seccion_id = m.seccion_id AND a.estudiante_id = m.estudiante_id AND a.fecha_clase = $2
      WHERE m.seccion_id = $1 AND m.estado = 'Activa'
      ORDER BY u.apellidos, u.nombres`,
    [req.params.seccionId, fecha]
  );
  enviarConEtag(req, res, { items: rows });
}));

// Batching: un solo POST con toda la lista del día, en UNA transacción.
router.post('/secciones/:seccionId/asistencia/lote', soloDocente, asyncHandler(async (req, res) => {
  const { fecha, registros } = req.body; // [{estudianteId, estado, observacion}]
  if (!fecha) return res.status(422).json({ error: 'fecha es obligatoria.' });
  const validacion = validarLoteCambios(registros, { maxItems: 300 });
  if (!validacion.ok) return res.status(422).json({ error: validacion.error });

  const resultado = await withTransaction(async (client) => {
    const guardados = [];
    for (const r of registros) {
      const { rows } = await client.query(
        `INSERT INTO univ_lms_asistencia (seccion_id, estudiante_id, fecha_clase, estado, observacion, registrado_por)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (seccion_id, estudiante_id, fecha_clase)
         DO UPDATE SET estado = EXCLUDED.estado, observacion = EXCLUDED.observacion, registrado_por = EXCLUDED.registrado_por
         RETURNING id, estudiante_id, estado`,
        [req.params.seccionId, r.estudianteId, fecha, r.estado, r.observacion || null, req.univPerfilId]
      );
      guardados.push(rows[0]);
    }
    return guardados;
  });

  // Actualiza el % de asistencia acumulado de cada estudiante (usado por
  // el "tope de fallas" configurado en univ_ent_parametros).
  await query(
    `UPDATE univ_ent_matriculas m SET porcentaje_asistencia = sub.pct
       FROM (
         SELECT estudiante_id,
                ROUND(100.0 * count(*) FILTER (WHERE estado IN ('Presente','Retardo')) / NULLIF(count(*),0), 2) AS pct
           FROM univ_lms_asistencia WHERE seccion_id = $1 GROUP BY estudiante_id
       ) sub
     WHERE m.seccion_id = $1 AND m.estudiante_id = sub.estudiante_id`,
    [req.params.seccionId]
  );

  res.json({ ok: true, guardados: resultado.length });
}));

router.get('/estudiantes/:estudianteId/asistencia/:seccionId', asyncHandler(async (req, res) => {
  if (req.sesionUniv.rol === 'estudiante' && String(req.univPerfilId) !== String(req.params.estudianteId)) {
    return res.status(403).json({ error: 'No autorizado.' });
  }
  const { limit, offset } = parsePaginacion(req, { limitPorDefecto: 50 });
  const { rows } = await query(
    `SELECT fecha_clase, estado, observacion FROM univ_lms_asistencia
      WHERE estudiante_id = $1 AND seccion_id = $2 ORDER BY fecha_clase DESC LIMIT $3 OFFSET $4`,
    [req.params.estudianteId, req.params.seccionId, limit, offset]
  );
  enviarConEtag(req, res, { items: rows });
}));

export default router;
