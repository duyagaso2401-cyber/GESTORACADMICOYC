// =====================================================================
// server/routes/admin.routes.js
// Sección 1 — Estructura institucional y configuración (SuperAdmin/Rector)
// Sedes/Campus · Facultades · Departamentos · Programas · Calendario
// académico (periodos) · Parámetros globales.
// Se monta en: /api/university/admin
// =====================================================================
import { Router } from 'express';
import { query } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, parsePaginacion, parseSince, respuestaConDelta, enviarConEtag } from '../utils/http.js';
import { registrarEvento } from '../utils/logger.js';

const router = Router();
const soloDireccion = checkUniversityRole(ROLES.SUPER_ADMIN, ROLES.RECTOR);
const direccionYDecanos = checkUniversityRole(ROLES.SUPER_ADMIN, ROLES.RECTOR, ROLES.DECANO);

// ── Sedes / Campus ──────────────────────────────────────────────────
router.get('/sedes', asyncHandler(async (req, res) => {
  const { limit, offset } = parsePaginacion(req);
  const sk = req.sesionUniv.sk;
  const { rows } = await query(
    `SELECT id, nombre, tipo, direccion, ciudad, pais, activo, updated_at
       FROM univ_sedes WHERE institucion_sk = $1 AND activo = TRUE
       ORDER BY nombre LIMIT $2 OFFSET $3`,
    [sk, limit, offset]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/sedes', soloDireccion, asyncHandler(async (req, res) => {
  const { nombre, tipo = 'Fisica', direccion, ciudad, pais } = req.body;
  if (!nombre) return res.status(422).json({ error: 'El nombre de la sede es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_sedes (institucion_sk, nombre, tipo, direccion, ciudad, pais)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.sesionUniv.sk, nombre, tipo, direccion || null, ciudad || null, pais || 'Colombia']
  );
  registrarEvento(req, 'creacion', { entidadTipo: 'univ_sedes', entidadId: rows[0].id });
  res.status(201).json(rows[0]);
}));

router.patch('/sedes/:id', soloDireccion, asyncHandler(async (req, res) => {
  const campos = ['nombre', 'tipo', 'direccion', 'ciudad', 'pais', 'activo'];
  const set = []; const params = [];
  campos.forEach((c) => { if (c in req.body) { params.push(req.body[c]); set.push(`${c} = $${params.length}`); } });
  if (!set.length) return res.status(422).json({ error: 'Nada que actualizar.' });
  params.push(req.params.id, req.sesionUniv.sk);
  const { rows } = await query(
    `UPDATE univ_sedes SET ${set.join(', ')} WHERE id = $${params.length - 1} AND institucion_sk = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Sede no encontrada.' });
  res.json(rows[0]);
}));

// ── Facultades / Decanaturas ────────────────────────────────────────
router.get('/facultades', asyncHandler(async (req, res) => {
  const since = parseSince(req);
  const sk = req.sesionUniv.sk;
  const { rows } = since
    ? await query(`SELECT id, nombre, codigo, decano_usuario_id, activo, updated_at FROM univ_ent_facultades
                     WHERE institucion_sk = $1 AND updated_at > $2 ORDER BY updated_at`, [sk, since])
    : await query(`SELECT id, nombre, codigo, decano_usuario_id, activo, updated_at FROM univ_ent_facultades
                     WHERE institucion_sk = $1 AND activo = TRUE ORDER BY nombre`, [sk]);
  respuestaConDelta(res, rows);
}));

router.post('/facultades', soloDireccion, asyncHandler(async (req, res) => {
  const { nombre, codigo, decanoUsuarioId } = req.body;
  if (!nombre) return res.status(422).json({ error: 'El nombre de la facultad es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_facultades (institucion_sk, nombre, codigo, decano_usuario_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.sesionUniv.sk, nombre, codigo || null, decanoUsuarioId || null]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/facultades/:id', soloDireccion, asyncHandler(async (req, res) => {
  const { nombre, codigo, decanoUsuarioId, activo } = req.body;
  const { rows } = await query(
    `UPDATE univ_ent_facultades SET
       nombre = COALESCE($1, nombre), codigo = COALESCE($2, codigo),
       decano_usuario_id = COALESCE($3, decano_usuario_id), activo = COALESCE($4, activo)
     WHERE id = $5 AND institucion_sk = $6 RETURNING *`,
    [nombre, codigo, decanoUsuarioId, activo, req.params.id, req.sesionUniv.sk]
  );
  if (!rows.length) return res.status(404).json({ error: 'Facultad no encontrada.' });
  res.json(rows[0]);
}));

// ── Departamentos académicos ────────────────────────────────────────
router.get('/facultades/:facultadId/departamentos', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT d.id, d.nombre, d.codigo, d.jefe_usuario_id, d.activo, d.updated_at
       FROM univ_ent_departamentos d
       JOIN univ_ent_facultades f ON f.id = d.facultad_id
      WHERE d.facultad_id = $1 AND f.institucion_sk = $2
      ORDER BY d.nombre`,
    [req.params.facultadId, req.sesionUniv.sk]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/facultades/:facultadId/departamentos', direccionYDecanos, asyncHandler(async (req, res) => {
  const { nombre, codigo, jefeUsuarioId } = req.body;
  if (!nombre) return res.status(422).json({ error: 'El nombre del departamento es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_departamentos (facultad_id, nombre, codigo, jefe_usuario_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.facultadId, nombre, codigo || null, jefeUsuarioId || null]
  );
  res.status(201).json(rows[0]);
}));

// ── Programas / Carreras ────────────────────────────────────────────
router.get('/departamentos/:departamentoId/programas', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, nombre, codigo_snies, nivel, creditos_totales, duracion_semestres, titulo_otorgado, activo, updated_at
       FROM univ_programas WHERE departamento_id = $1 ORDER BY nombre`,
    [req.params.departamentoId]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/departamentos/:departamentoId/programas', direccionYDecanos, asyncHandler(async (req, res) => {
  const { nombre, codigoSnies, nivel = 'Pregrado', creditosTotales = 0, duracionSemestres = 10, tituloOtorgado } = req.body;
  if (!nombre) return res.status(422).json({ error: 'El nombre del programa es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_programas (departamento_id, institucion_sk, nombre, codigo_snies, nivel, creditos_totales, duracion_semestres, titulo_otorgado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.departamentoId, req.sesionUniv.sk, nombre, codigoSnies || null, nivel, creditosTotales, duracionSemestres, tituloOtorgado || null]
  );
  res.status(201).json(rows[0]);
}));

// ── Calendario académico: periodos/semestres ────────────────────────
router.get('/periodos', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, codigo, nombre, estado,
            fecha_inicio_prematricula, fecha_fin_prematricula,
            fecha_inicio_adiciones, fecha_fin_adiciones,
            fecha_inicio_clases, fecha_fin_clases,
            corte1_fecha_limite, corte1_porcentaje,
            corte2_fecha_limite, corte2_porcentaje,
            corte3_fecha_limite, corte3_porcentaje,
            updated_at
       FROM univ_ent_periodos_academicos WHERE institucion_sk = $1 ORDER BY codigo DESC`,
    [req.sesionUniv.sk]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/periodos', soloDireccion, asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.codigo) return res.status(422).json({ error: 'El código del periodo (ej. 2026-1) es obligatorio.' });
  const c1 = Number(b.corte1Porcentaje ?? 30), c2 = Number(b.corte2Porcentaje ?? 30), c3 = Number(b.corte3Porcentaje ?? 40);
  if (Math.round((c1 + c2 + c3) * 100) !== 10000) {
    return res.status(422).json({ error: 'Los porcentajes de los 3 cortes deben sumar exactamente 100.' });
  }
  const { rows } = await query(
    `INSERT INTO univ_ent_periodos_academicos
       (institucion_sk, codigo, nombre,
        fecha_inicio_prematricula, fecha_fin_prematricula,
        fecha_inicio_adiciones, fecha_fin_adiciones,
        fecha_inicio_clases, fecha_fin_clases,
        corte1_fecha_limite, corte1_porcentaje,
        corte2_fecha_limite, corte2_porcentaje,
        corte3_fecha_limite, corte3_porcentaje, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [req.sesionUniv.sk, b.codigo, b.nombre || b.codigo,
     b.fechaInicioPrematricula || null, b.fechaFinPrematricula || null,
     b.fechaInicioAdiciones || null, b.fechaFinAdiciones || null,
     b.fechaInicioClases || null, b.fechaFinClases || null,
     b.corte1FechaLimite || null, c1,
     b.corte2FechaLimite || null, c2,
     b.corte3FechaLimite || null, c3,
     b.estado || 'Planeado']
  );
  res.status(201).json(rows[0]);
}));

router.patch('/periodos/:id/estado', soloDireccion, asyncHandler(async (req, res) => {
  const { estado } = req.body;
  if (!['Planeado', 'Activo', 'Cerrado'].includes(estado)) return res.status(422).json({ error: 'Estado inválido.' });
  const { rows } = await query(
    `UPDATE univ_ent_periodos_academicos SET estado = $1 WHERE id = $2 AND institucion_sk = $3 RETURNING *`,
    [estado, req.params.id, req.sesionUniv.sk]
  );
  if (!rows.length) return res.status(404).json({ error: 'Periodo no encontrado.' });
  res.json(rows[0]);
}));

/** Devuelve, para un periodo dado, si HOY el corte N sigue abierto para
 * digitar notas. Los controladores de gradebook llaman esto antes de
 * aceptar una nota — así se respeta el "límite de registro de notas por
 * corte" pedido en la especificación, sin que cada ruta reimplemente la
 * regla por su cuenta. */
export async function corteEstaAbierto(periodoId, corte) {
  const { rows } = await query(
    `SELECT corte1_fecha_limite, corte2_fecha_limite, corte3_fecha_limite FROM univ_ent_periodos_academicos WHERE id = $1`,
    [periodoId]
  );
  if (!rows.length) return false;
  const limite = rows[0][`corte${corte}_fecha_limite`];
  if (!limite) return true; // sin fecha límite configurada = siempre abierto
  return new Date() <= new Date(limite);
}

// ── Parámetros globales ─────────────────────────────────────────────
router.get('/parametros', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM univ_ent_parametros WHERE institucion_sk = $1`, [req.sesionUniv.sk]);
  if (!rows.length) {
    // Crea parámetros por defecto la primera vez que se consultan (evita
    // un paso manual de "seed" adicional para instituciones nuevas).
    const created = await query(
      `INSERT INTO univ_ent_parametros (institucion_sk) VALUES ($1) RETURNING *`,
      [req.sesionUniv.sk]
    );
    return res.json(created.rows[0]);
  }
  res.json(rows[0]);
}));

router.put('/parametros', soloDireccion, asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO univ_ent_parametros
       (institucion_sk, escala_nota_minima, escala_nota_maxima, nota_minima_aprobacion,
        tope_fallas_porcentaje, politica_creditos, umbral_prueba_academica, dias_inactividad_riesgo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (institucion_sk) DO UPDATE SET
       escala_nota_minima = EXCLUDED.escala_nota_minima,
       escala_nota_maxima = EXCLUDED.escala_nota_maxima,
       nota_minima_aprobacion = EXCLUDED.nota_minima_aprobacion,
       tope_fallas_porcentaje = EXCLUDED.tope_fallas_porcentaje,
       politica_creditos = EXCLUDED.politica_creditos,
       umbral_prueba_academica = EXCLUDED.umbral_prueba_academica,
       dias_inactividad_riesgo = EXCLUDED.dias_inactividad_riesgo
     RETURNING *`,
    [req.sesionUniv.sk, b.escalaNotaMinima ?? 0.0, b.escalaNotaMaxima ?? 5.0, b.notaMinimaAprobacion ?? 3.0,
     b.topeFallasPorcentaje ?? 20.0, JSON.stringify(b.politicaCreditos || {}), b.umbralPruebaAcademica ?? 3.0,
     b.diasInactividadRiesgo ?? 14]
  );
  res.json(rows[0]);
}));

export default router;
