// =====================================================================
// server/routes/quiz.routes.js
// Sección 4 — Quiz Engine: banco de preguntas por categoría, cuestionarios
// configurables (cronómetro, intentos, barajado, método de calificación)
// y control de integridad de evaluación (clics, tiempo por pregunta,
// pérdida de foco / cambio de pestaña).
// Se monta en: /api/university/lms  (mismo prefijo que lms.routes.js)
// =====================================================================
import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { checkUniversityRole, ROLES } from '../middleware/auth.js';
import { asyncHandler, enviarConEtag } from '../utils/http.js';
import { registrarEvento } from '../utils/logger.js';

const router = Router();
const soloDocente = checkUniversityRole(ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN, ROLES.AUXILIAR);
const soloEstudiante = checkUniversityRole(ROLES.ESTUDIANTE);

function barajar(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Banco de preguntas por categoría ────────────────────────────────
router.post('/secciones/:seccionId/banco-categorias', soloDocente, asyncHandler(async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(422).json({ error: 'El nombre de la categoría es obligatorio.' });
  const { rows } = await query(`INSERT INTO univ_lms_banco_categorias (seccion_id, nombre) VALUES ($1,$2) RETURNING *`, [req.params.seccionId, nombre]);
  res.status(201).json(rows[0]);
}));

router.get('/secciones/:seccionId/banco-categorias', soloDocente, asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM univ_lms_banco_categorias WHERE seccion_id = $1 ORDER BY nombre`, [req.params.seccionId]);
  enviarConEtag(req, res, { items: rows });
}));

router.post('/banco-categorias/:categoriaId/preguntas', soloDocente, asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.enunciado || !b.tipo) return res.status(422).json({ error: 'enunciado y tipo son obligatorios.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_lms_banco_preguntas (categoria_id, tipo, enunciado, puntaje_defecto, opciones, respuesta_correcta, retroalimentacion, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.categoriaId, b.tipo, b.enunciado, b.puntajeDefecto ?? 1, JSON.stringify(b.opciones || []),
     b.respuestaCorrecta || null, b.retroalimentacion || null, req.univPerfilId]
  );
  res.status(201).json(rows[0]);
}));

router.get('/banco-categorias/:categoriaId/preguntas', soloDocente, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, tipo, enunciado, puntaje_defecto, opciones, respuesta_correcta, retroalimentacion
       FROM univ_ent_lms_banco_preguntas WHERE categoria_id = $1 ORDER BY created_at DESC`,
    [req.params.categoriaId]
  );
  enviarConEtag(req, res, { items: rows });
}));

// ── Cuestionarios ────────────────────────────────────────────────────
router.post('/actividades/:actividadId/cuestionario', soloDocente, asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO univ_ent_lms_cuestionarios
       (actividad_id, limite_tiempo_minutos, intentos_permitidos, metodo_calificacion, barajar_preguntas,
        barajar_opciones, mostrar_respuestas_al_finalizar, control_integridad)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.actividadId, b.limiteTiempoMinutos || null, b.intentosPermitidos ?? 1, b.metodoCalificacion || 'mas_alto',
     b.barajarPreguntas !== false, b.barajarOpciones !== false, !!b.mostrarRespuestasAlFinalizar, b.controlIntegridad !== false]
  );
  res.status(201).json(rows[0]);
}));

router.post('/cuestionarios/:id/preguntas', soloDocente, asyncHandler(async (req, res) => {
  const { preguntaId, puntaje, orden = 0 } = req.body;
  if (!preguntaId) return res.status(422).json({ error: 'preguntaId es obligatorio.' });
  const { rows } = await query(
    `INSERT INTO univ_ent_lms_cuestionario_preguntas (cuestionario_id, pregunta_id, puntaje, orden)
     VALUES ($1,$2,$3,$4) ON CONFLICT (cuestionario_id, pregunta_id) DO UPDATE SET puntaje = EXCLUDED.puntaje
     RETURNING *`,
    [req.params.id, preguntaId, puntaje || null, orden]
  );
  res.status(201).json(rows[0]);
}));

// El estudiante NUNCA recibe `respuesta_correcta` ni `opciones.correcta`
// en la carga inicial del intento — solo el texto de las opciones. Esto
// evita filtrar la respuesta correcta por la red antes de tiempo.
function sanearPreguntaParaEstudiante(p, barajarOpciones) {
  const opciones = Array.isArray(p.opciones) ? p.opciones.map((o) => ({ id: o.id, texto: o.texto })) : [];
  return {
    id: p.pregunta_id,
    tipo: p.tipo,
    enunciado: p.enunciado,
    opciones: barajarOpciones ? barajar(opciones) : opciones,
    puntaje: p.puntaje ?? p.puntaje_defecto,
  };
}

// ── Iniciar un intento ───────────────────────────────────────────────
router.post('/cuestionarios/:id/intentos', soloEstudiante, asyncHandler(async (req, res) => {
  const cq = await query(`SELECT * FROM univ_ent_lms_cuestionarios WHERE id = $1`, [req.params.id]);
  if (!cq.rows.length) return res.status(404).json({ error: 'Cuestionario no encontrado.' });
  const cuestionario = cq.rows[0];

  const previos = await query(
    `SELECT count(*)::int AS n FROM univ_lms_intentos_cuestionario WHERE cuestionario_id = $1 AND estudiante_id = $2`,
    [req.params.id, req.univPerfilId]
  );
  if (previos.rows[0].n >= cuestionario.intentos_permitidos) {
    return res.status(409).json({ error: 'Ya agotó el número de intentos permitidos.' });
  }

  const preguntas = await query(
    `SELECT cp.pregunta_id, cp.puntaje, cp.orden, bp.tipo, bp.enunciado, bp.opciones, bp.puntaje_defecto
       FROM univ_ent_lms_cuestionario_preguntas cp JOIN univ_ent_lms_banco_preguntas bp ON bp.id = cp.pregunta_id
      WHERE cp.cuestionario_id = $1 ORDER BY cp.orden`,
    [req.params.id]
  );
  let listaPreguntas = preguntas.rows;
  if (cuestionario.barajar_preguntas) listaPreguntas = barajar(listaPreguntas);

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
  const intento = await query(
    `INSERT INTO univ_lms_intentos_cuestionario (cuestionario_id, estudiante_id, numero_intento, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, req.univPerfilId, previos.rows[0].n + 1, ip || null, req.headers['user-agent'] || '']
  );
  registrarEvento(req, 'inicio_examen', { entidadTipo: 'univ_ent_lms_cuestionarios', entidadId: req.params.id });

  res.status(201).json({
    intentoId: intento.rows[0].id,
    limiteTiempoMinutos: cuestionario.limite_tiempo_minutos,
    iniciadoAt: intento.rows[0].iniciado_at,
    preguntas: listaPreguntas.map((p) => sanearPreguntaParaEstudiante(p, cuestionario.barajar_opciones)),
  });
}));

// ── Registro de integridad EN VIVO (clics, cambio de pestaña, tiempo) ──
// El frontend llama esto en background, sin bloquear la UI del
// estudiante (encaja con la arquitectura de sincronización invisible de
// la sección 6): cada evento se acumula, nunca se sobreescribe.
router.post('/intentos/:id/integridad', soloEstudiante, asyncHandler(async (req, res) => {
  const { tipo, preguntaId, segundos } = req.body; // tipo: 'clic' | 'cambio_pestana' | 'tiempo_pregunta'
  if (tipo === 'clic') {
    await query(`UPDATE univ_lms_intentos_cuestionario SET clics_registrados = clics_registrados + 1 WHERE id = $1 AND estudiante_id = $2`,
      [req.params.id, req.univPerfilId]);
  } else if (tipo === 'cambio_pestana') {
    await query(`UPDATE univ_lms_intentos_cuestionario SET cambios_pestana = cambios_pestana + 1 WHERE id = $1 AND estudiante_id = $2`,
      [req.params.id, req.univPerfilId]);
  } else if (tipo === 'tiempo_pregunta' && preguntaId) {
    await query(
      `UPDATE univ_lms_intentos_cuestionario
         SET tiempo_por_pregunta = jsonb_set(tiempo_por_pregunta, $1, to_jsonb(COALESCE((tiempo_por_pregunta->>$2)::int,0) + $3::int))
       WHERE id = $4 AND estudiante_id = $5`,
      [`{${preguntaId}}`, preguntaId, segundos || 0, req.params.id, req.univPerfilId]
    );
  }
  res.status(202).json({ ok: true }); // 202: aceptado, no bloquea — igual que el resto del sync invisible
}));

// ── Enviar respuestas y cerrar el intento (calificación automática) ──
router.post('/intentos/:id/finalizar', soloEstudiante, asyncHandler(async (req, res) => {
  const { respuestas } = req.body; // [{preguntaId, respuestaDada}]
  if (!Array.isArray(respuestas)) return res.status(422).json({ error: 'Se esperaba un arreglo de respuestas.' });

  await withTransaction(async (client) => {
    const intento = await client.query(
      `SELECT i.*, c.limite_tiempo_minutos FROM univ_lms_intentos_cuestionario i
         JOIN univ_ent_lms_cuestionarios c ON c.id = i.cuestionario_id
        WHERE i.id = $1 AND i.estudiante_id = $2 FOR UPDATE`,
      [req.params.id, req.univPerfilId]
    );
    if (!intento.rows.length) { const e = new Error('Intento no encontrado.'); e.status = 404; e.expose = true; throw e; }
    const it = intento.rows[0];
    if (it.estado !== 'en_curso') { const e = new Error('Este intento ya fue finalizado.'); e.status = 409; e.expose = true; throw e; }

    // Corte por tiempo agotado: se marca "expirado" en vez de aceptar
    // respuestas fuera de plazo (el cronómetro real vive en el cliente,
    // pero el servidor es la autoridad final).
    if (it.limite_tiempo_minutos) {
      const limiteMs = it.limite_tiempo_minutos * 60 * 1000;
      if (Date.now() - new Date(it.iniciado_at).getTime() > limiteMs + 5000) { // 5s de tolerancia de red
        await client.query(`UPDATE univ_lms_intentos_cuestionario SET estado = 'expirado', finalizado_at = now() WHERE id = $1`, [req.params.id]);
        const e = new Error('El tiempo del cuestionario ya expiró.'); e.status = 409; e.expose = true; throw e;
      }
    }

    let notaTotal = 0; let puntajeMax = 0;
    for (const r of respuestas) {
      const pregunta = await client.query(
        `SELECT bp.*, cp.puntaje AS puntaje_override FROM univ_ent_lms_banco_preguntas bp
           JOIN univ_ent_lms_cuestionario_preguntas cp ON cp.pregunta_id = bp.id
          WHERE bp.id = $1 AND cp.cuestionario_id = $2`,
        [r.preguntaId, it.cuestionario_id]
      );
      if (!pregunta.rows.length) continue;
      const p = pregunta.rows[0];
      const puntaje = Number(p.puntaje_override ?? p.puntaje_defecto);
      puntajeMax += puntaje;

      let esCorrecta = null; let puntajeObtenido = 0; let calificadoManual = false;
      if (p.tipo === 'ensayo') {
        calificadoManual = true; // el docente calificará manualmente después
      } else if (p.tipo === 'verdadero_falso' || p.tipo === 'respuesta_corta') {
        esCorrecta = String(r.respuestaDada?.texto ?? r.respuestaDada ?? '').trim().toLowerCase()
                   === String(p.respuesta_correcta ?? '').trim().toLowerCase();
        puntajeObtenido = esCorrecta ? puntaje : 0;
      } else {
        // opción múltiple única/varias: compara el conjunto de ids marcados
        const correctas = (p.opciones || []).filter((o) => o.correcta).map((o) => o.id).sort();
        const marcadas = (r.respuestaDada?.opciones || r.respuestaDada || []).slice().sort();
        esCorrecta = JSON.stringify(correctas) === JSON.stringify(marcadas);
        puntajeObtenido = esCorrecta ? puntaje : 0;
      }
      if (!calificadoManual) notaTotal += puntajeObtenido;

      await client.query(
        `INSERT INTO univ_lms_respuestas_intento (intento_id, pregunta_id, respuesta_dada, es_correcta, puntaje_obtenido, calificado_manual)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (intento_id, pregunta_id) DO UPDATE SET respuesta_dada = EXCLUDED.respuesta_dada,
           es_correcta = EXCLUDED.es_correcta, puntaje_obtenido = EXCLUDED.puntaje_obtenido`,
        [req.params.id, r.preguntaId, JSON.stringify(r.respuestaDada || {}), esCorrecta, puntajeObtenido, calificadoManual]
      );
    }

    const notaSobre5 = puntajeMax > 0 ? Math.round((notaTotal / puntajeMax) * 500) / 100 : 0;
    await client.query(
      `UPDATE univ_lms_intentos_cuestionario SET estado = 'enviado', finalizado_at = now(), nota_obtenida = $1 WHERE id = $2`,
      [notaSobre5, req.params.id]
    );
    registrarEvento(req, 'envio_examen', { entidadTipo: 'univ_ent_lms_cuestionarios', entidadId: it.cuestionario_id, detalle: { intentoId: req.params.id } });
    res.json({ ok: true, notaObtenida: notaSobre5, requiereCalificacionManual: puntajeMax === 0 });
  });
}));

// Calificación manual de preguntas tipo ensayo, dentro de un intento ya enviado.
router.patch('/respuestas-intento/:id/calificar', soloDocente, asyncHandler(async (req, res) => {
  const { puntajeObtenido, retroalimentacionDocente } = req.body;
  const { rows } = await query(
    `UPDATE univ_lms_respuestas_intento SET puntaje_obtenido = $1, retroalimentacion_docente = $2
     WHERE id = $3 RETURNING *`,
    [puntajeObtenido, retroalimentacionDocente || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Respuesta no encontrada.' });
  res.json(rows[0]);
}));

export default router;
