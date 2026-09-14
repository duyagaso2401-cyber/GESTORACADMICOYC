// =====================================================================
// server/routes/academic.routes.js
// Sección 2 y 3 — Pensum/malla, asignaturas, prerrequisitos/correquisitos,
// oferta académica (secciones/NRC), matrícula y hoja de vida académica.
// Se monta en: /api/university/academic
// =====================================================================
import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, parsePaginacion, parseSince, respuestaConDelta, enviarConEtag } from '../utils/http.js';
import { registrarEvento } from '../utils/logger.js';

const router = Router();
const gestionCurricular = checkUniversityRole(ROLES.SUPER_ADMIN, ROLES.RECTOR, ROLES.DECANO);
const gestionOferta = checkUniversityRole(ROLES.SUPER_ADMIN, ROLES.RECTOR, ROLES.DECANO);

// ── Asignaturas (catálogo) ──────────────────────────────────────────
router.get('/asignaturas', asyncHandler(async (req, res) => {
  const { limit, offset } = parsePaginacion(req);
  const { rows } = await query(
    `SELECT id, codigo, nombre, creditos, horas_presenciales, horas_independientes, caracter, departamento_id, activo, updated_at
       FROM univ_asignaturas WHERE institucion_sk = $1 AND activo = TRUE
       ORDER BY codigo LIMIT $2 OFFSET $3`,
    [req.sesionUniv.sk, limit, offset]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/asignaturas', gestionCurricular, asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.codigo || !b.nombre) return res.status(422).json({ error: 'Código y nombre son obligatorios.' });
  const { rows } = await query(
    `INSERT INTO univ_asignaturas
       (institucion_sk, codigo, nombre, creditos, horas_presenciales, horas_independientes, caracter, departamento_id, descripcion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.sesionUniv.sk, b.codigo, b.nombre, b.creditos ?? 3, b.horasPresenciales ?? 0, b.horasIndependientes ?? 0,
     b.caracter || 'Obligatoria', b.departamentoId || null, b.descripcion || null]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/asignaturas/:id', gestionCurricular, asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `UPDATE univ_asignaturas SET
       nombre = COALESCE($1, nombre), creditos = COALESCE($2, creditos),
       horas_presenciales = COALESCE($3, horas_presenciales), horas_independientes = COALESCE($4, horas_independientes),
       caracter = COALESCE($5, caracter), departamento_id = COALESCE($6, departamento_id),
       descripcion = COALESCE($7, descripcion), activo = COALESCE($8, activo)
     WHERE id = $9 AND institucion_sk = $10 RETURNING *`,
    [b.nombre, b.creditos, b.horasPresenciales, b.horasIndependientes, b.caracter, b.departamentoId, b.descripcion, b.activo,
     req.params.id, req.sesionUniv.sk]
  );
  if (!rows.length) return res.status(404).json({ error: 'Asignatura no encontrada.' });
  res.json(rows[0]);
}));

// ── Prerrequisitos / Correquisitos ──────────────────────────────────
router.get('/asignaturas/:id/prerrequisitos', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, a.id AS prerrequisito_id, a.codigo, a.nombre
       FROM univ_prerrequisitos p JOIN univ_asignaturas a ON a.id = p.prerrequisito_id
      WHERE p.asignatura_id = $1`,
    [req.params.id]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/asignaturas/:id/prerrequisitos', gestionCurricular, asyncHandler(async (req, res) => {
  const { prerrequisitoId } = req.body;
  if (!prerrequisitoId) return res.status(422).json({ error: 'prerrequisitoId es obligatorio.' });
  if (String(prerrequisitoId) === String(req.params.id)) return res.status(422).json({ error: 'Una asignatura no puede ser prerrequisito de sí misma.' });
  const { rows } = await query(
    `INSERT INTO univ_prerrequisitos (asignatura_id, prerrequisito_id) VALUES ($1,$2)
     ON CONFLICT (asignatura_id, prerrequisito_id) DO NOTHING RETURNING *`,
    [req.params.id, prerrequisitoId]
  );
  res.status(201).json(rows[0] || { ok: true, yaExistia: true });
}));

router.post('/asignaturas/:id/correquisitos', gestionCurricular, asyncHandler(async (req, res) => {
  const { correquisitoId } = req.body;
  if (!correquisitoId) return res.status(422).json({ error: 'correquisitoId es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_correquisitos (asignatura_id, correquisito_id) VALUES ($1,$2)
     ON CONFLICT (asignatura_id, correquisito_id) DO NOTHING RETURNING *`,
    [req.params.id, correquisitoId]
  );
  res.status(201).json(rows[0] || { ok: true, yaExistia: true });
}));

// ── Pensum / malla curricular ───────────────────────────────────────
router.get('/programas/:programaId/pensums', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, version, nombre, vigente_desde, vigente_hasta, activo FROM univ_ent_pensums
      WHERE programa_id = $1 ORDER BY version DESC`,
    [req.params.programaId]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/programas/:programaId/pensums', gestionCurricular, asyncHandler(async (req, res) => {
  const { version, nombre, vigenteDesde, vigenteHasta } = req.body;
  if (!version) return res.status(422).json({ error: 'La versión del pensum es obligatoria.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_pensums (programa_id, version, nombre, vigente_desde, vigente_hasta)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.programaId, version, nombre || null, vigenteDesde || null, vigenteHasta || null]
  );
  res.status(201).json(rows[0]);
}));

router.post('/pensums/:pensumId/asignaturas', gestionCurricular, asyncHandler(async (req, res) => {
  const { asignaturaId, semestreSugerido = 1 } = req.body;
  if (!asignaturaId) return res.status(422).json({ error: 'asignaturaId es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_pensum_asignaturas (pensum_id, asignatura_id, semestre_sugerido)
     VALUES ($1,$2,$3) ON CONFLICT (pensum_id, asignatura_id) DO UPDATE SET semestre_sugerido = EXCLUDED.semestre_sugerido
     RETURNING *`,
    [req.params.pensumId, asignaturaId, semestreSugerido]
  );
  res.status(201).json(rows[0]);
}));

router.get('/pensums/:pensumId/asignaturas', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pa.id, pa.semestre_sugerido, a.id AS asignatura_id, a.codigo, a.nombre, a.creditos, a.caracter
       FROM univ_ent_pensum_asignaturas pa JOIN univ_asignaturas a ON a.id = pa.asignatura_id
      WHERE pa.pensum_id = $1 ORDER BY pa.semestre_sugerido, a.nombre`,
    [req.params.pensumId]
  );
  enviarConEtag(req, res, { items: rows });
}));

// ── Oferta académica / Secciones (NRC) ──────────────────────────────
router.get('/secciones', asyncHandler(async (req, res) => {
  const since = parseSince(req);
  const { periodoId, asignaturaId, docenteId } = req.query;
  const cond = ['s.institucion_sk = $1'];
  const params = [req.sesionUniv.sk];
  if (periodoId) { params.push(periodoId); cond.push(`s.periodo_id = $${params.length}`); }
  if (asignaturaId) { params.push(asignaturaId); cond.push(`s.asignatura_id = $${params.length}`); }
  if (docenteId) { params.push(docenteId); cond.push(`s.docente_titular_id = $${params.length}`); }
  if (since) { params.push(since); cond.push(`s.updated_at > $${params.length}`); }
  const { rows } = await query(
    `SELECT s.id, s.nrc, s.cupo_maximo, s.modalidad, s.horario, s.aula_fisica, s.enlace_videollamada,
            s.proveedor_video, s.formato_aula, s.updated_at,
            a.codigo AS asignatura_codigo, a.nombre AS asignatura_nombre,
            (SELECT count(*) FROM univ_ent_matriculas m WHERE m.seccion_id = s.id AND m.estado = 'Activa') AS matriculados
       FROM univ_ent_secciones s
       JOIN univ_asignaturas a ON a.id = s.asignatura_id
      WHERE ${cond.join(' AND ')}
      ORDER BY s.updated_at DESC`,
    params
  );
  respuestaConDelta(res, rows);
}));

router.post('/secciones', gestionOferta, asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.asignaturaId || !b.periodoId) return res.status(422).json({ error: 'asignaturaId y periodoId son obligatorios.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_secciones
       (institucion_sk, nrc, asignatura_id, periodo_id, sede_id, docente_titular_id, cupo_maximo,
        modalidad, horario, aula_fisica, enlace_videollamada, proveedor_video, formato_aula)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.sesionUniv.sk, b.nrc || null, b.asignaturaId, b.periodoId, b.sedeId || null, b.docenteTitularId || null,
     b.cupoMaximo ?? 35, b.modalidad || 'Presencial', JSON.stringify(b.horario || []), b.aulaFisica || null,
     b.enlaceVideollamada || null, b.proveedorVideo || null, b.formatoAula || 'semanal']
  );
  registrarEvento(req, 'creacion', { entidadTipo: 'univ_ent_secciones', entidadId: rows[0].id });
  res.status(201).json(rows[0]);
}));

router.post('/secciones/:id/auxiliares', gestionOferta, asyncHandler(async (req, res) => {
  const { usuarioId, rolAsistencia = 'Auxiliar' } = req.body;
  if (!usuarioId) return res.status(422).json({ error: 'usuarioId es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_seccion_auxiliares (seccion_id, usuario_id, rol_asistencia) VALUES ($1,$2,$3)
     ON CONFLICT (seccion_id, usuario_id) DO UPDATE SET rol_asistencia = EXCLUDED.rol_asistencia RETURNING *`,
    [req.params.id, usuarioId, rolAsistencia]
  );
  res.status(201).json(rows[0]);
}));

router.post('/secciones/:id/grabaciones', checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN), asyncHandler(async (req, res) => {
  const { titulo, urlGrabacion, fechaClase } = req.body;
  if (!urlGrabacion) return res.status(422).json({ error: 'urlGrabacion es obligatoria.' });
  const { rows } = await query(
    `INSERT INTO univ_seccion_grabaciones (seccion_id, titulo, url_grabacion, fecha_clase) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, titulo || null, urlGrabacion, fechaClase || null]
  );
  res.status(201).json(rows[0]);
}));

// ── Matrícula ────────────────────────────────────────────────────────
router.post('/matriculas', checkUniversityRole(ROLES.ESTUDIANTE, ROLES.SUPER_ADMIN, ROLES.RECTOR, ROLES.DECANO), asyncHandler(async (req, res) => {
  const { seccionId, tipo = 'Ordinaria' } = req.body;
  const estudianteId = req.sesionUniv.rol === 'estudiante' ? req.univPerfilId : req.body.estudianteId;
  if (!seccionId || !estudianteId) return res.status(422).json({ error: 'seccionId y estudianteId son obligatorios.' });

  await withTransaction(async (client) => {
    // Bloquea la fila de la sección para que dos matrículas simultáneas
    // no se pasen del cupo máximo (condición de carrera real en
    // periodos de alta demanda).
    const sec = await client.query(`SELECT cupo_maximo FROM univ_ent_secciones WHERE id = $1 FOR UPDATE`, [seccionId]);
    if (!sec.rows.length) { const e = new Error('Sección no encontrada.'); e.status = 404; e.expose = true; throw e; }
    const ocupados = await client.query(`SELECT count(*)::int AS n FROM univ_ent_matriculas WHERE seccion_id = $1 AND estado = 'Activa'`, [seccionId]);
    if (ocupados.rows[0].n >= sec.rows[0].cupo_maximo) {
      const e = new Error('La sección ya no tiene cupo disponible.'); e.status = 409; e.expose = true; throw e;
    }
    const ins = await client.query(
      `INSERT INTO univ_ent_matriculas (seccion_id, estudiante_id, tipo) VALUES ($1,$2,$3)
       ON CONFLICT (seccion_id, estudiante_id) DO UPDATE SET estado = 'Activa' RETURNING *`,
      [seccionId, estudianteId, tipo]
    );
    res.status(201).json(ins.rows[0]);
  });
}));

router.patch('/matriculas/:id/estado', gestionOferta, asyncHandler(async (req, res) => {
  const { estado } = req.body;
  if (!['Activa', 'Cancelada', 'Retirada', 'Aprobada', 'Reprobada'].includes(estado)) {
    return res.status(422).json({ error: 'Estado inválido.' });
  }
  const { rows } = await query(`UPDATE univ_ent_matriculas SET estado = $1 WHERE id = $2 RETURNING *`, [estado, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Matrícula no encontrada.' });
  res.json(rows[0]);
}));

// ── Hoja de vida / Historia académica ───────────────────────────────
router.get('/estudiantes/:estudianteId/historial', asyncHandler(async (req, res) => {
  const rol = req.sesionUniv.rol;
  if (rol === 'estudiante' && String(req.univPerfilId) !== String(req.params.estudianteId)) {
    return res.status(403).json({ error: 'No puede ver el historial de otro estudiante.' });
  }
  const { rows } = await query(
    `SELECT h.*, p.codigo AS periodo_codigo
       FROM univ_historial_academico h JOIN univ_ent_periodos_academicos p ON p.id = h.periodo_id
      WHERE h.estudiante_id = $1 ORDER BY p.codigo`,
    [req.params.estudianteId]
  );
  const resumen = rows.length ? rows[rows.length - 1] : null;
  enviarConEtag(req, res, {
    items: rows,
    resumen: resumen ? {
      papaAcumulado: resumen.papa_acumulado,
      creditosAprobados: resumen.creditos_aprobados,
      creditosPendientes: resumen.creditos_pendientes,
      estadoAcademico: resumen.estado_academico,
    } : null,
  });
}));

router.get('/estudiantes/:estudianteId/matriculas', asyncHandler(async (req, res) => {
  const rol = req.sesionUniv.rol;
  if (rol === 'estudiante' && String(req.univPerfilId) !== String(req.params.estudianteId)) {
    return res.status(403).json({ error: 'No autorizado.' });
  }
  const { rows } = await query(
    `SELECT m.id, m.estado, m.nota_definitiva, m.porcentaje_asistencia, s.nrc,
            a.codigo AS asignatura_codigo, a.nombre AS asignatura_nombre, per.codigo AS periodo
       FROM univ_ent_matriculas m
       JOIN univ_ent_secciones s ON s.id = m.seccion_id
       JOIN univ_asignaturas a ON a.id = s.asignatura_id
       JOIN univ_ent_periodos_academicos per ON per.id = s.periodo_id
      WHERE m.estudiante_id = $1 ORDER BY per.codigo DESC`,
    [req.params.estudianteId]
  );
  enviarConEtag(req, res, { items: rows });
}));

export default router;
