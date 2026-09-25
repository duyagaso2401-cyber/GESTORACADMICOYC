// ════════════════════════════════════════════════════════════════════════════
// MÓDULO ENTIDADES TERRITORIALES CERTIFICADAS (ETC) — Rutas API
// ------------------------------------------------------------------------------
// Lote 1 de este módulo: CRUD del perfil legal de la Entidad Territorial
// (punto 4 de la especificación — membrete/identidad legal) y de sus
// instituciones vinculadas con la bandera clave "usa_plataforma_yc" (punto
// 2 — cobertura institucional). El resto de la especificación (validación
// de pertenencia de docentes, formulario dinámico de permisos, escalado a
// la entidad, los 3 flujos de acceso híbrido, contratos/documentos/CRUD
// por rol) se construye en lotes siguientes sobre esta misma base.
//
// TODAS las rutas de este router están protegidas por
// checkModuleEnabled('ETC_CONTRACTING') (montado una sola vez al final de
// este archivo) — mientras el Súper Admin no haya activado el módulo,
// cualquier petición aquí responde 403 sin tocar Neon.
// ════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { db, ensureSchemaSimat } from '../db/index.js';
import { etcEntidades, etcInstituciones, etcContratos, etcOtpCodigos, etcDocumentos, etcAuditLog, docentePermisos, kvStore, simatEstudiantes } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { checkModuleEnabled, checkSimatEtcEnabled } from '../lib/feature-flags.js';
import { generarEsquemaSimatDinamico } from '../lib/simat-dynamic-schema.js';
import { verificarPertenenciaDocente, generarTokenAcceso, generarCodigoOtp } from '../lib/etc-verificacion.js';
import { hashPasswordServidor, verificarPasswordServidor } from '../lib/reset-tokens.js';
import { enviarNotificacionMulticanal, smsNotificacionesHabilitadasGlobalmente } from '../lib/sms-provider.js';
import { enviarPushADocente } from '../lib/push-provider.js';
import { broadcastChange } from '../lib/sync-bus.js';
import { uploadMemoria, subirBufferACloudinary } from '../lib/upload.js';
import type { Request, Response, NextFunction } from 'express';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// LOTE 5 (Ronda 33) — RBAC ligero + rastro de auditoría centralizado.
// ------------------------------------------------------------------------------
// El sistema K-12 no tiene (todavía) sesión/autenticación de backend real
// (ver notas de rondas anteriores) — el rol de quien llama se identifica
// hoy con el mismo criterio que ya usan `creadoPor`/`actualizadoPor` en
// TODO este router desde el Lote 1: el propio cliente declara quién es y
// con qué rol actúa. `requiereRol()` formaliza ese criterio en un gate real
// y explícito (en vez de dejarlo solo como una convención de nombres de
// campo) para los endpoints más sensibles del módulo, leyendo el rol de
// `body.rolActor` (o, en peticiones sin cuerpo como DELETE por querystring,
// `query.rolActor`/el encabezado `x-rol-actor`) y respondiendo 403 si no es
// uno de los roles permitidos. Migrar esto a sesión/JWT real de backend
// queda fuera de alcance de esta ronda (requeriría un mecanismo de sesión
// que hoy no existe en ningún endpoint de este proyecto), pero el gate ya
// es real: una petición que declare un rol no autorizado es rechazada.
// ════════════════════════════════════════════════════════════════════════════
// RONDA 36 — se agrega 'GOBERNACION_ETC' (rol de solo-lectura para
// supervisores/directores de núcleo/auditores de la Secretaría de
// Educación — ver el Portal ETC/Gobernación más abajo). 'AUDITOR_ETC'
// mencionado en la especificación se trata como el MISMO rol/permiso que
// 'GOBERNACION_ETC' (un único valor de rol, dos nombres coloquiales para la
// misma función) — no se duplicó el enum para no crear dos roles con
// exactamente los mismos permisos que alguien tendría que mantener en
// sincronía a mano.
type RolEtc = 'Docente' | 'Aspirante' | 'Rector' | 'Directivo' | 'Admin_ETC' | 'Superadmin' | 'GOBERNACION_ETC';

function _rolDeLaPeticion(req: Request): string {
  const b = (req.body && (req.body.rolActor || req.body.rol)) || '';
  const q = (req.query && (req.query.rolActor as string)) || '';
  const h = (req.headers && (req.headers['x-rol-actor'] as string)) || '';
  return String(b || q || h || '').trim();
}

function _actorDeLaPeticion(req: Request): string {
  const b = (req.body && (req.body.actorCedula || req.body.actorUsuario || req.body.creadoPor || req.body.actualizadoPor)) || '';
  const h = (req.headers && (req.headers['x-actor'] as string)) || '';
  return String(b || h || '').trim();
}

function requiereRol(rolesPermitidos: RolEtc[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const rol = _rolDeLaPeticion(req);
    if (!rol || !rolesPermitidos.includes(rol as RolEtc)) {
      return res.status(403).json({
        ok: false,
        error: `Esta acción requiere uno de estos roles: ${rolesPermitidos.join(', ')}.`,
      });
    }
    return next();
  };
}

// Log de auditoría append-only (etc_audit_log) — nunca lanza: un fallo al
// registrar la auditoría (ej. la tabla aún no existe porque el módulo se
// activó apenas en esta misma petición, o Neon está temporalmente fuera)
// jamás debe tumbar ni revertir la acción real que se está auditando.
async function registrarAuditoriaEtc(opts: {
  entidadId?: number | null;
  actor?: string;
  rol?: string;
  accion: string;
  objetivoTipo?: string;
  objetivoId?: number | null;
  detalle?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(etcAuditLog).values({
      entidadId: opts.entidadId ?? null,
      actor: String(opts.actor || ''),
      rol: String(opts.rol || ''),
      accion: opts.accion,
      objetivoTipo: String(opts.objetivoTipo || ''),
      objetivoId: opts.objetivoId ?? null,
      detalle: opts.detalle && typeof opts.detalle === 'object' ? opts.detalle : {},
    });
  } catch (e) {
    console.error('registrarAuditoriaEtc', e);
  }
}

// Protección aplicada aquí mismo, como el PRIMER middleware de este router
// — así ninguna ruta definida abajo (presente o futura) puede quedar sin
// protección por descuido, sin depender de que quien monte este router en
// src/index.ts recuerde aplicarla también ahí.
router.use(checkModuleEnabled('ETC_CONTRACTING'));

// ── Entidades Territoriales (perfil legal completo — punto 4) ────────────────

router.get('/entidades', async (_req, res) => {
  try {
    const filas = await db.select().from(etcEntidades).orderBy(desc(etcEntidades.id));
    return res.json({ ok: true, entidades: filas });
  } catch (e) {
    console.error('GET /api/etc/entidades', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar las entidades territoriales.' });
  }
});

router.get('/entidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const filas = await db.select().from(etcEntidades).where(eq(etcEntidades.id, id));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Entidad no encontrada' });
    return res.json({ ok: true, entidad: filas[0] });
  } catch (e) {
    console.error('GET /api/etc/entidades/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/entidades', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.nombreEntidad || !String(b.nombreEntidad).trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre oficial de la entidad es obligatorio.' });
    }
    const tiposValidos = ['Departamento', 'Distrito', 'Municipio_Certificado'];
    const tipoEntidad = tiposValidos.includes(b.tipoEntidad) ? b.tipoEntidad : 'Municipio_Certificado';
    const [creada] = await db.insert(etcEntidades).values({
      nombreEntidad: String(b.nombreEntidad).trim(),
      tipoEntidad,
      nit: String(b.nit || ''),
      direccion: String(b.direccion || ''),
      telefono: String(b.telefono || ''),
      emailContacto: String(b.emailContacto || ''),
      logoUrl: String(b.logoUrl || ''),
      firmaRepresentanteUrl: String(b.firmaRepresentanteUrl || ''),
      customFormSchema: b.customFormSchema && typeof b.customFormSchema === 'object' ? b.customFormSchema : {},
      creadoPor: String(b.creadoPor || ''),
      actualizadoPor: String(b.creadoPor || ''),
    }).returning();
    return res.json({ ok: true, entidad: creada });
  } catch (e) {
    console.error('POST /api/etc/entidades', e);
    return res.status(500).json({ ok: false, error: 'Error interno al crear la entidad territorial.' });
  }
});

router.put('/entidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = req.body || {};
    const existentes = await db.select().from(etcEntidades).where(eq(etcEntidades.id, id));
    if (!existentes.length) return res.status(404).json({ ok: false, error: 'Entidad no encontrada' });
    const tiposValidos = ['Departamento', 'Distrito', 'Municipio_Certificado'];
    const cambios: Record<string, any> = { updatedAt: new Date(), actualizadoPor: String(b.actualizadoPor || '') };
    if (typeof b.nombreEntidad === 'string' && b.nombreEntidad.trim()) cambios.nombreEntidad = b.nombreEntidad.trim();
    if (tiposValidos.includes(b.tipoEntidad)) cambios.tipoEntidad = b.tipoEntidad;
    for (const campo of ['nit', 'direccion', 'telefono', 'emailContacto', 'logoUrl', 'firmaRepresentanteUrl']) {
      if (typeof b[campo] === 'string') cambios[campo] = b[campo];
    }
    if (b.customFormSchema && typeof b.customFormSchema === 'object') cambios.customFormSchema = b.customFormSchema;
    // Multi-tenant de SMS (punto 3 del ajuste): cada entidad guarda AQUÍ
    // sus propias credenciales del proveedor que ella contrató — nunca se
    // valida contra un proveedor "conocido" en este endpoint (el
    // despachador agnóstico de sms-provider.ts es el único que interpreta
    // "proveedor"), para no tener que tocar este archivo cada vez que se
    // sume un proveedor nuevo.
    if (b.smsProviderConfig && typeof b.smsProviderConfig === 'object') cambios.smsProviderConfig = b.smsProviderConfig;
    if (typeof b.activo === 'boolean') cambios.activo = b.activo;
    const [actualizada] = await db.update(etcEntidades).set(cambios).where(eq(etcEntidades.id, id)).returning();
    return res.json({ ok: true, entidad: actualizada });
  } catch (e) {
    console.error('PUT /api/etc/entidades/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al actualizar la entidad territorial.' });
  }
});

// Eliminación = inactivación lógica (nunca DELETE físico) — punto 5: "Admin
// ETC y Superadmin: Control total CRUD... dejando rastro en logs de
// auditoría". Se conserva el registro (createdAt/actualizadoPor) como
// rastro; un DELETE físico real, si algún día hace falta, debería vivir en
// un endpoint aparte solo para Superadmin, no aquí.
// Lote 5 — control total CRUD reservado a Admin ETC/Superadmin (punto 5),
// con rastro de auditoría de quién inactivó qué entidad y cuándo.
router.delete('/entidades/:id', requiereRol(['Admin_ETC', 'Superadmin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const actualizadoPor = String((req.body && req.body.actualizadoPor) || req.query.actualizadoPor || '');
    const [actualizada] = await db.update(etcEntidades)
      .set({ activo: false, actualizadoPor, updatedAt: new Date() })
      .where(eq(etcEntidades.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Entidad no encontrada' });
    await registrarAuditoriaEtc({
      entidadId: id, actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req),
      accion: 'inactivar_entidad', objetivoTipo: 'entidad', objetivoId: id,
    });
    return res.json({ ok: true, entidad: actualizada });
  } catch (e) {
    console.error('DELETE /api/etc/entidades/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al inactivar la entidad territorial.' });
  }
});

// ── Instituciones vinculadas a una entidad (punto 2 — cobertura + DANE) ──────

router.get('/entidades/:entidadId/instituciones', async (req, res) => {
  try {
    const entidadId = Number(req.params.entidadId);
    if (!entidadId) return res.status(400).json({ ok: false, error: 'entidadId inválido' });
    const filas = await db.select().from(etcInstituciones).where(eq(etcInstituciones.entidadId, entidadId));
    return res.json({ ok: true, instituciones: filas });
  } catch (e) {
    console.error('GET /api/etc/entidades/:entidadId/instituciones', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar las instituciones.' });
  }
});

router.post('/entidades/:entidadId/instituciones', async (req, res) => {
  try {
    const entidadId = Number(req.params.entidadId);
    if (!entidadId) return res.status(400).json({ ok: false, error: 'entidadId inválido' });
    const b = req.body || {};
    if (!b.codigoDane || !String(b.codigoDane).trim()) {
      return res.status(400).json({ ok: false, error: 'El código DANE es obligatorio.' });
    }
    if (!b.nombreInstitucion || !String(b.nombreInstitucion).trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre de la institución es obligatorio.' });
    }
    const entidad = await db.select().from(etcEntidades).where(eq(etcEntidades.id, entidadId));
    if (!entidad.length) return res.status(404).json({ ok: false, error: 'La entidad territorial no existe.' });
    const [creada] = await db.insert(etcInstituciones).values({
      entidadId,
      codigoDane: String(b.codigoDane).trim(),
      nombreInstitucion: String(b.nombreInstitucion).trim(),
      usaPlataformaYc: !!b.usaPlataformaYc,
      skPlataformaYc: String(b.skPlataformaYc || ''),
    }).returning();
    return res.json({ ok: true, institucion: creada });
  } catch (e: any) {
    // Violación del índice único (entidad_id, codigo_dane) — mensaje claro
    // en vez del error crudo de Postgres.
    if (e && e.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe una institución con ese código DANE registrada en esta entidad territorial.' });
    }
    console.error('POST /api/etc/entidades/:entidadId/instituciones', e);
    return res.status(500).json({ ok: false, error: 'Error interno al registrar la institución.' });
  }
});

router.put('/instituciones/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = req.body || {};
    const cambios: Record<string, any> = {};
    if (typeof b.codigoDane === 'string' && b.codigoDane.trim()) cambios.codigoDane = b.codigoDane.trim();
    if (typeof b.nombreInstitucion === 'string' && b.nombreInstitucion.trim()) cambios.nombreInstitucion = b.nombreInstitucion.trim();
    if (typeof b.usaPlataformaYc === 'boolean') cambios.usaPlataformaYc = b.usaPlataformaYc;
    if (typeof b.skPlataformaYc === 'string') cambios.skPlataformaYc = b.skPlataformaYc;
    if (typeof b.autoReportEntidad === 'boolean') cambios.autoReportEntidad = b.autoReportEntidad;
    if (typeof b.activa === 'boolean') cambios.activa = b.activa;
    if (!Object.keys(cambios).length) return res.status(400).json({ ok: false, error: 'No hay cambios que aplicar.' });
    const [actualizada] = await db.update(etcInstituciones).set(cambios).where(eq(etcInstituciones.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Institución no encontrada' });
    return res.json({ ok: true, institucion: actualizada });
  } catch (e) {
    console.error('PUT /api/etc/instituciones/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al actualizar la institución.' });
  }
});

router.delete('/instituciones/:id', requiereRol(['Admin_ETC', 'Superadmin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const [actualizada] = await db.update(etcInstituciones).set({ activa: false }).where(eq(etcInstituciones.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Institución no encontrada' });
    await registrarAuditoriaEtc({
      entidadId: actualizada.entidadId, actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req),
      accion: 'inactivar_institucion', objetivoTipo: 'institucion', objetivoId: id,
    });
    return res.json({ ok: true, institucion: actualizada });
  } catch (e) {
    console.error('DELETE /api/etc/instituciones/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al inactivar la institución.' });
  }
});

// Punto 2 — "verificar dinámicamente si el colegio usa YC": endpoint de
// consulta rápida por código DANE, usado por el flujo de registro/
// contratación (Lote 2) antes de decidir si provisiona credenciales
// automáticas o solo guarda el expediente en la nube de la ETC.
router.get('/instituciones/buscar-por-dane/:codigoDane', async (req, res) => {
  try {
    const codigoDane = String(req.params.codigoDane || '').trim();
    if (!codigoDane) return res.status(400).json({ ok: false, error: 'codigoDane requerido' });
    const filas = await db.select().from(etcInstituciones).where(eq(etcInstituciones.codigoDane, codigoDane));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'No hay ninguna institución registrada con ese código DANE en el módulo ETC.' });
    return res.json({ ok: true, instituciones: filas });
  } catch (e) {
    console.error('GET /api/etc/instituciones/buscar-por-dane/:codigoDane', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Lote 3 — descubrimiento de cobertura ETC por parte de una institución
// que YA usa la plataforma YC: dado el "sk" del propio colegio (el mismo
// que usa GET/POST /api/inetis/db), el frontend del módulo de permisos/
// ausentismo (06-documentos-y-resto.js) consulta este endpoint para saber
// si esa institución está vinculada a alguna ETC y, si lo está, trae de
// una vez el `custom_form_schema` de la entidad (motor de campos
// dinámicos, punto 3) y la config `autoReportEntidad` (manual/automático).
// Nunca expone el resto del perfil legal de la entidad (NIT, firma, etc.)
// — esos datos se reservan para el Lote 4 (membretes).
router.get('/instituciones/buscar-por-sk/:sk', async (req, res) => {
  try {
    const sk = String(req.params.sk || '').trim();
    if (!sk) return res.status(400).json({ ok: false, error: 'sk requerido' });
    const filas = await db.select().from(etcInstituciones)
      .where(and(eq(etcInstituciones.skPlataformaYc, sk), eq(etcInstituciones.usaPlataformaYc, true), eq(etcInstituciones.activa, true)));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Esta institución no está vinculada a ninguna entidad territorial en el módulo ETC.' });
    const institucion = filas[0];
    const entidadFilas = await db.select().from(etcEntidades).where(eq(etcEntidades.id, institucion.entidadId));
    const entidad = entidadFilas[0];
    if (!entidad || !entidad.activo) return res.status(404).json({ ok: false, error: 'La entidad territorial de esta institución no está activa.' });
    return res.json({
      ok: true,
      institucion: { id: institucion.id, entidadId: institucion.entidadId, autoReportEntidad: institucion.autoReportEntidad },
      entidad: { id: entidad.id, nombreEntidad: entidad.nombreEntidad, customFormSchema: entidad.customFormSchema || {} },
    });
  } catch (e) {
    console.error('GET /api/etc/instituciones/buscar-por-sk/:sk', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// LOTE 2 — Expedientes de contratación (etc_contratos) + Flujos B/C de
// acceso híbrido (punto 5 de la especificación).
//
// Recordatorio de los 3 flujos:
//   Flujo A: docente activo CON plataforma YC → entra con su usuario y
//            contraseña institucional de siempre (el sistema K-12 no tiene
//            hoy sesión/autenticación de backend — ver nota en el
//            checklist — así que este flujo, en esta ronda, se limita a
//            que la verificación automática de abajo reconozca al docente;
//            la integración de sesión real queda para el Lote 5, con el
//            resto de la especificación de roles).
//   Flujo B: docente activo/asignado SIN plataforma YC → accede por Link
//            Único/Token Seguro (endpoints /contratos/acceso/token/:token
//            y POST /api/contratacion/acceso-link) o por Cédula + Código
//            OTP (endpoints /contratos/acceso/otp/solicitar y /verificar).
//   Flujo C: aspirante nuevo/convocatoria → registro público con
//            POST /contratos; si se aprueba y la institución usa YC, se
//            aprovisionan credenciales automáticas (ver /:id/evaluar).
// ════════════════════════════════════════════════════════════════════════════

// Campos "seguros para mostrar públicamente" de un contrato — nunca se
// exponen aquí el token de acceso ni datos de otros aspirantes, para que
// estos endpoints (usados desde enlaces/portales sin sesión) no filtren
// más de lo necesario.
function _contratoPublico(c: any) {
  return {
    id: c.id,
    nombreCompleto: c.nombreCompleto,
    estadoContrato: c.estadoContrato,
    institucionDestinoDane: c.institucionDestinoDane,
    municipio: c.municipio,
  };
}

// ── Expedientes (Flujo C: registro público de aspirante/docente) ────────────

router.get('/contratos', async (req, res) => {
  try {
    const { entidadId, estado } = req.query as { entidadId?: string; estado?: string };
    const condiciones = [];
    if (entidadId) condiciones.push(eq(etcContratos.entidadId, Number(entidadId)));
    if (estado) condiciones.push(eq(etcContratos.estadoContrato, String(estado)));
    const filas = condiciones.length
      ? await db.select().from(etcContratos).where(and(...condiciones)).orderBy(desc(etcContratos.id))
      : await db.select().from(etcContratos).orderBy(desc(etcContratos.id));
    return res.json({ ok: true, contratos: filas });
  } catch (e) {
    console.error('GET /api/etc/contratos', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar los expedientes.' });
  }
});

router.get('/contratos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const filas = await db.select().from(etcContratos).where(eq(etcContratos.id, id));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Expediente no encontrado' });
    return res.json({ ok: true, contrato: filas[0] });
  } catch (e) {
    console.error('GET /api/etc/contratos/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/contratos', async (req, res) => {
  try {
    const b = req.body || {};
    const entidadId = Number(b.entidadId);
    if (!entidadId) return res.status(400).json({ ok: false, error: 'entidadId es obligatorio.' });
    if (!b.docenteCedula || !String(b.docenteCedula).trim()) {
      return res.status(400).json({ ok: false, error: 'La cédula es obligatoria.' });
    }
    if (!b.nombreCompleto || !String(b.nombreCompleto).trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre completo es obligatorio.' });
    }
    const entidad = await db.select().from(etcEntidades).where(eq(etcEntidades.id, entidadId));
    if (!entidad.length) return res.status(404).json({ ok: false, error: 'La entidad territorial no existe.' });

    const codigoDane = String(b.institucionDestinoDane || '').trim();
    let institucion: typeof etcInstituciones.$inferSelect | undefined;
    if (codigoDane) {
      const filas = await db.select().from(etcInstituciones)
        .where(and(eq(etcInstituciones.entidadId, entidadId), eq(etcInstituciones.codigoDane, codigoDane)));
      institucion = filas[0];
    }

    // Punto 2: verificación automática de pertenencia — solo tiene sentido
    // si se indicó una institución destino registrada en el módulo ETC.
    let estadoContrato = 'Pendiente';
    let motivoVerificacion = 'No se indicó una institución destino registrada en el módulo ETC — sin verificación automática.';
    if (institucion) {
      const verificacion = await verificarPertenenciaDocente(institucion.id, String(b.docenteCedula));
      motivoVerificacion = verificacion.motivo;
      if (verificacion.institucionUsaYc && !verificacion.encontrado) {
        estadoContrato = 'Pendiente_Validacion_Institucional';
      }
    }

    const [creado] = await db.insert(etcContratos).values({
      entidadId,
      docenteCedula: String(b.docenteCedula).trim(),
      nombreCompleto: String(b.nombreCompleto).trim(),
      correo: String(b.correo || ''),
      telefono: String(b.telefono || ''),
      municipio: String(b.municipio || ''),
      institucionDestinoDane: codigoDane,
      usaPlataformaYc: !!(institucion && institucion.usaPlataformaYc),
      estadoContrato,
      tokenAccesoUnico: generarTokenAcceso(),
      creadoPor: String(b.creadoPor || 'Registro público (Flujo C)'),
      actualizadoPor: String(b.creadoPor || 'Registro público (Flujo C)'),
    }).returning();

    return res.json({ ok: true, contrato: creado, verificacion: motivoVerificacion });
  } catch (e) {
    console.error('POST /api/etc/contratos', e);
    return res.status(500).json({ ok: false, error: 'Error interno al registrar el expediente.' });
  }
});

// Edición: el punto 5 restringe quién puede editar según el rol (el
// Docente/Aspirante solo mientras está 'Pendiente'; Rector/Admin ETC con
// más margen). El sistema K-12 no tiene hoy autenticación de backend por
// rol (ver nota en el checklist de esta ronda) — igual que el resto de
// endpoints existentes, esta restricción por ahora se documenta y se dejan
// los campos actualizadoPor/updatedAt como rastro de auditoría mínimo;
// aplicar el rol real del que llama queda para el Lote 5, cuando se
// implemente sesión/autenticación real de este módulo.
router.put('/contratos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const existentes = await db.select().from(etcContratos).where(eq(etcContratos.id, id));
    if (!existentes.length) return res.status(404).json({ ok: false, error: 'Expediente no encontrado' });
    const b = req.body || {};
    const cambios: Record<string, any> = { updatedAt: new Date(), actualizadoPor: String(b.actualizadoPor || '') };
    for (const campo of ['nombreCompleto', 'correo', 'telefono', 'municipio', 'institucionDestinoDane']) {
      if (typeof b[campo] === 'string' && b[campo].trim()) cambios[campo] = b[campo].trim();
    }
    if (typeof b.docenteCedula === 'string' && b.docenteCedula.trim()) cambios.docenteCedula = b.docenteCedula.trim();
    if (!Object.keys(cambios).length) return res.status(400).json({ ok: false, error: 'No hay cambios que aplicar.' });
    const [actualizado] = await db.update(etcContratos).set(cambios).where(eq(etcContratos.id, id)).returning();
    return res.json({ ok: true, contrato: actualizado });
  } catch (e) {
    console.error('PUT /api/etc/contratos/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno al actualizar el expediente.' });
  }
});

// Evaluación del Rector/Admin ETC (punto 3/5): Aprobado | Rechazado |
// Con_Observaciones. Si se aprueba y la institución destino usa la
// plataforma YC y la persona NO fue reconocida como docente ya existente,
// se aprovisiona una cuenta nueva automáticamente (punto 5, Flujo C) y se
// notifica por el único canal de correo del sistema
// (enviarCorreoGeneral/POST /api/inetis/send-email — nunca se crea un
// canal nuevo). El envío de correo es best-effort: si el proveedor no está
// configurado o falla, la aprobación NO se revierte (mismo criterio ya
// usado en /api/inetis/auth/restablecer/solicitar). Lote 5: reservado a
// Rector/Directivo/Admin ETC/Superadmin, y — en PARALELO con el correo/SMS
// multicanal — se dispara además una notificación PUSH flotante al
// docente si tiene el navegador suscrito (enviarPushADocente(), nunca
// bloqueante ni puede fallar la respuesta de este endpoint).
router.post('/contratos/:id/evaluar', requiereRol(['Rector', 'Directivo', 'Admin_ETC', 'Superadmin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = req.body || {};
    const estadosValidos = ['Aprobado', 'Rechazado', 'Con_Observaciones'];
    if (!estadosValidos.includes(b.estadoContrato)) {
      return res.status(400).json({ ok: false, error: 'estadoContrato debe ser Aprobado, Rechazado o Con_Observaciones.' });
    }
    const filas = await db.select().from(etcContratos).where(eq(etcContratos.id, id));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Expediente no encontrado' });
    const contrato = filas[0];

    const [actualizado] = await db.update(etcContratos).set({
      estadoContrato: b.estadoContrato,
      actualizadoPor: String(b.evaluadoPor || ''),
      updatedAt: new Date(),
    }).where(eq(etcContratos.id, id)).returning();

    // Notificación push flotante (Ronda 33) — se dispara en PARALELO con el
    // correo/SMS de abajo (nunca se espera secuencialmente antes), y queda
    // envuelta en su propio .catch() como defensa adicional a las garantías
    // ya internas de enviarPushADocente() (nunca lanza, jamás bloquea ni
    // puede convertirse en un 500/501 de este endpoint). El mensaje TERMINA
    // siempre con el texto exacto acordado, para que el docente sepa que el
    // detalle formal está en su correo/la plataforma, nunca en el push
        // mismo (los push tienen espacio limitado y no llevan adjuntos).
    const mensajeEstadoPush = b.estadoContrato === 'Aprobado'
      ? 'Su vinculación/solicitud fue aprobada.'
      : (b.estadoContrato === 'Rechazado' ? 'Su solicitud fue rechazada.' : 'Su solicitud fue marcada con observaciones.');
    enviarPushADocente(
      contrato.docenteCedula,
      'Gestor Académico YC',
      `${mensajeEstadoPush} Por favor, revise su correo electrónico o ingrese a la plataforma para ver el documento formal.`,
    ).catch(() => {});

    let credencialesAprovisionadas = false;
    let avisoNotificacion = 'No se envió ninguna notificación (proveedor de correo no configurado y SMS no disponible).';
    let canalNotificacion: 'sms' | 'correo' | 'ninguno' = 'ninguno';

    if (b.estadoContrato === 'Aprobado' && contrato.usaPlataformaYc && contrato.institucionDestinoDane) {
      const instFilas = await db.select().from(etcInstituciones)
        .where(and(eq(etcInstituciones.entidadId, contrato.entidadId), eq(etcInstituciones.codigoDane, contrato.institucionDestinoDane)));
      const institucion = instFilas[0];
      if (institucion && institucion.skPlataformaYc) {
        const verificacion = await verificarPertenenciaDocente(institucion.id, contrato.docenteCedula);
        if (!verificacion.encontrado) {
          // Aprovisionamiento automático de credenciales (punto 5, Flujo C).
          const blobFilas = await db.select().from(kvStore).where(eq(kvStore.key, institucion.skPlataformaYc));
          const blob: any = blobFilas[0]?.value;
          if (blob && Array.isArray(blob.users)) {
            const usuarioBase = (contrato.docenteCedula || contrato.nombreCompleto.replace(/\s+/g, '.').toLowerCase()).slice(0, 40);
            let usuarioFinal = usuarioBase;
            let sufijo = 1;
            while (blob.users.some((u: any) => u && u.u === usuarioFinal)) {
              usuarioFinal = `${usuarioBase}${sufijo}`;
              sufijo++;
            }
            const passwordTemporal = generarTokenAcceso().slice(0, 10);
            blob.users.push({
              u: usuarioFinal,
              p: await hashPasswordServidor(passwordTemporal),
              n: contrato.nombreCompleto.toUpperCase(),
              r: 'docente',
              cedula: contrato.docenteCedula,
              correo: contrato.correo || '',
              telefono: contrato.telefono || '',
              cargo: 'DOCENTE',
            });
            await db.insert(kvStore)
              .values({ key: institucion.skPlataformaYc, value: blob, updatedAt: new Date() })
              .onConflictDoUpdate({ target: kvStore.key, set: { value: blob, updatedAt: new Date() } });
            // Lote 5 — sincronización en tiempo real (SSE/broadcastChange):
            // avisa de inmediato a cualquier dispositivo con sesión abierta
            // en ESA institución que su base de datos cambió, en vez de
            // esperar a la próxima sincronización periódica normal (la
            // limitación documentada desde el Lote 2 — ver checklist de
            // esta ronda). Mismo mecanismo que ya usa el resto de
            // src/index.ts, importado aquí desde src/lib/sync-bus.ts.
            broadcastChange(institucion.skPlataformaYc);
            credencialesAprovisionadas = true;
            // Ajuste multicanal: antes esto solo enviaba correo; ahora pasa
            // por enviarNotificacionMulticanal(), que intenta SMS con las
            // credenciales propias de ESTA entidad (si el flag global
            // ENABLE_SMS_NOTIFICATIONS está activo y la entidad las
            // configuró) y cae de inmediato al correo si no — nunca deja
            // esta aprobación sin notificar por un problema de canal. El
            // correo, además, adopta automáticamente el membrete de la
            // entidad (Lote 4, vía obtenerMembreteEntidad() dentro del
            // propio motor multicanal).
            const notif = await enviarNotificacionMulticanal({
              telefono: contrato.telefono,
              correo: contrato.correo,
              entidadId: contrato.entidadId,
              asuntoCorreo: `Acceso aprobado — ${institucion.nombreInstitucion}`,
              mensaje: `Hola ${contrato.nombreCompleto}, su vinculación fue aprobada. Usuario: ${usuarioFinal} / Contraseña temporal: ${passwordTemporal}. Le recomendamos cambiarla al ingresar por primera vez.`,
              htmlCorreo: `<p>Hola ${contrato.nombreCompleto},</p><p>Su vinculación fue aprobada. Ya puede ingresar a <b>Gestor Académico YC</b> con:</p><p>Usuario: <b>${usuarioFinal}</b><br/>Contraseña temporal: <b>${passwordTemporal}</b></p><p>Le recomendamos cambiarla al ingresar por primera vez.</p>`,
            });
            canalNotificacion = notif.canal;
            avisoNotificacion = notif.detalle;
          }
        }
      }
    } else if (contrato.correo || contrato.telefono) {
      const asunto = b.estadoContrato === 'Aprobado' ? 'Solicitud aprobada' : (b.estadoContrato === 'Rechazado' ? 'Solicitud rechazada' : 'Solicitud con observaciones');
      const notif = await enviarNotificacionMulticanal({
        telefono: contrato.telefono,
        correo: contrato.correo,
        entidadId: contrato.entidadId,
        asuntoCorreo: asunto,
        mensaje: `Hola ${contrato.nombreCompleto}, el estado de su expediente cambió a: ${b.estadoContrato}.${b.observaciones ? ` Observaciones: ${b.observaciones}` : ''}`,
        htmlCorreo: `<p>Hola ${contrato.nombreCompleto},</p><p>El estado de su expediente cambió a: <b>${b.estadoContrato}</b>.</p>${b.observaciones ? `<p>Observaciones: ${b.observaciones}</p>` : ''}`,
      });
      canalNotificacion = notif.canal;
      avisoNotificacion = notif.detalle;
    }

    await registrarAuditoriaEtc({
      entidadId: contrato.entidadId, actor: _actorDeLaPeticion(req) || String(b.evaluadoPor || ''), rol: _rolDeLaPeticion(req),
      accion: 'evaluar_contrato', objetivoTipo: 'contrato', objetivoId: id,
      detalle: { estadoContrato: b.estadoContrato, credencialesAprovisionadas, canalNotificacion },
    });

    return res.json({ ok: true, contrato: actualizado, credencialesAprovisionadas, canalNotificacion, avisoNotificacion });
  } catch (e) {
    console.error('POST /api/etc/contratos/:id/evaluar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al evaluar el expediente.' });
  }
});

// ── Flujo A (Lote 5): docente activo CON plataforma YC — acceso con su
// usuario y contraseña institucional de siempre ──────────────────────────────
// Punto 5, Flujo A: "docente activo con plataforma YC → entra con su
// usuario y contraseña institucional de siempre". Las rondas anteriores
// (Lote 2) dejaban esto limitado a que la verificación automática
// reconociera al docente por cédula; este endpoint completa el flujo
// real: valida las credenciales reales del docente CONTRA el mismo blob
// `kv_store.value.users` que usa el sistema K-12 (mismo hash PBKDF2,
// verificado aquí con `verificarPasswordServidor()`, la contraparte de
// `hashPasswordServidor()` ya usada por el aprovisionamiento del Lote 2)
// y, si son válidas, deja abierto el acceso al portal ETC para ese
// docente — sin inventar un sistema de sesión nuevo, ni tocar el login
// del sistema K-12 (que sigue siendo 100% client-side vía POST
// /api/inetis/db), solo verificando aquí lo mismo que el navegador ya
// verifica allá. Nunca expone el hash de la contraseña en la respuesta.
router.post('/contratos/acceso/login-institucional', async (req, res) => {
  try {
    const { sk, usuario, password } = req.body || {};
    const skLimpio = String(sk || '').trim();
    const usuarioLimpio = String(usuario || '').trim();
    if (!skLimpio || !usuarioLimpio || !password) {
      return res.status(400).json({ ok: false, error: 'sk, usuario y password son obligatorios.' });
    }
    const blobFilas = await db.select().from(kvStore).where(eq(kvStore.key, skLimpio));
    const blob: any = blobFilas[0]?.value;
    if (!blob || !Array.isArray(blob.users)) {
      return res.status(404).json({ ok: false, error: 'No fue posible leer la institución indicada.' });
    }
    const usuarioEncontrado = blob.users.find((u: any) => u && String(u.u || '') === usuarioLimpio);
    if (!usuarioEncontrado || !(await verificarPasswordServidor(String(password), usuarioEncontrado.p))) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
    }
    // Solo docentes (y roles administrativos del propio colegio) pueden
    // entrar al portal ETC por este flujo — un estudiante/acudiente con
    // cuenta válida en el Gestor YC no tiene expediente de contratación.
    const rolesPermitidosFlujoA = ['docente', 'rector', 'directivo', 'admin', 'gestor'];
    if (!rolesPermitidosFlujoA.includes(String(usuarioEncontrado.r || '').toLowerCase())) {
      return res.status(403).json({ ok: false, error: 'Este acceso es exclusivo para personal docente/directivo de la institución.' });
    }
    const perfil = {
      u: String(usuarioEncontrado.u || ''),
      n: String(usuarioEncontrado.n || ''),
      r: String(usuarioEncontrado.r || ''),
      cedula: String(usuarioEncontrado.cedula || ''),
      correo: String(usuarioEncontrado.correo || usuarioEncontrado.email || ''),
    };
    await registrarAuditoriaEtc({
      actor: perfil.u, rol: perfil.r, accion: 'login_flujo_a', objetivoTipo: 'acceso',
      detalle: { sk: skLimpio },
    });
    return res.json({ ok: true, docente: perfil });
  } catch (e) {
    console.error('POST /api/etc/contratos/acceso/login-institucional', e);
    return res.status(500).json({ ok: false, error: 'Error interno al validar el acceso institucional.' });
  }
});

// ── Flujo B: acceso por Link Único/Token Seguro ──────────────────────────────

router.get('/contratos/acceso/token/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token requerido' });
    const filas = await db.select().from(etcContratos).where(eq(etcContratos.tokenAccesoUnico, token));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'El link de acceso no es válido.' });
    return res.json({ ok: true, contrato: _contratoPublico(filas[0]) });
  } catch (e) {
    console.error('GET /api/etc/contratos/acceso/token/:token', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ── Flujo B: acceso por Cédula + Código OTP ──────────────────────────────────
// Ronda 33 (autorización EXPLÍCITA del usuario) — este endpoint estaba
// "cerrado" como correo-only desde el ajuste post-Lote 2 (rondas 30/31/32),
// precisamente porque en ese momento no existía ningún proveedor de SMS en
// el proyecto. Eso cambió en la Ronda 32 con el motor multicanal
// enviarNotificacionMulticanal() (sms-provider.ts) — así que este endpoint
// se rediseña para usarlo igual que ya hace /contratos/:id/evaluar: intenta
// SMS con las credenciales de la ETC (si el flag global está activo y la
// entidad las configuró) y cae de inmediato y en silencio al correo si no
// hay SMS disponible — MISMO invariante de siempre: nunca responde 501, ni
// exige que el cliente elija/anuncie un canal. El canal REALMENTE usado
// (no un valor fijo) es el que queda guardado en `etc_otp_codigos.canal`.
router.post('/contratos/acceso/otp/solicitar', async (req, res) => {
  try {
    const { cedula } = req.body || {};
    const cedulaLimpia = String(cedula || '').trim();
    if (!cedulaLimpia) return res.status(400).json({ ok: false, error: 'La cédula es obligatoria.' });
    const filas = await db.select().from(etcContratos).where(eq(etcContratos.docenteCedula, cedulaLimpia)).orderBy(desc(etcContratos.id));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'No hay ningún expediente registrado con esa cédula.' });
    const contrato = filas[0];
    if (!contrato.correo && !contrato.telefono) {
      return res.status(400).json({ ok: false, error: 'El expediente no tiene correo ni teléfono registrados para enviar el código.' });
    }
    const codigo = generarCodigoOtp();
    const expiraEn = new Date(Date.now() + 10 * 60 * 1000);
    const resultadoOtp = await enviarNotificacionMulticanal({
      telefono: contrato.telefono,
      correo: contrato.correo,
      entidadId: contrato.entidadId,
      asuntoCorreo: 'Código de acceso — Gestor Académico YC',
      mensaje: `Hola ${contrato.nombreCompleto}, su código de acceso es: ${codigo}. Es válido por 10 minutos y solo puede usarse una vez.`,
      htmlCorreo: `<p>Hola ${contrato.nombreCompleto},</p><p>Su código de acceso es: <b style="font-size:20px;letter-spacing:2px;">${codigo}</b></p><p>Es válido por 10 minutos y solo puede usarse una vez.</p>`,
    });
    await db.insert(etcOtpCodigos).values({
      cedula: cedulaLimpia,
      codigo,
      canal: resultadoOtp.canal,
      destino: resultadoOtp.canal === 'sms' ? contrato.telefono : contrato.correo,
      contratoId: contrato.id,
      expiraEn,
    });
    return res.json({ ok: true, aviso: resultadoOtp.detalle, canal: resultadoOtp.canal, expiraEn });
  } catch (e) {
    console.error('POST /api/etc/contratos/acceso/otp/solicitar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al generar el código de acceso.' });
  }
});

router.post('/contratos/acceso/otp/verificar', async (req, res) => {
  try {
    const { cedula, codigo } = req.body || {};
    const cedulaLimpia = String(cedula || '').trim();
    const codigoLimpio = String(codigo || '').trim();
    if (!cedulaLimpia || !codigoLimpio) return res.status(400).json({ ok: false, error: 'cedula y codigo son obligatorios.' });
    const filas = await db.select().from(etcOtpCodigos)
      .where(and(eq(etcOtpCodigos.cedula, cedulaLimpia), eq(etcOtpCodigos.codigo, codigoLimpio), eq(etcOtpCodigos.usado, false)))
      .orderBy(desc(etcOtpCodigos.id));
    const entrada = filas[0];
    if (!entrada || entrada.expiraEn.getTime() < Date.now()) {
      return res.status(400).json({ ok: false, error: 'El código es inválido, ya fue usado, o ya expiró.' });
    }
    await db.update(etcOtpCodigos).set({ usado: true }).where(eq(etcOtpCodigos.id, entrada.id));
    if (!entrada.contratoId) return res.json({ ok: true, contrato: null });
    const contratoFilas = await db.select().from(etcContratos).where(eq(etcContratos.id, entrada.contratoId));
    return res.json({ ok: true, contrato: contratoFilas.length ? _contratoPublico(contratoFilas[0]) : null });
  } catch (e) {
    console.error('POST /api/etc/contratos/acceso/otp/verificar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al verificar el código.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// LOTE 3 — Escalado de permisos/ausentismos a la ETC (punto 3 de la
// especificación) + motor de campos dinámicos (`custom_form_schema`).
// ------------------------------------------------------------------------------
// IMPORTANTE — esta tabla (`docente_permisos`) es un ESPEJO, no la fuente
// de verdad: el flujo interno colegio↔docente↔rector sigue viviendo por
// completo en `db.ausentismos` (el blob JSON de cada institución,
// gestionado por `htmlAusentismo()`/`enviarAusentismo()`/
// `responderAusentismo()` en gestor-academico/dist/modules/
// 06-documentos-y-resto.js) — el Rector sigue aprobando/rechazando ahí
// mismo, como siempre. Estos endpoints solo RECIBEN una copia de un
// permiso YA RESUELTO internamente, para que la ETC vea el consolidado de
// todas sus instituciones sin tener que abrir el "db" de cada colegio uno
// por uno. Por eso no existe aquí un endpoint de "evaluar" — la evaluación
// ocurre en el frontend interno del colegio, no en el módulo ETC.
//
// El escalado puede ser MANUAL (el Rector/Admin presiona "Reportar Novedad
// a la Entidad Territorial") o AUTOMÁTICO (config `auto_report_entidad` en
// `etc_instituciones` — ver GET /instituciones/buscar-por-sk/:sk arriba),
// pero en ambos casos el frontend termina llamando a este mismo
// POST /permisos.
// ════════════════════════════════════════════════════════════════════════════

router.get('/permisos', async (req, res) => {
  try {
    const { institucionId, entidadId, estado } = req.query as { institucionId?: string; entidadId?: string; estado?: string };
    const condiciones = [];
    if (institucionId) condiciones.push(eq(docentePermisos.institucionId, Number(institucionId)));
    if (entidadId) condiciones.push(eq(docentePermisos.entidadId, Number(entidadId)));
    if (estado) condiciones.push(eq(docentePermisos.estado, String(estado)));
    const filas = condiciones.length
      ? await db.select().from(docentePermisos).where(and(...condiciones)).orderBy(desc(docentePermisos.id))
      : await db.select().from(docentePermisos).orderBy(desc(docentePermisos.id));
    return res.json({ ok: true, permisos: filas });
  } catch (e) {
    console.error('GET /api/etc/permisos', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar los permisos escalados.' });
  }
});

router.get('/permisos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const filas = await db.select().from(docentePermisos).where(eq(docentePermisos.id, id));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Permiso no encontrado' });
    return res.json({ ok: true, permiso: filas[0] });
  } catch (e) {
    console.error('GET /api/etc/permisos/:id', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/permisos', async (req, res) => {
  try {
    const b = req.body || {};
    const institucionId = Number(b.institucionId);
    if (!institucionId) return res.status(400).json({ ok: false, error: 'institucionId es obligatorio.' });
    if (!b.docenteId || !String(b.docenteId).trim()) return res.status(400).json({ ok: false, error: 'docenteId es obligatorio.' });
    if (!b.tipoPermiso || !String(b.tipoPermiso).trim()) return res.status(400).json({ ok: false, error: 'tipoPermiso es obligatorio.' });

    // entidadId SIEMPRE se deriva de la propia institución en el servidor —
    // nunca se confía en un entidadId que mande el cliente, para que un
    // permiso no pueda "colarse" reportado bajo una entidad distinta de la
    // que realmente administra esa institución.
    const instFilas = await db.select().from(etcInstituciones).where(eq(etcInstituciones.id, institucionId));
    if (!instFilas.length) return res.status(404).json({ ok: false, error: 'La institución no existe en el módulo ETC.' });
    const institucion = instFilas[0];

    const estadosValidos = ['Pendiente', 'Aprobado', 'Rechazado', 'Con_Observaciones'];
    const estado = estadosValidos.includes(b.estado) ? b.estado : 'Pendiente';

    const [creado] = await db.insert(docentePermisos).values({
      docenteId: String(b.docenteId).trim(),
      institucionId,
      entidadId: institucion.entidadId,
      tipoPermiso: String(b.tipoPermiso).trim(),
      fechaInicio: String(b.fechaInicio || ''),
      fechaFin: String(b.fechaFin || ''),
      motivo: String(b.motivo || ''),
      datosAdicionales: b.datosAdicionales && typeof b.datosAdicionales === 'object' ? b.datosAdicionales : {},
      urlSoporteCloud: String(b.urlSoporteCloud || ''),
      estado,
      respuestaRector: String(b.respuestaRector || ''),
      // Este registro nace YA reportado: se crea precisamente porque se
      // está escalando (manual o automáticamente) un permiso que el Rector
      // ya resolvió internamente — nunca queda "pendiente de reportar".
      reportadoEntidad: true,
      fechaReporteEntidad: new Date(),
    }).returning();

    await registrarAuditoriaEtc({
      entidadId: institucion.entidadId, actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req),
      accion: 'escalar_permiso', objetivoTipo: 'permiso', objetivoId: creado.id,
      detalle: { institucionId, tipoPermiso: creado.tipoPermiso, estado },
    });

    return res.json({ ok: true, permiso: creado });
  } catch (e) {
    console.error('POST /api/etc/permisos', e);
    return res.status(500).json({ ok: false, error: 'Error interno al escalar el permiso a la entidad territorial.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// LOTE 5 (Ronda 33) — Documentos/soportes del expediente (etc_documentos):
// carga REAL de archivos a Cloudinary, reutilizando exactamente el mismo
// mecanismo (Multer en memoria + subirBufferACloudinary(), resourceType
// 'raw' para PDFs) que ya usa el resto de la plataforma en
// POST /api/inetis/upload — nunca se guarda el archivo en la base de datos,
// solo la URL segura que devuelve Cloudinary (etc_documentos.urlDocumentoCloud).
// ════════════════════════════════════════════════════════════════════════════

router.get('/contratos/:id/documentos', async (req, res) => {
  try {
    const contratoId = Number(req.params.id);
    if (!contratoId) return res.status(400).json({ ok: false, error: 'id inválido' });
    const filas = await db.select().from(etcDocumentos).where(eq(etcDocumentos.contratoId, contratoId)).orderBy(desc(etcDocumentos.id));
    return res.json({ ok: true, documentos: filas });
  } catch (e) {
    console.error('GET /api/etc/contratos/:id/documentos', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar los documentos del expediente.' });
  }
});

// Subida real de un PDF/soporte — el propio Docente/Aspirante puede subir
// sus documentos (cédula, hoja de vida, RUT, títulos, aptitud médica), sin
// necesitar rol administrativo; solo la REVISIÓN (endpoint de abajo) queda
// reservada al Rector/Admin ETC/Superadmin.
router.post('/contratos/:id/documentos', uploadMemoria.single('archivo'), async (req, res) => {
  try {
    const contratoId = Number(req.params.id);
    if (!contratoId) return res.status(400).json({ ok: false, error: 'id inválido' });
    const contratoFilas = await db.select().from(etcContratos).where(eq(etcContratos.id, contratoId));
    if (!contratoFilas.length) return res.status(404).json({ ok: false, error: 'Expediente no encontrado' });
    const tiposValidos = ['Cedula', 'HojaDeVida', 'Rut', 'Titulos', 'AptitudMedica'];
    const tipoDocumento = tiposValidos.includes(req.body?.tipoDocumento) ? req.body.tipoDocumento : '';
    if (!tipoDocumento) return res.status(400).json({ ok: false, error: `tipoDocumento debe ser uno de: ${tiposValidos.join(', ')}.` });
    const archivo = (req as unknown as { file?: { buffer: Buffer; mimetype: string } }).file;
    if (!archivo) return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo (campo "archivo" requerido).' });
    const resultado = await subirBufferACloudinary(archivo.buffer, {
      folder: `gestor-yc/etc-documentos/${contratoId}`,
      resourceType: 'raw',
    });
    const [creado] = await db.insert(etcDocumentos).values({
      contratoId,
      tipoDocumento,
      urlDocumentoCloud: resultado.url,
      estadoRevision: 'Pendiente',
    }).returning();
    await registrarAuditoriaEtc({
      entidadId: contratoFilas[0].entidadId, actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req),
      accion: 'subir_documento', objetivoTipo: 'documento', objetivoId: creado.id,
      detalle: { contratoId, tipoDocumento },
    });
    return res.json({ ok: true, documento: creado });
  } catch (e) {
    console.error('POST /api/etc/contratos/:id/documentos', e);
    return res.status(500).json({ ok: false, error: 'No se pudo subir el documento. Verifique que Cloudinary esté configurado e intente de nuevo.' });
  }
});

// Revisión del documento (Aprobado/Rechazado) — reservada al Rector/Admin
// ETC/Superadmin, con rastro de auditoría de quién aprobó/rechazó qué.
router.put('/documentos/:id/revisar', requiereRol(['Rector', 'Directivo', 'Admin_ETC', 'Superadmin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = req.body || {};
    const estadosValidos = ['Aprobado', 'Rechazado', 'Pendiente'];
    if (!estadosValidos.includes(b.estadoRevision)) {
      return res.status(400).json({ ok: false, error: 'estadoRevision debe ser Aprobado, Rechazado o Pendiente.' });
    }
    const [actualizado] = await db.update(etcDocumentos).set({
      estadoRevision: b.estadoRevision,
      observacionesAdmin: String(b.observacionesAdmin || ''),
    }).where(eq(etcDocumentos.id, id)).returning();
    if (!actualizado) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
    await registrarAuditoriaEtc({
      actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req),
      accion: 'revisar_documento', objetivoTipo: 'documento', objetivoId: id,
      detalle: { estadoRevision: b.estadoRevision },
    });
    return res.json({ ok: true, documento: actualizado });
  } catch (e) {
    console.error('PUT /api/etc/documentos/:id/revisar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al revisar el documento.' });
  }
});

// ── Ajuste multicanal — endpoint genérico reutilizable ───────────────────────
// Punto de entrada que el resto del sistema (por ahora, la notificación al
// docente en responderAusentismo(), 06-documentos-y-resto.js) puede usar
// para enviar una alerta multicanal sin necesitar sus propias credenciales
// de SMS ni saber qué proveedor está configurado — solo indica de qué
// institución/entidad se trata. Sigue protegido por
// checkModuleEnabled('ETC_CONTRACTING'): solo tiene sentido para
// instituciones cubiertas por una ETC (fuera de eso, el resto del sistema
// sigue usando /api/inetis/send-email directamente, como siempre).
router.get('/notificaciones/estado', async (_req, res) => {
  try {
    const smsHabilitadoGlobalmente = await smsNotificacionesHabilitadasGlobalmente();
    return res.json({ ok: true, smsHabilitadoGlobalmente });
  } catch (e) {
    console.error('GET /api/etc/notificaciones/estado', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

router.post('/notificaciones/enviar', async (req, res) => {
  try {
    const b = req.body || {};
    let entidadId = Number(b.entidadId) || null;
    if (!entidadId && b.institucionId) {
      const filas = await db.select().from(etcInstituciones).where(eq(etcInstituciones.id, Number(b.institucionId)));
      entidadId = filas[0]?.entidadId || null;
    }
    if (!b.mensaje || !String(b.mensaje).trim()) return res.status(400).json({ ok: false, error: 'mensaje es obligatorio.' });
    if (!b.correo && !b.telefono) return res.status(400).json({ ok: false, error: 'Debe indicar correo y/o telefono del destinatario.' });
    const resultado = await enviarNotificacionMulticanal({
      telefono: b.telefono || null,
      correo: b.correo || null,
      entidadId,
      asuntoCorreo: String(b.asunto || 'Notificación — Gestor Académico YC'),
      mensaje: String(b.mensaje),
      htmlCorreo: typeof b.html === 'string' ? b.html : undefined,
    });
    return res.json({ ok: true, ...resultado });
  } catch (e) {
    console.error('POST /api/etc/notificaciones/enviar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al enviar la notificación.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RONDA 36 — PARTE 3: MÓDULO DE INTEROPERABILIDAD SIMAT Y PORTAL
// ETC/GOBERNACIÓN. Ver el comentario extenso junto a `simatEstudiantes` en
// src/db/schema.ts para la decisión de arquitectura (tabla relacional
// aparte, vinculada por NUIP — no el blob JSON de cada institución).
//
// RONDA 37 — AJUSTE: `_asegurarSchemaSimat()` YA NO se ejecuta de forma
// incondicional. Ahora es responsabilidad de CADA endpoint SIMAT llamar
// primero a `_simatEstaEnStandby()` (ver abajo) y, si el módulo está
// apagado, responder de forma elegante SIN llegar siquiera a llamar esta
// función — así, con ENABLE_SIMAT_ETC_MODULE=false, ni `ensureSchemaSimat()`
// ni ningún ALTER TABLE dinámico se ejecutan jamás. Ver el comentario
// extenso de arquitectura en src/lib/feature-flags.ts (junto a
// FLAG_SIMAT_ETC_MODULE) y en src/lib/simat-dynamic-schema.ts.
// ════════════════════════════════════════════════════════════════════════════
let _schemaSimatListo = false;
async function _asegurarSchemaSimat(): Promise<void> {
  if (_schemaSimatListo) return;
  await ensureSchemaSimat();
  _schemaSimatListo = true;
}

// Mensaje único y consistente de "módulo en standby" para los 3 endpoints
// SIMAT — nunca un 500: el flag apagado es un estado NORMAL y esperado, no
// un error. Devuelve `true` (y ya escribió la respuesta) cuando el llamador
// debe detenerse aquí mismo.
const MENSAJE_SIMAT_ETC_STANDBY =
  'El Módulo SIMAT/Portal ETC-Gobernación está en modo standby (apagado). Un Súper Admin debe activarlo desde su panel (interruptor "Módulo SIMAT/ETC") antes de usar esta función. Mientras esté apagado, la plataforma no crea ni consulta ninguna tabla SIMAT en Neon.';
async function _simatEstaEnStandby(res: Response): Promise<boolean> {
  const habilitado = await checkSimatEtcEnabled();
  if (habilitado) return false;
  res.json({ ok: false, standby: true, error: MENSAJE_SIMAT_ETC_STANDBY });
  return true;
}

function _ipDeLaPeticionEtc(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  const primera = Array.isArray(xf) ? xf[0] : (typeof xf === 'string' ? xf.split(',')[0] : '');
  return (primera && primera.trim()) || req.socket?.remoteAddress || req.ip || '';
}

// Campos obligatorios para que un registro SIMAT no sea rechazado por la
// ETC al recibir el Anexo 6A/Planilla de Novedades — el pre-check pedido
// explícitamente ("motor de pre-check que valide campos obligatorios...
// antes de generar, para evitar rechazos en la ETC").
function _validarCamposObligatoriosSimat(fila: Record<string, any>): string[] {
  const faltantes: string[] = [];
  if (!fila.nuip) faltantes.push('NUIP/N° de documento');
  if (!fila.tipoDocumento) faltantes.push('Tipo de documento');
  if (!fila.nombres) faltantes.push('Nombres');
  if (!fila.apellidos) faltantes.push('Apellidos');
  if (!fila.fechaNacimiento) faltantes.push('Fecha de nacimiento');
  if (!fila.codigoDaneInstitucion) faltantes.push('Código DANE de la institución');
  if (!fila.gradoSimat) faltantes.push('Grado SIMAT');
  return faltantes;
}

// ── PARTE 3.2.a — Importador SIMAT -> Plataforma (UPSERT por NUIP) ──────────
// Recibe filas YA PARSEADAS por el navegador (SheetJS, reutilizando el mismo
// patrón de lectura de .csv/.xlsx que ya usa el resto del sistema — ver
// cargarNotasActExcel() en el frontend — en vez de parsear el archivo en el
// servidor). Por cada fila: si el NUIP ya existe para esa institución (sk),
// se ACTUALIZA solo la caracterización/grado (nunca toca `kv_store`, así que
// jamás borra notas/asistencias); si no existe, se inserta y se devuelve en
// `nuevos` para que el frontend lo matricule automáticamente en `db.ests`
// (el roster real vive en el blob JSON de la institución, no en Neon).
router.post('/simat/importar', requiereRol(['Admin_ETC', 'Rector', 'Directivo', 'Superadmin']), async (req, res) => {
  try {
    if (await _simatEstaEnStandby(res)) return;
    await _asegurarSchemaSimat();
    const { sk, filas } = (req.body || {}) as { sk?: string; filas?: Record<string, any>[] };
    if (!sk) return res.status(400).json({ ok: false, error: 'sk es obligatorio.' });
    if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ ok: false, error: 'filas debe ser un arreglo no vacío.' });

    // RONDA 37 — GENERADOR DINÁMICO: se detectan, del PRIMER registro
    // recibido, los encabezados que el archivo trae y que NO pertenecen al
    // esquema base (ver src/lib/simat-dynamic-schema.ts para la decisión de
    // arquitectura completa y las garantías de seguridad del DDL). Se hace
    // una sola vez por import (no por fila) porque todas las filas de un
    // mismo archivo comparten los mismos encabezados.
    const encabezadosDetectados = filas[0] ? Object.keys(filas[0]) : [];
    const { columnasAgregadas } = await generarEsquemaSimatDinamico(sk, encabezadosDetectados);

    const nuevos: Record<string, any>[] = [];
    const actualizados: Record<string, any>[] = [];
    const rechazados: { fila: Record<string, any>; motivos: string[] }[] = [];

    for (const filaCruda of filas) {
      const nuip = String(filaCruda.nuip || filaCruda.NUIP || filaCruda.documento || '').trim();
      const fila = { ...filaCruda, nuip };
      const motivos = _validarCamposObligatoriosSimat(fila);
      if (motivos.length) { rechazados.push({ fila, motivos }); continue; }

      const existentes = await db.select().from(simatEstudiantes).where(and(eq(simatEstudiantes.sk, sk), eq(simatEstudiantes.nuip, nuip)));
      const valores = {
        sk, nuip,
        tipoDocumento: String(fila.tipoDocumento || ''),
        nombres: String(fila.nombres || ''),
        apellidos: String(fila.apellidos || ''),
        fechaNacimiento: String(fila.fechaNacimiento || ''),
        genero: String(fila.genero || ''),
        codigoDaneInstitucion: String(fila.codigoDaneInstitucion || ''),
        codigoDaneSede: String(fila.codigoDaneSede || ''),
        jornada: String(fila.jornada || ''),
        gradoSimat: String(fila.gradoSimat || ''),
        grupo: String(fila.grupo || ''),
        tipoDiscapacidad: String(fila.tipoDiscapacidad || ''),
        poblacionVulnerable: String(fila.poblacionVulnerable || ''),
        etnia: String(fila.etnia || ''),
        victimaConflicto: !!fila.victimaConflicto,
        estrato: String(fila.estrato || ''),
        estadoSimat: String(fila.estadoSimat || 'Matriculado'),
        fechaRegistroNovedad: String(fila.fechaRegistroNovedad || ''),
        novedad: String(fila.novedad || ''),
        updatedAt: new Date(),
      };
      if (existentes[0]) {
        await db.update(simatEstudiantes).set(valores).where(eq(simatEstudiantes.id, existentes[0].id));
        actualizados.push(valores);
      } else {
        await db.insert(simatEstudiantes).values(valores);
        nuevos.push(valores); // el frontend matricula esto en db.ests (grupo/sede correspondiente)
      }
    }

    await registrarAuditoriaEtc({
      actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req), accion: 'importar_simat',
      objetivoTipo: 'simat_estudiante',
      detalle: { sk, ip: _ipDeLaPeticionEtc(req), total: filas.length, nuevos: nuevos.length, actualizados: actualizados.length, rechazados: rechazados.length, columnasDinamicasAgregadas: columnasAgregadas },
    });

    return res.json({ ok: true, nuevos, actualizados: actualizados.length, rechazados, columnasDinamicasAgregadas: columnasAgregadas });
  } catch (e) {
    console.error('POST /api/etc/simat/importar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al importar SIMAT.' });
  }
});

// ── PARTE 3.2.b — Generador Plataforma -> SIMAT (pre-check + compilación) ───
// Compila los registros de matrícula/novedades y corre el motor de pre-check
// ANTES de exportar — devuelve, por cada registro, si está listo o qué
// campos obligatorios le faltan, así el rector corrige antes de generar el
// archivo (evita el rechazo en la ETC). La generación del archivo plano/
// Excel en sí ocurre en el NAVEGADOR (SheetJS), reutilizando exactamente el
// mismo patrón que ya usa descargarNotasActExcel() — este endpoint entrega
// los datos ya validados y listos para convertir a archivo.
router.post('/simat/exportar-precheck', requiereRol(['Admin_ETC', 'Rector', 'Directivo', 'Superadmin', 'GOBERNACION_ETC']), async (req, res) => {
  try {
    if (await _simatEstaEnStandby(res)) return;
    await _asegurarSchemaSimat();
    const { sk } = (req.body || {}) as { sk?: string };
    if (!sk) return res.status(400).json({ ok: false, error: 'sk es obligatorio.' });
    const filas = await db.select().from(simatEstudiantes).where(eq(simatEstudiantes.sk, sk));
    const resultado = filas.map((f) => ({
      registro: f,
      listo: _validarCamposObligatoriosSimat(f as any).length === 0,
      faltantes: _validarCamposObligatoriosSimat(f as any),
    }));
    await registrarAuditoriaEtc({
      actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req), accion: 'exportar_simat_precheck',
      objetivoTipo: 'simat_estudiante',
      detalle: { sk, ip: _ipDeLaPeticionEtc(req), total: filas.length, conRechazo: resultado.filter((r) => !r.listo).length },
    });
    return res.json({ ok: true, total: filas.length, registros: resultado });
  } catch (e) {
    console.error('POST /api/etc/simat/exportar-precheck', e);
    return res.status(500).json({ ok: false, error: 'Error interno al preparar la exportación SIMAT.' });
  }
});

// ── PARTE 3.3 — Portal ETC/Gobernación: tablero consolidado de SOLO LECTURA ─
// Rol GOBERNACION_ETC (o AUDITOR_ETC, mismo permiso — ver el comentario del
// tipo RolEtc arriba). SOLO expone métricas agregadas, JAMÁS una operación
// de escritura — este es el único endpoint SIMAT que ese rol puede alcanzar
// junto con exportar-precheck (arriba), ambos de solo lectura; ningún otro
// endpoint de este router (ni de todo el sistema) acepta ese rol en su lista
// de `requiereRol(...)`, así que un actor que se declare GOBERNACION_ETC no
// puede escribir en ninguna parte del sistema.
router.get('/simat/consolidado', requiereRol(['GOBERNACION_ETC', 'Superadmin', 'Admin_ETC']), async (req, res) => {
  try {
    if (await _simatEstaEnStandby(res)) return;
    await _asegurarSchemaSimat();
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ ok: false, error: 'sk es obligatorio.' });
    const filas = await db.select().from(simatEstudiantes).where(eq(simatEstudiantes.sk, sk));
    const porEstado: Record<string, number> = {};
    const porGrado: Record<string, number> = {};
    const porSede: Record<string, number> = {};
    let victimasConflicto = 0, conDiscapacidad = 0, poblacionEtnica = 0;
    filas.forEach((f) => {
      porEstado[f.estadoSimat] = (porEstado[f.estadoSimat] || 0) + 1;
      if (f.gradoSimat) porGrado[f.gradoSimat] = (porGrado[f.gradoSimat] || 0) + 1;
      if (f.codigoDaneSede) porSede[f.codigoDaneSede] = (porSede[f.codigoDaneSede] || 0) + 1;
      if (f.victimaConflicto) victimasConflicto++;
      if (f.tipoDiscapacidad) conDiscapacidad++;
      if (f.etnia) poblacionEtnica++;
    });

    // RONDA 37 — Dashboard GOBERNACIÓN_ETC: 3 métricas consolidadas pedidas
    // explícitamente (Cobertura, Deserción, Ausentismo).
    //   - `coberturaPct`: proporción de la matrícula reportada en SIMAT que
    //     está actualmente en estado "Matriculado" — es una aproximación
    //     basada ÚNICAMENTE en los datos que la propia ETC/institución
    //     reportó a este módulo, NO un cálculo poblacional/censal (para eso
    //     se necesitaría la población en edad escolar del municipio, un
    //     dato que este sistema no gestiona ni tiene por qué gestionar).
    //   - `desercionPct`: proporción en estado "Retirado" sobre el total de
    //     registros SIMAT de la institución.
    //   - `ausentismoPct`: a diferencia de las dos anteriores (que salen de
    //     `simat_estudiantes`), el ausentismo se calcula, de forma honesta,
    //     a partir del módulo de asistencia YA EXISTENTE de la plataforma
    //     (el arreglo `asistencia` dentro del blob JSON de la institución
    //     en kv_store — ver d.asistencia.push(...) en
    //     06-documentos-y-resto.js), NO de SIMAT (que no registra
    //     asistencia diaria). Si la institución aún no tiene ningún
    //     registro de asistencia cargado, se documenta explícitamente con
    //     `ausentismoMuestraVacia: true` en vez de fingir un 0% engañoso.
    const totalSimat = filas.length;
    const matriculados = porEstado['Matriculado'] || 0;
    const retirados = porEstado['Retirado'] || 0;
    const coberturaPct = totalSimat ? Number(((matriculados / totalSimat) * 100).toFixed(1)) : 0;
    const desercionPct = totalSimat ? Number(((retirados / totalSimat) * 100).toFixed(1)) : 0;

    let totalMarcasAsistencia = 0, totalAusencias = 0;
    try {
      const rowsInst = await db.select().from(kvStore).where(eq(kvStore.key, sk));
      const registrosAsistencia: any[] = (rowsInst[0]?.value as any)?.asistencia || [];
      registrosAsistencia.forEach((r) => {
        if (r && r.deletedAt) return;
        const presentes = Array.isArray(r?.presentes) ? r.presentes.length : 0;
        const ausentes = Array.isArray(r?.ausentes) ? r.ausentes.length : 0;
        const justificados = Array.isArray(r?.justificados) ? r.justificados.length : 0;
        totalMarcasAsistencia += presentes + ausentes + justificados;
        totalAusencias += ausentes;
      });
    } catch { /* si no se puede leer el blob institucional, se reporta muestra vacía abajo — nunca se rompe el consolidado por esto */ }
    const ausentismoMuestraVacia = totalMarcasAsistencia === 0;
    const ausentismoPct = ausentismoMuestraVacia ? 0 : Number(((totalAusencias / totalMarcasAsistencia) * 100).toFixed(1));

    await registrarAuditoriaEtc({
      actor: _actorDeLaPeticion(req), rol: _rolDeLaPeticion(req), accion: 'consultar_consolidado_gobernacion',
      objetivoTipo: 'simat_estudiante', detalle: { sk, ip: _ipDeLaPeticionEtc(req) },
    });
    return res.json({
      ok: true,
      matriculaActiva: filas.length,
      porEstadoMatricula: porEstado,
      porGrado,
      porSede,
      victimasConflicto,
      conDiscapacidad,
      poblacionEtnica,
      coberturaPct,
      desercionPct,
      ausentismoPct,
      ausentismoMuestraVacia,
    });
  } catch (e) {
    console.error('GET /api/etc/simat/consolidado', e);
    return res.status(500).json({ ok: false, error: 'Error interno al consultar el consolidado SIMAT.' });
  }
});

export { router as etcRouter };
export default router;
