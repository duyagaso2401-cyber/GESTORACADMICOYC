// ════════════════════════════════════════════════════════════════════════════
// MÓDULO UNIVERSIDADES / EDUCACIÓN SUPERIOR (catálogo) — Rutas API
// ------------------------------------------------------------------------------
// Lote 1: CRUD básico de universidades, sus programas y las personas
// (catedrático/planta/estudiante) vinculadas a cada programa — la base de
// datos que pide el punto 6-B de la especificación. Es un catálogo
// deliberadamente simple (a diferencia del módulo universitario Enterprise
// ya existente en src/university-lms/, que es un LMS/SIS completo con
// matrícula, notas y quizzes) — este módulo nuevo sirve para que la ETC (u
// otro administrador) lleve el registro de universidades/programas/personas
// sin necesitar que esa universidad ya use el LMS completo.
//
// TODAS las rutas están protegidas por checkModuleEnabled('UNIVERSITIES')
// — mientras el Súper Admin no active el módulo, responde 403 sin tocar
// Neon.
// ════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { db } from '../db/index.js';
import { universidadEntidades, universidadProgramas, universidadDocentesEstudiantes } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { checkModuleEnabled } from '../lib/feature-flags.js';

const router = Router();
router.use(checkModuleEnabled('UNIVERSITIES'));

// ── Universidades ─────────────────────────────────────────────────────────────

router.get('/universidades', async (_req, res) => {
  try {
    const filas = await db.select().from(universidadEntidades).orderBy(desc(universidadEntidades.id));
    return res.json({ ok: true, universidades: filas });
  } catch (e) {
    console.error('GET /api/educacion-superior/universidades', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar universidades.' });
  }
});

router.post('/universidades', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.nombreUniversidad || !String(b.nombreUniversidad).trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre de la universidad es obligatorio.' });
    }
    const [creada] = await db.insert(universidadEntidades).values({
      nombreUniversidad: String(b.nombreUniversidad).trim(),
      codigoSnies: String(b.codigoSnies || ''),
      nit: String(b.nit || ''),
      logoUrl: String(b.logoUrl || ''),
    }).returning();
    return res.json({ ok: true, universidad: creada });
  } catch (e) {
    console.error('POST /api/educacion-superior/universidades', e);
    return res.status(500).json({ ok: false, error: 'Error interno al crear la universidad.' });
  }
});

router.put('/universidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = req.body || {};
    const cambios: Record<string, any> = {};
    for (const campo of ['nombreUniversidad', 'codigoSnies', 'nit', 'logoUrl']) {
      if (typeof b[campo] === 'string' && b[campo].trim()) cambios[campo] = b[campo].trim();
    }
    if (typeof b.activo === 'boolean') cambios.activo = b.activo;
    if (!Object.keys(cambios).length) return res.status(400).json({ ok: false, error: 'No hay cambios que aplicar.' });
    const [actualizada] = await db.update(universidadEntidades).set(cambios).where(eq(universidadEntidades.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Universidad no encontrada' });
    return res.json({ ok: true, universidad: actualizada });
  } catch (e) {
    console.error('PUT /api/educacion-superior/universidades/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al actualizar la universidad.' });
  }
});

router.delete('/universidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const [actualizada] = await db.update(universidadEntidades).set({ activo: false }).where(eq(universidadEntidades.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Universidad no encontrada' });
    return res.json({ ok: true, universidad: actualizada });
  } catch (e) {
    console.error('DELETE /api/educacion-superior/universidades/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al inactivar la universidad.' });
  }
});

// ── Programas ──────────────────────────────────────────────────────────────────

router.get('/universidades/:universidadId/programas', async (req, res) => {
  try {
    const universidadId = Number(req.params.universidadId);
    if (!universidadId) return res.status(400).json({ ok: false, error: 'universidadId inválido' });
    const filas = await db.select().from(universidadProgramas).where(eq(universidadProgramas.universidadId, universidadId));
    return res.json({ ok: true, programas: filas });
  } catch (e) {
    console.error('GET /api/educacion-superior/universidades/:universidadId/programas', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar programas.' });
  }
});

router.post('/universidades/:universidadId/programas', async (req, res) => {
  try {
    const universidadId = Number(req.params.universidadId);
    if (!universidadId) return res.status(400).json({ ok: false, error: 'universidadId inválido' });
    const b = req.body || {};
    if (!b.nombrePrograma || !String(b.nombrePrograma).trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre del programa es obligatorio.' });
    }
    const universidad = await db.select().from(universidadEntidades).where(eq(universidadEntidades.id, universidadId));
    if (!universidad.length) return res.status(404).json({ ok: false, error: 'La universidad no existe.' });
    const nivelesValidos = ['Pregrado', 'Posgrado', 'Maestria'];
    const nivel = nivelesValidos.includes(b.nivel) ? b.nivel : 'Pregrado';
    const [creado] = await db.insert(universidadProgramas).values({
      universidadId,
      nombrePrograma: String(b.nombrePrograma).trim(),
      nivel,
      facultad: String(b.facultad || ''),
    }).returning();
    return res.json({ ok: true, programa: creado });
  } catch (e) {
    console.error('POST /api/educacion-superior/universidades/:universidadId/programas', e);
    return res.status(500).json({ ok: false, error: 'Error interno al crear el programa.' });
  }
});

router.put('/programas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = req.body || {};
    const nivelesValidos = ['Pregrado', 'Posgrado', 'Maestria'];
    const cambios: Record<string, any> = {};
    if (typeof b.nombrePrograma === 'string' && b.nombrePrograma.trim()) cambios.nombrePrograma = b.nombrePrograma.trim();
    if (nivelesValidos.includes(b.nivel)) cambios.nivel = b.nivel;
    if (typeof b.facultad === 'string') cambios.facultad = b.facultad;
    if (!Object.keys(cambios).length) return res.status(400).json({ ok: false, error: 'No hay cambios que aplicar.' });
    const [actualizado] = await db.update(universidadProgramas).set(cambios).where(eq(universidadProgramas.id, id)).returning();
    if (!actualizado) return res.status(404).json({ ok: false, error: 'Programa no encontrado' });
    return res.json({ ok: true, programa: actualizado });
  } catch (e) {
    console.error('PUT /api/educacion-superior/programas/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al actualizar el programa.' });
  }
});

router.delete('/programas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const eliminado = await db.delete(universidadProgramas).where(eq(universidadProgramas.id, id)).returning();
    if (!eliminado.length) return res.status(404).json({ ok: false, error: 'Programa no encontrado' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/educacion-superior/programas/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al eliminar el programa.' });
  }
});

// ── Personas (catedrático/planta/estudiante) vinculadas a un programa ────────

router.get('/programas/:programaId/personas', async (req, res) => {
  try {
    const programaId = Number(req.params.programaId);
    if (!programaId) return res.status(400).json({ ok: false, error: 'programaId inválido' });
    const filas = await db.select().from(universidadDocentesEstudiantes).where(eq(universidadDocentesEstudiantes.programaId, programaId));
    return res.json({ ok: true, personas: filas });
  } catch (e) {
    console.error('GET /api/educacion-superior/programas/:programaId/personas', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar personas del programa.' });
  }
});

router.post('/programas/:programaId/personas', async (req, res) => {
  try {
    const programaId = Number(req.params.programaId);
    if (!programaId) return res.status(400).json({ ok: false, error: 'programaId inválido' });
    const b = req.body || {};
    if (!b.personaCedula || !String(b.personaCedula).trim()) {
      return res.status(400).json({ ok: false, error: 'La cédula de la persona es obligatoria.' });
    }
    const programa = await db.select().from(universidadProgramas).where(eq(universidadProgramas.id, programaId));
    if (!programa.length) return res.status(404).json({ ok: false, error: 'El programa no existe.' });
    const rolesValidos = ['Catedratico', 'Planta', 'Estudiante'];
    const tipoRol = rolesValidos.includes(b.tipoRol) ? b.tipoRol : 'Estudiante';
    const [creada] = await db.insert(universidadDocentesEstudiantes).values({
      programaId,
      personaCedula: String(b.personaCedula).trim(),
      tipoRol,
      datosAdicionales: b.datosAdicionales && typeof b.datosAdicionales === 'object' ? b.datosAdicionales : {},
    }).returning();
    return res.json({ ok: true, persona: creada });
  } catch (e) {
    console.error('POST /api/educacion-superior/programas/:programaId/personas', e);
    return res.status(500).json({ ok: false, error: 'Error interno al vincular la persona.' });
  }
});

router.put('/personas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = req.body || {};
    const rolesValidos = ['Catedratico', 'Planta', 'Estudiante'];
    const cambios: Record<string, any> = {};
    if (typeof b.personaCedula === 'string' && b.personaCedula.trim()) cambios.personaCedula = b.personaCedula.trim();
    if (rolesValidos.includes(b.tipoRol)) cambios.tipoRol = b.tipoRol;
    if (b.datosAdicionales && typeof b.datosAdicionales === 'object') cambios.datosAdicionales = b.datosAdicionales;
    if (!Object.keys(cambios).length) return res.status(400).json({ ok: false, error: 'No hay cambios que aplicar.' });
    const [actualizada] = await db.update(universidadDocentesEstudiantes).set(cambios).where(eq(universidadDocentesEstudiantes.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Persona no encontrada' });
    return res.json({ ok: true, persona: actualizada });
  } catch (e) {
    console.error('PUT /api/educacion-superior/personas/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al actualizar la persona.' });
  }
});

router.delete('/personas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const eliminada = await db.delete(universidadDocentesEstudiantes).where(eq(universidadDocentesEstudiantes.id, id)).returning();
    if (!eliminada.length) return res.status(404).json({ ok: false, error: 'Persona no encontrada' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/educacion-superior/personas/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al desvincular la persona.' });
  }
});

export { router as educacionSuperiorRouter };
export default router;
