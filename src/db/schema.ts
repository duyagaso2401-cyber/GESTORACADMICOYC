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
