// =====================================================================
// server/routes/gradebook.routes.js
// Sección 5 — Libro de Calificaciones (Gradebook), Analítica y Auditoría.
// Se monta en: /api/university/gradebook
//
// ESTE ARCHIVO CONTIENE EL ENDPOINT MÁS SENSIBLE DE TODA LA ENTREGA:
// POST /secciones/:seccionId/notas/lote — el guardado por lotes (batch)
// que reemplaza el guardado nota-por-nota que causaba las condiciones de
// carrera descritas (notas que "desaparecen" o "vuelven a cero"). Lee
// también la sección 6 del backend README para el contrato exacto que
// debe cumplir el cliente (debounce + batching antes de llamar aquí).
// =====================================================================
import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, validarLoteCambios, parseSince, respuestaConDelta, enviarConEtag } from '../utils/http.js';
import { corteEstaAbierto } from './admin.routes.js';

const router = Router();
const soloDocente = checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN, ROLES.AUXILIAR);

// ── Categorías / ponderaciones ───────────────────────────────────────
router.get('/secciones/:seccionId/categorias', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, nombre, corte, ponderacion, orden FROM univ_ent_gradebook_categorias WHERE seccion_id = $1 ORDER BY orden`,
    [req.params.seccionId]
  );
  enviarConEtag(req, res, { items: rows });
}));

router.post('/secciones/:seccionId/categorias', soloDocente, asyncHandler(async (req, res) => {
  const { nombre, corte, ponderacion, orden = 0 } = req.body;
  if (!nombre) return res.status(422).json({ error: 'El nombre de la categoría es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_gradebook_categorias (seccion_id, nombre, corte, ponderacion, orden) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.seccionId, nombre, corte || null, ponderacion ?? 0, orden]
  );
  res.status(201).json(rows[0]);
}));

// ── Grilla completa del gradebook (paginada por estudiante) ─────────
// SELECT explícito de columnas (nunca "SELECT *") + soporte de "since"
// para que un cliente que ya cargó la grilla solo pida lo que cambió.
router.get('/secciones/:seccionId/notas', soloDocente, asyncHandler(async (req, res) => {
  const since = parseSince(req);
  const params = [req.params.seccionId];
  let cond = 'm.seccion_id = $1';
  if (since) { params.push(since); cond += ` AND (m.updated_at > $${params.length} OR cc.updated_at > $${params.length})`; }
  const { rows } = await query(
    `SELECT m.id AS matricula_id, m.estudiante_id, u.nombres, u.apellidos,
            cc.corte, cc.nota, cc.updated_at
       FROM univ_ent_matriculas m
       JOIN univ_usuarios_perfil u ON u.id = m.estudiante_id
       LEFT JOIN univ_ent_calificaciones_cortes cc ON cc.matricula_id = m.id
      WHERE ${cond} AND m.estado = 'Activa'
      ORDER BY u.apellidos, u.nombres`,
    params
  );
  respuestaConDelta(res, rows, { columnaFecha: 'updated_at' });
}));

/**
 * GUARDADO EN LOTE (batching) — endpoint único para el autoguardado.
 *
 * Contrato esperado del cliente (ver frontend/modules/07-sync-engine.js):
 *   - El cliente acumula en memoria cada celda modificada en los últimos
 *     800ms-1s (debounce) y, además, agrupa varias celdas modificadas en
 *     una ventana de 1-2s (batching) antes de llamar aquí UNA sola vez.
 *   - Body: { cambios: [ { matriculaId, corte, nota, clienteActualizadoEn } ] }
 *   - clienteActualizadoEn es el timestamp LOCAL del navegador al momento
 *     de la edición — se usa para resolver conflictos "último en escribir
 *     gana" contra ediciones concurrentes de otro docente/auxiliar, NO
 *     contra el propio valor en edición del mismo usuario (eso lo
 *     resuelve el focus-guard en el cliente, nunca el servidor).
 *
 * Responde SIEMPRE con el estado final guardado de cada fila para que el
 * cliente pueda reconciliar (y revertir sutilmente, vía toast, solo la
 * fila que de verdad falló) sin tener que recargar la grilla entera.
 */
async function guardarLoteNotas(req, res) {
  const { cambios } = req.body;
  const validacion = validarLoteCambios(cambios, { maxItems: 500 });
  if (!validacion.ok) return res.status(422).json({ error: validacion.error });

  // Se resuelve UNA sola vez el periodo de la sección para no repetir el
  // JOIN por cada fila del lote.
  const seccion = await query(
    `SELECT s.periodo_id FROM univ_ent_secciones s WHERE s.id = $1 AND s.institucion_sk = $2`,
    [req.params.seccionId, req.sesionUniv.sk]
  );
  if (!seccion.rows.length) return res.status(404).json({ error: 'Sección no encontrada.' });
  const periodoId = seccion.rows[0].periodo_id;

  const resultados = [];
  await withTransaction(async (client) => {
    for (const c of cambios) {
      if (!c.matriculaId || !c.corte) { resultados.push({ ...c, ok: false, error: 'matriculaId y corte son obligatorios.' }); continue; }
      if (c.nota != null && (c.nota < 0 || c.nota > 5)) { resultados.push({ ...c, ok: false, error: 'La nota debe estar entre 0.0 y 5.0.' }); continue; }

      // Límite de registro de notas por corte (sección 1 del pliego).
      // eslint-disable-next-line no-await-in-loop
      if (!(await corteEstaAbierto(periodoId, c.corte))) {
        resultados.push({ ...c, ok: false, error: `El plazo para registrar notas del corte ${c.corte} ya venció.` });
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const { rows } = await client.query(
          `INSERT INTO univ_ent_calificaciones_cortes (matricula_id, corte, nota, actualizado_por)
             VALUES ($1,$2,$3,$4)
           ON CONFLICT (matricula_id, corte) DO UPDATE SET
             nota = EXCLUDED.nota, actualizado_por = EXCLUDED.actualizado_por, updated_at = now()
           RETURNING matricula_id, corte, nota, updated_at`,
          [c.matriculaId, c.corte, c.nota, req.univPerfilId]
        );
        resultados.push({ ...rows[0], ok: true });
      } catch (err) {
        resultados.push({ ...c, ok: false, error: 'No se pudo guardar esta celda (' + err.message + ').' });
      }
    }

    // Recalcula la nota_definitiva de cada matrícula tocada, con los %
    // reales del periodo (30/30/40 o lo que se haya configurado).
    const matriculasTocadas = [...new Set(cambios.map((c) => c.matriculaId).filter(Boolean))];
    for (const matId of matriculasTocadas) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `UPDATE univ_ent_matriculas m SET nota_definitiva = sub.definitiva
           FROM (
             SELECT $1::uuid AS mid,
                    ROUND(
                      COALESCE(SUM(cc.nota * CASE cc.corte WHEN 1 THEN p.corte1_porcentaje WHEN 2 THEN p.corte2_porcentaje WHEN 3 THEN p.corte3_porcentaje END)
                        FILTER (WHERE cc.nota IS NOT NULL) / 100.0, 0)
                    ::numeric, 2) AS definitiva
               FROM univ_ent_matriculas mm
               JOIN univ_ent_secciones s ON s.id = mm.seccion_id
               JOIN univ_ent_periodos_academicos p ON p.id = s.periodo_id
               LEFT JOIN univ_ent_calificaciones_cortes cc ON cc.matricula_id = mm.id
              WHERE mm.id = $1
              GROUP BY mm.id
           ) sub
          WHERE m.id = sub.mid`,
        [matId]
      );
    }
  });

  res.json({ items: resultados, guardadosOk: resultados.filter((r) => r.ok).length, fallidos: resultados.filter((r) => !r.ok) });
}
router.post('/secciones/:seccionId/notas/lote', soloDocente, asyncHandler(guardarLoteNotas));

// ── Analítica docente: estudiantes en riesgo académico ───────────────
router.get('/secciones/:seccionId/en-riesgo', soloDocente, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.* FROM univ_v_estudiantes_en_riesgo r WHERE r.seccion_id = $1 ORDER BY r.promedio_actual ASC`,
    [req.params.seccionId]
  );
  enviarConEtag(req, res, { items: rows }, { cacheControl: 'private, max-age=60, must-revalidate' });
}));

// ── Reporte de cobertura de contenidos (vistas de recursos vs. total) ─
router.get('/secciones/:seccionId/cobertura', soloDocente, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT m.id AS modulo_id, m.titulo,
            count(DISTINCT r.id) AS total_recursos,
            count(DISTINCT log.entidad_id) AS recursos_vistos_al_menos_1_vez
       FROM univ_lms_modulos m
       LEFT JOIN univ_lms_recursos r ON r.modulo_id = m.id
       LEFT JOIN univ_lms_logs log ON log.entidad_id = r.id AND log.tipo_evento = 'vista' AND log.entidad_tipo = 'univ_lms_recursos'
      WHERE m.seccion_id = $1
      GROUP BY m.id, m.titulo ORDER BY m.orden`,
    [req.params.seccionId]
  );
  enviarConEtag(req, res, { items: rows }, { cacheControl: 'private, max-age=120, must-revalidate' });
}));

// ── Exportar a CSV ────────────────────────────────────────────────────
router.get('/secciones/:seccionId/exportar-csv', soloDocente, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.documento_identidad, u.apellidos, u.nombres,
            MAX(CASE cc.corte WHEN 1 THEN cc.nota END) AS corte1,
            MAX(CASE cc.corte WHEN 2 THEN cc.nota END) AS corte2,
            MAX(CASE cc.corte WHEN 3 THEN cc.nota END) AS corte3,
            m.nota_definitiva
       FROM univ_ent_matriculas m
       JOIN univ_usuarios_perfil u ON u.id = m.estudiante_id
       LEFT JOIN univ_ent_calificaciones_cortes cc ON cc.matricula_id = m.id
      WHERE m.seccion_id = $1 AND m.estado = 'Activa'
      GROUP BY u.documento_identidad, u.apellidos, u.nombres, m.nota_definitiva
      ORDER BY u.apellidos, u.nombres`,
    [req.params.seccionId]
  );
  const encabezado = 'documento,apellidos,nombres,corte1,corte2,corte3,nota_definitiva';
  const filas = rows.map((r) => [r.documento_identidad, r.apellidos, r.nombres, r.corte1 ?? '', r.corte2 ?? '', r.corte3 ?? '', r.nota_definitiva ?? '']
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [encabezado, ...filas].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gradebook_${req.params.seccionId}.csv"`);
  res.send(csv);
}));

// ── Importar desde CSV/Excel (el cliente ya parseó el archivo a JSON) ─
// El parseo del .xlsx/.csv se hace en el FRONTEND (con SheetJS, que ya
// usa el proyecto — ver 02-sheetjs-loader.js) y llega aquí como un lote
// normal, reutilizando el mismo endpoint de batching de arriba. Este
// endpoint queda documentado por claridad, pero delega en el batch:
router.post('/secciones/:seccionId/notas/importar', soloDocente, asyncHandler(guardarLoteNotas));

export default router;
