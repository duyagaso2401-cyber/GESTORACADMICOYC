// ============================================================
// MÓDULO REPOSITORIO — Rutas API
// Integración directa con Neon DB (Gestor Académico YC)
// ============================================================

import { Router } from 'express';
import { db } from '../db/index.js';
import { repositorioResources, repositorioUsers, repositorioStats, repositorioConfig, repositorioAreas, repositorioGrados, repositorioTipos, kvStore } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

const GESTOR_SK = '__gestor_academico_yc__';

const router = Router();

/** Lee institucion_id de forma flexible desde query param */
function getInst(req: any): string {
  const inst = (
    req.query.inst || 
    req.query._inst || 
    req.query._repoInst || 
    req.query.institucionId || 
    req.query.instucionId || 
    'default'
  ).toString().trim();
  return inst || 'default';
}

/** Tipos de recurso predeterminados si la DB está vacía */
const DEFAULT_TIPOS = [
  'Guía de Aprendizaje',
  'Taller / Ejercicios',
  'Evaluación / Examen',
  'Presentación / Diapositivas',
  'Libro / Documento PDF',
  'Enlace / Video Educativo',
  'Plan de Área / Asignatura'
];

/** Auxiliar para extraer asignaturas y grados reales guardados en el kvStore de Neon */
async function getDatosRealesDesdeNeon(inst: string) {
  try {
    const gestorRows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorData = gestorRows[0]?.value as any;

    let platSK = '';
    let nombreInst = '';
    let escudoInst = '';

    if (gestorData?.platforms && Array.isArray(gestorData.platforms)) {
      // Búsqueda flexible por id, sk o coincidencia de texto
      const plat = gestorData.platforms.find((p: any) => 
        p.id === inst || 
        p.sk === inst || 
        (p.id && inst.includes(p.id)) || 
        (p.sk && inst.includes(p.sk)) ||
        (p.nombre && p.nombre.toLowerCase().includes(inst.toLowerCase()))
      ) || gestorData.platforms[0]; // Fallback a la primera plataforma registrada

      if (plat) {
        platSK = plat.sk || plat.id || '';
        nombreInst = plat.nombre || '';
        escudoInst = plat.escudo || plat.logo || '';
      }
    }

    const targetKey = platSK || inst;
    const platRows = await db.select().from(kvStore).where(eq(kvStore.key, targetKey));
    const platData = platRows[0]?.value as any;

    let grados: string[] = [];
    let asignaturas: string[] = [];

    if (platData) {
      const gradosArr = (platData.grados || []) as any[];
      grados = [...new Set(
        gradosArr.map((g: any) => (typeof g === 'string' ? g : g.n || g.id || g.nombre || '')).filter(Boolean)
      )] as string[];

      const cargaArr = (platData.carga || platData.asignaturas || platData.materias || []) as any[];
      asignaturas = [...new Set(
        cargaArr.map((c: any) => (typeof c === 'string' ? c : c.m || c.a || c.nombre || '')).filter(Boolean)
      )] as string[];
    }

    // FALLBACKS DE SEGURIDAD (Suministra opciones por defecto si Neon DB aún no las ha generado)
    if (!grados.length) {
      grados = ['Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo', 'Undécimo'];
    }
    if (!asignaturas.length) {
      asignaturas = ['Informática', 'Matemáticas', 'Lengua Castellana', 'Ciencias Naturales', 'Ciencias Sociales', 'Inglés'];
    }

    return { grados, asignaturas, nombreInst, escudoInst };
  } catch (e) {
    console.error('Error leyendo kvStore de Neon:', e);
    return { 
      grados: ['Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo', 'Undécimo'], 
      asignaturas: ['Informática', 'Matemáticas', 'Lengua Castellana', 'Ciencias Naturales', 'Ciencias Sociales', 'Inglés'], 
      nombreInst: '', 
      escudoInst: '' 
    };
  }
}

// ============================================================
// LOGIN
// ============================================================
router.post('/login', async (req, res) => {
  const inst = getInst(req);
  const { userIn, passIn, selectedRole } = req.body;
  try {
    const users = await db.select().from(repositorioUsers).where(
      and(
        eq(repositorioUsers.institucionId, inst),
        eq(repositorioUsers.username, userIn),
        eq(repositorioUsers.pass, passIn),
        eq(repositorioUsers.role, selectedRole)
      )
    );

    if (users.length > 0) {
      const user = users[0];
      const now = new Date();
      const logEntry = {
        user: user.fullname,
        role: user.role,
        action: 'Ingresó a la plataforma',
        timestamp: now.toLocaleDateString('es-CO') + ' ' + now.toLocaleTimeString('es-CO'),
      };
      await db.execute(sql`
        INSERT INTO repositorio_stats (institucion_id, views, downloads, logs)
        VALUES (${inst}, 1, 0, ${JSON.stringify([logEntry])}::jsonb)
        ON CONFLICT (institucion_id) DO UPDATE SET
          views = repositorio_stats.views + 1,
          logs  = ${JSON.stringify([logEntry])}::jsonb || repositorio_stats.logs
      `);
      return res.json({ success: true, user });
    }
    return res.json({ success: false });
  } catch (e: any) {
    console.error('POST /repositorio/login', e);
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// USUARIOS
// ============================================================
router.get('/users', async (req, res) => {
  const inst = getInst(req);
  try {
    const users = await db.select().from(repositorioUsers).where(eq(repositorioUsers.institucionId, inst));
    return res.json(users.filter(u => u.username !== 'admin'));
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/users', async (req, res) => {
  const inst = getInst(req);
  const { user, name, role, pass } = req.body;
  try {
    const result = await db.insert(repositorioUsers)
      .values({ institucionId: inst, username: user, fullname: name, role, pass })
      .returning({ id: repositorioUsers.id });
    return res.json({ success: true, id: result[0].id });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put('/users/:username', async (req, res) => {
  const inst = getInst(req);
  const { fullname, pass, newUsername, role } = req.body;
  try {
    await db.update(repositorioUsers).set({
      ...(fullname    && { fullname }),
      ...(pass        && { pass }),
      ...(newUsername && { username: newUsername }),
      ...(role        && { role }),
    }).where(and(eq(repositorioUsers.institucionId, inst), eq(repositorioUsers.username, req.params.username)));
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete('/users/:username', async (req, res) => {
  const inst = getInst(req);
  try {
    await db.delete(repositorioUsers).where(
      and(eq(repositorioUsers.institucionId, inst), eq(repositorioUsers.username, req.params.username))
    );
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// RECURSOS
// ============================================================
router.get('/resources', async (req, res) => {
  const inst = getInst(req);
  try {
    const items = await db.select().from(repositorioResources).where(eq(repositorioResources.institucionId, inst));
    return res.json(items);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/resources', async (req, res) => {
  const inst = getInst(req);
  const { title, author, level, skill, metadata, type, desc, link, fileData, fileName, uploader } = req.body;
  try {
    const result = await db.insert(repositorioResources).values({
      institucionId: inst,
      title,
      author,
      level:       level       || 'General',
      skill:       skill       || '',
      metadata:    metadata    || 'Ninguno',
      type:        type        || '',
      description: desc        || '',
      uploader:    uploader    || '',
      link:        link        || null,
      fileData:    fileData    || null,
      fileName:    fileName    || null,
    }).returning({ id: repositorioResources.id });
    return res.json({ success: true, id: result[0].id });
  } catch (e: any) {
    console.error('POST /repositorio/resources', e);
    return res.status(500).json({ error: e.message });
  }
});

router.put('/resources/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  const { title, author, level, skill, metadata, type, desc, link, fileData, fileName } = req.body;
  try {
    await db.update(repositorioResources).set({
      title,
      author,
      level,
      skill,
      metadata,
      type,
      description: desc,
      link:     link     || null,
      ...(fileData ? { fileData, fileName } : {}),
    }).where(and(eq(repositorioResources.id, id), eq(repositorioResources.institucionId, inst)));
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete('/resources/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  try {
    await db.delete(repositorioResources).where(
      and(eq(repositorioResources.id, id), eq(repositorioResources.institucionId, inst))
    );
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/resources/:id/rate', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  const { rating } = req.body;
  try {
    await db.execute(sql`
      UPDATE repositorio_resources
      SET rating_sum = rating_sum + ${rating}, rating_count = rating_count + 1
      WHERE id = ${id} AND institucion_id = ${inst}
    `);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/resources/:id/comment', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  const { user, text, date } = req.body;
  try {
    await db.execute(sql`
      UPDATE repositorio_resources
      SET comments = comments || ${JSON.stringify([{ user, text, date }])}::jsonb
      WHERE id = ${id} AND institucion_id = ${inst}
    `);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/resources/:id/download', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  try {
    await db.execute(sql`
      UPDATE repositorio_resources SET downloads_count = downloads_count + 1
      WHERE id = ${id} AND institucion_id = ${inst}
    `);
    await db.execute(sql`
      INSERT INTO repositorio_stats (institucion_id, views, downloads, logs)
      VALUES (${inst}, 0, 1, '[]'::jsonb)
      ON CONFLICT (institucion_id) DO UPDATE SET downloads = repositorio_stats.downloads + 1
    `);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ESTADÍSTICAS & CONFIGURACIÓN
// ============================================================
router.get('/stats', async (req, res) => {
  const inst = getInst(req);
  try {
    const rows = await db.select().from(repositorioStats).where(eq(repositorioStats.institucionId, inst));
    return res.json(rows[0] ?? { views: 0, downloads: 0, logs: [] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/config', async (req, res) => {
  const inst = getInst(req);
  try {
    let rows = await db.select().from(repositorioConfig).where(eq(repositorioConfig.institucionId, inst));
    if (!rows[0] || !rows[0].name) {
      const { nombreInst, escudoInst } = await getDatosRealesDesdeNeon(inst);
      if (nombreInst) {
        return res.json({ name: nombreInst, logo: escudoInst });
      }
    }
    return res.json(rows[0] ?? { name: '', logo: '' });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/inst-context', async (req, res) => {
  const inst = getInst(req);
  try {
    const { grados, asignaturas, nombreInst, escudoInst } = await getDatosRealesDesdeNeon(inst);

    let rowsConfig = await db.select().from(repositorioConfig).where(eq(repositorioConfig.institucionId, inst));
    const nombre = rowsConfig[0]?.name || nombreInst || 'Institución Educativa';
    const escudo = rowsConfig[0]?.logo || escudoInst || '';

    return res.json({ nombre, escudo, grados, asignaturas });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/seed-areas-grados', async (req, res) => {
  const inst = getInst(req);
  const { asignaturas = [], grados = [] } = req.body as { asignaturas: string[]; grados: string[]; };
  try {
    const [existAreas, existGrados] = await Promise.all([
      db.select({ id: repositorioAreas.id }).from(repositorioAreas).where(eq(repositorioAreas.institucionId, inst)),
      db.select({ id: repositorioGrados.id }).from(repositorioGrados).where(eq(repositorioGrados.institucionId, inst)),
    ]);

    let addedAreas = 0;
    let addedGrados = 0;

    if (!existAreas.length && asignaturas.length) {
      for (const nombre of asignaturas) {
        if (nombre?.trim()) {
          await db.insert(repositorioAreas).values({ institucionId: inst, nombre: nombre.trim() }).onConflictDoNothing();
          addedAreas++;
        }
      }
    }

    if (!existGrados.length && grados.length) {
      for (const nombre of grados) {
        if (nombre?.trim()) {
          await db.insert(repositorioGrados).values({ institucionId: inst, nombre: nombre.trim() }).onConflictDoNothing();
          addedGrados++;
        }
      }
    }

    return res.json({ success: true, addedAreas, addedGrados });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/config', async (req, res) => {
  const inst = getInst(req);
  const { name, logo } = req.body;
  try {
    await db.execute(sql`
      INSERT INTO repositorio_config (institucion_id, name, logo)
      VALUES (${inst}, ${name}, ${logo || ''})
      ON CONFLICT (institucion_id) DO UPDATE SET name = ${name}, logo = ${logo || ''}
    `);
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ÁREAS (Consultadas directamente de Neon con Fallback)
// ============================================================
router.get('/areas', async (req, res) => {
  const inst = getInst(req);
  try {
    let rows = await db.select().from(repositorioAreas).where(eq(repositorioAreas.institucionId, inst));
    
    if (!rows.length) {
      const { asignaturas } = await getDatosRealesDesdeNeon(inst);
      rows = asignaturas.map((nombre, index) => ({ id: index + 1, institucionId: inst, nombre })) as any;
    }

    return res.json(rows);
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.post('/areas', async (req, res) => {
  const inst = getInst(req);
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const r = await db.insert(repositorioAreas).values({ institucionId: inst, nombre: nombre.trim() }).returning({ id: repositorioAreas.id });
    return res.json({ success: true, id: r[0].id });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.put('/areas/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  const { nombre } = req.body;
  try {
    await db.update(repositorioAreas).set({ nombre }).where(and(eq(repositorioAreas.id, id), eq(repositorioAreas.institucionId, inst)));
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.delete('/areas/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  try {
    await db.delete(repositorioAreas).where(and(eq(repositorioAreas.id, id), eq(repositorioAreas.institucionId, inst)));
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ============================================================
// GRADOS (Consultados directamente de Neon con Fallback)
// ============================================================
router.get('/grados', async (req, res) => {
  const inst = getInst(req);
  try {
    let rows = await db.select().from(repositorioGrados).where(eq(repositorioGrados.institucionId, inst));

    if (!rows.length) {
      const { grados } = await getDatosRealesDesdeNeon(inst);
      rows = grados.map((nombre, index) => ({ id: index + 1, institucionId: inst, nombre })) as any;
    }

    return res.json(rows);
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.post('/grados', async (req, res) => {
  const inst = getInst(req);
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const r = await db.insert(repositorioGrados).values({ institucionId: inst, nombre: nombre.trim() }).returning({ id: repositorioGrados.id });
    return res.json({ success: true, id: r[0].id });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.put('/grados/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  const { nombre } = req.body;
  try {
    await db.update(repositorioGrados).set({ nombre }).where(and(eq(repositorioGrados.id, id), eq(repositorioGrados.institucionId, inst)));
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.delete('/grados/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  try {
    await db.delete(repositorioGrados).where(and(eq(repositorioGrados.id, id), eq(repositorioGrados.institucionId, inst)));
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ============================================================
// TIPOS DE RECURSO
// ============================================================
router.get('/tipos', async (req, res) => {
  const inst = getInst(req);
  try {
    let rows = await db.select().from(repositorioTipos).where(eq(repositorioTipos.institucionId, inst));
    
    if (!rows.length) {
      rows = DEFAULT_TIPOS.map((nombre, index) => ({ id: index + 1, institucionId: inst, nombre })) as any;
    }

    return res.json(rows);
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.post('/tipos', async (req, res) => {
  const inst = getInst(req);
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const r = await db.insert(repositorioTipos).values({ institucionId: inst, nombre: nombre.trim() }).returning({ id: repositorioTipos.id });
    return res.json({ success: true, id: r[0].id });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.put('/tipos/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  const { nombre } = req.body;
  try {
    await db.update(repositorioTipos).set({ nombre }).where(and(eq(repositorioTipos.id, id), eq(repositorioTipos.institucionId, inst)));
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.delete('/tipos/:id', async (req, res) => {
  const inst = getInst(req);
  const id = parseInt(req.params.id);
  try {
    await db.delete(repositorioTipos).where(and(eq(repositorioTipos.id, id), eq(repositorioTipos.institucionId, inst)));
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

export default router;