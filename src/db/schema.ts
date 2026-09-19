import { pgTable, text, jsonb, timestamp, serial, boolean, index, integer, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const kvStore = pgTable('kv_store', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  sk: text('sk'),
  kind: text('kind').notNull().default('info'),
  actor: text('actor').notNull().default(''),
  message: text('message').notNull(),
  meta: jsonb('meta'),
  seen: boolean('seen').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('notifications_seen_idx').on(t.seen),
  index('notifications_created_idx').on(t.createdAt),
  index('notifications_sk_idx').on(t.sk),
]);

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  clave: text('clave').notNull().unique(),
  estId: text('est_id'),
  data: jsonb('data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('documents_est_id_idx').on(t.estId),
]);

// ── Notificaciones push (Web Push) ─────────────────────────────────────────────
// Guarda la suscripción de cada dispositivo/navegador que activó las
// notificaciones. "estId" solo aplica a padre/estudiante y permite filtrar
// los avisos de un docente por grado sin tener que enviarlos a toda la
// institución.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  sk: text('sk').notNull(),
  userU: text('user_u').notNull(),
  rol: text('rol').notNull().default(''),
  estId: text('est_id'),
  endpoint: text('endpoint').notNull().unique(),
  subscription: jsonb('subscription').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('push_subs_sk_idx').on(t.sk),
]);

// ── Módulo Repositorio ────────────────────────────────────────────────────────

export const repositorioResources = pgTable('repositorio_resources', {
  id:            serial('id').primaryKey(),
  institucionId: text('institucion_id').notNull().default('default'),
  title:         text('title').notNull(),
  author:        text('author').notNull().default(''),
  level:         text('level').default('General'),
  skill:         text('skill').default(''),
  metadata:      text('metadata').default(''),
  type:          text('type').default(''),
  description:   text('description').default(''),
  uploader:      text('uploader').default(''),
  link:          text('link'),
  fileData:      text('file_data'),
  fileName:      text('file_name'),
  ratingSum:     integer('rating_sum').notNull().default(0),
  ratingCount:   integer('rating_count').notNull().default(0),
  comments:      jsonb('comments').default([]),
  downloadsCount:integer('downloads_count').notNull().default(0),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const repositorioUsers = pgTable('repositorio_users', {
  id:            serial('id').primaryKey(),
  institucionId: text('institucion_id').notNull().default('default'),
  username:      text('username').notNull(),
  fullname:      text('fullname').notNull(),
  role:          text('role').notNull(),
  pass:          text('pass').notNull(),
});

export const repositorioStats = pgTable('repositorio_stats', {
  institucionId: text('institucion_id').primaryKey(),
  views:         integer('views').notNull().default(0),
  downloads:     integer('downloads').notNull().default(0),
  logs:          jsonb('logs').default([]),
});

export const repositorioConfig = pgTable('repositorio_config', {
  institucionId: text('institucion_id').primaryKey(),
  name:          text('name').notNull().default('REPOSITORIO INSTITUCIONAL'),
  logo:          text('logo').notNull().default(''),
});

export const repositorioAreas = pgTable('repositorio_areas', {
  id:            serial('id').primaryKey(),
  institucionId: text('institucion_id').notNull().default('default'),
  nombre:        text('nombre').notNull(),
});

export const repositorioGrados = pgTable('repositorio_grados', {
  id:            serial('id').primaryKey(),
  institucionId: text('institucion_id').notNull().default('default'),
  nombre:        text('nombre').notNull(),
});

export const repositorioTipos = pgTable('repositorio_tipos', {
  id:            serial('id').primaryKey(),
  institucionId: text('institucion_id').notNull().default('default'),
  nombre:        text('nombre').notNull(),
});

// ════════════════════════════════════════════════════════════════════════════
// MÓDULO EDUCACIÓN SUPERIOR / LMS (Aula Virtual) — FASE 1: solo el esquema.
// ------------------------------------------------------------------------------
// A diferencia del resto del sistema (que guarda los datos de cada
// institución como un solo bloque JSON en "kv_store"), el contenido del LMS
// (unidades, recursos, actividades, entregas) se modela aquí como tablas
// relacionales propias — tiene sentido porque es contenido más pesado
// (archivos, HTML largo) y con una jerarquía más profunda (aula → unidad →
// recurso/actividad → entrega) que se beneficia de consultarse por partes en
// vez de cargar siempre el bloque completo de la institución.
//
// Todas las tablas usan "sk" (el mismo identificador de institución que ya
// usan "notifications"/"push_subscriptions") para saber a qué institución
// pertenecen — no existe una tabla "instituciones" aparte porque las
// instituciones ya se administran dentro del propio panel del Súper Admin
// (gestorDB.platforms[]); el interruptor COLEGIO/UNIVERSIDAD vive ahí
// mismo, como un campo más de cada plataforma (ver "tipoInstitucion" en el
// frontend), no en una tabla SQL nueva.
//
// "grupoAsignaturaId", "catedraticoU" y "estudianteId" son TEXTO (no llaves
// foráneas de base de datos) porque las asignaturas/docentes/estudiantes
// del colegio o universidad viven dentro del bloque JSON de la
// institución, no en una tabla SQL — se validan en el propio código del
// backend/frontend, no con una FK de Postgres.
// ════════════════════════════════════════════════════════════════════════════

// ── Plan de estudios / malla curricular (para instituciones tipo UNIVERSIDAD) ──
export const lmsPlanesEstudio = pgTable('lms_planes_estudio', {
  id:             serial('id').primaryKey(),
  sk:             text('sk').notNull(),
  nombreCarrera:  text('nombre_carrera').notNull(),
  totalCreditos:  integer('total_creditos').notNull().default(0),
  // Estructura orgánica y nivel del programa — se agregan como columnas
  // NULLABLE sobre la tabla ya existente (no se creó una tabla aparte)
  // para no duplicar el concepto de "programa": un programa académico ya
  // vivía aquí, esto solo lo enriquece con dónde pertenece
  // organizacionalmente y qué nivel de formación es.
  departamentoId: integer('departamento_id').references((): any => univDepartamentos.id, { onDelete: 'set null' }),
  nivel:          text('nivel').default('PREGRADO'), // PREGRADO | POSGRADO | EDUCACION_CONTINUA
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('lms_planes_sk_idx').on(t.sk),
]);

// ── Asignaturas universitarias (con créditos, horas y prerrequisitos) ──────────
export const lmsAsignaturasUniversidad = pgTable('lms_asignaturas_universidad', {
  id:                   serial('id').primaryKey(),
  sk:                   text('sk').notNull(),
  planEstudioId:        integer('plan_estudio_id').references((): any => lmsPlanesEstudio.id, { onDelete: 'set null' }),
  codigoMateria:        text('codigo_materia').notNull(),
  nombre:               text('nombre').notNull(),
  creditos:             integer('creditos').notNull().default(0),
  horasPresenciales:    integer('horas_presenciales').notNull().default(0),
  horasIndependientes:  integer('horas_independientes').notNull().default(0),
  semestre:             integer('semestre').notNull().default(1),
  // Prerrequisito: referencia a OTRA fila de esta misma tabla (una
  // asignatura no se puede cursar sin haber aprobado la que señala aquí).
  // Puede quedar vacío si no tiene prerrequisito.
  prerrequisitoId:      integer('prerrequisito_id').references((): any => lmsAsignaturasUniversidad.id, { onDelete: 'set null' }),
  // Carácter de la asignatura dentro del pensum — de qué tipo es.
  caracter:             text('caracter').notNull().default('OBLIGATORIA'), // OBLIGATORIA | ELECTIVA | OPTATIVA
  metadata:             jsonb('metadata').default({}),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('lms_asig_sk_idx').on(t.sk),
  index('lms_asig_plan_idx').on(t.planEstudioId),
]);

// ── Aula virtual (una por grupo/asignatura con su catedrático) ─────────────────
export const lmsAulasVirtuales = pgTable('lms_aulas_virtuales', {
  id:                serial('id').primaryKey(),
  sk:                text('sk').notNull(),
  grupoAsignaturaId: text('grupo_asignatura_id').notNull(), // referencia al id de "carga" dentro del bloque JSON de la institución
  catedraticoU:      text('catedratico_u').notNull(),       // referencia al "u" (usuario) del docente/catedrático
  estado:            text('estado').notNull().default('activa'), // activa | archivada
  linkClaseVivo:     text('link_clase_vivo').default(''),   // URL de Meet/Teams/Jitsi
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('lms_aulas_sk_idx').on(t.sk),
  index('lms_aulas_grupo_idx').on(t.grupoAsignaturaId),
]);

// ── Unidades de aprendizaje dentro de un aula ───────────────────────────────────
export const lmsUnidades = pgTable('lms_unidades', {
  id:          serial('id').primaryKey(),
  aulaId:      integer('aula_id').notNull().references(() => lmsAulasVirtuales.id, { onDelete: 'cascade' }),
  titulo:      text('titulo').notNull(),
  descripcion: text('descripcion').default(''),
  orden:       integer('orden').notNull().default(0),
  visible:     boolean('visible').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('lms_unidades_aula_idx').on(t.aulaId),
]);

// ── Recursos (material de apoyo) dentro de una unidad ───────────────────────────
export const lmsRecursos = pgTable('lms_recursos', {
  id:             serial('id').primaryKey(),
  unidadId:       integer('unidad_id').notNull().references(() => lmsUnidades.id, { onDelete: 'cascade' }),
  titulo:         text('titulo').notNull(),
  tipo:           text('tipo').notNull().default('DOCUMENTO'), // DOCUMENTO | VIDEO_EMBED | ENLACE_EXTERNO | TEXTO_HTML
  urlCloudinary:  text('url_cloudinary').default(''),
  contenidoHtml:  text('contenido_html').default(''),
  orden:          integer('orden').notNull().default(0),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('lms_recursos_unidad_idx').on(t.unidadId),
]);

// ── Actividades (tareas, foros, quizzes) dentro de una unidad ──────────────────
export const lmsActividades = pgTable('lms_actividades', {
  id:               serial('id').primaryKey(),
  unidadId:         integer('unidad_id').notNull().references(() => lmsUnidades.id, { onDelete: 'cascade' }),
  titulo:           text('titulo').notNull(),
  instruccion:      text('instruccion').default(''),
  tipo:             text('tipo').notNull().default('TAREA'), // TAREA | FORO | QUIZ
  fechaApertura:    timestamp('fecha_apertura', { withTimezone: true }),
  fechaCierre:      timestamp('fecha_cierre', { withTimezone: true }),
  porcentajeCorte:  text('porcentaje_corte').default(''), // a qué corte/periodo académico alimenta (ej. "1", "2")
  maxCalificacion:  text('max_calificacion').notNull().default('5.0'),
  // Categoría del Libro de Calificaciones a la que pertenece esta
  // actividad (ej. "Talleres", "Exámenes") — se usa para calcular el
  // promedio ponderado final del estudiante. Puede quedar sin asignar.
  categoriaId:      integer('categoria_id').references((): any => univGradebookCategorias.id, { onDelete: 'set null' }),
  metadata:         jsonb('metadata').default({}),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('lms_activ_unidad_idx').on(t.unidadId),
]);

// ── Entregas de los estudiantes para cada actividad ─────────────────────────────
export const lmsEntregas = pgTable('lms_entregas', {
  id:                    serial('id').primaryKey(),
  actividadId:           integer('actividad_id').notNull().references(() => lmsActividades.id, { onDelete: 'cascade' }),
  estudianteId:          text('estudiante_id').notNull(), // referencia al id del estudiante dentro del bloque JSON de la institución
  archivoUrlCloudinary:  text('archivo_url_cloudinary').default(''),
  textoEntrega:          text('texto_entrega').default(''),
  fechaEnvio:            timestamp('fecha_envio', { withTimezone: true }).defaultNow(),
  nota:                  text('nota').default(''),
  retroalimentacion:     text('retroalimentacion').default(''),
  estado:                text('estado').notNull().default('ENVIADO'), // ENVIADO | CALIFICADO | ATRASADO
}, (t) => [
  index('lms_entregas_actividad_idx').on(t.actividadId),
  index('lms_entregas_estudiante_idx').on(t.estudianteId),
]);

// ════════════════════════════════════════════════════════════════════════════
// AMPLIACIÓN: Secciones, Matrículas y Calificaciones por Corte — prefijo
// "univ_" (a pedido explícito), para pasar "Secciones" y "Matrícula" de
// vivir dentro del bloque JSON de la institución (como quedaron en la
// primera versión del módulo) a tablas relacionales propias, con
// integridad referencial real. Las tablas "lms_*" de arriba NO se tocan
// ni se renombran — quedan exactamente como estaban, funcionando igual.
// ════════════════════════════════════════════════════════════════════════════

// ── Secciones: un grupo/aula abierta para una asignatura, con su
// catedrático — reemplaza el arreglo "universidadSecciones" que antes
// vivía dentro del JSON de la institución.
export const univSecciones = pgTable('univ_secciones', {
  id:            serial('id').primaryKey(),
  sk:            text('sk').notNull(),
  asignaturaId:  integer('asignatura_id').notNull().references(() => lmsAsignaturasUniversidad.id, { onDelete: 'cascade' }),
  catedraticoU:  text('catedratico_u').notNull(),
  grupo:         text('grupo').notNull(),
  metadata:      jsonb('metadata').default({}),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_secciones_sk_idx').on(t.sk),
  index('univ_secciones_asignatura_idx').on(t.asignaturaId),
]);

// ── Matrículas: inscripción formal de un estudiante a una sección — un
// estudiante puede estar matriculado en VARIAS secciones (una por cada
// asignatura que esté cursando), a diferencia del campo suelto
// "planEstudioId" que se usaba antes solo para el programa general.
export const univMatriculas = pgTable('univ_matriculas', {
  id:              serial('id').primaryKey(),
  sk:              text('sk').notNull(),
  seccionId:       integer('seccion_id').notNull().references(() => univSecciones.id, { onDelete: 'cascade' }),
  estudianteId:    text('estudiante_id').notNull(),
  fechaMatricula:  timestamp('fecha_matricula', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_matriculas_sk_idx').on(t.sk),
  index('univ_matriculas_seccion_idx').on(t.seccionId),
  index('univ_matriculas_estudiante_idx').on(t.estudianteId),
  uniqueIndex('univ_matriculas_unica_idx').on(t.seccionId, t.estudianteId),
]);

// ── Calificaciones por Corte: notas finales por corte de evaluación (ej.
// 30% / 30% / 40%) — reemplaza el guardado indirecto que antes se hacía
// dentro de "nts" del estudiante (reutilizando la estructura del libro de
// notas K-12). Aquí queda en una tabla propia de este sistema.
export const univCalificacionesCortes = pgTable('univ_calificaciones_cortes', {
  id:            serial('id').primaryKey(),
  matriculaId:   integer('matricula_id').notNull().references(() => univMatriculas.id, { onDelete: 'cascade' }),
  corte:         text('corte').notNull(), // ej '1' | '2' | '3' | 'final'
  porcentaje:    text('porcentaje').notNull().default('0'), // ej '30' para 30%
  nota:          text('nota').default(''),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_calif_matricula_idx').on(t.matriculaId),
  uniqueIndex('univ_calif_unica_idx').on(t.matriculaId, t.corte),
]);

// ── Pensums: malla curricular versionada de un Programa Académico — a
// diferencia de "lms_planes_estudio" (que representa el programa/carrera
// en sí, con su total de créditos), esto permite tener VARIAS mallas para
// el mismo programa a lo largo del tiempo (ej. "Pensum 2024", "Pensum
// 2026"), cada una con su propio conjunto de asignaturas obligatorias.
export const univPensums = pgTable('univ_pensums', {
  id:             serial('id').primaryKey(),
  sk:             text('sk').notNull(),
  planEstudioId:  integer('plan_estudio_id').notNull().references(() => lmsPlanesEstudio.id, { onDelete: 'cascade' }),
  nombre:         text('nombre').notNull(), // ej "Pensum 2026-1"
  vigenteDesde:   text('vigente_desde').default(''), // año o periodo desde el que aplica
  activo:         boolean('activo').notNull().default(true),
  metadata:       jsonb('metadata').default({}),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_pensums_sk_idx').on(t.sk),
  index('univ_pensums_plan_idx').on(t.planEstudioId),
]);

// Cada asignatura de un pensum (tabla puente, ya que una asignatura puede
// pertenecer a varios pensums del mismo programa a través del tiempo).
export const univPensumAsignaturas = pgTable('univ_pensum_asignaturas', {
  id:            serial('id').primaryKey(),
  pensumId:      integer('pensum_id').notNull().references(() => univPensums.id, { onDelete: 'cascade' }),
  asignaturaId:  integer('asignatura_id').notNull().references(() => lmsAsignaturasUniversidad.id, { onDelete: 'cascade' }),
}, (t) => [
  index('univ_pensum_asig_pensum_idx').on(t.pensumId),
  uniqueIndex('univ_pensum_asig_unica_idx').on(t.pensumId, t.asignaturaId),
]);

// ── Perfiles: datos de perfil AMPLIADOS de cada usuario del sistema
// universitario (estudiante/docente/admin) — foto, biografía/formación,
// teléfono, y si ya completó su perfil. La identidad y contraseña siguen
// viviendo donde ya funcionan (kv_store, vía el sistema de login
// existente); esto es SOLO la información adicional de perfil, para no
// duplicar ni arriesgar el sistema de autenticación que ya funciona.
export const univPerfiles = pgTable('univ_perfiles', {
  id:                 serial('id').primaryKey(),
  sk:                 text('sk').notNull(),
  usuarioId:          text('usuario_id').notNull(), // el mismo id/usuario que ya se usa para el login
  rol:                text('rol').notNull(), // admin | docente | estudiante
  fotoUrl:            varchar('foto_url', { length: 500 }).default(''),
  telefono:           text('telefono').default(''),
  correo:             text('correo').default(''),
  biografia:          text('biografia').default(''), // formación académica / biografía breve
  perfilCompletado:   boolean('perfil_completado').notNull().default(false),
  actualizadoEn:      timestamp('actualizado_en', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_perfiles_sk_idx').on(t.sk),
  uniqueIndex('univ_perfiles_unico_idx').on(t.sk, t.usuarioId),
]);

// ── Configuración de Cortes Evaluativos por institución — cuántos cortes
// tiene el año/semestre y qué porcentaje pesa cada uno (ej. 30/30/40).
// Se guarda como JSONB para poder tener cualquier cantidad de cortes sin
// tener que cambiar la estructura de la tabla.
export const univConfigCortes = pgTable('univ_config_cortes', {
  id:            serial('id').primaryKey(),
  sk:            text('sk').notNull().unique(),
  cortes:        jsonb('cortes').default([{ nombre: 'Corte 1', porcentaje: 30 }, { nombre: 'Corte 2', porcentaje: 30 }, { nombre: 'Corte 3', porcentaje: 40 }]),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// FASE: ESTRUCTURA INSTITUCIONAL + CALENDARIO ACADÉMICO — primer bloque de
// la especificación de "software universitario profesional" (Enterprise
// LMS/SIS). El resto de bloques (quiz engine, rúbricas, foros, coevaluación
// por pares, gradebook por categorías) quedan planeados para próximas
// entregas, según lo acordado.
// ════════════════════════════════════════════════════════════════════════════

// ── Facultades / Decanaturas ──────────────────────────────────────────────
export const univFacultades = pgTable('univ_facultades', {
  id:        serial('id').primaryKey(),
  sk:        text('sk').notNull(),
  nombre:    text('nombre').notNull(),
  decano:    text('decano').default(''),
  metadata:  jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_facultades_sk_idx').on(t.sk),
]);

// ── Departamentos Académicos (pertenecen a una Facultad) ─────────────────
export const univDepartamentos = pgTable('univ_departamentos', {
  id:               serial('id').primaryKey(),
  sk:               text('sk').notNull(),
  facultadId:       integer('facultad_id').notNull().references(() => univFacultades.id, { onDelete: 'cascade' }),
  nombre:           text('nombre').notNull(),
  jefeDepartamento: text('jefe_departamento').default(''),
  metadata:         jsonb('metadata').default({}),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_departamentos_sk_idx').on(t.sk),
  index('univ_departamentos_facultad_idx').on(t.facultadId),
]);

// ── Periodos Académicos (Calendario) — cada semestre/periodo (ej.
// "2026-1"), con sus fechas clave y, dentro del mismo registro, los
// cortes de evaluación de ESE periodo con su fecha límite de registro de
// notas (distinto de "univ_config_cortes", que es un porcentaje por
// defecto a nivel institucional sin fechas — aquí sí hay fechas,
// concretas por periodo, que es lo que pidió la especificación).
export const univPeriodosAcademicos = pgTable('univ_periodos_academicos', {
  id:                        serial('id').primaryKey(),
  sk:                        text('sk').notNull(),
  nombre:                    text('nombre').notNull(), // ej "2026-1"
  fechaInicio:               timestamp('fecha_inicio', { withTimezone: true }),
  fechaFin:                  timestamp('fecha_fin', { withTimezone: true }),
  fechaAperturaPrematricula: timestamp('fecha_apertura_prematricula', { withTimezone: true }),
  fechaCierrePrematricula:   timestamp('fecha_cierre_prematricula', { withTimezone: true }),
  fechaAperturaAdiciones:    timestamp('fecha_apertura_adiciones', { withTimezone: true }), // adiciones y cancelaciones
  fechaCierreAdiciones:      timestamp('fecha_cierre_adiciones', { withTimezone: true }),
  fechaInicioClases:         timestamp('fecha_inicio_clases', { withTimezone: true }),
  fechaCierreClases:         timestamp('fecha_cierre_clases', { withTimezone: true }),
  // [{nombre:'Corte 1', porcentaje:30, fechaLimiteNotas:'2026-04-15'}, ...]
  cortes:                    jsonb('cortes').default([]),
  activo:                    boolean('activo').notNull().default(false),
  metadata:                  jsonb('metadata').default({}),
  createdAt:                 timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_periodos_sk_idx').on(t.sk),
]);

// ── Parámetros Globales de la institución universitaria — escala de
// calificación, nota mínima de aprobación, tope de fallas para pérdida
// de asignatura por inasistencia.
export const univParametros = pgTable('univ_parametros', {
  id:                   serial('id').primaryKey(),
  sk:                   text('sk').notNull().unique(),
  escalaTipo:            text('escala_tipo').notNull().default('NUMERICA'), // NUMERICA | LETRAS
  notaMaxima:           text('nota_maxima').notNull().default('5.0'), // techo de la escala (5.0, 10.0, 100, etc. — editable)
  notaMinimaAprobacion: text('nota_minima_aprobacion').notNull().default('3.0'),
  // Bandas de desempeño de la escala, totalmente editables por el
  // administrador — nombre y rango de cada nivel (ej. "Bajo" 0.0-2.9,
  // "Básico" 3.0-3.9, ... o "F" 0-59, "D" 60-69, etc. para escala de
  // letras). No es una escala fija de solo dos opciones — se puede
  // agregar, quitar, renombrar y cambiar los rangos libremente.
  escalaPersonalizada: jsonb('escala_personalizada').default([
    { nombre: 'Bajo', min: 0.0, max: 2.9 },
    { nombre: 'Básico', min: 3.0, max: 3.9 },
    { nombre: 'Alto', min: 4.0, max: 4.6 },
    { nombre: 'Superior', min: 4.7, max: 5.0 },
  ]),
  topeFallasPorcentaje: text('tope_fallas_porcentaje').notNull().default('20'), // % de clases falladas que hace perder la materia
  metadata:             jsonb('metadata').default({}),
  actualizadoEn:        timestamp('actualizado_en', { withTimezone: true }).defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// FASE 2: PENSUM AVANZADO — Correquisitos (materias simultáneas) además de
// los Prerrequisitos que ya existían (campo "prerrequisitoId", único, en
// lms_asignaturas_universidad — se deja intacto). Los correquisitos, a
// diferencia del prerrequisito, pueden ser VARIOS a la vez para la misma
// asignatura, por eso viven en una tabla puente aparte.
// ════════════════════════════════════════════════════════════════════════════
export const univCorrequisitos = pgTable('univ_correquisitos', {
  id:             serial('id').primaryKey(),
  asignaturaId:   integer('asignatura_id').notNull().references(() => lmsAsignaturasUniversidad.id, { onDelete: 'cascade' }),
  correquisitoId: integer('correquisito_id').notNull().references(() => lmsAsignaturasUniversidad.id, { onDelete: 'cascade' }),
}, (t) => [
  index('univ_correq_asignatura_idx').on(t.asignaturaId),
  uniqueIndex('univ_correq_unica_idx').on(t.asignaturaId, t.correquisitoId),
]);

// ════════════════════════════════════════════════════════════════════════════
// FASE 3: MOTOR DE CUESTIONARIOS/QUIZ — banco de preguntas por categoría,
// varios tipos de pregunta, cuestionario configurable (tiempo, intentos,
// barajado, retroalimentación) ligado a una Actividad tipo QUIZ ya
// existente (lms_actividades), e intentos de los estudiantes con
// calificación automática para los tipos de pregunta objetivos.
// ════════════════════════════════════════════════════════════════════════════

// ── Banco de Preguntas: agrupador por categoría, reutilizable entre
// distintos cuestionarios (así el docente arma una pregunta una sola vez
// y la reutiliza en varios exámenes a través del semestre).
export const univBancoPreguntas = pgTable('univ_lms_banco_preguntas', {
  id:         serial('id').primaryKey(),
  sk:         text('sk').notNull(),
  categoria:  text('categoria').notNull(), // ej "Cálculo I - Derivadas"
  docenteU:   text('docente_u').notNull(),
  metadata:   jsonb('metadata').default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_banco_sk_idx').on(t.sk),
  index('univ_banco_docente_idx').on(t.docenteU),
]);

// ── Preguntas individuales dentro de un banco.
// tipo: OPCION_UNICA | OPCION_MULTIPLE | VERDADERO_FALSO | RESPUESTA_CORTA | ENSAYO
// opciones (para OPCION_UNICA/OPCION_MULTIPLE/VERDADERO_FALSO):
//   [{id:'a', texto:'...', correcta:true/false}, ...]
// respuestaCorta (para RESPUESTA_CORTA): lista de respuestas válidas, texto plano
export const univPreguntas = pgTable('univ_lms_preguntas', {
  id:             serial('id').primaryKey(),
  bancoId:        integer('banco_id').notNull().references(() => univBancoPreguntas.id, { onDelete: 'cascade' }),
  tipo:           text('tipo').notNull(), // OPCION_UNICA | OPCION_MULTIPLE | VERDADERO_FALSO | RESPUESTA_CORTA | ENSAYO
  enunciado:      text('enunciado').notNull(),
  opciones:       jsonb('opciones').default([]),
  respuestaCorta: jsonb('respuesta_corta').default([]), // array de strings aceptadas como correctas (RESPUESTA_CORTA)
  puntaje:        text('puntaje').notNull().default('1.0'),
  retroalimentacion: text('retroalimentacion').default(''), // explicación que se muestra tras responder
  metadata:       jsonb('metadata').default({}),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_preguntas_banco_idx').on(t.bancoId),
]);

// ── Cuestionario: la CONFIGURACIÓN de un examen — se liga 1 a 1 a una
// Actividad ya existente de tipo QUIZ (lms_actividades), reutilizando
// TODO lo que ya existía para actividades (título, instrucción, fechas,
// a qué corte alimenta) en vez de duplicarlo.
export const univCuestionarios = pgTable('univ_lms_cuestionarios', {
  id:                   serial('id').primaryKey(),
  actividadId:          integer('actividad_id').notNull().references(() => lmsActividades.id, { onDelete: 'cascade' }).unique(),
  tiempoLimiteMinutos:  integer('tiempo_limite_minutos'), // NULL = sin límite de tiempo
  intentosPermitidos:   integer('intentos_permitidos').notNull().default(1),
  metodoCalificacion:   text('metodo_calificacion').notNull().default('NOTA_MAS_ALTA'), // NOTA_MAS_ALTA | PROMEDIO | ULTIMO_INTENTO
  barajarPreguntas:     boolean('barajar_preguntas').notNull().default(false),
  barajarRespuestas:    boolean('barajar_respuestas').notNull().default(false),
  retroalimentacion:    text('retroalimentacion').notNull().default('AL_FINALIZAR'), // INMEDIATA | AL_FINALIZAR | NINGUNA
  metadata:             jsonb('metadata').default({}),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Qué preguntas (de qué bancos) componen cada cuestionario, en qué
// orden, y si el puntaje se sobre-escribe para ese cuestionario en
// particular (si no, se usa el puntaje por defecto de la pregunta).
export const univCuestionarioPreguntas = pgTable('univ_lms_cuestionario_preguntas', {
  id:               serial('id').primaryKey(),
  cuestionarioId:   integer('cuestionario_id').notNull().references(() => univCuestionarios.id, { onDelete: 'cascade' }),
  preguntaId:       integer('pregunta_id').notNull().references(() => univPreguntas.id, { onDelete: 'cascade' }),
  orden:            integer('orden').notNull().default(0),
  puntajeOverride:  text('puntaje_override'), // NULL = usa el puntaje de la pregunta
}, (t) => [
  index('univ_cq_preguntas_cuestionario_idx').on(t.cuestionarioId),
  uniqueIndex('univ_cq_preguntas_unica_idx').on(t.cuestionarioId, t.preguntaId),
]);

// ── Intentos de un estudiante — cada vez que empieza/entrega el
// cuestionario. Las respuestas quedan en JSONB: {preguntaId: valorRespondido}.
// Se califica automáticamente lo objetivo (opción única/múltiple,
// verdadero/falso, respuesta corta); ENSAYO queda pendiente de
// calificación manual por el docente.
export const univIntentosCuestionario = pgTable('univ_lms_intentos', {
  id:               serial('id').primaryKey(),
  cuestionarioId:   integer('cuestionario_id').notNull().references(() => univCuestionarios.id, { onDelete: 'cascade' }),
  estudianteId:     text('estudiante_id').notNull(),
  numeroIntento:    integer('numero_intento').notNull().default(1),
  fechaInicio:      timestamp('fecha_inicio', { withTimezone: true }).defaultNow(),
  fechaFin:         timestamp('fecha_fin', { withTimezone: true }),
  respuestas:       jsonb('respuestas').default({}), // {preguntaId: respuesta}
  notaObtenida:     text('nota_obtenida'), // NULL mientras no se haya calificado/terminado
  notaMaxima:       text('nota_maxima').notNull().default('0'),
  tienePendientesManual: boolean('tiene_pendientes_manual').notNull().default(false), // true si hay ENSAYOs sin calificar
  estado:           text('estado').notNull().default('EN_CURSO'), // EN_CURSO | ENTREGADO | CALIFICADO
}, (t) => [
  index('univ_intentos_cuestionario_idx').on(t.cuestionarioId),
  index('univ_intentos_estudiante_idx').on(t.estudianteId),
]);

// ════════════════════════════════════════════════════════════════════════════
// FASE 4: LIBRO DE CALIFICACIONES (GRADEBOOK) — categorías ponderadas por
// sección (ej. "Talleres" 20%, "Exámenes" 40%, "Proyecto" 40%, o también se
// pueden usar como los Cortes si se prefiere ese esquema — el docente
// decide el nombre y el peso de cada una). Cada Actividad se asigna a UNA
// categoría (columna nueva en lms_actividades); el promedio final del
// estudiante se calcula ponderando el promedio de cada categoría.
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// "4 pilares de autonomía" — Pilar 2: MÓDULO FINANCIERO Y PASARELA DE PAGO
// ------------------------------------------------------------------------------
// Andamiaje genérico para los tres niveles de cobro pedidos: (a) suscripción
// SaaS de la plataforma, (b) mensualidades/pensiones (colegios privados),
// (c) trámites administrativos (certificados, constancias, derechos de
// grado) — a través de webhooks universales de Mercado Pago, Wompi y
// Stripe (ver src/lib/pagos-webhooks.ts y POST /api/payments/webhook/:proveedor
// en src/index.ts). Mismo criterio que EMAIL_API_PROVIDER: el código y las
// tablas de los tres proveedores conviven; cuál queda "vivo" depende
// únicamente de qué variables de entorno de credenciales estén configuradas.
//
// IMPORTANTE — esto es andamiaje, no un módulo listo para cobrar en
// producción: falta que el usuario decida qué proveedor(es) usar, obtenga
// sus credenciales reales, defina precios/planes, y decida las reglas de
// negocio de mora y de entrega de PDFs firmados. Ver CHECKLIST_DESPLIEGUE.md.
// ════════════════════════════════════════════════════════════════════════════
export const finTransacciones = pgTable('fin_transacciones', {
  id: serial('id').primaryKey(),
  sk: text('sk'), // institución dueña del cobro; null solo si algún día hay cargos de plataforma sin institución asociada
  tipo: text('tipo').notNull(), // 'suscripcion_saas' | 'mensualidad' | 'tramite'
  concepto: text('concepto').notNull().default(''), // ej "Mensualidad Sept. 2026", "Certificado de notas"
  estudianteId: text('estudiante_id'), // solo aplica a 'mensualidad' y 'tramite'
  proveedor: text('proveedor').notNull(), // 'mercadopago' | 'wompi' | 'stripe'
  proveedorPagoId: text('proveedor_pago_id').notNull(), // id del cargo/pago en el proveedor externo — permite ignorar reintentos duplicados del mismo webhook
  estado: text('estado').notNull().default('pendiente'), // 'pendiente' | 'aprobado' | 'rechazado' | 'reembolsado'
  montoCentavos: integer('monto_centavos').notNull().default(0),
  moneda: text('moneda').notNull().default('COP'),
  metadata: jsonb('metadata').default({}),
  entregableGenerado: boolean('entregable_generado').notNull().default(false), // true cuando ya se generó/entregó el PDF firmado (certificado, paz y salvo, etc.)
  // Ronda 13: código corto de verificación del certificado (mismo valor que
  // metadata.certificado.codigoVerificacion, duplicado aquí como columna
  // propia para poder buscarlo en O(1) desde GET /api/certificados/verificar/:hash
  // sin tener que recorrer/filtrar el jsonb de "metadata" en cada consulta).
  codigoVerificacion: text('codigo_verificacion'),
  // Ronda 13: true cuando el pago que originó este certificado fue
  // reembolsado/contracargado después de emitido — el documento deja de
  // pasar la verificación pública aunque su firma siga siendo
  // matemáticamente válida (la firma prueba que los datos no fueron
  // alterados, no que el pago siga vigente; "revocado" es el candado para
  // ese segundo caso).
  revocado: boolean('revocado').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('fin_transacciones_sk_idx').on(t.sk),
  index('fin_transacciones_estado_idx').on(t.estado),
  index('fin_transacciones_codigo_verificacion_idx').on(t.codigoVerificacion),
  uniqueIndex('fin_transacciones_proveedor_pago_idx').on(t.proveedor, t.proveedorPagoId),
]);

export const finSuscripciones = pgTable('fin_suscripciones', {
  id: serial('id').primaryKey(),
  sk: text('sk').notNull().unique(), // una suscripción SaaS activa por institución
  plan: text('plan').notNull().default('basico'),
  estado: text('estado').notNull().default('inactiva'), // 'activa' | 'vencida' | 'cancelada' | 'inactiva'
  proveedor: text('proveedor'),
  proveedorSuscripcionId: text('proveedor_suscripcion_id'),
  vigenteHasta: timestamp('vigente_hasta', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
  // Ronda 13: true una vez que ya se envió el correo de "tu plan vence en
  // 5 días" para el ciclo de vigencia ACTUAL — se reinicia a false cada
  // vez que vigenteHasta avanza (renovación), para que la alerta se pueda
  // volver a enviar en el siguiente ciclo sin reenviarla varias veces en
  // el mismo ciclo.
  alertaVencimientoEnviada: boolean('alerta_vencimiento_enviada').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('fin_suscripciones_estado_idx').on(t.estado),
]);

// ════════════════════════════════════════════════════════════════════════════
// AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA — bitácora de auditorías.
// ------------------------------------------------------------------------------
// Una fila por CADA hallazgo/acción del agente (no una fila por ciclo de
// auditoría completo) — así el panel "🤖 Auditoría IA / Agente" puede listar,
// filtrar y contar hallazgos individuales sin tener que desempacar un JSON
// gigante por fila. "details" (JSONB) es, a propósito, el único lugar donde
// el agente puede guardar cualquier metadato adicional que necesite en el
// futuro (ids afectados, valores antes/después, sugerencias de columnas
// nuevas para que un desarrollador las revise, etc.) — ver la regla de
// "Control de Esquema de BD" en src/services/ecosystemAgent.js: el agente
// tiene prohibido ejecutar ALTER TABLE/CREATE TABLE en tiempo de ejecución,
// así que cualquier dato nuevo que necesite recordar SIEMPRE va aquí dentro,
// nunca como una columna física nueva.
export const agentAuditLogs = pgTable('agent_audit_logs', {
  id:             serial('id').primaryKey(),
  timestamp:      timestamp('timestamp', { withTimezone: true }).defaultNow(),
  category:       text('category').notNull(),                 // 'Academico' | 'Tecnico' | 'Sincronizacion'
  issueDetected:  text('issue_detected').notNull(),
  actionTaken:    text('action_taken').notNull().default(''),
  status:         text('status').notNull().default('Informativo'), // 'Corregido' | 'Alerta' | 'Informativo'
  details:        jsonb('details').default({}),
}, (t) => [
  index('agent_audit_logs_timestamp_idx').on(t.timestamp),
  index('agent_audit_logs_category_idx').on(t.category),
  index('agent_audit_logs_status_idx').on(t.status),
]);

export const univGradebookCategorias = pgTable('univ_gradebook_categorias', {
  id:          serial('id').primaryKey(),
  sk:          text('sk').notNull(),
  seccionId:   integer('seccion_id').notNull().references(() => univSecciones.id, { onDelete: 'cascade' }),
  nombre:      text('nombre').notNull(), // ej "Talleres", "Exámenes", "Corte 1"
  porcentaje:  text('porcentaje').notNull().default('0'), // ej "30" para 30%
  orden:       integer('orden').notNull().default(0),
  metadata:    jsonb('metadata').default({}),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('univ_gb_cat_sk_idx').on(t.sk),
  index('univ_gb_cat_seccion_idx').on(t.seccionId),
]);

// ════════════════════════════════════════════════════════════════════════════
// LOTE 1 — MÓDULO DE GESTIÓN DOCUMENTAL/CONTRATACIÓN PARA ENTIDADES
// TERRITORIALES CERTIFICADAS (ETC) + MÓDULO DE EDUCACIÓN SUPERIOR/UNIVERSIDADES
// ------------------------------------------------------------------------------
// A diferencia de TODAS las tablas anteriores de este archivo (que
// `initDb()` crea siempre, en cada arranque del servidor), las tablas de
// estos dos módulos se crean BAJO DEMANDA — nunca al arrancar el servidor —
// mediante `ensureSchemaETC()`/`ensureSchemaEducacionSuperior()` (ver
// src/db/index.ts), que solo se ejecutan la primera vez que el Súper Admin
// presiona el botón de activación correspondiente en su panel (ver
// src/lib/feature-flags.ts y los endpoints POST /api/superadmin/activar-
// modulo-etc / activar-modulo-universidades en src/index.ts). Mientras el
// módulo esté desactivado, estas tablas simplemente no existen en Neon —
// tal como pediste, "no se ejecutará ninguna consulta o script SQL sobre
// Neon" hasta la primera activación. Se declaran aquí, en el mismo
// schema.ts de siempre, para poder usar `db.select().from(...)` con
// tipado de Drizzle una vez que el módulo YA está activo — Drizzle no
// exige que la tabla exista físicamente para poder importar su definición,
// solo al ejecutar una consulta real contra ella.
//
// Ambos módulos son INDEPENDIENTES entre sí (activar uno no activa ni
// depende del otro) y también independientes del módulo "Educación
// Superior/LMS" YA EXISTENTE en este archivo (tablas `lms_*`/`univ_*`,
// arriba) — ese módulo es el Aula Virtual/LMS-SIS de universidades que YA
// usan la plataforma con matrícula/notas/quizzes completos; el módulo
// "Universidades" de este bloque es un catálogo más simple (universidad,
// programas, personas) pensado para instituciones de educación superior
// que la ETC gestiona a nivel de convocatoria/contratación, no
// necesariamente usuarias del LMS completo — pueden coexistir sin
// conflicto porque usan prefijos de tabla completamente distintos
// (`universidad_*` aquí vs. `univ_*`/`lms_*` arriba).
// ════════════════════════════════════════════════════════════════════════════

// ── A. MÓDULO ETC (Entidades Territoriales Certificadas) ──────────────────────

// Perfil legal completo de la Entidad Territorial — ver punto 4 de la
// especificación ("Parametrización legal y membretes dinámicos"): estos
// datos alimentan automáticamente el membrete de todos los documentos,
// constancias, reportes y correos que emita el módulo.
export const etcEntidades = pgTable('etc_entidades', {
  id:                     serial('id').primaryKey(),
  nombreEntidad:          text('nombre_entidad').notNull(),
  tipoEntidad:            text('tipo_entidad').notNull().default('Municipio_Certificado'), // 'Departamento' | 'Distrito' | 'Municipio_Certificado'
  nit:                    text('nit').notNull().default(''),
  direccion:              text('direccion').notNull().default(''),
  telefono:               text('telefono').notNull().default(''),
  emailContacto:          text('email_contacto').notNull().default(''),
  logoUrl:                text('logo_url').notNull().default(''),
  firmaRepresentanteUrl:  text('firma_representante_url').notNull().default(''),
  // Motor de formulario dinámico por entidad (punto 3): cada ETC puede
  // definir sus propios tipos de permiso, campos adicionales y requisitos
  // de soporte PDF sin necesitar una migración de esquema nueva por cada
  // entidad — todo vive en este JSONB, interpretado por el frontend/
  // backend del módulo de permisos (Lote 3).
  customFormSchema:       jsonb('custom_form_schema').default({}),
  // Multi-tenant de SMS: cada ETC puede ingresar sus PROPIAS credenciales
  // del proveedor de SMS que ella misma contrató y paga (Hablame.co,
  // Twilio, AWS SNS, ...) — forma agnóstica {proveedor, apiKey, apiSecret?,
  // accountSid?, remitente, ...}, interpretada por src/lib/sms-provider.ts.
  // Si queda vacío ({}), esta entidad simplemente nunca tiene SMS
  // disponible — todas sus notificaciones caen siempre al correo
  // (fallback transparente, sin costo transaccional), sin que eso sea un
  // error ni interrumpa ningún flujo.
  smsProviderConfig:      jsonb('sms_provider_config').default({}),
  activo:                 boolean('activo').notNull().default(true),
  creadoPor:              text('creado_por').default(''),
  actualizadoPor:         text('actualizado_por').default(''),
  createdAt:              timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('etc_entidades_activo_idx').on(t.activo),
]);

// Colegios/instituciones vinculados a una ETC — "usaPlataformaYc" es la
// bandera clave del punto 2: determina si el backend provisiona
// credenciales automáticas en el Gestor YC o si el expediente del docente
// se queda únicamente en la nube de la ETC.
export const etcInstituciones = pgTable('etc_instituciones', {
  id:                 serial('id').primaryKey(),
  entidadId:          integer('entidad_id').notNull().references(() => etcEntidades.id, { onDelete: 'cascade' }),
  codigoDane:         text('codigo_dane').notNull(),
  nombreInstitucion:  text('nombre_institucion').notNull(),
  usaPlataformaYc:    boolean('usa_plataforma_yc').notNull().default(false),
  // "sk" de la institución dentro de kv_store — solo tiene sentido cuando
  // usaPlataformaYc=true; permite, en lotes futuros, verificar pertenencia
  // de un docente consultando directamente el "db" real del colegio (ver
  // punto 2, "Verificación automática de vinculación docente").
  skPlataformaYc:     text('sk_plataforma_yc').default(''),
  // Lote 3, punto 3: "escalado manual/automático a la entidad". false
  // (default) = manual, la institución solo escala una novedad de permiso
  // ya resuelta cuando alguien presiona "Reportar Novedad a la Entidad
  // Territorial"; true = automático, se reporta a la entidad de inmediato
  // en cuanto el Rector aprueba/rechaza/observa el permiso internamente.
  autoReportEntidad:  boolean('auto_report_entidad').notNull().default(false),
  activa:             boolean('activa').notNull().default(true),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('etc_instituciones_entidad_idx').on(t.entidadId),
  uniqueIndex('etc_instituciones_dane_idx').on(t.entidadId, t.codigoDane),
]);

// Expediente de contratación/convocatoria de un docente/aspirante frente a
// la ETC (punto 5, Flujos A/B/C de acceso híbrido) — el propio expediente,
// sin los documentos anexos (esos van en etc_documentos, abajo, para poder
// tener varios PDFs por contrato sin repetir todas estas columnas).
export const etcContratos = pgTable('etc_contratos', {
  id:                     serial('id').primaryKey(),
  entidadId:              integer('entidad_id').notNull().references(() => etcEntidades.id, { onDelete: 'cascade' }),
  docenteCedula:          text('docente_cedula').notNull(),
  nombreCompleto:         text('nombre_completo').notNull(),
  correo:                 text('correo').notNull().default(''),
  telefono:               text('telefono').notNull().default(''),
  municipio:              text('municipio').notNull().default(''),
  institucionDestinoDane: text('institucion_destino_dane').notNull().default(''),
  usaPlataformaYc:        boolean('usa_plataforma_yc').notNull().default(false),
  // 'Pendiente' | 'Pendiente_Validacion_Institucional' (Lote 2: la cédula no
  // se encontró como docente activo en la institución — el Rector debe
  // confirmar) | 'Aprobado' | 'Rechazado' | 'Con_Observaciones'
  estadoContrato:         text('estado_contrato').notNull().default('Pendiente'),
  // Flujo B del punto 5: acceso por Link Único/Token Seguro para un
  // docente activo/asignado que todavía no tiene usuario propio.
  tokenAccesoUnico:       text('token_acceso_unico').default(''),
  creadoPor:              text('creado_por').default(''),
  actualizadoPor:         text('actualizado_por').default(''),
  createdAt:              timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('etc_contratos_entidad_idx').on(t.entidadId),
  index('etc_contratos_cedula_idx').on(t.docenteCedula),
  index('etc_contratos_estado_idx').on(t.estadoContrato),
  uniqueIndex('etc_contratos_token_idx').on(t.tokenAccesoUnico),
]);

// Documentos/soportes PDF de un contrato/expediente — solo la URL en la
// nube se guarda aquí (Cloudinary, vía src/lib/upload.ts con
// resourceType:'raw'), nunca el archivo en sí, para mantener la fila
// liviana y proteger conexiones rurales de baja velocidad (punto 7).
export const etcDocumentos = pgTable('etc_documentos', {
  id:                 serial('id').primaryKey(),
  contratoId:         integer('contrato_id').notNull().references(() => etcContratos.id, { onDelete: 'cascade' }),
  tipoDocumento:      text('tipo_documento').notNull(), // 'Cedula' | 'HojaDeVida' | 'Rut' | 'Titulos' | 'AptitudMedica'
  urlDocumentoCloud:  text('url_documento_cloud').notNull().default(''),
  estadoRevision:     text('estado_revision').notNull().default('Pendiente'), // 'Pendiente' | 'Aprobado' | 'Rechazado'
  observacionesAdmin: text('observaciones_admin').default(''),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('etc_documentos_contrato_idx').on(t.contratoId),
]);

// Permisos/ausentismos ESCALADOS A LA ETC (punto 3, "Escalado a la
// entidad"). Esta tabla es DISTINTA del arreglo "db.ausentismos" que ya
// vive dentro del blob JSON de cada institución (ver
// gestor-academico/dist/modules/06-documentos-y-resto.js) — ese arreglo
// sigue siendo la fuente de verdad del flujo interno colegio↔docente↔
// rector, y no se toca. Esta tabla nueva es el ESPEJO que recibe la ETC
// cuando un permiso ya aprobado se reporta (manual o automáticamente,
// según "auto_report_entidad" en etc_instituciones/config institucional) —
// permite a la ETC ver el consolidado de permisos de TODAS sus
// instituciones en un solo lugar, sin tener que consultar el "db" JSON de
// cada colegio uno por uno. "institucionId"/"entidadId" son enteros que
// referencian etc_instituciones/etc_entidades; "docenteId" es texto libre
// (usuario o cédula) porque el docente puede o no tener cuenta en el
// Gestor YC (Flujo B/C del punto 5).
export const docentePermisos = pgTable('docente_permisos', {
  id:                   serial('id').primaryKey(),
  docenteId:            text('docente_id').notNull(),
  institucionId:        integer('institucion_id').notNull().references(() => etcInstituciones.id, { onDelete: 'cascade' }),
  entidadId:            integer('entidad_id').notNull().references(() => etcEntidades.id, { onDelete: 'cascade' }),
  tipoPermiso:          text('tipo_permiso').notNull(),
  fechaInicio:          text('fecha_inicio').notNull().default(''),
  fechaFin:             text('fecha_fin').notNull().default(''),
  motivo:               text('motivo').default(''),
  // Campos adicionales definidos dinámicamente por el "custom_form_schema"
  // de la entidad (punto 3) — cada ETC puede pedir requisitos distintos
  // sin necesitar una columna física nueva por cada una.
  datosAdicionales:     jsonb('datos_adicionales').default({}),
  urlSoporteCloud:      text('url_soporte_cloud').default(''),
  estado:               text('estado').notNull().default('Pendiente'), // 'Pendiente' | 'Aprobado' | 'Rechazado' | 'Con_Observaciones'
  respuestaRector:      text('respuesta_rector').default(''),
  reportadoEntidad:     boolean('reportado_entidad').notNull().default(false),
  fechaReporteEntidad:  timestamp('fecha_reporte_entidad', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('docente_permisos_institucion_idx').on(t.institucionId),
  index('docente_permisos_entidad_idx').on(t.entidadId),
  index('docente_permisos_docente_idx').on(t.docenteId),
  index('docente_permisos_estado_idx').on(t.estado),
]);

// Códigos de un solo uso para el Flujo B de acceso híbrido (punto 5):
// "Cédula + Código OTP". Diseño 100% cerrado (ajuste post-Lote 2): el único
// canal real de este proyecto es el correo (se reutiliza
// enviarCorreoGeneral()/POST /api/inetis/send-email, sin inventar un canal
// nuevo) — no existe ningún proveedor de SMS integrado, así que el endpoint
// (src/routes/etc.ts, /contratos/acceso/otp/solicitar) ni siquiera acepta un
// parámetro de canal: siempre envía por correo. La columna "canal" queda
// como un campo de extensión a futuro (si algún día se contrata un
// proveedor de SMS), no como una opción ofrecida hoy al usuario.
export const etcOtpCodigos = pgTable('etc_otp_codigos', {
  id:          serial('id').primaryKey(),
  cedula:      text('cedula').notNull(),
  codigo:      text('codigo').notNull(),
  canal:       text('canal').notNull().default('correo'), // hoy siempre 'correo' — columna reservada para un futuro proveedor de SMS
  destino:     text('destino').notNull().default(''),
  contratoId:  integer('contrato_id').references(() => etcContratos.id, { onDelete: 'cascade' }),
  expiraEn:    timestamp('expira_en', { withTimezone: true }).notNull(),
  usado:       boolean('usado').notNull().default(false),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('etc_otp_cedula_idx').on(t.cedula),
]);

// Ronda 33 — LOTE 5: rastro de auditoría del módulo ETC. La convención que
// YA usaba este módulo (creadoPor/actualizadoPor + createdAt/updatedAt en
// cada tabla) queda intacta y sin tocar — esta tabla nueva es un rastro
// ADICIONAL, centralizado y cronológico de acciones sensibles (login del
// Flujo A, evaluación de expedientes/permisos, revisión de documentos,
// inactivación de entidades/instituciones), tal como pide el punto 5 de la
// especificación ("CRUD... dejando rastro en logs de auditoría") para los
// 4 roles del módulo (Docente/Aspirante, Rector/Directivo, Admin ETC,
// Superadmin). Nunca se borra ni se edita una fila ya escrita — es un log
// de solo-inserción (append-only).
export const etcAuditLog = pgTable('etc_audit_log', {
  id:            serial('id').primaryKey(),
  entidadId:     integer('entidad_id'),
  actor:         text('actor').notNull().default(''), // cédula/usuario de quien ejecuta la acción
  rol:           text('rol').notNull().default(''), // 'Docente' | 'Aspirante' | 'Rector' | 'Directivo' | 'Admin_ETC' | 'Superadmin'
  accion:        text('accion').notNull(), // ej. 'login_flujo_a', 'evaluar_contrato', 'subir_documento', ...
  objetivoTipo:  text('objetivo_tipo').notNull().default(''), // 'contrato' | 'permiso' | 'entidad' | 'institucion' | 'documento' | 'acceso'
  objetivoId:    integer('objetivo_id'),
  detalle:       jsonb('detalle').default({}),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('etc_audit_log_entidad_idx').on(t.entidadId),
  index('etc_audit_log_actor_idx').on(t.actor),
]);

// ── RONDA 35 — Módulo "Mi Perfil" (clasificación extendida de rol/decreto +
// hoja de vida) ─────────────────────────────────────────────────────────────
// Estructura, en Neon PostgreSQL, los campos ampliados del perfil de cada
// usuario (rol/cargo específico, si es Docente Orientador/Psicoorientador,
// si es Tutor/Formador PTA, el tipo de Decreto/Régimen Laboral bajo la
// normativa MEN, y la URL de la hoja de vida subida a Cloudinary) para que el
// módulo ETC pueda leerlos directamente por (sk, userU) en vez de depender
// únicamente del blob JSON de kv_store. "sk" identifica la institución
// (multi-tenant) y "userU" es el nombre de usuario dentro de esa institución.
export const perfilDocenteExtendido = pgTable('perfil_docente_extendido', {
  id:                    serial('id').primaryKey(),
  sk:                    text('sk').notNull(),
  userU:                 text('user_u').notNull(),
  rolEspecifico:         text('rol_especifico').notNull().default(''), // ver catálogo RONDA35_ROLES_ESPECIFICOS
  esDocenteOrientador:   boolean('es_docente_orientador').notNull().default(false),
  esTutorPta:            boolean('es_tutor_pta').notNull().default(false),
  tipoDecretoNormativo:  text('tipo_decreto_normativo').notNull().default(''), // ver catálogo RONDA35_DECRETOS_NORMATIVOS
  escalafon:             text('escalafon').notNull().default(''),
  cvUrl:                 text('cv_url').notNull().default(''),
  cvNombreArchivo:       text('cv_nombre_archivo').notNull().default(''),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('perfil_docente_ext_sk_idx').on(t.sk),
  index('perfil_docente_ext_sk_user_idx').on(t.sk, t.userU),
]);

// ── RONDA 36 — Módulo de Interoperabilidad SIMAT / Portal ETC-Gobernación ──
// Decisión de arquitectura (documentada con transparencia): estos campos
// SIMAT/MEN se guardan en una tabla RELACIONAL nueva de Neon, identificada
// por (sk, nuip) — NO se integran al blob JSON de cada institución
// (kv_store, donde vive `db.ests` con sus notas/asistencia). Motivo: el
// importador debe poder hacer UPSERT por NUIP (actualizar caracterización/
// grado) "SIN borrar calificaciones/asistencias previas" — si estos campos
// vivieran dentro del mismo objeto JSON que las notas, cualquier import
// tendría que leer, fusionar y reescribir el blob COMPLETO de la
// institución (el mismo riesgo de "barrido masivo" que la Parte 1 de esta
// ronda corrigió para las notas), y una sola importación mal sincronizada
// podría arrastrar consigo datos de notas desactualizados. Con una tabla
// aparte, un import/export SIMAT nunca toca `kv_store` en absoluto — el
// vínculo entre un estudiante SIMAT y su ficha real (`db.ests`) se hace por
// NUIP/número de documento (comparación de texto), no por una llave foránea
// de base de datos, precisamente porque `db.ests` no vive en una tabla de
// Neon sino en el JSON de cada institución.
export const simatEstudiantes = pgTable('simat_estudiantes', {
  id:                     serial('id').primaryKey(),
  sk:                     text('sk').notNull(),
  nuip:                   text('nuip').notNull(),
  tipoDocumento:          text('tipo_documento').notNull().default(''),
  nombres:                text('nombres').notNull().default(''),
  apellidos:              text('apellidos').notNull().default(''),
  fechaNacimiento:        text('fecha_nacimiento').notNull().default(''),
  genero:                 text('genero').notNull().default(''),
  codigoDaneInstitucion:  text('codigo_dane_institucion').notNull().default(''),
  codigoDaneSede:         text('codigo_dane_sede').notNull().default(''),
  jornada:                text('jornada').notNull().default(''),
  gradoSimat:             text('grado_simat').notNull().default(''),
  grupo:                  text('grupo').notNull().default(''),
  tipoDiscapacidad:       text('tipo_discapacidad').notNull().default(''),
  poblacionVulnerable:    text('poblacion_vulnerable').notNull().default(''),
  etnia:                  text('etnia').notNull().default(''), // 'Indigena' | 'Afro' | 'Raizal' | 'Palenquera' | ''
  victimaConflicto:       boolean('victima_conflicto').notNull().default(false),
  estrato:                text('estrato').notNull().default(''),
  estadoSimat:            text('estado_simat').notNull().default('Matriculado'), // Matriculado|Retirado|Trasladado|Promovido|No Promovido
  fechaRegistroNovedad:   text('fecha_registro_novedad').notNull().default(''),
  novedad:                text('novedad').notNull().default(''),
  createdAt:              timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('simat_estudiantes_sk_nuip_idx').on(t.sk, t.nuip),
  index('simat_estudiantes_sk_idx').on(t.sk),
  index('simat_estudiantes_estado_idx').on(t.estadoSimat),
]);

// RONDA 37 — MÓDULO DE VERIFICACIÓN DIGITAL (Hash/QR de certificados). Se
// creó una tabla nueva, aparte de la firma HMAC "stateless" que ya existía
// para boletines (POST /api/inetis/boletin/firmar|verificar, que exige
// volver a enviar TODOS los datos originales para comprobar el código —
// algo que solo la propia app puede hacer porque ya conoce esos datos). El
// nuevo requisito pide una vista PÚBLICA que reciba SOLO un hash (sin
// sesión, sin reenviar datos) y muestre si es válido — para eso hace falta
// que el servidor recuerde, aunque sea con un resumen mínimo, qué hash
// corresponde a qué documento. Por eso esta tabla guarda ÚNICAMENTE los
// campos que la vista pública puede mostrar sin riesgo (nombre, tipo de
// documento, institución, fecha de emisión) — nunca notas, número de
// documento completo, dirección, ni ningún otro dato sensible del
// estudiante. No depende del flag ENABLE_SIMAT_ETC_MODULE: es una función
// aparte, ya usaba DOC_SIGN_SECRET, que ya existe en toda instalación.
// RONDA 38 — se agregaron `documentoEstudiante` y `anioLectivo` (columnas
// NUEVAS, con default '' — ver ensureSchemaCertificados() en src/db/index.ts
// para el ALTER TABLE retrocompatible) porque el usuario pidió que la vista
// pública de verificación muestre, además, el documento del estudiante y el
// año lectivo — antes solo existían para boletines (que ya mostraban el
// nombre, pero no el documento ni el año, en la vista pública). Los
// registros de boletines YA EMITIDOS en la Ronda 37 (antes de este ALTER)
// simplemente quedan con estas dos columnas en '' — la vista pública las
// omite quietamente si están vacías, en vez de mostrar un campo en blanco
// engañoso (ver _htmlVerificacionCertificado() en src/index.ts).
export const certificadosEmitidos = pgTable('certificados_emitidos', {
  id:                serial('id').primaryKey(),
  hash:              text('hash').notNull(),
  sk:                text('sk').notNull(),
  tipoDocumento:     text('tipo_documento').notNull().default(''), // 'boletin' | 'certificado_estudio' | 'constancia_matricula' | 'acta_grado' | ...
  nombreEstudiante:  text('nombre_estudiante').notNull().default(''),
  documentoEstudiante: text('documento_estudiante').notNull().default(''), // Ronda 38 — ej. "T.I. 1234567" (nunca el número completo de un adulto/tercero, solo del propio estudiante del documento)
  anioLectivo:       text('anio_lectivo').notNull().default(''), // Ronda 38
  institucion:       text('institucion').notNull().default(''),
  emitidoPor:        text('emitido_por').notNull().default(''),
  ip:                text('ip').notNull().default(''),
  fechaEmision:      timestamp('fecha_emision', { withTimezone: true }).defaultNow(),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('certificados_emitidos_hash_idx').on(t.hash),
  index('certificados_emitidos_sk_idx').on(t.sk),
]);

// Auditoría append-only de cada actualización de "Mi Perfil" — fecha/hora,
// usuario, rol e IP, tal como exige el punto 2 de la Ronda 35 ("trazabilidad
// de auditoría para cada actualización... fecha, hora, rol e IP").
export const perfilAuditLog = pgTable('perfil_audit_log', {
  id:         serial('id').primaryKey(),
  sk:         text('sk').notNull(),
  userU:      text('user_u').notNull(),
  rol:        text('rol').notNull().default(''),
  camposModificados: jsonb('campos_modificados').default([]),
  esCambioSensible:  boolean('es_cambio_sensible').notNull().default(false), // true si tocó email/teléfono/contraseña
  ip:         text('ip').notNull().default(''),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('perfil_audit_log_sk_idx').on(t.sk),
  index('perfil_audit_log_user_idx').on(t.userU),
]);

// ── B. MÓDULO EDUCACIÓN SUPERIOR / UNIVERSIDADES (catálogo independiente) ──────

export const universidadEntidades = pgTable('universidad_entidades', {
  id:            serial('id').primaryKey(),
  nombreUniversidad: text('nombre_universidad').notNull(),
  codigoSnies:   text('codigo_snies').notNull().default(''),
  nit:           text('nit').notNull().default(''),
  logoUrl:       text('logo_url').notNull().default(''),
  activo:        boolean('activo').notNull().default(true),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const universidadProgramas = pgTable('universidad_programas', {
  id:              serial('id').primaryKey(),
  universidadId:   integer('universidad_id').notNull().references(() => universidadEntidades.id, { onDelete: 'cascade' }),
  nombrePrograma:  text('nombre_programa').notNull(),
  nivel:           text('nivel').notNull().default('Pregrado'), // 'Pregrado' | 'Posgrado' | 'Maestria'
  facultad:        text('facultad').default(''),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('universidad_programas_universidad_idx').on(t.universidadId),
]);

export const universidadDocentesEstudiantes = pgTable('universidad_docentes_estudiantes', {
  id:               serial('id').primaryKey(),
  personaCedula:    text('persona_cedula').notNull(),
  tipoRol:          text('tipo_rol').notNull().default('Estudiante'), // 'Catedratico' | 'Planta' | 'Estudiante'
  programaId:       integer('programa_id').notNull().references(() => universidadProgramas.id, { onDelete: 'cascade' }),
  datosAdicionales: jsonb('datos_adicionales').default({}),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('universidad_docestud_persona_idx').on(t.personaCedula),
  index('universidad_docestud_programa_idx').on(t.programaId),
]);
