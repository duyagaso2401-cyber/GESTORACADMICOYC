// ============================================================
// MÓDULO REPOSITORIO — Rutas API
// Todos los recursos se filtran por institucion_id (multitenant)
// ============================================================

import { Router } from 'express';
import { db } from '../db/index.js';
import { repositorioResources, repositorioUsers, repositorioStats, repositorioConfig, repositorioAreas, repositorioGrados, repositorioTipos, kvStore } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

const GESTOR_SK = '__gestor_academico_yc__';

const router = Router();

/** Lee institucion_id desde query param ?inst=... (válido para todos los métodos HTTP) */
function getInst(req: any): string {
  return ((req.query.inst as string) || 'default').trim();
}

/** Catálogo (áreas/grados/tipos): filtra por inst; si vacío, devuelve todos los registros */
async function queryCatalogByInstOrAll<T>(
  queryByInst: (instId: string) => Promise<T[]>,
  queryAll: () => Promise<T[]>,
  inst: string
): Promise<T[]> {
  let rows = await queryByInst(inst);
  if (!rows.length) {
    rows = await queryAll();
  }
  return rows;
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
      level:       level    || 'General',
      skill:       skill    || '',
      metadata:    metadata || 'Ninguno',
      type:        type     || '',
      description: desc     || '',
      uploader:    uploader || '',
      link:        link     || null,
      fileData:    fileData || null,
      fileName:    fileName || null,
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
// ESTADÍSTICAS
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

// ============================================================
// CONFIGURACIÓN INSTITUCIONAL
// ============================================================
router.get('/config', async (req, res) => {
  const inst = getInst(req);
  try {
    const rows = await db.select().from(repositorioConfig).where(eq(repositorioConfig.institucionId, inst));
    return res.json(rows[0] ?? { name: '', logo: '' });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CONTEXTO DE INSTITUCIÓN — nombre, escudo, grados y asignaturas
// reales leídos desde la BD principal de la institución
// ============================================================
router.get('/inst-context', async (req, res) => {
  const inst = getInst(req);
  try {
    // 1. Leer GestorDB para encontrar la plataforma por id
    const gestorRows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorData = gestorRows[0]?.value as any;

    let nombre  = '';
    let escudo  = '';
    let platSK  = '';
    let grados: string[]      = [];
    let asignaturas: string[] = [];

    if (gestorData?.platforms) {
      const plat = gestorData.platforms.find((p: any) => p.id === inst);
      if (plat) {
        nombre = plat.nombre || '';
        escudo = plat.escudo || '';
        platSK = plat.sk    || '';
      }
    }

    // 2. Leer la BD de la plataforma usando su sk para obtener grados y carga
    if (platSK) {
      const platRows = await db.select().from(kvStore).where(eq(kvStore.key, platSK));
      const platData = platRows[0]?.value as any;
      if (platData) {
        if (!nombre && platData.nombre) nombre = platData.nombre;
        if (!escudo) escudo = platData.escudo || platData.logo || '';

        // Grados: array de objetos con campo .n (nombre del grado)
        const gradosArr = (platData.grados || []) as any[];
        grados = [...new Set(
          gradosArr.map((g: any) => (typeof g === 'string' ? g : g.n || g.id || '')).filter(Boolean)
        )] as string[];

        // Asignaturas: campo .m (materia) de cada entrada de carga académica
        const cargaArr = (platData.carga || []) as any[];
        asignaturas = [...new Set(
          cargaArr.map((c: any) => c.m || c.a || '').filter(Boolean)
        )] as string[];
      }
    }

    return res.json({ nombre, escudo, grados, asignaturas });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// SEMBRAR ÁREAS Y GRADOS desde datos reales de la institución
// Solo actúa si la tabla repositorio está vacía para esa inst.
// ============================================================
router.post('/seed-areas-grados', async (req, res) => {
  const inst = getInst(req);
  const { asignaturas = [], grados = [] } = req.body as {
    asignaturas: string[];
    grados: string[];
  };
  try {
    const [existAreas, existGrados] = await Promise.all([
      db.select({ id: repositorioAreas.id }).from(repositorioAreas).where(eq(repositorioAreas.institucionId, inst)),
      db.select({ id: repositorioGrados.id }).from(repositorioGrados).where(eq(repositorioGrados.institucionId, inst)),
    ]);

    let addedAreas  = 0;
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

    return res.json({
      success: true,
      addedAreas,
      addedGrados,
      skippedAreas:  existAreas.length  > 0,
      skippedGrados: existGrados.length > 0,
    });
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
// ÁREAS
// ============================================================
router.get('/areas', async (req, res) => {
  const inst = getInst(req);
  try {
    const rows = await queryCatalogByInstOrAll(
      (instId) => db.select().from(repositorioAreas).where(eq(repositorioAreas.institucionId, instId)),
      () => db.select().from(repositorioAreas),
      inst
    );
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
// GRADOS
// ============================================================
router.get('/grados', async (req, res) => {
  const inst = getInst(req);
  try {
    const rows = await queryCatalogByInstOrAll(
      (instId) => db.select().from(repositorioGrados).where(eq(repositorioGrados.institucionId, instId)),
      () => db.select().from(repositorioGrados),
      inst
    );
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
    const rows = await queryCatalogByInstOrAll(
      (instId) => db.select().from(repositorioTipos).where(eq(repositorioTipos.institucionId, instId)),
      () => db.select().from(repositorioTipos),
      inst
    );
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
