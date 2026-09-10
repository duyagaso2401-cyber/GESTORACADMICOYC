// ════════════════════════════════════════════════════════════════════════════
// SISTEMA INDEPENDIENTE DE EDUCACIÓN SUPERIOR (/api/university/)
// ------------------------------------------------------------------------------
// Este archivo es la API de un sistema DELIBERADAMENTE SEPARADO del resto de
// Gestor Académico YC — no comparte código de renderizado ni de lógica K-12
// con el resto del backend. Su único punto de contacto con el sistema
// principal es:
//   1) Lee/escribe el mismo "kv_store" por institución (para no duplicar la
//      base de usuarios/estudiantes/docentes ya matriculados — reconstruir
//      un sistema de identidad desde cero sería redundante y arriesgado).
//   2) Recibe un token de sesión que el sistema principal genera SOLO al
//      momento del login, después de validar la contraseña — de ahí en
//      adelante, este sistema funciona 100% independiente, con su propia
//      verificación de sesión en cada petición (no vuelve a confiar en el
//      cliente sin más).
//
// Ningún archivo del sistema K-12 existente importa ni depende de este
// archivo — se puede desactivar por completo (comentando su "app.use" en
// index.ts) sin afectar en nada al resto de la plataforma.
// ════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { kvStore, lmsPlanesEstudio, lmsAsignaturasUniversidad, lmsAulasVirtuales, lmsUnidades, lmsRecursos, lmsActividades, lmsEntregas, univSecciones, univMatriculas, univCalificacionesCortes, univPerfiles, univConfigCortes, univPensums, univPensumAsignaturas, univFacultades, univDepartamentos, univPeriodosAcademicos, univParametros, univCorrequisitos, univBancoPreguntas, univPreguntas, univCuestionarios, univCuestionarioPreguntas, univIntentosCuestionario, univGradebookCategorias } from '../db/schema.js';
import { eq, and, asc, sql } from 'drizzle-orm';
import { uploadMemoria, subirBufferACloudinary } from '../lib/upload.js';
import { GoogleGenAI } from '@google/genai';
import type { Express } from 'express';
interface ArchivoSubidoMulter { buffer: Buffer; mimetype: string; originalname: string; size: number; }

const router = Router();

const UNIV_SIGN_SECRET = process.env.DOC_SIGN_SECRET || ''; // reutiliza la misma clave del servidor que ya protege boletines/enlaces — no hace falta una nueva variable de entorno
const SESION_HORAS_VALIDEZ = 12;
const GESTOR_SK = '__gestor_academico_yc__'; // misma clave que ya usa el sistema K-12 para la lista de instituciones del Súper Admin

// Verifica, contra el registro REAL del Súper Admin (no algo que el
// cliente pueda alterar), si la institución está activa y desbloqueada.
// Se usa tanto al iniciar sesión como en CADA petición posterior — así,
// si el Súper Admin suspende o bloquea la institución mientras alguien
// ya tiene una sesión abierta, esa sesión deja de poder hacer nada de
// inmediato (no solo se bloquean los inicios de sesión nuevos).
async function verificarInstitucionActiva(sk: string): Promise<{ ok: boolean; motivo?: string }> {
  try {
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    if (!rows.length) return { ok: true }; // si no hay registro del gestor (entorno sin ese dato aún), no bloquea por esto
    const gestorDB = rows[0].value as any;
    const plat = (gestorDB?.platforms || []).find((p: any) => p.sk === sk);
    if (!plat) return { ok: true }; // institución no encontrada en la lista del gestor — no es motivo para bloquear aquí
    if (plat.activa === false) return { ok: false, motivo: 'Esta institución está suspendida por el administrador del sistema.' };
    if (plat.bloqueada) return { ok: false, motivo: 'Esta institución está bloqueada por el administrador del sistema.' };
    return { ok: true };
  } catch {
    return { ok: true }; // ante un error de esta verificación puntual, no se tumba todo el sistema — se deja pasar
  }
}

function _jsonEstableUniv(datos: unknown): string {
  if (datos === null || typeof datos !== 'object') return JSON.stringify(datos);
  if (Array.isArray(datos)) return '[' + datos.map(_jsonEstableUniv).join(',') + ']';
  const obj = datos as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _jsonEstableUniv(obj[k])).join(',') + '}';
}
function _firmar(datos: unknown): string {
  return crypto.createHmac('sha256', UNIV_SIGN_SECRET).update(_jsonEstableUniv(datos)).digest('hex');
}

interface SesionUniv { sk: string; rol: string; userId: string; nombre: string; exp: number; }

function generarTokenSesion(payload: Omit<SesionUniv, 'exp'>): string {
  const completo: SesionUniv = { ...payload, exp: Date.now() + SESION_HORAS_VALIDEZ * 60 * 60 * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(completo)).toString('base64url');
  return payloadB64 + '.' + _firmar(completo);
}
function verificarTokenSesion(token: string): SesionUniv | null {
  try {
    const [payloadB64, firma] = String(token || '').split('.');
    if (!payloadB64 || !firma) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (_firmar(payload) !== firma) return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload as SesionUniv;
  } catch {
    return null;
  }
}

// Middleware: exige un token de sesión válido (header "Authorization: Bearer <token>")
// en TODAS las rutas de este sistema excepto la de login. Adjunta la sesión
// verificada a req.sesionUniv para que cada ruta sepa quién y de qué
// institución es, sin tener que volver a confiar ciegamente en lo que
// mande el cliente en el body.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { sesionUniv?: SesionUniv; }
  }
}
function exigirSesion(req: any, res: any, next: any) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const sesion = verificarTokenSesion(token);
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o vencida. Vuelva a iniciar sesión.' });
  req.sesionUniv = sesion;
  next();
}

async function leerInstitucion(sk: string): Promise<any | null> {
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
  return rows.length ? (rows[0].value as any) : null;
}

/** Busca una sección (con los datos de su asignatura ya incluidos) por id,
 * validando que pertenezca a la institución indicada. Se reutiliza en
 * varios puntos (aula, entregas, matrícula) para no repetir el mismo JOIN. */
async function buscarSeccionConDetalle(sk: string, seccionId: string | number) {
  const filas = await db.select({
    id: univSecciones.id, asignaturaId: univSecciones.asignaturaId, catedraticoId: univSecciones.catedraticoU,
    grupo: univSecciones.grupo, codigoMateria: lmsAsignaturasUniversidad.codigoMateria,
    nombreAsignatura: lmsAsignaturasUniversidad.nombre, creditos: lmsAsignaturasUniversidad.creditos,
  }).from(univSecciones)
    .innerJoin(lmsAsignaturasUniversidad, eq(univSecciones.asignaturaId, lmsAsignaturasUniversidad.id))
    .where(and(eq(univSecciones.id, Number(seccionId)), eq(univSecciones.sk, sk)));
  return filas[0] || null;
}

// ── LOGIN — el sistema K-12 ya validó usuario/contraseña del lado del
// cliente (contra el mismo kv_store); esta ruta simplemente EMITE el
// token firmado que autoriza el acceso al sistema independiente, a
// partir de ahí ya no depende para nada del sistema anterior.
router.post('/auth/token', async (req, res) => {
  try {
    const { sk, rol, userId, nombre } = req.body || {};
    if (!sk || !rol || !userId) return res.status(400).json({ error: 'Faltan datos de sesión (sk, rol, userId).' });
    const estado = await verificarInstitucionActiva(sk);
    if (!estado.ok) return res.status(403).json({ error: estado.motivo });
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    if (inst.nivelEducativo !== 'UNIVERSIDAD') return res.status(403).json({ error: 'Esta institución no está configurada como Universidad/Instituto Técnico.' });
    const token = generarTokenSesion({ sk, rol, userId: String(userId), nombre: nombre || '' });
    return res.json({ token, horasValidez: SESION_HORAS_VALIDEZ, institucion: { nombre: inst.nombre || '', rectora: inst.rectora || '' } });
  } catch (err) {
    console.error('POST /api/university/auth/token error:', err);
    return res.status(500).json({ error: 'Error interno generando la sesión.' });
  }
});

// A partir de aquí, TODAS las rutas exigen sesión válida.
router.use(exigirSesion);
// Y, además, en CADA petición se revalida que la institución siga activa
// y desbloqueada — esto es lo que realmente "pausa" el consumo de las
// tablas cuando el Súper Admin desactiva o bloquea una institución: ni
// siquiera con un token todavía válido se puede seguir usando el sistema.
router.use(async (req: any, res, next) => {
  const estado = await verificarInstitucionActiva(req.sesionUniv.sk);
  if (!estado.ok) return res.status(403).json({ error: estado.motivo, institucionPausada: true });
  next();
});

router.get('/auth/whoami', (req: any, res) => {
  res.json({ sesion: req.sesionUniv });
});

// ── Panel de Control ────────────────────────────────────────────────────────
router.get('/dashboard', async (req: any, res) => {
  try {
    const { sk, rol, userId } = req.sesionUniv;
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    if (rol === 'estudiante') {
      const est = (inst.ests || []).find((e: any) => String(e.id) === String(userId));
      if (!est) return res.status(404).json({ error: 'Estudiante no encontrado.' });
      const misSecciones = await db.select({ creditos: lmsAsignaturasUniversidad.creditos }).from(univMatriculas)
        .innerJoin(univSecciones, eq(univMatriculas.seccionId, univSecciones.id))
        .innerJoin(lmsAsignaturasUniversidad, eq(univSecciones.asignaturaId, lmsAsignaturasUniversidad.id))
        .where(and(eq(univMatriculas.sk, sk), eq(univMatriculas.estudianteId, String(userId))));
      const totalCreditos = misSecciones.reduce((s, c) => s + (Number(c.creditos) || 0), 0);
      return res.json({
        institucion: { nombre: inst.nombre, rectora: inst.rectora, anio: inst.anio },
        estudiante: { nombre: est.n, grupo: est.g, planEstudioId: est.planEstudioId || null },
        creditosInscritos: totalCreditos,
        asignaturasInscritas: misSecciones.length,
      });
    }
    if (rol === 'docente') {
      const misSecciones = await db.select({ grupo: univSecciones.grupo }).from(univSecciones).where(and(eq(univSecciones.sk, sk), eq(univSecciones.catedraticoU, userId)));
      return res.json({
        institucion: { nombre: inst.nombre, rectora: inst.rectora, anio: inst.anio },
        catedratico: { nombre: inst.users?.find((u: any) => u.u === userId)?.n || '' },
        asignaturasACargo: misSecciones.length,
        grupos: [...new Set(misSecciones.map((s) => s.grupo))],
      });
    }
    // admin
    const planes = await db.select().from(lmsPlanesEstudio).where(eq(lmsPlanesEstudio.sk, sk));
    return res.json({
      institucion: { nombre: inst.nombre, rectora: inst.rectora, anio: inst.anio },
      totalEstudiantes: (inst.ests || []).length,
      totalDocentes: (inst.users || []).filter((u: any) => u.r === 'docente').length,
      totalPlanesEstudio: planes.length,
    });
  } catch (err) {
    console.error('GET /api/university/dashboard error:', err);
    return res.status(500).json({ error: 'Error interno cargando el panel de control.' });
  }
});

// ── Estructura Institucional: Facultades y Departamentos ─────────────────
router.get('/facultades', async (req: any, res) => {
  const facultades = await db.select().from(univFacultades).where(eq(univFacultades.sk, req.sesionUniv.sk));
  res.json({ facultades });
});
router.post('/facultades', async (req: any, res) => {
  const { nombre, decano } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la facultad.' });
  const creadas = await db.insert(univFacultades).values({ sk: req.sesionUniv.sk, nombre, decano: decano || '' }).returning();
  res.json({ facultad: creadas[0] });
});
router.put('/facultades/:id', async (req: any, res) => {
  const { nombre, decano } = req.body || {};
  const cambios: any = {};
  if (typeof nombre === 'string') cambios.nombre = nombre;
  if (typeof decano === 'string') cambios.decano = decano;
  const actualizadas = await db.update(univFacultades).set(cambios).where(and(eq(univFacultades.id, Number(req.params.id)), eq(univFacultades.sk, req.sesionUniv.sk))).returning();
  if (!actualizadas.length) return res.status(404).json({ error: 'Facultad no encontrada.' });
  res.json({ facultad: actualizadas[0] });
});
router.delete('/facultades/:id', async (req: any, res) => {
  try {
    await db.delete(univFacultades).where(and(eq(univFacultades.id, Number(req.params.id)), eq(univFacultades.sk, req.sesionUniv.sk)));
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'No se puede eliminar: tiene departamentos asociados. Elimínelos primero.' });
  }
});

router.get('/departamentos', async (req: any, res) => {
  const { sk } = req.sesionUniv;
  const facultadId = req.query.facultadId ? Number(req.query.facultadId) : null;
  const condiciones = facultadId ? and(eq(univDepartamentos.sk, sk), eq(univDepartamentos.facultadId, facultadId)) : eq(univDepartamentos.sk, sk);
  const departamentos = await db.select().from(univDepartamentos).where(condiciones);
  res.json({ departamentos });
});
router.post('/departamentos', async (req: any, res) => {
  const { facultadId, nombre, jefeDepartamento } = req.body || {};
  if (!facultadId || !nombre) return res.status(400).json({ error: 'Faltan facultadId o nombre.' });
  const creados = await db.insert(univDepartamentos).values({ sk: req.sesionUniv.sk, facultadId: Number(facultadId), nombre, jefeDepartamento: jefeDepartamento || '' }).returning();
  res.json({ departamento: creados[0] });
});
router.put('/departamentos/:id', async (req: any, res) => {
  const { nombre, jefeDepartamento } = req.body || {};
  const cambios: any = {};
  if (typeof nombre === 'string') cambios.nombre = nombre;
  if (typeof jefeDepartamento === 'string') cambios.jefeDepartamento = jefeDepartamento;
  const actualizados = await db.update(univDepartamentos).set(cambios).where(and(eq(univDepartamentos.id, Number(req.params.id)), eq(univDepartamentos.sk, req.sesionUniv.sk))).returning();
  if (!actualizados.length) return res.status(404).json({ error: 'Departamento no encontrado.' });
  res.json({ departamento: actualizados[0] });
});
router.delete('/departamentos/:id', async (req: any, res) => {
  try {
    await db.delete(univDepartamentos).where(and(eq(univDepartamentos.id, Number(req.params.id)), eq(univDepartamentos.sk, req.sesionUniv.sk)));
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'No se puede eliminar: tiene programas académicos asociados. Reasígnelos primero.' });
  }
});

// ── Calendario Académico: Periodos ────────────────────────────────────────
router.get('/periodos', async (req: any, res) => {
  const periodos = await db.select().from(univPeriodosAcademicos).where(eq(univPeriodosAcademicos.sk, req.sesionUniv.sk));
  res.json({ periodos });
});
router.post('/periodos', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const { nombre, fechaInicio, fechaFin, fechaAperturaPrematricula, fechaCierrePrematricula, fechaAperturaAdiciones, fechaCierreAdiciones, fechaInicioClases, fechaCierreClases, cortes, activo } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del periodo (ej: 2026-1).' });
    // Si este periodo se marca activo, los demás de la institución dejan de estarlo (solo puede haber uno activo a la vez).
    if (activo) await db.update(univPeriodosAcademicos).set({ activo: false }).where(eq(univPeriodosAcademicos.sk, sk));
    const fechaOrNull = (v: any) => (v ? new Date(v) : null);
    const creados = await db.insert(univPeriodosAcademicos).values({
      sk, nombre, fechaInicio: fechaOrNull(fechaInicio), fechaFin: fechaOrNull(fechaFin),
      fechaAperturaPrematricula: fechaOrNull(fechaAperturaPrematricula), fechaCierrePrematricula: fechaOrNull(fechaCierrePrematricula),
      fechaAperturaAdiciones: fechaOrNull(fechaAperturaAdiciones), fechaCierreAdiciones: fechaOrNull(fechaCierreAdiciones),
      fechaInicioClases: fechaOrNull(fechaInicioClases), fechaCierreClases: fechaOrNull(fechaCierreClases),
      cortes: Array.isArray(cortes) ? cortes : [], activo: !!activo,
    }).returning();
    res.json({ periodo: creados[0] });
  } catch (err) {
    console.error('POST /api/university/periodos error:', err);
    res.status(500).json({ error: 'Error interno creando el periodo académico.' });
  }
});
router.put('/periodos/:id', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const body = req.body || {};
    if (body.activo) await db.update(univPeriodosAcademicos).set({ activo: false }).where(eq(univPeriodosAcademicos.sk, sk));
    const fechaOrNull = (v: any) => (v === undefined ? undefined : (v ? new Date(v) : null));
    const cambios: any = {};
    ['nombre'].forEach((k) => { if (typeof body[k] === 'string') cambios[k] = body[k]; });
    ['fechaInicio', 'fechaFin', 'fechaAperturaPrematricula', 'fechaCierrePrematricula', 'fechaAperturaAdiciones', 'fechaCierreAdiciones', 'fechaInicioClases', 'fechaCierreClases'].forEach((k) => {
      const v = fechaOrNull(body[k]); if (v !== undefined) cambios[k] = v;
    });
    if (Array.isArray(body.cortes)) cambios.cortes = body.cortes;
    if (typeof body.activo === 'boolean') cambios.activo = body.activo;
    const actualizados = await db.update(univPeriodosAcademicos).set(cambios).where(and(eq(univPeriodosAcademicos.id, Number(req.params.id)), eq(univPeriodosAcademicos.sk, sk))).returning();
    if (!actualizados.length) return res.status(404).json({ error: 'Periodo no encontrado.' });
    res.json({ periodo: actualizados[0] });
  } catch (err) {
    console.error('PUT /api/university/periodos/:id error:', err);
    res.status(500).json({ error: 'Error interno actualizando el periodo académico.' });
  }
});
router.delete('/periodos/:id', async (req: any, res) => {
  await db.delete(univPeriodosAcademicos).where(and(eq(univPeriodosAcademicos.id, Number(req.params.id)), eq(univPeriodosAcademicos.sk, req.sesionUniv.sk)));
  res.json({ ok: true });
});

// ── Parámetros Globales de la institución ─────────────────────────────────
router.get('/parametros', async (req: any, res) => {
  const filas = await db.select().from(univParametros).where(eq(univParametros.sk, req.sesionUniv.sk));
  res.json({ parametros: filas[0] || { escalaTipo: 'NUMERICA', notaMaxima: '5.0', notaMinimaAprobacion: '3.0', topeFallasPorcentaje: '20', escalaPersonalizada: [{ nombre: 'Bajo', min: 0, max: 2.9 }, { nombre: 'Básico', min: 3.0, max: 3.9 }, { nombre: 'Alto', min: 4.0, max: 4.6 }, { nombre: 'Superior', min: 4.7, max: 5.0 }] } });
});
router.put('/parametros', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede cambiar esta configuración.' });
    const { sk } = req.sesionUniv;
    const { escalaTipo, notaMaxima, notaMinimaAprobacion, topeFallasPorcentaje, escalaPersonalizada } = req.body || {};
    if (Array.isArray(escalaPersonalizada)) {
      for (const banda of escalaPersonalizada) {
        if (!banda.nombre || isNaN(Number(banda.min)) || isNaN(Number(banda.max))) return res.status(400).json({ error: 'Cada banda de la escala necesita nombre y un rango mínimo/máximo válido.' });
      }
    }
    const cambios: any = { actualizadoEn: new Date() };
    if (escalaTipo) cambios.escalaTipo = escalaTipo;
    if (notaMaxima !== undefined) cambios.notaMaxima = String(notaMaxima);
    if (notaMinimaAprobacion !== undefined) cambios.notaMinimaAprobacion = String(notaMinimaAprobacion);
    if (topeFallasPorcentaje !== undefined) cambios.topeFallasPorcentaje = String(topeFallasPorcentaje);
    if (Array.isArray(escalaPersonalizada)) cambios.escalaPersonalizada = escalaPersonalizada;
    const existentes = await db.select().from(univParametros).where(eq(univParametros.sk, sk));
    if (existentes.length) {
      await db.update(univParametros).set(cambios).where(eq(univParametros.id, existentes[0].id));
    } else {
      await db.insert(univParametros).values({ sk, ...cambios });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/university/parametros error:', err);
    res.status(500).json({ error: 'Error interno guardando los parámetros.' });
  }
});

// ── Gestión Académica: Programas / Semestres / Asignaturas / Secciones ──────
router.get('/programas', async (req: any, res) => {
  const planes = await db.select().from(lmsPlanesEstudio).where(eq(lmsPlanesEstudio.sk, req.sesionUniv.sk));
  res.json({ programas: planes });
});
router.post('/programas', async (req: any, res) => {
  const { nombreCarrera, totalCreditos, departamentoId, nivel } = req.body || {};
  if (!nombreCarrera) return res.status(400).json({ error: 'Falta el nombre del programa.' });
  const creados = await db.insert(lmsPlanesEstudio).values({
    sk: req.sesionUniv.sk, nombreCarrera, totalCreditos: Number(totalCreditos) || 0,
    departamentoId: departamentoId ? Number(departamentoId) : null, nivel: nivel || 'PREGRADO',
  }).returning();
  res.json({ programa: creados[0] });
});
router.get('/asignaturas', async (req: any, res) => {
  const asig = await db.select().from(lmsAsignaturasUniversidad).where(eq(lmsAsignaturasUniversidad.sk, req.sesionUniv.sk));
  res.json({ asignaturas: asig });
});
router.post('/asignaturas', async (req: any, res) => {
  const { planEstudioId, codigoMateria, nombre, creditos, horasPresenciales, horasIndependientes, semestre, prerrequisitoId, caracter } = req.body || {};
  if (!codigoMateria || !nombre) return res.status(400).json({ error: 'Faltan código o nombre de la asignatura.' });
  const creadas = await db.insert(lmsAsignaturasUniversidad).values({
    sk: req.sesionUniv.sk, planEstudioId: planEstudioId ? Number(planEstudioId) : null, codigoMateria, nombre,
    creditos: Number(creditos) || 0, horasPresenciales: Number(horasPresenciales) || 0, horasIndependientes: Number(horasIndependientes) || 0,
    semestre: Number(semestre) || 1, prerrequisitoId: prerrequisitoId ? Number(prerrequisitoId) : null,
    caracter: ['OBLIGATORIA', 'ELECTIVA', 'OPTATIVA'].includes(caracter) ? caracter : 'OBLIGATORIA',
  }).returning();
  res.json({ asignatura: creadas[0] });
});
// ── Correquisitos: materias que deben cursarse SIMULTÁNEAMENTE (a
// diferencia del prerrequisito, aquí puede haber varias a la vez).
router.get('/asignaturas/:id/correquisitos', async (req: any, res) => {
  const asigId = Number(req.params.id);
  const filas = await db.select({
    id: univCorrequisitos.id, correquisitoId: univCorrequisitos.correquisitoId,
    codigoMateria: lmsAsignaturasUniversidad.codigoMateria, nombre: lmsAsignaturasUniversidad.nombre,
  }).from(univCorrequisitos)
    .innerJoin(lmsAsignaturasUniversidad, eq(univCorrequisitos.correquisitoId, lmsAsignaturasUniversidad.id))
    .where(eq(univCorrequisitos.asignaturaId, asigId));
  res.json({ correquisitos: filas });
});
router.post('/asignaturas/:id/correquisitos', async (req: any, res) => {
  const asigId = Number(req.params.id);
  const { correquisitoId } = req.body || {};
  if (!correquisitoId) return res.status(400).json({ error: 'Falta correquisitoId.' });
  if (Number(correquisitoId) === asigId) return res.status(400).json({ error: 'Una asignatura no puede ser correquisito de sí misma.' });
  try {
    const creados = await db.insert(univCorrequisitos).values({ asignaturaId: asigId, correquisitoId: Number(correquisitoId) }).returning();
    res.json({ correquisito: creados[0] });
  } catch (err) {
    res.status(409).json({ error: 'Ese correquisito ya estaba agregado.' });
  }
});
router.delete('/correquisitos/:id', async (req: any, res) => {
  await db.delete(univCorrequisitos).where(eq(univCorrequisitos.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── Pensums: malla curricular versionada de un Programa — permite tener
// varias mallas para el mismo programa a través del tiempo (ej. "Pensum
// 2024" vs "Pensum 2026"), cada una con su propio conjunto de asignaturas.
router.get('/pensums', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const planEstudioId = req.query.planEstudioId ? Number(req.query.planEstudioId) : null;
    const condiciones = planEstudioId ? and(eq(univPensums.sk, sk), eq(univPensums.planEstudioId, planEstudioId)) : eq(univPensums.sk, sk);
    const pensums = await db.select().from(univPensums).where(condiciones);
    res.json({ pensums });
  } catch (err) {
    console.error('GET /api/university/pensums error:', err);
    res.status(500).json({ error: 'Error interno consultando los pensums.' });
  }
});
router.post('/pensums', async (req: any, res) => {
  try {
    const { planEstudioId, nombre, vigenteDesde } = req.body || {};
    if (!planEstudioId || !nombre) return res.status(400).json({ error: 'Faltan planEstudioId o nombre.' });
    const creados = await db.insert(univPensums).values({ sk: req.sesionUniv.sk, planEstudioId: Number(planEstudioId), nombre, vigenteDesde: vigenteDesde || '' }).returning();
    res.json({ pensum: creados[0] });
  } catch (err) {
    console.error('POST /api/university/pensums error:', err);
    res.status(500).json({ error: 'Error interno creando el pensum.' });
  }
});
router.put('/pensums/:id', async (req: any, res) => {
  try {
    const { nombre, vigenteDesde, activo } = req.body || {};
    const cambios: any = {};
    if (typeof nombre === 'string') cambios.nombre = nombre;
    if (typeof vigenteDesde === 'string') cambios.vigenteDesde = vigenteDesde;
    if (typeof activo === 'boolean') cambios.activo = activo;
    const actualizados = await db.update(univPensums).set(cambios).where(and(eq(univPensums.id, Number(req.params.id)), eq(univPensums.sk, req.sesionUniv.sk))).returning();
    if (!actualizados.length) return res.status(404).json({ error: 'Pensum no encontrado.' });
    res.json({ pensum: actualizados[0] });
  } catch (err) {
    console.error('PUT /api/university/pensums/:id error:', err);
    res.status(500).json({ error: 'Error interno actualizando el pensum.' });
  }
});
router.delete('/pensums/:id', async (req: any, res) => {
  try {
    await db.delete(univPensums).where(and(eq(univPensums.id, Number(req.params.id)), eq(univPensums.sk, req.sesionUniv.sk)));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/university/pensums/:id error:', err);
    res.status(500).json({ error: 'Error interno eliminando el pensum.' });
  }
});
// Asignaturas que componen un pensum — devuelve TODAS las asignaturas del
// programa, marcando cuáles ya están incluidas (para pintar checkboxes).
router.get('/pensums/:id/asignaturas', async (req: any, res) => {
  try {
    const pensumId = Number(req.params.id);
    const pensumRows = await db.select().from(univPensums).where(and(eq(univPensums.id, pensumId), eq(univPensums.sk, req.sesionUniv.sk)));
    const pensum = pensumRows[0];
    if (!pensum) return res.status(404).json({ error: 'Pensum no encontrado.' });
    const todasLasAsignaturas = await db.select().from(lmsAsignaturasUniversidad).where(eq(lmsAsignaturasUniversidad.planEstudioId, pensum.planEstudioId));
    const incluidas = await db.select().from(univPensumAsignaturas).where(eq(univPensumAsignaturas.pensumId, pensumId));
    const idsIncluidas = new Set(incluidas.map((i) => i.asignaturaId));
    const asignaturas = todasLasAsignaturas.map((a) => ({ ...a, incluidaEnPensum: idsIncluidas.has(a.id) }));
    res.json({ asignaturas });
  } catch (err) {
    console.error('GET /api/university/pensums/:id/asignaturas error:', err);
    res.status(500).json({ error: 'Error interno consultando las asignaturas del pensum.' });
  }
});
router.post('/pensums/:id/asignaturas', async (req: any, res) => {
  try {
    const pensumId = Number(req.params.id);
    const { asignaturaId, incluir } = req.body || {};
    if (!asignaturaId) return res.status(400).json({ error: 'Falta asignaturaId.' });
    if (incluir === false) {
      await db.delete(univPensumAsignaturas).where(and(eq(univPensumAsignaturas.pensumId, pensumId), eq(univPensumAsignaturas.asignaturaId, Number(asignaturaId))));
    } else {
      await db.insert(univPensumAsignaturas).values({ pensumId, asignaturaId: Number(asignaturaId) }).onConflictDoNothing();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/university/pensums/:id/asignaturas error:', err);
    res.status(500).json({ error: 'Error interno actualizando las asignaturas del pensum.' });
  }
});

// ── Secciones (Grupo/Sección + Catedrático) — equivalente a "Carga
// Académica" pero exclusivo de este sistema, guardado en el mismo
// kv_store de la institución para no fragmentar dónde vive esta
// información (el sistema K-12 nunca lee este campo, así que no hay
// riesgo de interferencia).
// ── Catedráticos (docentes) — antes, al crear una Sección, solo se
// escribía un nombre de usuario como texto libre, SIN crear ninguna
// cuenta real; ese catedrático nunca podía iniciar sesión porque no
// existía. Ahora se puede crear la cuenta desde aquí mismo, con el
// mismo formato exacto de contraseña (cifrada con PBKDF2) que usa el
// resto del sistema para docentes.
router.get('/docentes', async (req: any, res) => {
  try {
    const inst = await leerInstitucion(req.sesionUniv.sk);
    const docentes = inst ? (inst.users || []).filter((u: any) => u.r === 'docente').map((u: any) => ({ u: u.u, nombre: u.n, correo: u.correo || u.email || '' })) : [];
    res.json({ docentes });
  } catch (err) {
    console.error('GET /api/university/docentes error:', err);
    res.status(500).json({ error: 'Error interno consultando los catedráticos.' });
  }
});
router.post('/docentes', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede crear catedráticos.' });
    const { sk } = req.sesionUniv;
    const { nombre, usuario, password, correo, telefono } = req.body || {};
    if (!nombre || !usuario || !password) return res.status(400).json({ error: 'Faltan nombre, usuario o contraseña.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener mínimo 6 caracteres.' });
    const CONTRASENAS_DEBILES = ['1234', '12345', '123456', '1234567', '12345678', 'admin', 'password', 'contraseña', 'qwerty', '000000'];
    if (CONTRASENAS_DEBILES.includes(String(password).toLowerCase())) return res.status(400).json({ error: 'Esa contraseña es demasiado común/débil. Por seguridad, elija una distinta.' });
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    if (!inst.users) inst.users = [];
    const yaExiste = inst.users.find((u: any) => u.u === usuario);
    if (yaExiste) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario.' });
    const nuevoDocente = {
      u: String(usuario), p: hashPasswordServidor(String(password)), r: 'docente',
      n: String(nombre).toUpperCase(), correo: correo || '', telefono: telefono || '', cargo: 'DOCENTE',
    };
    inst.users.push(nuevoDocente);
    await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
    res.json({ docente: { u: nuevoDocente.u, nombre: nuevoDocente.n } });
  } catch (err) {
    console.error('POST /api/university/docentes error:', err);
    res.status(500).json({ error: 'Error interno creando el catedrático.' });
  }
});

router.get('/secciones', async (req: any, res) => {
  try {
    const filas = await db.select({
      id: univSecciones.id, asignaturaId: univSecciones.asignaturaId, catedraticoId: univSecciones.catedraticoU,
      grupo: univSecciones.grupo, metadata: univSecciones.metadata,
      codigoMateria: lmsAsignaturasUniversidad.codigoMateria, nombreAsignatura: lmsAsignaturasUniversidad.nombre, creditos: lmsAsignaturasUniversidad.creditos,
    }).from(univSecciones)
      .innerJoin(lmsAsignaturasUniversidad, eq(univSecciones.asignaturaId, lmsAsignaturasUniversidad.id))
      .where(eq(univSecciones.sk, req.sesionUniv.sk));
    res.json({ secciones: filas });
  } catch (err) {
    console.error('GET /api/university/secciones error:', err);
    res.status(500).json({ error: 'Error interno consultando las secciones.' });
  }
});
router.post('/secciones', async (req: any, res) => {
  try {
    const { asignaturaId, catedraticoId, grupo } = req.body || {};
    if (!asignaturaId || !catedraticoId || !grupo) return res.status(400).json({ error: 'Faltan asignaturaId, catedraticoId o grupo.' });
    const sk = req.sesionUniv.sk;
    const asigRows = await db.select().from(lmsAsignaturasUniversidad).where(eq(lmsAsignaturasUniversidad.id, Number(asignaturaId)));
    const asig = asigRows[0];
    if (!asig) return res.status(404).json({ error: 'Asignatura no encontrada.' });
    const creadas = await db.insert(univSecciones).values({ sk, asignaturaId: Number(asignaturaId), catedraticoU: catedraticoId, grupo }).returning();
    const nuevaSeccion = { ...creadas[0], catedraticoId: creadas[0].catedraticoU, codigoMateria: asig.codigoMateria, nombreAsignatura: asig.nombre, creditos: asig.creditos };
    res.json({ seccion: nuevaSeccion });
  } catch (err) {
    console.error('POST /api/university/secciones error:', err);
    res.status(500).json({ error: 'Error interno creando la sección.' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// MOTOR DE CUESTIONARIOS/QUIZ
// ════════════════════════════════════════════════════════════════════════

// ── Banco de Preguntas (por categoría) y Preguntas individuales ──────────
router.get('/banco-preguntas', async (req: any, res) => {
  const filas = await db.select().from(univBancoPreguntas).where(and(eq(univBancoPreguntas.sk, req.sesionUniv.sk), eq(univBancoPreguntas.docenteU, req.sesionUniv.userId)));
  res.json({ bancos: filas });
});
router.post('/banco-preguntas', async (req: any, res) => {
  if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
  const { categoria } = req.body || {};
  if (!categoria) return res.status(400).json({ error: 'Falta la categoría del banco.' });
  const creados = await db.insert(univBancoPreguntas).values({ sk: req.sesionUniv.sk, categoria, docenteU: req.sesionUniv.userId }).returning();
  res.json({ banco: creados[0] });
});
router.delete('/banco-preguntas/:id', async (req: any, res) => {
  await db.delete(univBancoPreguntas).where(and(eq(univBancoPreguntas.id, Number(req.params.id)), eq(univBancoPreguntas.docenteU, req.sesionUniv.userId)));
  res.json({ ok: true });
});

router.get('/banco-preguntas/:id/preguntas', async (req: any, res) => {
  const preguntas = await db.select().from(univPreguntas).where(eq(univPreguntas.bancoId, Number(req.params.id)));
  res.json({ preguntas });
});
router.post('/preguntas', async (req: any, res) => {
  if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
  const { bancoId, tipo, enunciado, opciones, respuestaCorta, puntaje, retroalimentacion } = req.body || {};
  const TIPOS_VALIDOS = ['OPCION_UNICA', 'OPCION_MULTIPLE', 'VERDADERO_FALSO', 'RESPUESTA_CORTA', 'ENSAYO'];
  if (!bancoId || !enunciado || !TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ error: 'Faltan bancoId, enunciado, o el tipo de pregunta no es válido.' });
  if (['OPCION_UNICA', 'OPCION_MULTIPLE', 'VERDADERO_FALSO'].includes(tipo)) {
    if (!Array.isArray(opciones) || opciones.length < 2) return res.status(400).json({ error: 'Debe indicar al menos 2 opciones.' });
    if (!opciones.some((o: any) => o.correcta)) return res.status(400).json({ error: 'Debe marcar al menos una opción como correcta.' });
  }
  const creadas = await db.insert(univPreguntas).values({
    bancoId: Number(bancoId), tipo, enunciado, opciones: opciones || [], respuestaCorta: respuestaCorta || [],
    puntaje: String(puntaje || '1.0'), retroalimentacion: retroalimentacion || '',
  }).returning();
  res.json({ pregunta: creadas[0] });
});
router.delete('/preguntas/:id', async (req: any, res) => {
  await db.delete(univPreguntas).where(eq(univPreguntas.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── Configuración de Cuestionario (ligado 1 a 1 a una Actividad tipo QUIZ) ─
router.get('/actividades/:id/cuestionario', async (req: any, res) => {
  const filas = await db.select().from(univCuestionarios).where(eq(univCuestionarios.actividadId, Number(req.params.id)));
  if (!filas.length) return res.json({ cuestionario: null, preguntas: [] });
  const preguntas = await db.select({
    id: univCuestionarioPreguntas.id, preguntaId: univPreguntas.id, tipo: univPreguntas.tipo, enunciado: univPreguntas.enunciado,
    opciones: univPreguntas.opciones, puntaje: univPreguntas.puntaje, orden: univCuestionarioPreguntas.orden,
  }).from(univCuestionarioPreguntas)
    .innerJoin(univPreguntas, eq(univCuestionarioPreguntas.preguntaId, univPreguntas.id))
    .where(eq(univCuestionarioPreguntas.cuestionarioId, filas[0].id));
  res.json({ cuestionario: filas[0], preguntas });
});
router.post('/actividades/:id/cuestionario', async (req: any, res) => {
  if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
  const actividadId = Number(req.params.id);
  const { tiempoLimiteMinutos, intentosPermitidos, metodoCalificacion, barajarPreguntas, barajarRespuestas, retroalimentacion } = req.body || {};
  try {
    const creados = await db.insert(univCuestionarios).values({
      actividadId, tiempoLimiteMinutos: tiempoLimiteMinutos ? Number(tiempoLimiteMinutos) : null,
      intentosPermitidos: Number(intentosPermitidos) || 1, metodoCalificacion: metodoCalificacion || 'NOTA_MAS_ALTA',
      barajarPreguntas: !!barajarPreguntas, barajarRespuestas: !!barajarRespuestas, retroalimentacion: retroalimentacion || 'AL_FINALIZAR',
    }).returning();
    res.json({ cuestionario: creados[0] });
  } catch (err) {
    res.status(409).json({ error: 'Esta actividad ya tiene un cuestionario configurado.' });
  }
});
router.post('/cuestionarios/:id/preguntas', async (req: any, res) => {
  if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
  const cuestionarioId = Number(req.params.id);
  const { preguntaId } = req.body || {};
  if (!preguntaId) return res.status(400).json({ error: 'Falta preguntaId.' });
  const existentes = await db.select().from(univCuestionarioPreguntas).where(eq(univCuestionarioPreguntas.cuestionarioId, cuestionarioId));
  try {
    const creadas = await db.insert(univCuestionarioPreguntas).values({ cuestionarioId, preguntaId: Number(preguntaId), orden: existentes.length }).returning();
    res.json({ ok: true, item: creadas[0] });
  } catch (err) {
    res.status(409).json({ error: 'Esa pregunta ya estaba agregada a este cuestionario.' });
  }
});
router.delete('/cuestionarios/preguntas/:id', async (req: any, res) => {
  await db.delete(univCuestionarioPreguntas).where(eq(univCuestionarioPreguntas.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── Presentar el cuestionario (estudiante) ────────────────────────────────
// Nunca se envían al estudiante las respuestas correctas — solo el
// enunciado y las opciones (con su texto, sin el campo "correcta").
function _preguntaSinRespuestas(p: any) {
  const opciones = Array.isArray(p.opciones) ? p.opciones.map((o: any) => ({ id: o.id, texto: o.texto })) : [];
  return { id: p.preguntaId || p.id, tipo: p.tipo, enunciado: p.enunciado, opciones, puntaje: p.puntaje, orden: p.orden };
}
function _barajarArray<T>(arr: T[]): T[] {
  const copia = arr.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
router.get('/cuestionarios/:actividadId/tomar', async (req: any, res) => {
  try {
    const { userId } = req.sesionUniv;
    const actividadId = Number(req.params.actividadId);
    const cuestRows = await db.select().from(univCuestionarios).where(eq(univCuestionarios.actividadId, actividadId));
    const cuestionario = cuestRows[0];
    if (!cuestionario) return res.status(404).json({ error: 'Este cuestionario no está configurado todavía.' });
    const actividadRows = await db.select().from(lmsActividades).where(eq(lmsActividades.id, actividadId));
    const actividad = actividadRows[0];

    const intentosPrevios = await db.select().from(univIntentosCuestionario).where(and(eq(univIntentosCuestionario.cuestionarioId, cuestionario.id), eq(univIntentosCuestionario.estudianteId, String(userId))));
    const intentoEnCurso = intentosPrevios.find((i) => i.estado === 'EN_CURSO');
    const intentosTerminados = intentosPrevios.filter((i) => i.estado !== 'EN_CURSO');

    if (!intentoEnCurso && intentosTerminados.length >= cuestionario.intentosPermitidos) {
      return res.json({ cuestionario, actividad, agotado: true, intentosPrevios: intentosTerminados, preguntas: [] });
    }

    let preguntasFilas = await db.select({
      preguntaId: univPreguntas.id, tipo: univPreguntas.tipo, enunciado: univPreguntas.enunciado,
      opciones: univPreguntas.opciones, puntaje: univPreguntas.puntaje, orden: univCuestionarioPreguntas.orden,
    }).from(univCuestionarioPreguntas)
      .innerJoin(univPreguntas, eq(univCuestionarioPreguntas.preguntaId, univPreguntas.id))
      .where(eq(univCuestionarioPreguntas.cuestionarioId, cuestionario.id));

    let intento = intentoEnCurso;
    if (!intento) {
      const notaMaxima = preguntasFilas.reduce((s, p) => s + (Number(p.puntaje) || 0), 0);
      const creados = await db.insert(univIntentosCuestionario).values({
        cuestionarioId: cuestionario.id, estudianteId: String(userId), numeroIntento: intentosTerminados.length + 1,
        notaMaxima: String(notaMaxima), estado: 'EN_CURSO',
      }).returning();
      intento = creados[0];
    }

    if (cuestionario.barajarPreguntas) preguntasFilas = _barajarArray(preguntasFilas);
    let preguntas = preguntasFilas.map(_preguntaSinRespuestas);
    if (cuestionario.barajarRespuestas) preguntas = preguntas.map((p) => ({ ...p, opciones: _barajarArray(p.opciones) }));

    res.json({ cuestionario, actividad, intento, preguntas, agotado: false, intentosPrevios: intentosTerminados });
  } catch (err) {
    console.error('GET /api/university/cuestionarios/:actividadId/tomar error:', err);
    res.status(500).json({ error: 'Error interno cargando el cuestionario.' });
  }
});

// Guarda respuestas parciales (autoguardado mientras el estudiante avanza) —
// no califica todavía, solo persiste el progreso por si se corta la conexión.
router.put('/intentos/:id/responder', async (req: any, res) => {
  try {
    const { userId } = req.sesionUniv;
    const intentoId = Number(req.params.id);
    const { preguntaId, respuesta } = req.body || {};
    if (!preguntaId) return res.status(400).json({ error: 'Falta preguntaId.' });
    const filas = await db.select().from(univIntentosCuestionario).where(eq(univIntentosCuestionario.id, intentoId));
    const intento = filas[0];
    if (!intento || intento.estudianteId !== String(userId)) return res.status(404).json({ error: 'Intento no encontrado.' });
    if (intento.estado !== 'EN_CURSO') return res.status(409).json({ error: 'Este intento ya fue entregado.' });
    const respuestas = { ...(intento.respuestas as any || {}), [String(preguntaId)]: respuesta };
    await db.update(univIntentosCuestionario).set({ respuestas }).where(eq(univIntentosCuestionario.id, intentoId));
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/university/intentos/:id/responder error:', err);
    res.status(500).json({ error: 'Error interno guardando la respuesta.' });
  }
});

// Entrega final del intento — aquí SÍ se califica todo lo objetivo de
// forma automática; lo tipo ENSAYO queda pendiente para el docente.
router.post('/intentos/:id/entregar', async (req: any, res) => {
  try {
    const { userId } = req.sesionUniv;
    const intentoId = Number(req.params.id);
    const filas = await db.select().from(univIntentosCuestionario).where(eq(univIntentosCuestionario.id, intentoId));
    const intento = filas[0];
    if (!intento || intento.estudianteId !== String(userId)) return res.status(404).json({ error: 'Intento no encontrado.' });
    if (intento.estado !== 'EN_CURSO') return res.status(409).json({ error: 'Este intento ya fue entregado.' });

    const preguntasFilas = await db.select({
      preguntaId: univPreguntas.id, tipo: univPreguntas.tipo, opciones: univPreguntas.opciones,
      respuestaCorta: univPreguntas.respuestaCorta, puntaje: univPreguntas.puntaje,
    }).from(univCuestionarioPreguntas)
      .innerJoin(univPreguntas, eq(univCuestionarioPreguntas.preguntaId, univPreguntas.id))
      .where(eq(univCuestionarioPreguntas.cuestionarioId, intento.cuestionarioId));

    const respuestas = (intento.respuestas as any) || {};
    let notaObtenida = 0;
    let hayPendientesManual = false;
    for (const p of preguntasFilas) {
      const r = calificarRespuestaAutomatica(p, respuestas[String(p.preguntaId)]);
      if (r.pendienteManual) hayPendientesManual = true;
      else notaObtenida += r.puntajeObtenido || 0;
    }
    const estadoFinal = hayPendientesManual ? 'ENTREGADO' : 'CALIFICADO'; // si hay ensayos, falta calificación manual del docente
    await db.update(univIntentosCuestionario).set({
      fechaFin: new Date(), notaObtenida: hayPendientesManual ? null : String(notaObtenida),
      tienePendientesManual: hayPendientesManual, estado: estadoFinal,
    }).where(eq(univIntentosCuestionario.id, intentoId));

    res.json({ ok: true, notaObtenida: hayPendientesManual ? null : notaObtenida, notaMaxima: Number(intento.notaMaxima), pendienteManual: hayPendientesManual });
  } catch (err) {
    console.error('POST /api/university/intentos/:id/entregar error:', err);
    res.status(500).json({ error: 'Error interno entregando el cuestionario.' });
  }
});

// ── Vista del docente: intentos de todos los estudiantes + calificar ENSAYOs
router.get('/cuestionarios/:id/intentos', async (req: any, res) => {
  if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
  const intentos = await db.select().from(univIntentosCuestionario).where(eq(univIntentosCuestionario.cuestionarioId, Number(req.params.id)));
  res.json({ intentos });
});
router.put('/intentos/:id/calificar-manual', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    const intentoId = Number(req.params.id);
    const { puntajesEnsayo } = req.body || {}; // {preguntaId: puntajeAsignado}
    const filas = await db.select().from(univIntentosCuestionario).where(eq(univIntentosCuestionario.id, intentoId));
    const intento = filas[0];
    if (!intento) return res.status(404).json({ error: 'Intento no encontrado.' });
    const preguntasFilas = await db.select({
      preguntaId: univPreguntas.id, tipo: univPreguntas.tipo, opciones: univPreguntas.opciones,
      respuestaCorta: univPreguntas.respuestaCorta, puntaje: univPreguntas.puntaje,
    }).from(univCuestionarioPreguntas)
      .innerJoin(univPreguntas, eq(univCuestionarioPreguntas.preguntaId, univPreguntas.id))
      .where(eq(univCuestionarioPreguntas.cuestionarioId, intento.cuestionarioId));
    const respuestas = (intento.respuestas as any) || {};
    let notaObtenida = 0;
    for (const p of preguntasFilas) {
      if (p.tipo === 'ENSAYO') {
        const asignado = Number((puntajesEnsayo || {})[String(p.preguntaId)]);
        notaObtenida += isNaN(asignado) ? 0 : Math.min(asignado, Number(p.puntaje) || 0);
      } else {
        const r = calificarRespuestaAutomatica(p, respuestas[String(p.preguntaId)]);
        notaObtenida += r.puntajeObtenido || 0;
      }
    }
    await db.update(univIntentosCuestionario).set({ notaObtenida: String(notaObtenida), tienePendientesManual: false, estado: 'CALIFICADO' }).where(eq(univIntentosCuestionario.id, intentoId));
    res.json({ ok: true, notaObtenida });
  } catch (err) {
    console.error('PUT /api/university/intentos/:id/calificar-manual error:', err);
    res.status(500).json({ error: 'Error interno calificando el intento.' });
  }
});

// ── AULA VIRTUAL ──────────────────────────────────────────────────────────
router.get('/aula/:seccionId', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const seccionId = req.params.seccionId;
    const seccion = await buscarSeccionConDetalle(sk, seccionId);
    if (!seccion) return res.status(404).json({ error: 'Sección no encontrada.' });

    let aulas = await db.select().from(lmsAulasVirtuales).where(and(eq(lmsAulasVirtuales.sk, sk), eq(lmsAulasVirtuales.grupoAsignaturaId, String(seccionId))));
    let aula = aulas[0];
    if (!aula) {
      const creadas = await db.insert(lmsAulasVirtuales).values({ sk, grupoAsignaturaId: String(seccionId), catedraticoU: seccion.catedraticoId, estado: 'activa', linkClaseVivo: '' }).returning();
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
    res.json({ seccion, aula, unidades: unidadesConContenido });
  } catch (err) {
    console.error('GET /api/university/aula/:seccionId error:', err);
    res.status(500).json({ error: 'Error interno consultando el aula virtual.' });
  }
});
router.put('/aula/:id', async (req: any, res) => {
  const { linkClaseVivo, estado } = req.body || {};
  const cambios: any = {};
  if (typeof linkClaseVivo === 'string') cambios.linkClaseVivo = linkClaseVivo;
  if (typeof estado === 'string') cambios.estado = estado;
  const actualizadas = await db.update(lmsAulasVirtuales).set(cambios).where(eq(lmsAulasVirtuales.id, Number(req.params.id))).returning();
  if (!actualizadas.length) return res.status(404).json({ error: 'Aula no encontrada.' });
  res.json({ aula: actualizadas[0] });
});

router.post('/unidades', async (req: any, res) => {
  const { aulaId, titulo, descripcion, visible, reordenar } = req.body || {};
  if (Array.isArray(reordenar)) {
    await Promise.all(reordenar.map((it: any) => db.update(lmsUnidades).set({ orden: Number(it.orden) || 0 }).where(eq(lmsUnidades.id, Number(it.id)))));
    return res.json({ ok: true });
  }
  if (!aulaId || !titulo) return res.status(400).json({ error: 'Faltan aulaId o titulo.' });
  const existentes = await db.select().from(lmsUnidades).where(eq(lmsUnidades.aulaId, Number(aulaId)));
  const creadas = await db.insert(lmsUnidades).values({ aulaId: Number(aulaId), titulo, descripcion: descripcion || '', orden: existentes.length, visible: visible !== false }).returning();
  res.json({ unidad: creadas[0] });
});
router.put('/unidades/:id', async (req: any, res) => {
  const { titulo, descripcion, visible } = req.body || {};
  const cambios: any = {};
  if (typeof titulo === 'string') cambios.titulo = titulo;
  if (typeof descripcion === 'string') cambios.descripcion = descripcion;
  if (typeof visible === 'boolean') cambios.visible = visible;
  const actualizadas = await db.update(lmsUnidades).set(cambios).where(eq(lmsUnidades.id, Number(req.params.id))).returning();
  res.json({ unidad: actualizadas[0] });
});
router.delete('/unidades/:id', async (req: any, res) => {
  await db.delete(lmsUnidades).where(eq(lmsUnidades.id, Number(req.params.id)));
  res.json({ ok: true });
});

router.post('/recursos', async (req: any, res) => {
  const { unidadId, titulo, tipo, urlCloudinary, contenidoHtml } = req.body || {};
  if (!unidadId || !titulo || !tipo) return res.status(400).json({ error: 'Faltan unidadId, titulo o tipo.' });
  const existentes = await db.select().from(lmsRecursos).where(eq(lmsRecursos.unidadId, Number(unidadId)));
  const creados = await db.insert(lmsRecursos).values({ unidadId: Number(unidadId), titulo, tipo, urlCloudinary: urlCloudinary || '', contenidoHtml: contenidoHtml || '', orden: existentes.length }).returning();
  res.json({ recurso: creados[0] });
});
router.delete('/recursos/:id', async (req: any, res) => {
  await db.delete(lmsRecursos).where(eq(lmsRecursos.id, Number(req.params.id)));
  res.json({ ok: true });
});

router.post('/actividades', async (req: any, res) => {
  const { unidadId, titulo, instruccion, tipo, fechaApertura, fechaCierre, porcentajeCorte, maxCalificacion, categoriaId } = req.body || {};
  if (!unidadId || !titulo || !tipo) return res.status(400).json({ error: 'Faltan unidadId, titulo o tipo.' });
  const creadas = await db.insert(lmsActividades).values({
    unidadId: Number(unidadId), titulo, instruccion: instruccion || '', tipo,
    fechaApertura: fechaApertura ? new Date(fechaApertura) : null, fechaCierre: fechaCierre ? new Date(fechaCierre) : null,
    porcentajeCorte: porcentajeCorte || '', maxCalificacion: maxCalificacion || '5.0',
    categoriaId: categoriaId ? Number(categoriaId) : null,
  }).returning();
  res.json({ actividad: creadas[0] });
});
router.put('/actividades/:id/categoria', async (req: any, res) => {
  const { categoriaId } = req.body || {};
  const actualizadas = await db.update(lmsActividades).set({ categoriaId: categoriaId ? Number(categoriaId) : null }).where(eq(lmsActividades.id, Number(req.params.id))).returning();
  if (!actualizadas.length) return res.status(404).json({ error: 'Actividad no encontrada.' });
  res.json({ actividad: actualizadas[0] });
});
router.delete('/actividades/:id', async (req: any, res) => {
  await db.delete(lmsActividades).where(eq(lmsActividades.id, Number(req.params.id)));
  res.json({ ok: true });
});

// El estudiante SOLO puede entregar en su propio nombre — se usa el userId
// de la SESIÓN VERIFICADA, no el que venga en el body (así nadie puede
// entregar a nombre de otro estudiante con solo cambiar un dato en la
// petición).
router.post('/entregas', async (req: any, res) => {
  try {
    const { sk, rol, userId } = req.sesionUniv;
    if (rol !== 'estudiante') return res.status(403).json({ error: 'Solo un estudiante puede enviar una entrega.' });
    const { actividadId, archivoUrlCloudinary, textoEntrega } = req.body || {};
    if (!actividadId) return res.status(400).json({ error: 'Falta actividadId.' });
    if (!archivoUrlCloudinary && !textoEntrega) return res.status(400).json({ error: 'Debe adjuntar un archivo o escribir una respuesta.' });

    const actividades = await db.select().from(lmsActividades).where(eq(lmsActividades.id, Number(actividadId)));
    const actividad = actividades[0];
    if (!actividad) return res.status(404).json({ error: 'Actividad no encontrada.' });
    const unidades = await db.select().from(lmsUnidades).where(eq(lmsUnidades.id, actividad.unidadId));
    const unidad = unidades[0];
    const aulas = unidad ? await db.select().from(lmsAulasVirtuales).where(eq(lmsAulasVirtuales.id, unidad.aulaId)) : [];
    const aula = aulas[0];
    if (!aula || aula.sk !== sk) return res.status(403).json({ error: 'Esta actividad no pertenece a su institución.' });

    // Verificación de matrícula: el estudiante debe tener una matrícula
    // real (tabla univ_matriculas) para la sección de esta aula — ya no se
    // verifica comparando el texto del "grupo", sino con una inscripción
    // formal, más precisa y auditable.
    const matriculaRows = await db.select().from(univMatriculas).where(and(eq(univMatriculas.seccionId, Number(aula.grupoAsignaturaId)), eq(univMatriculas.estudianteId, String(userId))));
    if (!matriculaRows.length) return res.status(403).json({ error: 'No está matriculado en la sección de esta actividad.' });

    const ahora = new Date();
    const estado = (actividad.fechaCierre && ahora > new Date(actividad.fechaCierre)) ? 'ATRASADO' : 'ENVIADO';
    const previas = await db.select().from(lmsEntregas).where(and(eq(lmsEntregas.actividadId, Number(actividadId)), eq(lmsEntregas.estudianteId, String(userId))));
    let entrega;
    if (previas.length) {
      const actualizadas = await db.update(lmsEntregas).set({ archivoUrlCloudinary: archivoUrlCloudinary || '', textoEntrega: textoEntrega || '', fechaEnvio: ahora, estado }).where(eq(lmsEntregas.id, previas[0].id)).returning();
      entrega = actualizadas[0];
    } else {
      const creadas = await db.insert(lmsEntregas).values({ actividadId: Number(actividadId), estudianteId: String(userId), archivoUrlCloudinary: archivoUrlCloudinary || '', textoEntrega: textoEntrega || '', estado }).returning();
      entrega = creadas[0];
    }
    res.json({ entrega });
  } catch (err) {
    console.error('POST /api/university/entregas error:', err);
    res.status(500).json({ error: 'Error interno guardando la entrega.' });
  }
});
router.get('/entregas/:actividadId', async (req: any, res) => {
  const entregas = await db.select().from(lmsEntregas).where(eq(lmsEntregas.actividadId, Number(req.params.actividadId)));
  res.json({ entregas });
});
// ── Buzón de Entregas — vista consolidada de TODAS las entregas del
// estudiante, con el contexto completo (actividad, asignatura, fechas,
// nota) en una sola consulta, para no tener que entrar aula por aula.
router.get('/mis-entregas', async (req: any, res) => {
  try {
    const { userId } = req.sesionUniv;
    const filas = await db.select({
      id: lmsEntregas.id, actividadId: lmsEntregas.actividadId, archivoUrlCloudinary: lmsEntregas.archivoUrlCloudinary,
      textoEntrega: lmsEntregas.textoEntrega, fechaEnvio: lmsEntregas.fechaEnvio, nota: lmsEntregas.nota,
      retroalimentacion: lmsEntregas.retroalimentacion, estado: lmsEntregas.estado,
      tituloActividad: lmsActividades.titulo, fechaCierre: lmsActividades.fechaCierre, maxCalificacion: lmsActividades.maxCalificacion,
      codigoMateria: lmsAsignaturasUniversidad.codigoMateria, nombreAsignatura: lmsAsignaturasUniversidad.nombre,
    }).from(lmsEntregas)
      .innerJoin(lmsActividades, eq(lmsEntregas.actividadId, lmsActividades.id))
      .innerJoin(lmsUnidades, eq(lmsActividades.unidadId, lmsUnidades.id))
      .innerJoin(lmsAulasVirtuales, eq(lmsUnidades.aulaId, lmsAulasVirtuales.id))
      .innerJoin(univSecciones, eq(lmsAulasVirtuales.grupoAsignaturaId, sql`${univSecciones.id}::text`))
      .innerJoin(lmsAsignaturasUniversidad, eq(univSecciones.asignaturaId, lmsAsignaturasUniversidad.id))
      .where(and(eq(lmsEntregas.estudianteId, String(userId)), eq(lmsAulasVirtuales.sk, req.sesionUniv.sk)));
    res.json({ entregas: filas });
  } catch (err) {
    console.error('GET /api/university/mis-entregas error:', err);
    res.status(500).json({ error: 'Error interno consultando sus entregas.' });
  }
});

// Solo un catedrático/admin puede calificar — y además alimenta el libro de
// calificaciones principal del sistema K-12 (mismo kv_store), tal como se
// pidió, sin que eso implique compartir código de renderizado.
router.put('/entregas/:id/calificar', async (req: any, res) => {
  try {
    const { sk, rol } = req.sesionUniv;
    if (rol === 'estudiante') return res.status(403).json({ error: 'No autorizado para calificar.' });
    const id = Number(req.params.id);
    const { nota, retroalimentacion } = req.body || {};
    const notaNum = Number(nota);
    if (isNaN(notaNum) || notaNum < 0 || notaNum > 5) return res.status(400).json({ error: 'La nota debe estar entre 0.0 y 5.0.' });

    const entregasActuales = await db.select().from(lmsEntregas).where(eq(lmsEntregas.id, id));
    const entregaActual = entregasActuales[0];
    if (!entregaActual) return res.status(404).json({ error: 'Entrega no encontrada.' });
    const actualizadas = await db.update(lmsEntregas).set({ nota: String(notaNum), retroalimentacion: retroalimentacion || '', estado: 'CALIFICADO' }).where(eq(lmsEntregas.id, id)).returning();

    let alimentado = false;
    try {
      const actividades = await db.select().from(lmsActividades).where(eq(lmsActividades.id, entregaActual.actividadId));
      const actividad = actividades[0];
      const unidades = actividad ? await db.select().from(lmsUnidades).where(eq(lmsUnidades.id, actividad.unidadId)) : [];
      const unidad = unidades[0];
      const aulas = unidad ? await db.select().from(lmsAulasVirtuales).where(eq(lmsAulasVirtuales.id, unidad.aulaId)) : [];
      const aula = aulas[0];
      if (aula && aula.sk === sk) {
        // La nota queda registrada en "univ_calificaciones_cortes", ligada
        // a la matrícula del estudiante en esta sección — ya no se escribe
        // dentro del bloque JSON de la institución.
        const matriculaRows = await db.select().from(univMatriculas).where(and(eq(univMatriculas.seccionId, Number(aula.grupoAsignaturaId)), eq(univMatriculas.estudianteId, entregaActual.estudianteId)));
        const matricula = matriculaRows[0];
        if (matricula) {
          const corte = actividad?.porcentajeCorte || '1';
          await db.insert(univCalificacionesCortes)
            .values({ matriculaId: matricula.id, corte, porcentaje: '0', nota: String(notaNum) })
            .onConflictDoUpdate({ target: [univCalificacionesCortes.matriculaId, univCalificacionesCortes.corte], set: { nota: String(notaNum), actualizadoEn: new Date() } });
          alimentado = true;
        }
      }
    } catch (errInterno) {
      console.warn('⚠️  No se pudo alimentar el libro de calificaciones desde Universidad:', errInterno);
    }
    res.json({ entrega: actualizadas[0], alimentadoEnPlanilla: alimentado });
  } catch (err) {
    console.error('PUT /api/university/entregas/:id/calificar error:', err);
    res.status(500).json({ error: 'Error interno calificando la entrega.' });
  }
});

// ── Historial Académico (transcript + GPA) — cálculo propio de este
// sistema, no depende de ninguna función del sistema K-12 anterior.
router.get('/historial/:estudianteId', async (req: any, res) => {
  try {
    const { sk, rol, userId } = req.sesionUniv;
    const estudianteId = req.params.estudianteId;
    if (rol === 'estudiante' && String(userId) !== String(estudianteId)) return res.status(403).json({ error: 'No puede ver el historial de otro estudiante.' });
    const inst = await leerInstitucion(sk);
    const est = inst ? (inst.ests || []).find((e: any) => String(e.id) === String(estudianteId)) : null;
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    const notaMinAprob = 3.0;

    const matriculas = await db.select({
      matriculaId: univMatriculas.id, codigoMateria: lmsAsignaturasUniversidad.codigoMateria,
      nombreAsignatura: lmsAsignaturasUniversidad.nombre, creditos: lmsAsignaturasUniversidad.creditos,
    }).from(univMatriculas)
      .innerJoin(univSecciones, eq(univMatriculas.seccionId, univSecciones.id))
      .innerJoin(lmsAsignaturasUniversidad, eq(univSecciones.asignaturaId, lmsAsignaturasUniversidad.id))
      .where(and(eq(univMatriculas.sk, sk), eq(univMatriculas.estudianteId, String(estudianteId))));

    let sumaPonderada = 0, sumaCreditos = 0, creditosAprobados = 0;
    const materias = await Promise.all(matriculas.map(async (m) => {
      const cortes = await db.select().from(univCalificacionesCortes).where(eq(univCalificacionesCortes.matriculaId, m.matriculaId));
      const notasValidas = cortes.map((c) => Number(c.nota)).filter((n) => !isNaN(n) && n > 0);
      const promedio = notasValidas.length ? notasValidas.reduce((a, b) => a + b, 0) / notasValidas.length : 0;
      if (promedio > 0) {
        sumaPonderada += promedio * (m.creditos || 0);
        sumaCreditos += (m.creditos || 0);
        if (promedio >= notaMinAprob) creditosAprobados += (m.creditos || 0);
      }
      return { codigoMateria: m.codigoMateria, nombreAsignatura: m.nombreAsignatura, creditos: m.creditos, promedio, estado: promedio === 0 ? 'EN_CURSO' : (promedio >= notaMinAprob ? 'APROBADO' : 'REPROBADO') };
    }));
    const gpa = sumaCreditos ? (sumaPonderada / sumaCreditos) : 0;
    res.json({ estudiante: { nombre: est.n, grupo: est.g }, materias, gpa, creditosAprobados, creditosTotales: sumaCreditos });
  } catch (err) {
    console.error('GET /api/university/historial/:estudianteId error:', err);
    res.status(500).json({ error: 'Error interno calculando el historial académico.' });
  }
});

// ── Subida de archivos a Cloudinary — igual que el sistema K-12, las
// entregas/recursos NUNCA suben el archivo pesado a la base de datos, solo
// la URL de Cloudinary que este endpoint devuelve. Protegido por la misma
// sesión de este sistema (exigirSesion ya se aplicó arriba con router.use).
router.post('/upload', uploadMemoria.single('archivo'), async (req: any, res) => {
  try {
    const archivo = (req as unknown as { file?: ArchivoSubidoMulter }).file;
    if (!archivo) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    const { sk } = req.sesionUniv;
    const carpeta = String(req.body?.carpeta || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
    const esImagen = archivo.mimetype.startsWith('image/');
    const resultado = await subirBufferACloudinary(archivo.buffer, {
      folder: 'gestor-yc/' + sk + '/universidad/' + carpeta,
      resourceType: esImagen ? 'image' : 'auto',
    });
    res.json({ url: resultado.url, bytes: resultado.bytes, format: resultado.format });
  } catch (err) {
    console.error('POST /api/university/upload error:', err);
    res.status(500).json({ error: 'No se pudo subir el archivo. Intente de nuevo.' });
  }
});

// ── Editar/eliminar Programas Académicos ─────────────────────────────────
router.put('/programas/:id', async (req: any, res) => {
  const { nombreCarrera, totalCreditos, departamentoId, nivel } = req.body || {};
  const cambios: any = {};
  if (typeof nombreCarrera === 'string') cambios.nombreCarrera = nombreCarrera;
  if (totalCreditos !== undefined) cambios.totalCreditos = Number(totalCreditos) || 0;
  if (departamentoId !== undefined) cambios.departamentoId = departamentoId ? Number(departamentoId) : null;
  if (typeof nivel === 'string') cambios.nivel = nivel;
  const actualizados = await db.update(lmsPlanesEstudio).set(cambios).where(and(eq(lmsPlanesEstudio.id, Number(req.params.id)), eq(lmsPlanesEstudio.sk, req.sesionUniv.sk))).returning();
  if (!actualizados.length) return res.status(404).json({ error: 'Programa no encontrado.' });
  res.json({ programa: actualizados[0] });
});
router.delete('/programas/:id', async (req: any, res) => {
  try {
    await db.delete(lmsPlanesEstudio).where(and(eq(lmsPlanesEstudio.id, Number(req.params.id)), eq(lmsPlanesEstudio.sk, req.sesionUniv.sk)));
    res.json({ ok: true });
  } catch (err) {
    // Si hay asignaturas referenciando este programa, la base de datos
    // rechaza el borrado (protección de integridad) — se avisa con
    // claridad en vez de un error genérico.
    res.status(409).json({ error: 'No se puede eliminar: hay asignaturas que pertenecen a este programa. Elimínelas primero, o simplemente edite el programa en vez de borrarlo.' });
  }
});

// ── Editar/eliminar Asignaturas ───────────────────────────────────────────
router.put('/asignaturas/:id', async (req: any, res) => {
  const { codigoMateria, nombre, creditos, horasPresenciales, horasIndependientes, semestre, prerrequisitoId, caracter } = req.body || {};
  const cambios: any = {};
  if (typeof codigoMateria === 'string') cambios.codigoMateria = codigoMateria;
  if (typeof nombre === 'string') cambios.nombre = nombre;
  if (creditos !== undefined) cambios.creditos = Number(creditos) || 0;
  if (horasPresenciales !== undefined) cambios.horasPresenciales = Number(horasPresenciales) || 0;
  if (horasIndependientes !== undefined) cambios.horasIndependientes = Number(horasIndependientes) || 0;
  if (semestre !== undefined) cambios.semestre = Number(semestre) || 1;
  if (prerrequisitoId !== undefined) cambios.prerrequisitoId = prerrequisitoId ? Number(prerrequisitoId) : null;
  if (['OBLIGATORIA', 'ELECTIVA', 'OPTATIVA'].includes(caracter)) cambios.caracter = caracter;
  const actualizadas = await db.update(lmsAsignaturasUniversidad).set(cambios).where(and(eq(lmsAsignaturasUniversidad.id, Number(req.params.id)), eq(lmsAsignaturasUniversidad.sk, req.sesionUniv.sk))).returning();
  if (!actualizadas.length) return res.status(404).json({ error: 'Asignatura no encontrada.' });
  res.json({ asignatura: actualizadas[0] });
});
router.delete('/asignaturas/:id', async (req: any, res) => {
  try {
    await db.delete(lmsAsignaturasUniversidad).where(and(eq(lmsAsignaturasUniversidad.id, Number(req.params.id)), eq(lmsAsignaturasUniversidad.sk, req.sesionUniv.sk)));
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'No se puede eliminar: otra asignatura la tiene como prerrequisito, o ya tiene una sección creada. Revise eso primero.' });
  }
});

// ── Editar/eliminar Secciones (tabla SQL "univ_secciones") ──────────────
router.put('/secciones/:id', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const { catedraticoId, grupo } = req.body || {};
    const cambios: any = {};
    if (typeof catedraticoId === 'string') cambios.catedraticoU = catedraticoId;
    if (typeof grupo === 'string') cambios.grupo = grupo;
    const actualizadas = await db.update(univSecciones).set(cambios).where(and(eq(univSecciones.id, Number(req.params.id)), eq(univSecciones.sk, sk))).returning();
    if (!actualizadas.length) return res.status(404).json({ error: 'Sección no encontrada.' });
    res.json({ seccion: { ...actualizadas[0], catedraticoId: actualizadas[0].catedraticoU } });
  } catch (err) {
    console.error('PUT /api/university/secciones/:id error:', err);
    res.status(500).json({ error: 'Error interno actualizando la sección.' });
  }
});
router.delete('/secciones/:id', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    await db.delete(univSecciones).where(and(eq(univSecciones.id, Number(req.params.id)), eq(univSecciones.sk, sk)));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/university/secciones/:id error:', err);
    res.status(500).json({ error: 'Error interno eliminando la sección.' });
  }
});

// ── Estudiantes: listar y matricular a un Programa Académico ────────────
// Los estudiantes en sí se siguen creando desde "Gestión de Estudiantes"
// del portal K-12 (misma base de usuarios) — aquí solo se les asigna a
// qué Programa Académico pertenecen, algo exclusivo de este sistema.
router.get('/estudiantes', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    const estudiantes = (inst.ests || []).map((e: any) => ({ id: e.id, nombre: e.n, grupo: e.g, numDoc: e.numDoc || '', planEstudioId: e.planEstudioId || null }));
    res.json({ estudiantes });
  } catch (err) {
    console.error('GET /api/university/estudiantes error:', err);
    res.status(500).json({ error: 'Error interno consultando los estudiantes.' });
  }
});
// ── Crear/matricular un estudiante NUEVO directamente desde el sistema
// universitario — no hace falta ir al portal K-12 para esto. El número de
// documento se usa como usuario y contraseña inicial (misma convención
// que ya usa el resto del sistema para estudiantes), así puede iniciar
// sesión de inmediato por el portal principal, que lo redirigirá aquí
// automáticamente por ser una institución tipo Universidad.
router.post('/estudiantes', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    const { sk } = req.sesionUniv;
    const { apellido1, apellido2, nombre1, nombre2, numDoc, grupo, planEstudioId } = req.body || {};
    if (!apellido1 || !nombre1 || !numDoc || !grupo) return res.status(400).json({ error: 'Faltan apellido, nombre, número de documento o grupo.' });
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    if (!inst.ests) inst.ests = [];
    const yaExiste = inst.ests.find((e: any) => String(e.numDoc) === String(numDoc));
    if (yaExiste) return res.status(409).json({ error: 'Ya existe un estudiante matriculado con ese número de documento.' });
    const nombreCompleto = [apellido1, apellido2, nombre1, nombre2].filter(Boolean).join(' ');
    // IMPORTANTE: se fijan "u" y "p" EXPLÍCITAMENTE (texto plano, igual al
    // número de documento) — es el mismo patrón exacto que usa el resto
    // del sistema al asignar credenciales a un estudiante (módulo "Ver
    // Credenciales" → _guardarCred). No basta con guardar solo "numDoc":
    // sin "u"/"p" puestos así, las credenciales quedan incompletas.
    const nuevoEstudiante = {
      id: Date.now() + Math.random(), n: nombreCompleto, g: String(grupo), numDoc: String(numDoc),
      u: String(numDoc), p: String(numDoc),
      apellido1, apellido2: apellido2 || '', nombre1, nombre2: nombre2 || '',
      nts: {}, observaciones: [], planEstudioId: planEstudioId ? Number(planEstudioId) : null,
    };
    inst.ests.push(nuevoEstudiante);
    await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
    res.json({ estudiante: { id: nuevoEstudiante.id, nombre: nuevoEstudiante.n, grupo: nuevoEstudiante.g, numDoc: nuevoEstudiante.numDoc, planEstudioId: nuevoEstudiante.planEstudioId } });
  } catch (err) {
    console.error('POST /api/university/estudiantes error:', err);
    res.status(500).json({ error: 'Error interno matriculando al estudiante.' });
  }
});
router.put('/estudiantes/:id/matricula', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    const { sk } = req.sesionUniv;
    const { planEstudioId, grupo } = req.body || {};
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    const idx = (inst.ests || []).findIndex((e: any) => String(e.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    if (planEstudioId !== undefined) inst.ests[idx].planEstudioId = planEstudioId || null;
    if (typeof grupo === 'string' && grupo.trim()) inst.ests[idx].g = grupo.trim();
    await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
    res.json({ estudiante: { id: inst.ests[idx].id, nombre: inst.ests[idx].n, grupo: inst.ests[idx].g, planEstudioId: inst.ests[idx].planEstudioId || null } });
  } catch (err) {
    console.error('PUT /api/university/estudiantes/:id/matricula error:', err);
    res.status(500).json({ error: 'Error interno matriculando al estudiante.' });
  }
});

// ── Ver/Restablecer credenciales — cierra el ciclo completo (crear,
// verificar, corregir) sin tener que salir al portal K-12 para nada de
// esto. La contraseña del estudiante se guarda en texto plano (mismo
// patrón que usa TODO el sistema para estudiantes, no es una decisión de
// este módulo), así que sí se puede mostrar tal cual; la del catedrático
// va cifrada, así que solo se puede restablecer, no volver a ver la
// original.
router.get('/estudiantes/:id/credenciales', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    const inst = await leerInstitucion(req.sesionUniv.sk);
    const e = inst ? (inst.ests || []).find((x: any) => String(x.id) === String(req.params.id)) : null;
    if (!e) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    res.json({ usuario: e.u || e.numDoc || '', password: e.p || e.numDoc || '' });
  } catch (err) {
    console.error('GET /api/university/estudiantes/:id/credenciales error:', err);
    res.status(500).json({ error: 'Error interno consultando las credenciales.' });
  }
});
router.put('/estudiantes/:id/credenciales', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    const { sk } = req.sesionUniv;
    const { usuario, password } = req.body || {};
    if (!usuario || !password) return res.status(400).json({ error: 'Falta el usuario o la contraseña.' });
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    const idx = (inst.ests || []).findIndex((e: any) => String(e.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    inst.ests[idx].u = String(usuario);
    inst.ests[idx].p = String(password);
    await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/university/estudiantes/:id/credenciales error:', err);
    res.status(500).json({ error: 'Error interno actualizando las credenciales.' });
  }
});
router.put('/docentes/:usuario/password', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede restablecer contraseñas de catedráticos.' });
    const { sk } = req.sesionUniv;
    const { password } = req.body || {};
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener mínimo 6 caracteres.' });
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });
    const idx = (inst.users || []).findIndex((u: any) => u.u === req.params.usuario && u.r === 'docente');
    if (idx === -1) return res.status(404).json({ error: 'Catedrático no encontrado.' });
    inst.users[idx].p = hashPasswordServidor(String(password));
    await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/university/docentes/:usuario/password error:', err);
    res.status(500).json({ error: 'Error interno restableciendo la contraseña.' });
  }
});

// ── Matrícula formal a una Sección (tabla univ_matriculas) — distinto del
// "planEstudioId" de arriba, que es la afiliación general del estudiante a
// una carrera; esto es la inscripción concreta a la sección de UNA
// asignatura puntual, la que realmente da acceso al Aula Virtual.
// El estudiante consulta SUS PROPIAS secciones matriculadas (según
// matrícula real, no por coincidencia de texto de "grupo" como antes).
// ── Categorías del Libro de Calificaciones (por Sección) ──────────────────
router.get('/secciones/:id/categorias', async (req: any, res) => {
  const categorias = await db.select().from(univGradebookCategorias).where(eq(univGradebookCategorias.seccionId, Number(req.params.id)));
  res.json({ categorias });
});
router.post('/secciones/:id/categorias', async (req: any, res) => {
  if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
  const seccionId = Number(req.params.id);
  const { nombre, porcentaje } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la categoría.' });
  const existentes = await db.select().from(univGradebookCategorias).where(eq(univGradebookCategorias.seccionId, seccionId));
  const creadas = await db.insert(univGradebookCategorias).values({ sk: req.sesionUniv.sk, seccionId, nombre, porcentaje: String(porcentaje || '0'), orden: existentes.length }).returning();
  res.json({ categoria: creadas[0] });
});
router.put('/categorias/:id', async (req: any, res) => {
  const { nombre, porcentaje } = req.body || {};
  const cambios: any = {};
  if (typeof nombre === 'string') cambios.nombre = nombre;
  if (porcentaje !== undefined) cambios.porcentaje = String(porcentaje);
  const actualizadas = await db.update(univGradebookCategorias).set(cambios).where(eq(univGradebookCategorias.id, Number(req.params.id))).returning();
  if (!actualizadas.length) return res.status(404).json({ error: 'Categoría no encontrada.' });
  res.json({ categoria: actualizadas[0] });
});
router.delete('/categorias/:id', async (req: any, res) => {
  await db.delete(univGradebookCategorias).where(eq(univGradebookCategorias.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── Libro de Calificaciones completo de una Sección ────────────────────────
router.get('/secciones/:id/gradebook', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const seccionId = Number(req.params.id);
    const categorias = await db.select().from(univGradebookCategorias).where(eq(univGradebookCategorias.seccionId, seccionId));

    // Todas las actividades de esta sección (a través de: sección → aula → unidades → actividades)
    const aulaRows = await db.select().from(lmsAulasVirtuales).where(eq(lmsAulasVirtuales.grupoAsignaturaId, String(seccionId)));
    const aula = aulaRows[0];
    let actividades: any[] = [];
    if (aula) {
      const unidades = await db.select().from(lmsUnidades).where(eq(lmsUnidades.aulaId, aula.id));
      for (const u of unidades) {
        const acts = await db.select().from(lmsActividades).where(eq(lmsActividades.unidadId, u.id));
        actividades = actividades.concat(acts);
      }
    }
    const actividadesPorCategoria: Record<number, number[]> = {};
    categorias.forEach((c) => { actividadesPorCategoria[c.id] = actividades.filter((a) => a.categoriaId === c.id).map((a) => a.id); });

    // Estudiantes matriculados en esta sección
    const matriculas = await db.select().from(univMatriculas).where(eq(univMatriculas.seccionId, seccionId));
    const inst = await leerInstitucion(sk);

    const filasEstudiantes = await Promise.all(matriculas.map(async (m) => {
      const est = inst ? (inst.ests || []).find((e: any) => String(e.id) === String(m.estudianteId)) : null;
      const calificacionesPorActividad: Record<number, CalifActividad | undefined> = {};
      for (const a of actividades) {
        if (a.tipo === 'QUIZ') {
          const cuestRows = await db.select().from(univCuestionarios).where(eq(univCuestionarios.actividadId, a.id));
          if (cuestRows.length) {
            const intentos = await db.select().from(univIntentosCuestionario).where(and(eq(univIntentosCuestionario.cuestionarioId, cuestRows[0].id), eq(univIntentosCuestionario.estudianteId, String(m.estudianteId))));
            const calificados = intentos.filter((i) => i.notaObtenida != null);
            if (calificados.length) {
              const notas = calificados.map((i) => Number(i.notaObtenida));
              let notaFinal: number;
              if (cuestRows[0].metodoCalificacion === 'PROMEDIO') notaFinal = notas.reduce((s, n) => s + n, 0) / notas.length;
              else if (cuestRows[0].metodoCalificacion === 'ULTIMO_INTENTO') notaFinal = notas[notas.length - 1];
              else notaFinal = Math.max(...notas); // NOTA_MAS_ALTA
              calificacionesPorActividad[a.id] = { nota: notaFinal, notaMaxima: Number(calificados[0].notaMaxima) || 5 };
            }
          }
        } else {
          const entregaRows = await db.select().from(lmsEntregas).where(and(eq(lmsEntregas.actividadId, a.id), eq(lmsEntregas.estudianteId, String(m.estudianteId))));
          const entrega = entregaRows[0];
          if (entrega && entrega.nota) calificacionesPorActividad[a.id] = { nota: Number(entrega.nota), notaMaxima: Number(a.maxCalificacion) || 5 };
        }
      }
      const resultado = calcularNotaFinalEstudiante(categorias.map((c) => ({ id: c.id, porcentaje: c.porcentaje })), actividadesPorCategoria, calificacionesPorActividad);
      return {
        estudianteId: m.estudianteId, nombre: est ? est.n : m.estudianteId,
        notaFinal: resultado.notaFinal, pesoUsado: resultado.pesoUsado, detalleCategorias: resultado.detalleCategorias,
        calificacionesPorActividad,
      };
    }));

    res.json({ categorias, actividades: actividades.map((a) => ({ id: a.id, titulo: a.titulo, tipo: a.tipo, categoriaId: a.categoriaId, maxCalificacion: a.maxCalificacion })), estudiantes: filasEstudiantes });
  } catch (err) {
    console.error('GET /api/university/secciones/:id/gradebook error:', err);
    res.status(500).json({ error: 'Error interno calculando el libro de calificaciones.' });
  }
});

// ── Importar notas masivas — solo para actividades tipo TAREA/FORO (las
// de tipo QUIZ se califican por su propio flujo, con sus intentos). Cada
// fila crea o actualiza la "entrega" del estudiante con la nota indicada.
router.post('/actividades/:id/importar-notas', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    const actividadId = Number(req.params.id);
    const { filas } = req.body || {}; // [{estudianteId, nota}]
    if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ error: 'No se recibieron filas para importar.' });
    let actualizados = 0, creados = 0, saltados = 0;
    for (const fila of filas) {
      const estudianteId = String(fila.estudianteId || '').trim();
      const notaNum = Number(fila.nota);
      if (!estudianteId || isNaN(notaNum)) { saltados++; continue; }
      const existentes = await db.select().from(lmsEntregas).where(and(eq(lmsEntregas.actividadId, actividadId), eq(lmsEntregas.estudianteId, estudianteId)));
      if (existentes.length) {
        await db.update(lmsEntregas).set({ nota: String(notaNum), estado: 'CALIFICADO' }).where(eq(lmsEntregas.id, existentes[0].id));
        actualizados++;
      } else {
        await db.insert(lmsEntregas).values({ actividadId, estudianteId, nota: String(notaNum), estado: 'CALIFICADO' });
        creados++;
      }
    }
    res.json({ ok: true, actualizados, creados, saltados });
  } catch (err) {
    console.error('POST /api/university/actividades/:id/importar-notas error:', err);
    res.status(500).json({ error: 'Error interno importando las notas.' });
  }
});

// ── Asistente Universitario (IA) — misma integración de Gemini que ya usa
// el sistema, pero con su PROPIA identidad: nunca se presenta como
// "Adán" ni menciona ese nombre — es el "Asistente Universitario" de
// este sistema, aparte.
function _asistenteUniversitarioSystemPrompt(contexto: any): string {
  const nombreInst = contexto?.nombreInstitucion || 'la institución';
  const rolLabel = contexto?.rol === 'docente' ? 'un catedrático' : (contexto?.rol === 'estudiante' ? 'un estudiante' : 'un administrador');
  return `Eres el "Asistente Universitario", el asistente de inteligencia artificial del sistema de Educación Superior de ${nombreInst}. `
    + `NUNCA reveles ni menciones ningún otro nombre para ti mismo, ni digas que eres un modelo de Google/Gemini ni ningún otro nombre de asistente — preséntate únicamente como "Asistente Universitario". `
    + `Estás ayudando a ${rolLabel}. Responde en español, de forma clara, profesional y concisa, enfocado en temas académicos, administrativos y de uso del sistema universitario (programas, asignaturas, matrícula, aula virtual, cuestionarios, calificaciones, cortes evaluativos). `
    + `Si te preguntan algo fuera de ese ámbito, puedes responder con normalidad, pero mantén siempre tu identidad como "Asistente Universitario".`;
}
router.post('/asistente/chat', async (req: any, res) => {
  try {
    const { mensaje, historial } = req.body || {};
    if (!mensaje || !String(mensaje).trim()) return res.status(400).json({ error: 'Escriba un mensaje.' });
    const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!apiKey) return res.status(503).json({ error: 'El Asistente Universitario no está disponible en este momento (falta configuración del servidor).' });

    const inst = await leerInstitucion(req.sesionUniv.sk);
    const systemPrompt = _asistenteUniversitarioSystemPrompt({ nombreInstitucion: inst?.nombre, rol: req.sesionUniv.rol });

    const genAI = new GoogleGenAI({ apiKey });
    const historialFormateado = (Array.isArray(historial) ? historial : []).slice(-10).map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.content || '') }],
    }));
    const chat = genAI.chats.create({
      model: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^models\//, ''),
      config: { systemInstruction: systemPrompt, temperature: 0.7, maxOutputTokens: 2048 },
      history: historialFormateado,
    });
    const respuesta = await chat.sendMessage({ message: String(mensaje) });
    res.json({ respuesta: respuesta.text || 'No se pudo generar una respuesta en este momento.' });
  } catch (err) {
    console.error('POST /api/university/asistente/chat error:', err);
    res.status(500).json({ error: 'El Asistente Universitario no pudo responder en este momento. Intente de nuevo.' });
  }
});

router.get('/mis-secciones', async (req: any, res) => {
  try {
    const { sk, userId } = req.sesionUniv;
    const filas = await db.select({
      id: univSecciones.id, grupo: univSecciones.grupo, codigoMateria: lmsAsignaturasUniversidad.codigoMateria,
      nombreAsignatura: lmsAsignaturasUniversidad.nombre, creditos: lmsAsignaturasUniversidad.creditos,
    }).from(univMatriculas)
      .innerJoin(univSecciones, eq(univMatriculas.seccionId, univSecciones.id))
      .innerJoin(lmsAsignaturasUniversidad, eq(univSecciones.asignaturaId, lmsAsignaturasUniversidad.id))
      .where(and(eq(univMatriculas.sk, sk), eq(univMatriculas.estudianteId, String(userId))));
    res.json({ secciones: filas });
  } catch (err) {
    console.error('GET /api/university/mis-secciones error:', err);
    res.status(500).json({ error: 'Error interno consultando sus secciones.' });
  }
});
router.get('/secciones/:id/matriculas', async (req: any, res) => {
  try {
    const { sk } = req.sesionUniv;
    const inst = await leerInstitucion(sk);
    const filas = await db.select().from(univMatriculas).where(and(eq(univMatriculas.seccionId, Number(req.params.id)), eq(univMatriculas.sk, sk)));
    const matriculas = filas.map((m) => {
      const est = inst ? (inst.ests || []).find((e: any) => String(e.id) === String(m.estudianteId)) : null;
      return { id: m.id, estudianteId: m.estudianteId, nombreEstudiante: est ? est.n : m.estudianteId };
    });
    res.json({ matriculas });
  } catch (err) {
    console.error('GET /api/university/secciones/:id/matriculas error:', err);
    res.status(500).json({ error: 'Error interno consultando las matrículas.' });
  }
});
router.post('/matriculas', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    const { sk } = req.sesionUniv;
    const { seccionId, estudianteId } = req.body || {};
    if (!seccionId || !estudianteId) return res.status(400).json({ error: 'Faltan seccionId o estudianteId.' });
    const seccion = await buscarSeccionConDetalle(sk, seccionId);
    if (!seccion) return res.status(404).json({ error: 'Sección no encontrada.' });
    const creadas = await db.insert(univMatriculas).values({ sk, seccionId: Number(seccionId), estudianteId: String(estudianteId) })
      .onConflictDoNothing().returning();
    res.json({ matricula: creadas[0] || null, yaExistia: !creadas.length });
  } catch (err) {
    console.error('POST /api/university/matriculas error:', err);
    res.status(500).json({ error: 'Error interno matriculando al estudiante en la sección.' });
  }
});
router.delete('/matriculas/:id', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol === 'estudiante') return res.status(403).json({ error: 'No autorizado.' });
    await db.delete(univMatriculas).where(and(eq(univMatriculas.id, Number(req.params.id)), eq(univMatriculas.sk, req.sesionUniv.sk)));
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/university/matriculas/:id error:', err);
    res.status(500).json({ error: 'Error interno retirando la matrícula.' });
  }
});

// ── Mi Perfil — para los 3 roles (admin, docente, estudiante) ───────────
router.get('/perfil', async (req: any, res) => {
  try {
    const { sk, rol, userId } = req.sesionUniv;
    const inst = await leerInstitucion(sk);
    let nombre = '', telefono = '', correo = '';
    if (inst) {
      if (rol === 'estudiante') {
        const est = (inst.ests || []).find((e: any) => String(e.id) === String(userId));
        if (est) { nombre = est.n; telefono = est.tel || est.telefono || ''; correo = est.email || ''; }
      } else {
        const u = (inst.users || []).find((x: any) => x.u === userId);
        if (u) { nombre = u.n; telefono = u.telefono || ''; correo = u.email || ''; }
      }
    }
    const filas = await db.select().from(univPerfiles).where(and(eq(univPerfiles.sk, sk), eq(univPerfiles.usuarioId, String(userId))));
    const perfil = filas[0];
    res.json({
      nombre, rol,
      telefono: perfil?.telefono || telefono,
      correo: perfil?.correo || correo,
      fotoUrl: perfil?.fotoUrl || '',
      biografia: perfil?.biografia || '',
      perfilCompletado: perfil?.perfilCompletado || false,
    });
  } catch (err) {
    console.error('GET /api/university/perfil error:', err);
    res.status(500).json({ error: 'Error interno consultando el perfil.' });
  }
});
router.put('/perfil', async (req: any, res) => {
  try {
    const { sk, rol, userId } = req.sesionUniv;
    const { telefono, correo, biografia, fotoUrl, nombre } = req.body || {};
    const cambiosPerfil: any = { actualizadoEn: new Date() };
    if (typeof telefono === 'string') cambiosPerfil.telefono = telefono;
    if (typeof correo === 'string') cambiosPerfil.correo = correo;
    if (typeof biografia === 'string') cambiosPerfil.biografia = biografia;
    if (typeof fotoUrl === 'string') cambiosPerfil.fotoUrl = fotoUrl;
    cambiosPerfil.perfilCompletado = true;

    const existentes = await db.select().from(univPerfiles).where(and(eq(univPerfiles.sk, sk), eq(univPerfiles.usuarioId, String(userId))));
    if (existentes.length) {
      await db.update(univPerfiles).set(cambiosPerfil).where(eq(univPerfiles.id, existentes[0].id));
    } else {
      await db.insert(univPerfiles).values({ sk, usuarioId: String(userId), rol, ...cambiosPerfil });
    }

    // El nombre (y el teléfono/foto, si se maneja también en el registro
    // K-12) se refleja también en el bloque JSON de la institución, para
    // que el resto del sistema (ej. listados del portal principal) lo
    // vea actualizado igual — best-effort, no bloquea si algo no cuadra.
    if (typeof nombre === 'string' && nombre.trim()) {
      try {
        const inst = await leerInstitucion(sk);
        if (inst) {
          if (rol === 'estudiante') {
            const idx = (inst.ests || []).findIndex((e: any) => String(e.id) === String(userId));
            if (idx !== -1) { inst.ests[idx].n = nombre.trim(); if (typeof telefono === 'string') inst.ests[idx].tel = telefono; }
          } else {
            const idx = (inst.users || []).findIndex((u: any) => u.u === userId);
            if (idx !== -1) { inst.users[idx].n = nombre.trim(); if (typeof telefono === 'string') inst.users[idx].telefono = telefono; if (typeof correo === 'string') inst.users[idx].email = correo; }
          }
          await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
        }
      } catch { /* no bloquea el guardado del perfil si esto falla */ }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/university/perfil error:', err);
    res.status(500).json({ error: 'Error interno actualizando el perfil.' });
  }
});

// ── Cambiar contraseña — verifica la actual y guarda la nueva en el
// MISMO lugar donde el portal principal la busca al iniciar sesión (así
// el cambio funciona en ambos sistemas, sin duplicar la autenticación).
router.put('/perfil/password', async (req: any, res) => {
  try {
    const { sk, rol, userId } = req.sesionUniv;
    const { passwordActual, passwordNueva } = req.body || {};
    if (!passwordActual || !passwordNueva) return res.status(400).json({ error: 'Falta la contraseña actual o la nueva.' });
    if (String(passwordNueva).length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener mínimo 6 caracteres.' });
    const CONTRASENAS_DEBILES = ['1234', '12345', '123456', '1234567', '12345678', 'admin', 'password', 'contraseña', 'qwerty', '000000'];
    if (CONTRASENAS_DEBILES.includes(String(passwordNueva).toLowerCase())) return res.status(400).json({ error: 'Esa contraseña es demasiado común/débil. Por seguridad, elija una distinta.' });
    const inst = await leerInstitucion(sk);
    if (!inst) return res.status(404).json({ error: 'Institución no encontrada.' });

    if (rol === 'estudiante') {
      const idx = (inst.ests || []).findIndex((e: any) => String(e.id) === String(userId));
      if (idx === -1) return res.status(404).json({ error: 'Estudiante no encontrado.' });
      const actual = inst.ests[idx].p || inst.ests[idx].numDoc || '';
      if (!verificarPasswordServidor(String(passwordActual), actual)) return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
      inst.ests[idx].p = hashPasswordServidor(String(passwordNueva));
    } else {
      const idx = (inst.users || []).findIndex((u: any) => u.u === userId);
      if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado.' });
      if (!verificarPasswordServidor(String(passwordActual), inst.users[idx].p || '')) return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
      inst.users[idx].p = hashPasswordServidor(String(passwordNueva));
    }
    await db.update(kvStore).set({ value: inst, updatedAt: new Date() }).where(eq(kvStore.key, sk));
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/university/perfil/password error:', err);
    res.status(500).json({ error: 'Error interno cambiando la contraseña.' });
  }
});

// ── Configuración de Cortes Evaluativos (solo admin) ─────────────────────
router.get('/config/cortes', async (req: any, res) => {
  try {
    const filas = await db.select().from(univConfigCortes).where(eq(univConfigCortes.sk, req.sesionUniv.sk));
    res.json({ cortes: filas[0]?.cortes || [{ nombre: 'Corte 1', porcentaje: 30 }, { nombre: 'Corte 2', porcentaje: 30 }, { nombre: 'Corte 3', porcentaje: 40 }] });
  } catch (err) {
    console.error('GET /api/university/config/cortes error:', err);
    res.status(500).json({ error: 'Error interno consultando la configuración de cortes.' });
  }
});
router.put('/config/cortes', async (req: any, res) => {
  try {
    if (req.sesionUniv.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede cambiar esta configuración.' });
    const { cortes } = req.body || {};
    if (!Array.isArray(cortes) || !cortes.length) return res.status(400).json({ error: 'Debe indicar al menos un corte.' });
    const sumaPorcentajes = cortes.reduce((s: number, c: any) => s + (Number(c.porcentaje) || 0), 0);
    if (Math.abs(sumaPorcentajes - 100) > 0.5) return res.status(400).json({ error: 'Los porcentajes de los cortes deben sumar 100% (suman ' + sumaPorcentajes + '%).' });
    const sk = req.sesionUniv.sk;
    const existentes = await db.select().from(univConfigCortes).where(eq(univConfigCortes.sk, sk));
    if (existentes.length) {
      await db.update(univConfigCortes).set({ cortes, actualizadoEn: new Date() }).where(eq(univConfigCortes.id, existentes[0].id));
    } else {
      await db.insert(univConfigCortes).values({ sk, cortes });
    }
    res.json({ ok: true, cortes });
  } catch (err) {
    console.error('PUT /api/university/config/cortes error:', err);
    res.status(500).json({ error: 'Error interno guardando la configuración de cortes.' });
  }
});

// ── Utilidades de contraseña — MISMO formato que ya usa el resto del
// sistema (pbkdf2$salt$hash, 100.000 iteraciones SHA-256), para que una
// contraseña cambiada aquí siga funcionando igual al iniciar sesión desde
// el portal principal, y viceversa.
// ── Calificación automática de una respuesta, según el tipo de pregunta.
// ENSAYO nunca se autocalifica (queda pendiente para el docente). El
// resto de tipos se comparan contra la(s) opción(es)/respuesta(s)
// correcta(s) definidas al crear la pregunta.
interface ResultadoCalificacion { puntajeObtenido: number | null; pendienteManual: boolean; }
function calificarRespuestaAutomatica(pregunta: any, respuestaEstudiante: any): ResultadoCalificacion {
  const puntajeMax = Number(pregunta.puntaje) || 0;
  if (pregunta.tipo === 'ENSAYO') return { puntajeObtenido: null, pendienteManual: true };
  if (pregunta.tipo === 'OPCION_UNICA' || pregunta.tipo === 'VERDADERO_FALSO') {
    const opciones = pregunta.opciones || [];
    const correcta = opciones.find((o: any) => o.correcta);
    const esCorrecta = !!correcta && String(respuestaEstudiante) === String(correcta.id);
    return { puntajeObtenido: esCorrecta ? puntajeMax : 0, pendienteManual: false };
  }
  if (pregunta.tipo === 'OPCION_MULTIPLE') {
    const opciones = pregunta.opciones || [];
    const idsCorrectas = new Set(opciones.filter((o: any) => o.correcta).map((o: any) => String(o.id)));
    const idsRespondidas = new Set((Array.isArray(respuestaEstudiante) ? respuestaEstudiante : []).map(String));
    // Todo o nada: el conjunto de opciones marcadas debe coincidir exactamente con el correcto.
    const coincideExacto = idsCorrectas.size === idsRespondidas.size && [...idsCorrectas].every((id) => idsRespondidas.has(id as string));
    return { puntajeObtenido: coincideExacto ? puntajeMax : 0, pendienteManual: false };
  }
  if (pregunta.tipo === 'RESPUESTA_CORTA') {
    const aceptadas = (pregunta.respuestaCorta || []).map((s: string) => String(s).trim().toLowerCase());
    const respuestaNormalizada = String(respuestaEstudiante || '').trim().toLowerCase();
    const esCorrecta = aceptadas.includes(respuestaNormalizada);
    return { puntajeObtenido: esCorrecta ? puntajeMax : 0, pendienteManual: false };
  }
  return { puntajeObtenido: 0, pendienteManual: false };
}

// ── Libro de Calificaciones (Gradebook): calcula el promedio ponderado de
// un estudiante a partir de las categorías de la sección y las notas ya
// registradas — sin notas aún en una categoría, esa categoría no cuenta
// todavía (no se confunde con "reprobado"), y cada actividad se normaliza
// a una escala de 0 a 5 antes de promediar, por si alguna tiene otra
// escala (ej. un examen calificado sobre 20 puntos).
interface CategoriaGradebook { id: number; porcentaje: string | number; }
interface CalifActividad { nota: number | null; notaMaxima: number; }
function calcularNotaFinalEstudiante(
  categorias: CategoriaGradebook[],
  actividadesPorCategoria: Record<number, number[]>,
  calificacionesPorActividad: Record<number, CalifActividad | undefined>
) {
  let notaFinal = 0, pesoUsado = 0;
  const detalleCategorias: any[] = [];
  for (const cat of categorias) {
    const actividades = actividadesPorCategoria[cat.id] || [];
    const notasNormalizadas = actividades
      .map((actId) => calificacionesPorActividad[actId])
      .filter((c): c is CalifActividad => !!c && c.nota != null)
      .map((c) => (Number(c.nota) / Number(c.notaMaxima || 5)) * 5);
    const promedioCategoria = notasNormalizadas.length ? notasNormalizadas.reduce((a, b) => a + b, 0) / notasNormalizadas.length : null;
    if (promedioCategoria != null) {
      notaFinal += promedioCategoria * (Number(cat.porcentaje) / 100);
      pesoUsado += Number(cat.porcentaje);
    }
    detalleCategorias.push({ categoriaId: cat.id, promedio: promedioCategoria });
  }
  return { notaFinal: pesoUsado > 0 ? notaFinal : null, detalleCategorias, pesoUsado };
}

function hashPasswordServidor(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return 'pbkdf2$' + salt.toString('hex') + '$' + hash.toString('hex');
}
function verificarPasswordServidor(passwordIngresada: string, valorGuardado: string): boolean {
  if (!valorGuardado) return false;
  if (!valorGuardado.startsWith('pbkdf2$') || valorGuardado.split('$').length !== 3) return passwordIngresada === valorGuardado; // heredada, sin cifrar
  const partes = valorGuardado.split('$');
  const recalculado = hashPasswordServidor(passwordIngresada, partes[1]);
  return recalculado.split('$')[2] === partes[2];
}

export default router;
