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
import { db } from '../db/index.js';
import { etcEntidades, etcInstituciones, etcContratos, etcOtpCodigos, docentePermisos, kvStore } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { checkModuleEnabled } from '../lib/feature-flags.js';
import { verificarPertenenciaDocente, generarTokenAcceso, generarCodigoOtp } from '../lib/etc-verificacion.js';
import { enviarCorreoGeneral, correoGeneralConfigurado } from '../lib/email-general.js';
import { hashPasswordServidor } from '../lib/reset-tokens.js';
import { enviarNotificacionMulticanal, smsNotificacionesHabilitadasGlobalmente } from '../lib/sms-provider.js';

const router = Router();

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
router.delete('/entidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const actualizadoPor = String((req.body && req.body.actualizadoPor) || req.query.actualizadoPor || '');
    const [actualizada] = await db.update(etcEntidades)
      .set({ activo: false, actualizadoPor, updatedAt: new Date() })
      .where(eq(etcEntidades.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Entidad no encontrada' });
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

router.delete('/instituciones/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const [actualizada] = await db.update(etcInstituciones).set({ activa: false }).where(eq(etcInstituciones.id, id)).returning();
    if (!actualizada) return res.status(404).json({ ok: false, error: 'Institución no encontrada' });
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
// usado en /api/inetis/auth/restablecer/solicitar).
router.post('/contratos/:id/evaluar', async (req, res) => {
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
              p: hashPasswordServidor(passwordTemporal),
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

    return res.json({ ok: true, contrato: actualizado, credencialesAprovisionadas, canalNotificacion, avisoNotificacion });
  } catch (e) {
    console.error('POST /api/etc/contratos/:id/evaluar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al evaluar el expediente.' });
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
// Ajuste post-Lote 2: el código siempre se envía por correo (el único canal
// de comunicación que existe en toda la plataforma — no hay ningún proveedor
// de SMS integrado en este proyecto). En vez de aceptar un parámetro "canal"
// que solo podría fallar con teléfono, este endpoint queda 100% cerrado y
// terminado tal como es: correo únicamente, sin anunciar una opción que no
// existe. Si en el futuro se contrata un proveedor de SMS, agregar el canal
// telefónico será una extensión aislada de este mismo endpoint (columna
// "canal" de etc_otp_codigos ya queda lista para ese valor).

router.post('/contratos/acceso/otp/solicitar', async (req, res) => {
  try {
    const { cedula } = req.body || {};
    const cedulaLimpia = String(cedula || '').trim();
    if (!cedulaLimpia) return res.status(400).json({ ok: false, error: 'La cédula es obligatoria.' });
    const filas = await db.select().from(etcContratos).where(eq(etcContratos.docenteCedula, cedulaLimpia)).orderBy(desc(etcContratos.id));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'No hay ningún expediente registrado con esa cédula.' });
    const contrato = filas[0];
    if (!contrato.correo) return res.status(400).json({ ok: false, error: 'El expediente no tiene un correo registrado para enviar el código.' });
    const codigo = generarCodigoOtp();
    const expiraEn = new Date(Date.now() + 10 * 60 * 1000);
    await db.insert(etcOtpCodigos).values({
      cedula: cedulaLimpia,
      codigo,
      canal: 'correo',
      destino: contrato.correo,
      contratoId: contrato.id,
      expiraEn,
    });
    let avisoCorreo = 'No se envió correo (proveedor de correo no configurado) — revise el registro en la base de datos si es un entorno de pruebas.';
    if (correoGeneralConfigurado) {
      await enviarCorreoGeneral({
        to: contrato.correo,
        subject: 'Código de acceso — Gestor Académico YC',
        text: `Hola ${contrato.nombreCompleto},\n\nSu código de acceso es: ${codigo}\n\nEs válido por 10 minutos y solo puede usarse una vez.`,
        html: `<p>Hola ${contrato.nombreCompleto},</p><p>Su código de acceso es: <b style="font-size:20px;letter-spacing:2px;">${codigo}</b></p><p>Es válido por 10 minutos y solo puede usarse una vez.</p>`,
      });
      avisoCorreo = 'Código enviado por correo.';
    }
    return res.json({ ok: true, aviso: avisoCorreo, expiraEn });
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

    return res.json({ ok: true, permiso: creado });
  } catch (e) {
    console.error('POST /api/etc/permisos', e);
    return res.status(500).json({ ok: false, error: 'Error interno al escalar el permiso a la entidad territorial.' });
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

export { router as etcRouter };
export default router;
