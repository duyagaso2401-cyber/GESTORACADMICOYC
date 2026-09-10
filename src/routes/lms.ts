// ============================================================
// MÓDULO EDUCACIÓN SUPERIOR / LMS (Aula Virtual) — Rutas API
// ------------------------------------------------------------------
// A diferencia del resto del sistema (que guarda los datos de cada
// institución como un bloque JSON en "kv_store"), este módulo usa
// tablas relacionales propias (ver src/db/schema.ts) para el
// contenido del curso — pero SÍ necesita leer/escribir el bloque
// JSON de la institución en dos casos puntuales:
//   1) Para verificar que un estudiante realmente está matriculado
//      en el grupo antes de dejarlo entregar una actividad.
//   2) Para que, al calificar una entrega, la nota quede reflejada
//      también en el libro de calificaciones principal (Planilla),
//      no solo en la tabla de entregas del LMS.
// ============================================================
import { Router } from 'express';
import { db } from '../db/index.js';
import { kvStore, lmsPlanesEstudio, lmsAsignaturasUniversidad, lmsAulasVirtuales, lmsUnidades, lmsRecursos, lmsActividades, lmsEntregas } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';

const router = Router();

// ── Auxiliares ──────────────────────────────────────────────────────────────

/** Lee el bloque JSON completo de una institución desde kv_store. */
async function leerInstitucion(sk: string): Promise<any | null> {
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
  return rows.length ? (rows[0].value as any) : null;
}

/** Verifica que un estudiante esté matriculado en el grado que corresponde
 * a esa aula (comparando contra "carga" y "ests" dentro del bloque JSON de
 * la institución) antes de dejarlo entregar una actividad. Devuelve un
 * mensaje de error como string si NO puede, o null si sí puede. */
async function verificarMatricula(sk: string, grupoAsignaturaId: string, estudianteId: string): Promise<string | null> {
  const inst = await leerInstitucion(sk);
  if (!inst) return 'Institución no encontrada.';
  const carga = (inst.carga || []).find((c: any) => String(c.id) === String(grupoAsignaturaId));
  if (!carga) return 'El grupo/asignatura de esta aula ya no existe en la institución.';
  const est = (inst.ests || []).find((e: any) => String(e.id) === String(estudianteId));
  if (!est) return 'Estudiante no encontrado en la institución.';
  if (est.g !== carga.g) return 'El estudiante no está matriculado en el grupo de esta aula virtual.';
  return null;
}

/** Alimenta el libro de calificaciones principal (el mismo que usa
 * Planilla) cuando se califica una entrega del LMS — para que la nota no
 * quede aislada solo en el LMS. Se guarda como una nota más dentro de
 * "ests[].nts[cargaId][periodo]", en el componente "h" (Hacer), igual que
 * cualquier otra nota de actividad. Silencioso ante errores: si algo no
 * cuadra (el grupo ya no existe, etc.), la calificación en el LMS igual
 * queda guardada — esto es un beneficio adicional, no debe bloquear la
 * calificación en sí.
 */
async function alimentarLibroCalificaciones(sk: string, grupoAsignaturaId: string, estudianteId: string, periodo: string, nota: number): Promise<boolean> {
  try {
    const inst = await leerInstitucion(sk);
    if (!inst) return false;
    const idx = (inst.ests || []).findIndex((e: any) => String(e.id) === String(estudianteId));
    if (idx === -1) return false;
    const per = periodo || '1';
    if (!inst.ests[idx].nts) inst.ests[idx].nts = {};
    if (!inst.ests[idx].nts[grupoAsignaturaId]) inst.ests[idx].nts[grupoAsignaturaId] = {};
    if (!inst.ests[idx].nts[grupoAsignaturaId][per]) inst.ests[idx].nts[grupoAsignaturaId][per] = {};
    inst.ests[idx].nts[grupoAsignaturaId][per].h = nota; // componente "Hacer" — coherente con una entrega/tarea calificada
    await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
    return true;
  } catch (err) {
    console.warn('⚠️  No se pudo alimentar el libro de calificaciones principal desde el LMS:', err);
    return false;
  }
}

// ── GET /api/lms/aula/:grupoId — estructura completa del aula ───────────────
// Si el aula todavía no existe para ese grupo, se crea automáticamente (el
// docente que la pide ya demostró que quiere usarla) — así el catedrático
// no tiene que "crear el aula" como paso aparte antes de empezar a usarla.
router.get('/aula/:grupoId', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    const catedraticoU = String(req.query.catedraticoU || '');
    const grupoId = req.params.grupoId;
    if (!sk || !grupoId) return res.status(400).json({ error: 'Faltan parámetros (sk, grupoId).' });

    let aulas = await db.select().from(lmsAulasVirtuales).where(and(eq(lmsAulasVirtuales.sk, sk), eq(lmsAulasVirtuales.grupoAsignaturaId, grupoId)));
    let aula = aulas[0];
    if (!aula) {
      const creadas = await db.insert(lmsAulasVirtuales).values({ sk, grupoAsignaturaId: grupoId, catedraticoU: catedraticoU || '', estado: 'activa', linkClaseVivo: '' }).returning();
      aula = creadas[0];
    }

    const unidades = await db.select().from(lmsUnidades).where(eq(lmsUnidades.aulaId, aula.id)).orderBy(asc(lmsUnidades.orden));
    const unidadesConContenido = await Promise.all(unidades.map(async (u) => {
      const [recursos, actividades] = await Promise.all([
        db.select().from(lmsRecursos).where(eq(lmsRecursos.unidadId, u.id)).orderBy(asc(lmsRecursos.orden)),
        db.select().from(lmsActividades).where(eq(lmsActividades.unidadId, u.id)),
      ]);
      return { ...u, recursos, actividades };
    }));

    return res.json({ aula, unidades: unidadesConContenido });
  } catch (err) {
    console.error('GET /api/lms/aula/:grupoId error:', err);
    return res.status(500).json({ error: 'Error interno consultando el aula virtual.' });
  }
});

// ── PUT /api/lms/aula/:id — actualizar link de clase en vivo / estado ───────
router.put('/aula/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { linkClaseVivo, estado } = req.body || {};
    const cambios: any = {};
    if (typeof linkClaseVivo === 'string') cambios.linkClaseVivo = linkClaseVivo;
    if (typeof estado === 'string') cambios.estado = estado;
    if (!Object.keys(cambios).length) return res.status(400).json({ error: 'Nada para actualizar.' });
    const actualizadas = await db.update(lmsAulasVirtuales).set(cambios).where(eq(lmsAulasVirtuales.id, id)).returning();
    if (!actualizadas.length) return res.status(404).json({ error: 'Aula no encontrada.' });
    return res.json({ aula: actualizadas[0] });
  } catch (err) {
    console.error('PUT /api/lms/aula/:id error:', err);
    return res.status(500).json({ error: 'Error interno actualizando el aula.' });
  }
});

// ── POST /api/lms/unidades — crear O reordenar unidades ─────────────────────
// Crear: { aulaId, titulo, descripcion, visible }
// Reordenar: { reordenar: [{id, orden}, ...] }
router.post('/unidades', async (req, res) => {
  try {
    const { aulaId, titulo, descripcion, visible, reordenar } = req.body || {};
    if (Array.isArray(reordenar)) {
      await Promise.all(reordenar.map((it: any) => db.update(lmsUnidades).set({ orden: Number(it.orden) || 0 }).where(eq(lmsUnidades.id, Number(it.id)))));
      return res.json({ ok: true, reordenadas: reordenar.length });
    }
    if (!aulaId || !titulo) return res.status(400).json({ error: 'Faltan aulaId o titulo.' });
    const existentes = await db.select().from(lmsUnidades).where(eq(lmsUnidades.aulaId, Number(aulaId)));
    const creadas = await db.insert(lmsUnidades).values({
      aulaId: Number(aulaId), titulo, descripcion: descripcion || '', orden: existentes.length, visible: visible !== false,
    }).returning();
    return res.json({ unidad: creadas[0] });
  } catch (err) {
    console.error('POST /api/lms/unidades error:', err);
    return res.status(500).json({ error: 'Error interno guardando la unidad.' });
  }
});

// ── PUT /api/lms/unidades/:id — editar o eliminar (papelera lógica simple) ──
router.put('/unidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { titulo, descripcion, visible } = req.body || {};
    const cambios: any = {};
    if (typeof titulo === 'string') cambios.titulo = titulo;
    if (typeof descripcion === 'string') cambios.descripcion = descripcion;
    if (typeof visible === 'boolean') cambios.visible = visible;
    const actualizadas = await db.update(lmsUnidades).set(cambios).where(eq(lmsUnidades.id, id)).returning();
    if (!actualizadas.length) return res.status(404).json({ error: 'Unidad no encontrada.' });
    return res.json({ unidad: actualizadas[0] });
  } catch (err) {
    console.error('PUT /api/lms/unidades/:id error:', err);
    return res.status(500).json({ error: 'Error interno actualizando la unidad.' });
  }
});
router.delete('/unidades/:id', async (req, res) => {
  try {
    // Al borrar una unidad, sus recursos/actividades/entregas se borran en
    // cascada (así quedó definido en el esquema de la base de datos).
    await db.delete(lmsUnidades).where(eq(lmsUnidades.id, Number(req.params.id)));
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/lms/unidades/:id error:', err);
    return res.status(500).json({ error: 'Error interno eliminando la unidad.' });
  }
});

// ── POST /api/lms/recursos — material de apoyo (ya subido a Cloudinary) ─────
router.post('/recursos', async (req, res) => {
  try {
    const { unidadId, titulo, tipo, urlCloudinary, contenidoHtml } = req.body || {};
    if (!unidadId || !titulo || !tipo) return res.status(400).json({ error: 'Faltan unidadId, titulo o tipo.' });
    if (!['DOCUMENTO', 'VIDEO_EMBED', 'ENLACE_EXTERNO', 'TEXTO_HTML'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de recurso inválido.' });
    }
    const existentes = await db.select().from(lmsRecursos).where(eq(lmsRecursos.unidadId, Number(unidadId)));
    const creados = await db.insert(lmsRecursos).values({
      unidadId: Number(unidadId), titulo, tipo, urlCloudinary: urlCloudinary || '', contenidoHtml: contenidoHtml || '', orden: existentes.length,
    }).returning();
    return res.json({ recurso: creados[0] });
  } catch (err) {
    console.error('POST /api/lms/recursos error:', err);
    return res.status(500).json({ error: 'Error interno guardando el recurso.' });
  }
});
router.delete('/recursos/:id', async (req, res) => {
  try {
    await db.delete(lmsRecursos).where(eq(lmsRecursos.id, Number(req.params.id)));
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/lms/recursos/:id error:', err);
    return res.status(500).json({ error: 'Error interno eliminando el recurso.' });
  }
});

// ── POST /api/lms/actividades — tareas, foros o quizzes ──────────────────────
router.post('/actividades', async (req, res) => {
  try {
    const { unidadId, titulo, instruccion, tipo, fechaApertura, fechaCierre, porcentajeCorte, maxCalificacion } = req.body || {};
    if (!unidadId || !titulo || !tipo) return res.status(400).json({ error: 'Faltan unidadId, titulo o tipo.' });
    if (!['TAREA', 'FORO', 'QUIZ'].includes(tipo)) return res.status(400).json({ error: 'Tipo de actividad inválido.' });
    const creadas = await db.insert(lmsActividades).values({
      unidadId: Number(unidadId), titulo, instruccion: instruccion || '', tipo,
      fechaApertura: fechaApertura ? new Date(fechaApertura) : null,
      fechaCierre: fechaCierre ? new Date(fechaCierre) : null,
      porcentajeCorte: porcentajeCorte || '', maxCalificacion: maxCalificacion || '5.0',
    }).returning();
    return res.json({ actividad: creadas[0] });
  } catch (err) {
    console.error('POST /api/lms/actividades error:', err);
    return res.status(500).json({ error: 'Error interno guardando la actividad.' });
  }
});
router.put('/actividades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { titulo, instruccion, fechaApertura, fechaCierre, porcentajeCorte, maxCalificacion } = req.body || {};
    const cambios: any = {};
    if (typeof titulo === 'string') cambios.titulo = titulo;
    if (typeof instruccion === 'string') cambios.instruccion = instruccion;
    if (fechaApertura !== undefined) cambios.fechaApertura = fechaApertura ? new Date(fechaApertura) : null;
    if (fechaCierre !== undefined) cambios.fechaCierre = fechaCierre ? new Date(fechaCierre) : null;
    if (typeof porcentajeCorte === 'string') cambios.porcentajeCorte = porcentajeCorte;
    if (typeof maxCalificacion === 'string') cambios.maxCalificacion = maxCalificacion;
    const actualizadas = await db.update(lmsActividades).set(cambios).where(eq(lmsActividades.id, id)).returning();
    if (!actualizadas.length) return res.status(404).json({ error: 'Actividad no encontrada.' });
    return res.json({ actividad: actualizadas[0] });
  } catch (err) {
    console.error('PUT /api/lms/actividades/:id error:', err);
    return res.status(500).json({ error: 'Error interno actualizando la actividad.' });
  }
});
router.delete('/actividades/:id', async (req, res) => {
  try {
    await db.delete(lmsActividades).where(eq(lmsActividades.id, Number(req.params.id)));
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/lms/actividades/:id error:', err);
    return res.status(500).json({ error: 'Error interno eliminando la actividad.' });
  }
});

// ── POST /api/lms/entregas — el estudiante sube/responde una actividad ──────
// CONTROL DE ACCESO: se verifica que el estudiante esté matriculado en el
// grupo de esa aula ANTES de guardar la entrega — así ningún estudiante
// puede entregarle una tarea a un curso que no le corresponde.
router.post('/entregas', async (req, res) => {
  try {
    const { actividadId, estudianteId, archivoUrlCloudinary, textoEntrega, sk } = req.body || {};
    if (!actividadId || !estudianteId || !sk) return res.status(400).json({ error: 'Faltan actividadId, estudianteId o sk.' });
    if (!archivoUrlCloudinary && !textoEntrega) return res.status(400).json({ error: 'Debe adjuntar un archivo o escribir una respuesta.' });

    const actividades = await db.select().from(lmsActividades).where(eq(lmsActividades.id, Number(actividadId)));
    const actividad = actividades[0];
    if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada.' });
    const unidades = await db.select().from(lmsUnidades).where(eq(lmsUnidades.id, actividad.unidadId));
    const unidad = unidades[0];
    if (!unidad) return res.status(404).json({ error: 'Unidad de la actividad no encontrada.' });
    const aulas = await db.select().from(lmsAulasVirtuales).where(eq(lmsAulasVirtuales.id, unidad.aulaId));
    const aula = aulas[0];
    if (!aula) return res.status(404).json({ error: 'Aula de la actividad no encontrada.' });
    if (aula.sk !== sk) return res.status(403).json({ error: 'Esta actividad no pertenece a la institución indicada.' });

    const errorMatricula = await verificarMatricula(sk, aula.grupoAsignaturaId, String(estudianteId));
    if (errorMatricula) return res.status(403).json({ error: errorMatricula });

    const ahora = new Date();
    const estado = (actividad.fechaCierre && ahora > new Date(actividad.fechaCierre)) ? 'ATRASADO' : 'ENVIADO';

    // Si el estudiante ya había entregado antes, se actualiza esa misma
    // entrega en vez de crear una duplicada (permite corregir/reenviar
    // mientras la actividad siga abierta).
    const previas = await db.select().from(lmsEntregas).where(and(eq(lmsEntregas.actividadId, Number(actividadId)), eq(lmsEntregas.estudianteId, String(estudianteId))));
    let entrega;
    if (previas.length) {
      const actualizadas = await db.update(lmsEntregas).set({
        archivoUrlCloudinary: archivoUrlCloudinary || '', textoEntrega: textoEntrega || '', fechaEnvio: ahora, estado,
      }).where(eq(lmsEntregas.id, previas[0].id)).returning();
      entrega = actualizadas[0];
    } else {
      const creadas = await db.insert(lmsEntregas).values({
        actividadId: Number(actividadId), estudianteId: String(estudianteId),
        archivoUrlCloudinary: archivoUrlCloudinary || '', textoEntrega: textoEntrega || '', estado,
      }).returning();
      entrega = creadas[0];
    }
    return res.json({ entrega });
  } catch (err) {
    console.error('POST /api/lms/entregas error:', err);
    return res.status(500).json({ error: 'Error interno guardando la entrega.' });
  }
});

// ── GET /api/lms/entregas/:actividadId — listado para el catedrático ────────
router.get('/entregas/:actividadId', async (req, res) => {
  try {
    const entregas = await db.select().from(lmsEntregas).where(eq(lmsEntregas.actividadId, Number(req.params.actividadId)));
    return res.json({ entregas });
  } catch (err) {
    console.error('GET /api/lms/entregas/:actividadId error:', err);
    return res.status(500).json({ error: 'Error interno consultando las entregas.' });
  }
});

// ── GET /api/lms/mis-entregas — para el estudiante: sus propias entregas ────
// (útil para pintar la barra de progreso y la línea de tiempo del LMS
// estudiantil sin tener que consultar cada actividad una por una)
router.get('/mis-entregas', async (req, res) => {
  try {
    const estudianteId = String(req.query.estudianteId || '');
    if (!estudianteId) return res.status(400).json({ error: 'Falta estudianteId.' });
    const entregas = await db.select().from(lmsEntregas).where(eq(lmsEntregas.estudianteId, estudianteId));
    return res.json({ entregas });
  } catch (err) {
    console.error('GET /api/lms/mis-entregas error:', err);
    return res.status(500).json({ error: 'Error interno consultando sus entregas.' });
  }
});

// ── PUT /api/lms/entregas/:id/calificar — el catedrático asigna nota ────────
// Además de guardar la nota en la propia entrega del LMS, esta nota
// ALIMENTA DIRECTAMENTE el libro de calificaciones principal (Planilla) —
// tal como se pidió — para que el docente no tenga que copiarla a mano.
router.put('/entregas/:id/calificar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nota, retroalimentacion, sk } = req.body || {};
    if (nota === undefined || nota === null || nota === '') return res.status(400).json({ error: 'Falta la nota.' });
    const notaNum = Number(nota);
    if (isNaN(notaNum) || notaNum < 0 || notaNum > 5) return res.status(400).json({ error: 'La nota debe estar entre 0.0 y 5.0.' });

    const entregasActuales = await db.select().from(lmsEntregas).where(eq(lmsEntregas.id, id));
    const entregaActual = entregasActuales[0];
    if (!entregaActual) return res.status(404).json({ error: 'Entrega no encontrada.' });

    const actualizadas = await db.update(lmsEntregas).set({
      nota: String(notaNum), retroalimentacion: retroalimentacion || '', estado: 'CALIFICADO',
    }).where(eq(lmsEntregas.id, id)).returning();

    // Alimentar el libro de calificaciones principal — best-effort, no
    // bloquea la respuesta si algo no cuadra (institución no encontrada,
    // grupo eliminado, etc.); la calificación en el LMS ya quedó guardada
    // de todas formas.
    let alimentado = false;
    if (sk) {
      const actividades = await db.select().from(lmsActividades).where(eq(lmsActividades.id, entregaActual.actividadId));
      const actividad = actividades[0];
      if (actividad) {
        const unidades = await db.select().from(lmsUnidades).where(eq(lmsUnidades.id, actividad.unidadId));
        const unidad = unidades[0];
        if (unidad) {
          const aulas = await db.select().from(lmsAulasVirtuales).where(eq(lmsAulasVirtuales.id, unidad.aulaId));
          const aula = aulas[0];
          if (aula && aula.sk === sk) {
            alimentado = await alimentarLibroCalificaciones(sk, aula.grupoAsignaturaId, entregaActual.estudianteId, actividad.porcentajeCorte || '1', notaNum);
          }
        }
      }
    }

    return res.json({ entrega: actualizadas[0], alimentadoEnPlanilla: alimentado });
  } catch (err) {
    console.error('PUT /api/lms/entregas/:id/calificar error:', err);
    return res.status(500).json({ error: 'Error interno calificando la entrega.' });
  }
});

// ── Plan de estudios / asignaturas universitarias (créditos, prerrequisitos) ─
router.get('/planes-estudio', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ error: 'Falta sk.' });
    const planes = await db.select().from(lmsPlanesEstudio).where(eq(lmsPlanesEstudio.sk, sk));
    return res.json({ planes });
  } catch (err) {
    console.error('GET /api/lms/planes-estudio error:', err);
    return res.status(500).json({ error: 'Error interno consultando los planes de estudio.' });
  }
});
router.post('/planes-estudio', async (req, res) => {
  try {
    const { sk, nombreCarrera, totalCreditos } = req.body || {};
    if (!sk || !nombreCarrera) return res.status(400).json({ error: 'Faltan sk o nombreCarrera.' });
    const creados = await db.insert(lmsPlanesEstudio).values({ sk, nombreCarrera, totalCreditos: Number(totalCreditos) || 0 }).returning();
    return res.json({ plan: creados[0] });
  } catch (err) {
    console.error('POST /api/lms/planes-estudio error:', err);
    return res.status(500).json({ error: 'Error interno guardando el plan de estudio.' });
  }
});
router.get('/asignaturas-universidad', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ error: 'Falta sk.' });
    const asignaturas = await db.select().from(lmsAsignaturasUniversidad).where(eq(lmsAsignaturasUniversidad.sk, sk));
    return res.json({ asignaturas });
  } catch (err) {
    console.error('GET /api/lms/asignaturas-universidad error:', err);
    return res.status(500).json({ error: 'Error interno consultando las asignaturas.' });
  }
});
router.post('/asignaturas-universidad', async (req, res) => {
  try {
    const { sk, planEstudioId, codigoMateria, nombre, creditos, horasPresenciales, horasIndependientes, semestre, prerrequisitoId } = req.body || {};
    if (!sk || !codigoMateria || !nombre) return res.status(400).json({ error: 'Faltan sk, codigoMateria o nombre.' });
    const creadas = await db.insert(lmsAsignaturasUniversidad).values({
      sk, planEstudioId: planEstudioId ? Number(planEstudioId) : null, codigoMateria, nombre,
      creditos: Number(creditos) || 0, horasPresenciales: Number(horasPresenciales) || 0, horasIndependientes: Number(horasIndependientes) || 0,
      semestre: Number(semestre) || 1, prerrequisitoId: prerrequisitoId ? Number(prerrequisitoId) : null,
    }).returning();
    return res.json({ asignatura: creadas[0] });
  } catch (err) {
    console.error('POST /api/lms/asignaturas-universidad error:', err);
    return res.status(500).json({ error: 'Error interno guardando la asignatura.' });
  }
});

export default router;
