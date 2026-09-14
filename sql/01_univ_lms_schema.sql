-- =====================================================================
-- GESTOR ACADÉMICO YC — MÓDULO UNIVERSITARIO / LMS ENTERPRISE
-- Script SQL Universal y Agnóstico (DDL) — PostgreSQL 13+
-- Compatible con: Supabase, Neon, Render (Postgres), Railway, RDS, local.
--
-- CONVENCIONES:
--   - Prefijo univ_ en todas las tablas del módulo.
--   - Llaves primarias UUID (gen_random_uuid()).
--   - TIMESTAMP WITH TIME ZONE para toda fecha/hora.
--   - Columna metadata JSONB DEFAULT '{}' en tablas clave, para extender
--     el modelo sin migraciones destructivas futuras.
--   - Todas las FK a "instituciones" usan institucion_sk TEXT porque el
--     resto de la plataforma (kv_store, notifications, documents) ya
--     identifica cada institución/colegio/universidad con una clave de
--     texto (sk = "sede key" / tenant key), NO con un id numérico. Esto
--     hace que este módulo sea 100% multi-tenant desde el día uno y
--     compatible con los datos que ya existen en el sistema.
--   - IF NOT EXISTS en todo: el script se puede correr muchas veces sin
--     romper nada (idempotente), igual que el resto del proyecto.
--   - ON DELETE CASCADE en relaciones "de composición" (ej. un módulo
--     LMS no puede existir sin su sección) y ON DELETE SET NULL/RESTRICT
--     en relaciones "de referencia" (ej. no se borra un docente aunque
--     tenga secciones asignadas).
--
-- ORDEN DE EJECUCIÓN: este archivo es autocontenido y se puede ejecutar
-- de una sola vez (psql -f 01_univ_lms_schema.sql, o pegado completo en
-- el editor SQL de Supabase/Neon/Render).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- fallback por si gen_random_uuid() no está en core (PG < 13)
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- búsquedas de texto (foros, banco de preguntas, mensajería)

-- =====================================================================
-- 0. TIPOS ENUM
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE univ_rol AS ENUM ('SuperAdmin','Rector','Decano','Docente','Estudiante','Auxiliar','Padre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_estado_academico AS ENUM ('Regular','Prueba Academica','Graduado','Retirado','Suspendido','Egresado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_caracter_asignatura AS ENUM ('Obligatoria','Electiva','Optativa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_nivel_programa AS ENUM ('Pregrado','Posgrado','Especializacion','Maestria','Doctorado','Educacion Continua','Tecnico','Tecnologo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_tipo_entrega AS ENUM ('archivo','texto','enlace','archivo_texto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_tipo_pregunta AS ENUM ('opcion_multiple_unica','opcion_multiple_varias','verdadero_falso','respuesta_corta','ensayo','emparejamiento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_tipo_foro AS ENUM ('general','debate_sencillo','preguntas_respuestas');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_estado_asistencia AS ENUM ('Presente','Retardo','Excusado','Ausente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_estado_solicitud AS ENUM ('Pendiente','Aprobada','Rechazada','Cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE univ_modalidad_seccion AS ENUM ('Presencial','Virtual','Hibrida');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- 1. ESTRUCTURA INSTITUCIONAL Y CONFIGURACIÓN
-- =====================================================================

-- Sedes y campus (físicos y virtuales)
CREATE TABLE IF NOT EXISTS univ_sedes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk   TEXT NOT NULL,
  nombre           VARCHAR(200) NOT NULL,
  tipo             VARCHAR(30) NOT NULL DEFAULT 'Fisica',      -- Fisica | Virtual
  direccion        TEXT,
  ciudad           VARCHAR(120),
  pais             VARCHAR(120) DEFAULT 'Colombia',
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_sedes_institucion ON univ_sedes(institucion_sk);

-- Facultades / Decanaturas
CREATE TABLE IF NOT EXISTS univ_ent_facultades (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk   TEXT NOT NULL,
  nombre           VARCHAR(200) NOT NULL,
  codigo           VARCHAR(30),
  decano_usuario_id UUID,             -- FK diferida a univ_usuarios_perfil (definida más abajo con ALTER)
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(institucion_sk, codigo)
);
CREATE INDEX IF NOT EXISTS idx_univ_facultades_institucion ON univ_ent_facultades(institucion_sk);

-- Departamentos académicos
CREATE TABLE IF NOT EXISTS univ_ent_departamentos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facultad_id      UUID NOT NULL REFERENCES univ_ent_facultades(id) ON DELETE CASCADE,
  nombre           VARCHAR(200) NOT NULL,
  codigo           VARCHAR(30),
  jefe_usuario_id  UUID,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_departamentos_facultad ON univ_ent_departamentos(facultad_id);

-- Programas / Carreras (Pregrado, Posgrado, Educación Continua, etc.)
CREATE TABLE IF NOT EXISTS univ_programas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  departamento_id  UUID NOT NULL REFERENCES univ_ent_departamentos(id) ON DELETE CASCADE,
  institucion_sk   TEXT NOT NULL,
  nombre           VARCHAR(200) NOT NULL,
  codigo_snies     VARCHAR(30),
  nivel            univ_nivel_programa NOT NULL DEFAULT 'Pregrado',
  creditos_totales INTEGER NOT NULL DEFAULT 0,
  duracion_semestres INTEGER NOT NULL DEFAULT 10,
  titulo_otorgado  VARCHAR(255),
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_programas_departamento ON univ_programas(departamento_id);
CREATE INDEX IF NOT EXISTS idx_univ_programas_institucion ON univ_programas(institucion_sk);

-- Calendario académico: periodos/semestres, fechas clave y límites de cortes
CREATE TABLE IF NOT EXISTS univ_ent_periodos_academicos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk        TEXT NOT NULL,
  codigo                VARCHAR(20) NOT NULL,          -- ej. "2026-1"
  nombre                VARCHAR(120),
  fecha_inicio_prematricula TIMESTAMP WITH TIME ZONE,
  fecha_fin_prematricula    TIMESTAMP WITH TIME ZONE,
  fecha_inicio_adiciones    TIMESTAMP WITH TIME ZONE,
  fecha_fin_adiciones       TIMESTAMP WITH TIME ZONE,   -- adiciones/cancelaciones
  fecha_inicio_clases       TIMESTAMP WITH TIME ZONE,
  fecha_fin_clases          TIMESTAMP WITH TIME ZONE,
  -- límites de registro de notas por corte (fecha límite para digitar cada corte)
  corte1_fecha_limite       TIMESTAMP WITH TIME ZONE,
  corte1_porcentaje         NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  corte2_fecha_limite       TIMESTAMP WITH TIME ZONE,
  corte2_porcentaje         NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  corte3_fecha_limite       TIMESTAMP WITH TIME ZONE,
  corte3_porcentaje         NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  estado                    VARCHAR(20) NOT NULL DEFAULT 'Planeado', -- Planeado | Activo | Cerrado
  activo                    BOOLEAN NOT NULL DEFAULT TRUE,
  metadata                  JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(institucion_sk, codigo),
  CONSTRAINT chk_univ_periodos_suma_100 CHECK (corte1_porcentaje + corte2_porcentaje + corte3_porcentaje = 100.00)
);
CREATE INDEX IF NOT EXISTS idx_univ_periodos_institucion ON univ_ent_periodos_academicos(institucion_sk);
CREATE INDEX IF NOT EXISTS idx_univ_periodos_estado ON univ_ent_periodos_academicos(institucion_sk, estado);

-- Parámetros globales de la institución universitaria
CREATE TABLE IF NOT EXISTS univ_ent_parametros (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk           TEXT NOT NULL UNIQUE,
  escala_nota_minima       NUMERIC(4,2) NOT NULL DEFAULT 0.0,
  escala_nota_maxima       NUMERIC(4,2) NOT NULL DEFAULT 5.0,
  nota_minima_aprobacion   NUMERIC(4,2) NOT NULL DEFAULT 3.0,
  tope_fallas_porcentaje   NUMERIC(5,2) NOT NULL DEFAULT 20.00,   -- % de fallas para perder por inasistencia
  politica_creditos        JSONB NOT NULL DEFAULT '{"min_creditos_semestre":12,"max_creditos_semestre":21,"max_creditos_prueba_academica":14}',
  umbral_prueba_academica  NUMERIC(4,2) NOT NULL DEFAULT 3.0,     -- PAPA por debajo del cual entra a prueba académica
  dias_inactividad_riesgo  INTEGER NOT NULL DEFAULT 14,           -- días sin ingresar para marcar "en riesgo"
  metadata                 JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. USUARIOS / PERFILES (auto-gestión para todos los roles)
-- =====================================================================
-- Nota: el sistema base (Gestor Académico YC) ya maneja usuarios dentro
-- del kv_store por institución. Esta tabla es la extensión "enterprise"
-- para el módulo universitario: credenciales propias con hash bcrypt,
-- datos de perfil y foto Cloudinary, enlazable al usuario "u" (userU)
-- que ya usa el resto de la plataforma vía usuario_u.

CREATE TABLE IF NOT EXISTS univ_usuarios_perfil (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk     TEXT NOT NULL,
  usuario_u          TEXT NOT NULL,             -- identificador de usuario ya usado en el resto del sistema (sk+user)
  rol                univ_rol NOT NULL DEFAULT 'Estudiante',
  nombres            VARCHAR(150) NOT NULL DEFAULT '',
  apellidos          VARCHAR(150) NOT NULL DEFAULT '',
  correo             VARCHAR(180),
  telefono           VARCHAR(40),
  documento_identidad VARCHAR(40),
  biografia          TEXT,
  foto_url           TEXT,                      -- URL segura de Cloudinary
  password_hash      TEXT,                      -- bcrypt
  password_actualizada_at TIMESTAMP WITH TIME ZONE,
  ultimo_ingreso_at  TIMESTAMP WITH TIME ZONE,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(institucion_sk, usuario_u)
);
CREATE INDEX IF NOT EXISTS idx_univ_usuarios_institucion ON univ_usuarios_perfil(institucion_sk);
CREATE INDEX IF NOT EXISTS idx_univ_usuarios_rol ON univ_usuarios_perfil(institucion_sk, rol);
CREATE INDEX IF NOT EXISTS idx_univ_usuarios_ultimo_ingreso ON univ_usuarios_perfil(ultimo_ingreso_at);

-- Ahora sí podemos completar las FK diferidas de facultades/departamentos:
DO $$ BEGIN
  ALTER TABLE univ_ent_facultades ADD CONSTRAINT fk_univ_facultades_decano
    FOREIGN KEY (decano_usuario_id) REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE univ_ent_departamentos ADD CONSTRAINT fk_univ_departamentos_jefe
    FOREIGN KEY (jefe_usuario_id) REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- 3. GESTIÓN ACADÉMICA Y CURRICULAR
-- =====================================================================

-- Pensum / malla curricular (por versión, ligado a un programa)
CREATE TABLE IF NOT EXISTS univ_ent_pensums (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programa_id      UUID NOT NULL REFERENCES univ_programas(id) ON DELETE CASCADE,
  version          VARCHAR(30) NOT NULL,          -- ej. "2026-A"
  nombre           VARCHAR(200),
  vigente_desde    DATE,
  vigente_hasta    DATE,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(programa_id, version)
);
CREATE INDEX IF NOT EXISTS idx_univ_pensums_programa ON univ_ent_pensums(programa_id);

-- Asignaturas (catálogo maestro; una asignatura puede repetirse en varios pensums)
CREATE TABLE IF NOT EXISTS univ_asignaturas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk        TEXT NOT NULL,
  codigo                VARCHAR(30) NOT NULL,
  nombre                VARCHAR(200) NOT NULL,
  creditos              NUMERIC(4,1) NOT NULL DEFAULT 3,
  horas_presenciales    NUMERIC(5,1) NOT NULL DEFAULT 0,
  horas_independientes  NUMERIC(5,1) NOT NULL DEFAULT 0,
  caracter              univ_caracter_asignatura NOT NULL DEFAULT 'Obligatoria',
  departamento_id       UUID REFERENCES univ_ent_departamentos(id) ON DELETE SET NULL,
  descripcion           TEXT,
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(institucion_sk, codigo)
);
CREATE INDEX IF NOT EXISTS idx_univ_asignaturas_institucion ON univ_asignaturas(institucion_sk);

-- Relación asignatura <-> pensum (semestre sugerido dentro del plan)
CREATE TABLE IF NOT EXISTS univ_ent_pensum_asignaturas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pensum_id        UUID NOT NULL REFERENCES univ_ent_pensums(id) ON DELETE CASCADE,
  asignatura_id    UUID NOT NULL REFERENCES univ_asignaturas(id) ON DELETE CASCADE,
  semestre_sugerido INTEGER NOT NULL DEFAULT 1,
  metadata         JSONB NOT NULL DEFAULT '{}',
  UNIQUE(pensum_id, asignatura_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_pensum_asig_pensum ON univ_ent_pensum_asignaturas(pensum_id);

-- Prerrequisitos (asignatura_id requiere haber aprobado prerrequisito_id)
CREATE TABLE IF NOT EXISTS univ_prerrequisitos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asignatura_id     UUID NOT NULL REFERENCES univ_asignaturas(id) ON DELETE CASCADE,
  prerrequisito_id  UUID NOT NULL REFERENCES univ_asignaturas(id) ON DELETE CASCADE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  UNIQUE(asignatura_id, prerrequisito_id),
  CONSTRAINT chk_univ_prereq_no_self CHECK (asignatura_id <> prerrequisito_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_prereq_asignatura ON univ_prerrequisitos(asignatura_id);

-- Correquisitos (deben cursarse en simultáneo)
CREATE TABLE IF NOT EXISTS univ_ent_correquisitos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asignatura_id     UUID NOT NULL REFERENCES univ_asignaturas(id) ON DELETE CASCADE,
  correquisito_id   UUID NOT NULL REFERENCES univ_asignaturas(id) ON DELETE CASCADE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  UNIQUE(asignatura_id, correquisito_id),
  CONSTRAINT chk_univ_correq_no_self CHECK (asignatura_id <> correquisito_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_correq_asignatura ON univ_ent_correquisitos(asignatura_id);

-- Oferta académica / Secciones o NRC (apertura de aula/grupo por periodo)
CREATE TABLE IF NOT EXISTS univ_ent_secciones (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk      TEXT NOT NULL,
  nrc                 VARCHAR(30),                -- código de sección/NRC visible
  asignatura_id       UUID NOT NULL REFERENCES univ_asignaturas(id) ON DELETE CASCADE,
  periodo_id          UUID NOT NULL REFERENCES univ_ent_periodos_academicos(id) ON DELETE CASCADE,
  sede_id             UUID REFERENCES univ_sedes(id) ON DELETE SET NULL,
  docente_titular_id  UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  cupo_maximo         INTEGER NOT NULL DEFAULT 35,
  modalidad           univ_modalidad_seccion NOT NULL DEFAULT 'Presencial',
  horario             JSONB NOT NULL DEFAULT '[]',   -- [{dia,hora_inicio,hora_fin,aula}]
  aula_fisica         VARCHAR(100),
  enlace_videollamada TEXT,                          -- Meet/Teams/Zoom/Jitsi recurrente
  proveedor_video     VARCHAR(30),                   -- meet | teams | zoom | jitsi
  formato_aula        VARCHAR(20) NOT NULL DEFAULT 'semanal', -- semanal | temas
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_secciones_periodo ON univ_ent_secciones(periodo_id);
CREATE INDEX IF NOT EXISTS idx_univ_secciones_asignatura ON univ_ent_secciones(asignatura_id);
CREATE INDEX IF NOT EXISTS idx_univ_secciones_docente ON univ_ent_secciones(docente_titular_id);
CREATE INDEX IF NOT EXISTS idx_univ_secciones_institucion ON univ_ent_secciones(institucion_sk);

-- Docentes auxiliares / monitores por sección (relación N:N con rol específico)
CREATE TABLE IF NOT EXISTS univ_seccion_auxiliares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id     UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  usuario_id     UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  rol_asistencia VARCHAR(30) NOT NULL DEFAULT 'Auxiliar', -- Auxiliar | Monitor
  metadata       JSONB NOT NULL DEFAULT '{}',
  UNIQUE(seccion_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_seccion_aux_seccion ON univ_seccion_auxiliares(seccion_id);

-- Grabaciones de las videollamadas de la sección
CREATE TABLE IF NOT EXISTS univ_seccion_grabaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id     UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  titulo         VARCHAR(200),
  url_grabacion  TEXT NOT NULL,
  fecha_clase    TIMESTAMP WITH TIME ZONE,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_grabaciones_seccion ON univ_seccion_grabaciones(seccion_id);

-- =====================================================================
-- 4. MATRÍCULAS Y HOJA DE VIDA ACADÉMICA
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_ent_matriculas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id        UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  estudiante_id     UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  tipo              VARCHAR(20) NOT NULL DEFAULT 'Ordinaria',  -- Ordinaria | Extraordinaria
  estado            VARCHAR(20) NOT NULL DEFAULT 'Activa',     -- Activa | Cancelada | Retirada | Aprobada | Reprobada
  fecha_matricula   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  nota_definitiva   NUMERIC(4,2),
  porcentaje_asistencia NUMERIC(5,2),
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(seccion_id, estudiante_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_matriculas_seccion ON univ_ent_matriculas(seccion_id);
CREATE INDEX IF NOT EXISTS idx_univ_matriculas_estudiante ON univ_ent_matriculas(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_univ_matriculas_estado ON univ_ent_matriculas(estado);

-- Calificación por corte (usa los % definidos en univ_ent_periodos_academicos)
CREATE TABLE IF NOT EXISTS univ_ent_calificaciones_cortes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id   UUID NOT NULL REFERENCES univ_ent_matriculas(id) ON DELETE CASCADE,
  corte          SMALLINT NOT NULL CHECK (corte IN (1,2,3)),
  nota           NUMERIC(4,2),
  observacion    TEXT,
  actualizado_por UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  metadata       JSONB NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(matricula_id, corte)
);
CREATE INDEX IF NOT EXISTS idx_univ_calif_cortes_matricula ON univ_ent_calificaciones_cortes(matricula_id);

-- Hoja de vida / historia académica: snapshot por semestre cursado
CREATE TABLE IF NOT EXISTS univ_historial_academico (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id         UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  periodo_id            UUID NOT NULL REFERENCES univ_ent_periodos_academicos(id) ON DELETE CASCADE,
  promedio_semestral    NUMERIC(4,2),
  papa_acumulado        NUMERIC(4,2),               -- Promedio Académico Ponderado Acumulado
  creditos_cursados     INTEGER NOT NULL DEFAULT 0,
  creditos_aprobados    INTEGER NOT NULL DEFAULT 0,
  creditos_pendientes   INTEGER NOT NULL DEFAULT 0,
  estado_academico      univ_estado_academico NOT NULL DEFAULT 'Regular',
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(estudiante_id, periodo_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_historial_estudiante ON univ_historial_academico(estudiante_id);

-- =====================================================================
-- 5. LMS — ESTRUCTURA DEL AULA VIRTUAL (MÓDULOS / TEMAS)
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_modulos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id     UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  titulo         VARCHAR(200) NOT NULL,
  descripcion    TEXT,
  orden          INTEGER NOT NULL DEFAULT 0,
  tipo           VARCHAR(20) NOT NULL DEFAULT 'tema',  -- semanal | tema
  fecha_inicio   DATE,
  fecha_fin      DATE,
  visible        BOOLEAN NOT NULL DEFAULT TRUE,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_lms_modulos_seccion ON univ_lms_modulos(seccion_id, orden);

-- Recursos (archivos, enlaces, páginas HTML, carpetas)
CREATE TABLE IF NOT EXISTS univ_lms_recursos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id      UUID NOT NULL REFERENCES univ_lms_modulos(id) ON DELETE CASCADE,
  tipo           VARCHAR(30) NOT NULL,   -- archivo | enlace | pagina_html | carpeta
  titulo         VARCHAR(200) NOT NULL,
  descripcion    TEXT,
  url_archivo    TEXT,                   -- URL Cloudinary (PDF, Word, Slides, ZIP)
  url_externa    TEXT,                   -- enlace externo (video, simulador)
  contenido_html TEXT,                   -- página HTML con editor WYSIWYG
  carpeta_padre_id UUID REFERENCES univ_lms_recursos(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL DEFAULT 0,
  visible        BOOLEAN NOT NULL DEFAULT TRUE,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_lms_recursos_modulo ON univ_lms_recursos(modulo_id, orden);

-- =====================================================================
-- 6. LMS — RÚBRICAS (reutilizables en tareas y en taller de coevaluación)
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_rubricas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id     UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  nombre         VARCHAR(200) NOT NULL,
  tipo           VARCHAR(20) NOT NULL DEFAULT 'rubrica', -- rubrica | lista_cotejo
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_rubricas_seccion ON univ_lms_rubricas(seccion_id);

CREATE TABLE IF NOT EXISTS univ_lms_rubrica_criterios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubrica_id     UUID NOT NULL REFERENCES univ_lms_rubricas(id) ON DELETE CASCADE,
  criterio       VARCHAR(255) NOT NULL,
  descripcion    TEXT,
  puntaje_maximo NUMERIC(6,2) NOT NULL DEFAULT 1,
  niveles        JSONB NOT NULL DEFAULT '[]',  -- [{nombre,puntaje,descripcion}]
  orden          INTEGER NOT NULL DEFAULT 0,
  metadata       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_univ_rubrica_criterios_rubrica ON univ_lms_rubrica_criterios(rubrica_id);

-- =====================================================================
-- 7. LMS — ACTIVIDADES (tareas/entregas avanzadas)
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_actividades (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id             UUID NOT NULL REFERENCES univ_lms_modulos(id) ON DELETE CASCADE,
  tipo                  VARCHAR(30) NOT NULL DEFAULT 'tarea',  -- tarea | cuestionario | foro | taller | asistencia
  titulo                VARCHAR(200) NOT NULL,
  descripcion           TEXT,
  tipo_entrega          univ_tipo_entrega NOT NULL DEFAULT 'archivo',
  fecha_apertura        TIMESTAMP WITH TIME ZONE,
  fecha_limite          TIMESTAMP WITH TIME ZONE,
  fecha_penalizacion    TIMESTAMP WITH TIME ZONE,   -- desde aquí aplica penalización por retraso
  fecha_corte           TIMESTAMP WITH TIME ZONE,   -- fecha absoluta de cierre, ya no recibe entregas
  penalizacion_por_dia  NUMERIC(5,2) NOT NULL DEFAULT 0,   -- % de descuento por día de retraso
  puntaje_maximo        NUMERIC(6,2) NOT NULL DEFAULT 5,
  rubrica_id            UUID REFERENCES univ_lms_rubricas(id) ON DELETE SET NULL,
  es_grupal             BOOLEAN NOT NULL DEFAULT FALSE,
  ponderable            BOOLEAN NOT NULL DEFAULT TRUE,
  categoria_gradebook_id UUID,   -- FK diferida a univ_ent_gradebook_categorias (declarada más abajo)
  visible               BOOLEAN NOT NULL DEFAULT TRUE,
  orden                 INTEGER NOT NULL DEFAULT 0,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_actividades_modulo ON univ_lms_actividades(modulo_id);
CREATE INDEX IF NOT EXISTS idx_univ_actividades_tipo ON univ_lms_actividades(tipo);
CREATE INDEX IF NOT EXISTS idx_univ_actividades_fecha_limite ON univ_lms_actividades(fecha_limite);

-- Grupos de trabajo (para actividades grupales)
CREATE TABLE IF NOT EXISTS univ_lms_grupos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id   UUID NOT NULL REFERENCES univ_lms_actividades(id) ON DELETE CASCADE,
  nombre         VARCHAR(150) NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS univ_lms_grupo_integrantes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       UUID NOT NULL REFERENCES univ_lms_grupos(id) ON DELETE CASCADE,
  estudiante_id  UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  UNIQUE(grupo_id, estudiante_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_grupo_integrantes_grupo ON univ_lms_grupo_integrantes(grupo_id);

-- Entregas de estudiantes (individuales o por grupo)
CREATE TABLE IF NOT EXISTS univ_lms_entregas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id      UUID NOT NULL REFERENCES univ_lms_actividades(id) ON DELETE CASCADE,
  estudiante_id     UUID REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  grupo_id          UUID REFERENCES univ_lms_grupos(id) ON DELETE CASCADE,
  contenido_texto   TEXT,
  url_archivo       TEXT,        -- Cloudinary
  url_enlace        TEXT,
  intento_numero    INTEGER NOT NULL DEFAULT 1,
  estado            VARCHAR(20) NOT NULL DEFAULT 'enviada', -- borrador | enviada | calificada | devuelta
  entregado_tarde   BOOLEAN NOT NULL DEFAULT FALSE,
  nota              NUMERIC(6,2),
  retroalimentacion TEXT,
  calificacion_rubrica JSONB DEFAULT '{}',   -- {criterio_id: {nivel, puntaje}}
  calificado_por    UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  calificado_at     TIMESTAMP WITH TIME ZONE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT chk_univ_entrega_autor CHECK (estudiante_id IS NOT NULL OR grupo_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_univ_entregas_actividad ON univ_lms_entregas(actividad_id);
CREATE INDEX IF NOT EXISTS idx_univ_entregas_estudiante ON univ_lms_entregas(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_univ_entregas_grupo ON univ_lms_entregas(grupo_id);
CREATE INDEX IF NOT EXISTS idx_univ_entregas_estado ON univ_lms_entregas(estado);

-- =====================================================================
-- 8. LMS — QUIZ ENGINE (banco de preguntas, cuestionarios, intentos)
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_banco_categorias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id     UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  nombre         VARCHAR(150) NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS univ_ent_lms_banco_preguntas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id      UUID NOT NULL REFERENCES univ_lms_banco_categorias(id) ON DELETE CASCADE,
  tipo              univ_tipo_pregunta NOT NULL DEFAULT 'opcion_multiple_unica',
  enunciado         TEXT NOT NULL,
  puntaje_defecto   NUMERIC(6,2) NOT NULL DEFAULT 1,
  opciones          JSONB NOT NULL DEFAULT '[]',  -- [{id,texto,correcta}]
  respuesta_correcta TEXT,                        -- para respuesta corta / V-F
  retroalimentacion TEXT,
  creado_por        UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_banco_preguntas_categoria ON univ_ent_lms_banco_preguntas(categoria_id);
CREATE INDEX IF NOT EXISTS idx_univ_banco_preguntas_enunciado_trgm ON univ_ent_lms_banco_preguntas USING gin (enunciado gin_trgm_ops);

CREATE TABLE IF NOT EXISTS univ_ent_lms_cuestionarios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id          UUID NOT NULL REFERENCES univ_lms_actividades(id) ON DELETE CASCADE,
  limite_tiempo_minutos INTEGER,                 -- cronómetro; NULL = sin límite
  intentos_permitidos   INTEGER NOT NULL DEFAULT 1,
  metodo_calificacion   VARCHAR(20) NOT NULL DEFAULT 'mas_alto', -- mas_alto | promedio | primer_intento | ultimo_intento
  barajar_preguntas     BOOLEAN NOT NULL DEFAULT TRUE,
  barajar_opciones      BOOLEAN NOT NULL DEFAULT TRUE,
  mostrar_respuestas_al_finalizar BOOLEAN NOT NULL DEFAULT FALSE,
  control_integridad    BOOLEAN NOT NULL DEFAULT TRUE,   -- registrar clics, tiempo por pregunta, pérdida de foco
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_cuestionarios_actividad ON univ_ent_lms_cuestionarios(actividad_id);

CREATE TABLE IF NOT EXISTS univ_ent_lms_cuestionario_preguntas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuestionario_id   UUID NOT NULL REFERENCES univ_ent_lms_cuestionarios(id) ON DELETE CASCADE,
  pregunta_id       UUID NOT NULL REFERENCES univ_ent_lms_banco_preguntas(id) ON DELETE CASCADE,
  puntaje           NUMERIC(6,2),          -- sobre-escribe puntaje_defecto de la pregunta si se define
  orden             INTEGER NOT NULL DEFAULT 0,
  UNIQUE(cuestionario_id, pregunta_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_cq_preguntas_cuestionario ON univ_ent_lms_cuestionario_preguntas(cuestionario_id);

CREATE TABLE IF NOT EXISTS univ_lms_intentos_cuestionario (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuestionario_id   UUID NOT NULL REFERENCES univ_ent_lms_cuestionarios(id) ON DELETE CASCADE,
  estudiante_id     UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  numero_intento    INTEGER NOT NULL DEFAULT 1,
  iniciado_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finalizado_at     TIMESTAMP WITH TIME ZONE,
  nota_obtenida     NUMERIC(6,2),
  estado            VARCHAR(20) NOT NULL DEFAULT 'en_curso',  -- en_curso | enviado | calificado | expirado | anulado
  -- Control de integridad de evaluación:
  clics_registrados     INTEGER NOT NULL DEFAULT 0,
  cambios_pestana       INTEGER NOT NULL DEFAULT 0,   -- veces que perdió foco / cambió de pestaña
  tiempo_por_pregunta   JSONB NOT NULL DEFAULT '{}',  -- {pregunta_id: segundos}
  ip_address            VARCHAR(64),
  user_agent            TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  UNIQUE(cuestionario_id, estudiante_id, numero_intento)
);
CREATE INDEX IF NOT EXISTS idx_univ_intentos_cuestionario ON univ_lms_intentos_cuestionario(cuestionario_id);
CREATE INDEX IF NOT EXISTS idx_univ_intentos_estudiante ON univ_lms_intentos_cuestionario(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_univ_intentos_estado ON univ_lms_intentos_cuestionario(estado);

CREATE TABLE IF NOT EXISTS univ_lms_respuestas_intento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intento_id     UUID NOT NULL REFERENCES univ_lms_intentos_cuestionario(id) ON DELETE CASCADE,
  pregunta_id    UUID NOT NULL REFERENCES univ_ent_lms_banco_preguntas(id) ON DELETE CASCADE,
  respuesta_dada JSONB NOT NULL DEFAULT '{}',  -- opciones marcadas / texto libre
  es_correcta    BOOLEAN,
  puntaje_obtenido NUMERIC(6,2),
  calificado_manual BOOLEAN NOT NULL DEFAULT FALSE, -- true para ensayo
  retroalimentacion_docente TEXT,
  segundos_invertidos INTEGER NOT NULL DEFAULT 0,
  metadata       JSONB NOT NULL DEFAULT '{}',
  UNIQUE(intento_id, pregunta_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_respuestas_intento ON univ_lms_respuestas_intento(intento_id);

-- =====================================================================
-- 9. LMS — FOROS DE DISCUSIÓN
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_foros (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id      UUID NOT NULL REFERENCES univ_lms_actividades(id) ON DELETE CASCADE,
  tipo              univ_tipo_foro NOT NULL DEFAULT 'general',
  responder_antes_de_ver BOOLEAN NOT NULL DEFAULT FALSE,  -- modo Q&A
  es_evaluable      BOOLEAN NOT NULL DEFAULT FALSE,
  ponderacion       NUMERIC(5,2) NOT NULL DEFAULT 0,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_foros_actividad ON univ_lms_foros(actividad_id);

CREATE TABLE IF NOT EXISTS univ_lms_foro_temas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  foro_id        UUID NOT NULL REFERENCES univ_lms_foros(id) ON DELETE CASCADE,
  autor_id       UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  titulo         VARCHAR(255) NOT NULL,
  contenido      TEXT NOT NULL,
  fijado         BOOLEAN NOT NULL DEFAULT FALSE,
  cerrado        BOOLEAN NOT NULL DEFAULT FALSE,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_foro_temas_foro ON univ_lms_foro_temas(foro_id);
CREATE INDEX IF NOT EXISTS idx_univ_foro_temas_contenido_trgm ON univ_lms_foro_temas USING gin (contenido gin_trgm_ops);

CREATE TABLE IF NOT EXISTS univ_lms_foro_respuestas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tema_id        UUID NOT NULL REFERENCES univ_lms_foro_temas(id) ON DELETE CASCADE,
  autor_id       UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  respuesta_padre_id UUID REFERENCES univ_lms_foro_respuestas(id) ON DELETE CASCADE,
  contenido      TEXT NOT NULL,
  nota_evaluacion NUMERIC(6,2),   -- si el foro es evaluable
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_foro_respuestas_tema ON univ_lms_foro_respuestas(tema_id);

-- =====================================================================
-- 10. LMS — TALLER DE COEVALUACIÓN (PEER REVIEW)
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_talleres (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id      UUID NOT NULL REFERENCES univ_lms_actividades(id) ON DELETE CASCADE,
  rubrica_id        UUID REFERENCES univ_lms_rubricas(id) ON DELETE SET NULL,
  fase_actual       VARCHAR(20) NOT NULL DEFAULT 'envio', -- envio | evaluacion | calificacion_final | cerrado
  evaluaciones_por_estudiante INTEGER NOT NULL DEFAULT 3,
  fecha_fin_envio      TIMESTAMP WITH TIME ZONE,
  fecha_fin_evaluacion TIMESTAMP WITH TIME ZONE,
  ponderacion_autoevaluacion NUMERIC(5,2) NOT NULL DEFAULT 0,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS univ_lms_taller_envios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taller_id      UUID NOT NULL REFERENCES univ_lms_talleres(id) ON DELETE CASCADE,
  estudiante_id  UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  contenido_texto TEXT,
  url_archivo    TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(taller_id, estudiante_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_taller_envios_taller ON univ_lms_taller_envios(taller_id);

-- Asignación de qué envío evalúa cada estudiante (algoritmo de reparto en backend)
CREATE TABLE IF NOT EXISTS univ_lms_taller_asignaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taller_id      UUID NOT NULL REFERENCES univ_lms_talleres(id) ON DELETE CASCADE,
  envio_id       UUID NOT NULL REFERENCES univ_lms_taller_envios(id) ON DELETE CASCADE,
  evaluador_id   UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  es_autoevaluacion BOOLEAN NOT NULL DEFAULT FALSE,
  calificacion_rubrica JSONB DEFAULT '{}',
  nota_asignada  NUMERIC(6,2),
  comentario     TEXT,
  completada     BOOLEAN NOT NULL DEFAULT FALSE,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(envio_id, evaluador_id)
);
CREATE INDEX IF NOT EXISTS idx_univ_taller_asign_taller ON univ_lms_taller_asignaciones(taller_id);
CREATE INDEX IF NOT EXISTS idx_univ_taller_asign_evaluador ON univ_lms_taller_asignaciones(evaluador_id);

-- =====================================================================
-- 11. ASISTENCIA
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_asistencia (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id     UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  estudiante_id  UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  fecha_clase    DATE NOT NULL,
  estado         univ_estado_asistencia NOT NULL DEFAULT 'Presente',
  observacion    TEXT,
  registrado_por UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(seccion_id, estudiante_id, fecha_clase)
);
CREATE INDEX IF NOT EXISTS idx_univ_asistencia_seccion_fecha ON univ_lms_asistencia(seccion_id, fecha_clase);
CREATE INDEX IF NOT EXISTS idx_univ_asistencia_estudiante ON univ_lms_asistencia(estudiante_id);

-- =====================================================================
-- 12. GRADEBOOK (categorías, ponderaciones)
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_ent_gradebook_categorias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seccion_id     UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  nombre         VARCHAR(150) NOT NULL,             -- ej. "Corte 1", "Talleres", "Quices"
  corte          SMALLINT CHECK (corte IN (1,2,3)), -- opcional: agrupar por corte
  ponderacion    NUMERIC(5,2) NOT NULL DEFAULT 0,   -- % dentro del corte o del total
  orden          INTEGER NOT NULL DEFAULT 0,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_gb_categorias_seccion ON univ_ent_gradebook_categorias(seccion_id);

-- Ahora sí, la FK diferida de actividades -> categoría de gradebook
DO $$ BEGIN
  ALTER TABLE univ_lms_actividades ADD CONSTRAINT fk_univ_actividades_categoria
    FOREIGN KEY (categoria_gradebook_id) REFERENCES univ_ent_gradebook_categorias(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_univ_actividades_categoria ON univ_lms_actividades(categoria_gradebook_id);

-- =====================================================================
-- 13. TRAZABILIDAD Y TELEMETRÍA (AUDIT TRAIL)
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_lms_logs (
  id             BIGSERIAL PRIMARY KEY,
  institucion_sk TEXT NOT NULL,
  usuario_id     UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  seccion_id     UUID REFERENCES univ_ent_secciones(id) ON DELETE SET NULL,
  tipo_evento    VARCHAR(50) NOT NULL,     -- login | vista | descarga | inicio_examen | envio_examen | inicio_tarea | envio_tarea | vista_foro | etc.
  entidad_tipo   VARCHAR(50),              -- 'univ_lms_recursos' | 'univ_lms_actividades' | ...
  entidad_id     UUID,
  ip_address     VARCHAR(64),
  user_agent     TEXT,
  detalle        JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_logs_institucion_fecha ON univ_lms_logs(institucion_sk, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_univ_logs_usuario ON univ_lms_logs(usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_univ_logs_seccion ON univ_lms_logs(seccion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_univ_logs_tipo ON univ_lms_logs(tipo_evento, created_at DESC);
-- Índice pensado para "delta updates": traer solo logs desde una fecha
CREATE INDEX IF NOT EXISTS idx_univ_logs_created_at ON univ_lms_logs(created_at);

-- =====================================================================
-- 14. MENSAJERÍA INTERNA
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_mensajes_conversaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk   TEXT NOT NULL,
  tipo             VARCHAR(20) NOT NULL DEFAULT 'directo',  -- directo | grupo
  titulo           VARCHAR(200),
  participantes    UUID[] NOT NULL,          -- array de univ_usuarios_perfil.id, indexado con GIN
  creado_por       UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  ultimo_mensaje_at TIMESTAMP WITH TIME ZONE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_conversaciones_participantes ON univ_mensajes_conversaciones USING gin (participantes);
CREATE INDEX IF NOT EXISTS idx_univ_conversaciones_institucion ON univ_mensajes_conversaciones(institucion_sk);
CREATE INDEX IF NOT EXISTS idx_univ_conversaciones_ultimo_msg ON univ_mensajes_conversaciones(ultimo_mensaje_at DESC);

CREATE TABLE IF NOT EXISTS univ_mensajes_texto (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id  UUID NOT NULL REFERENCES univ_mensajes_conversaciones(id) ON DELETE CASCADE,
  autor_id         UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  contenido        TEXT NOT NULL,
  adjunto_url      TEXT,
  leido_por        UUID[] NOT NULL DEFAULT '{}',
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_mensajes_conversacion_fecha ON univ_mensajes_texto(conversacion_id, created_at);
-- Este índice es clave para "delta updates" de chat: traer solo mensajes nuevos.
CREATE INDEX IF NOT EXISTS idx_univ_mensajes_created_at ON univ_mensajes_texto(created_at);

-- =====================================================================
-- 15. CENTRO DE NOTIFICACIONES MULTICANAL
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_notificaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institucion_sk   TEXT NOT NULL,
  usuario_id       UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  tipo             VARCHAR(50) NOT NULL,   -- nueva_tarea | recordatorio | calificacion_publicada | anuncio | mensaje | foro
  titulo           VARCHAR(255) NOT NULL,
  cuerpo           TEXT,
  url_accion       TEXT,
  canal_email_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  leida            BOOLEAN NOT NULL DEFAULT FALSE,
  leida_at         TIMESTAMP WITH TIME ZONE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_notif_usuario_leida ON univ_notificaciones(usuario_id, leida, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_univ_notif_institucion ON univ_notificaciones(institucion_sk, created_at DESC);
-- Índice para delta updates: solo notificaciones nuevas desde ?since=
CREATE INDEX IF NOT EXISTS idx_univ_notif_created_at ON univ_notificaciones(created_at);

-- =====================================================================
-- 16. SUPLETORIOS Y EXÁMENES EXTEMPORÁNEOS
-- =====================================================================

CREATE TABLE IF NOT EXISTS univ_solicitudes_supletorios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id     UUID NOT NULL REFERENCES univ_usuarios_perfil(id) ON DELETE CASCADE,
  seccion_id        UUID NOT NULL REFERENCES univ_ent_secciones(id) ON DELETE CASCADE,
  actividad_id      UUID REFERENCES univ_lms_actividades(id) ON DELETE SET NULL,
  motivo            TEXT NOT NULL,
  url_excusa_adjunta TEXT,                 -- Cloudinary
  estado            univ_estado_solicitud NOT NULL DEFAULT 'Pendiente',
  fecha_propuesta_examen TIMESTAMP WITH TIME ZONE,
  revisado_por      UUID REFERENCES univ_usuarios_perfil(id) ON DELETE SET NULL,
  comentario_revision TEXT,
  revisado_at       TIMESTAMP WITH TIME ZONE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_univ_supletorios_estudiante ON univ_solicitudes_supletorios(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_univ_supletorios_seccion ON univ_solicitudes_supletorios(seccion_id);
CREATE INDEX IF NOT EXISTS idx_univ_supletorios_estado ON univ_solicitudes_supletorios(estado);

-- =====================================================================
-- 17. TRIGGER GENÉRICO updated_at
-- =====================================================================

CREATE OR REPLACE FUNCTION univ_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
  tablas_con_updated_at TEXT[] := ARRAY[
    'univ_sedes','univ_ent_facultades','univ_ent_departamentos','univ_programas',
    'univ_ent_periodos_academicos','univ_ent_parametros','univ_usuarios_perfil',
    'univ_ent_pensums','univ_asignaturas','univ_ent_secciones','univ_ent_matriculas',
    'univ_lms_modulos','univ_lms_recursos','univ_lms_actividades',
    'univ_lms_entregas','univ_ent_lms_cuestionarios','univ_lms_foro_temas',
    'univ_solicitudes_supletorios','univ_ent_lms_banco_preguntas'
  ];
BEGIN
  FOREACH t IN ARRAY tablas_con_updated_at LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at ON %I; CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION univ_set_updated_at();',
      t, t
    );
  END LOOP;
END $$;

-- =====================================================================
-- 18. VISTA DE ANALÍTICA: ESTUDIANTES EN RIESGO ACADÉMICO
-- =====================================================================
-- Un estudiante está "en riesgo" si su promedio calculado (a partir de
-- univ_ent_calificaciones_cortes) es menor a la nota mínima de aprobación
-- de la institución, o si lleva más días sin ingresar que el umbral
-- configurado en univ_ent_parametros.dias_inactividad_riesgo.

CREATE OR REPLACE VIEW univ_v_estudiantes_en_riesgo AS
SELECT
  m.id                  AS matricula_id,
  m.seccion_id,
  s.institucion_sk,
  up.id                 AS estudiante_id,
  up.nombres, up.apellidos, up.correo,
  ROUND(
    COALESCE(
      SUM(cc.nota * pe.corte_pct) FILTER (WHERE cc.nota IS NOT NULL) /
      NULLIF(SUM(pe.corte_pct) FILTER (WHERE cc.nota IS NOT NULL), 0)
    , 0)::numeric, 2
  ) AS promedio_actual,
  up.ultimo_ingreso_at,
  EXTRACT(DAY FROM (now() - up.ultimo_ingreso_at))::int AS dias_sin_ingresar,
  pr.nota_minima_aprobacion,
  pr.dias_inactividad_riesgo
FROM univ_ent_matriculas m
JOIN univ_ent_secciones s        ON s.id = m.seccion_id
JOIN univ_usuarios_perfil up ON up.id = m.estudiante_id
JOIN univ_ent_parametros pr      ON pr.institucion_sk = s.institucion_sk
LEFT JOIN univ_ent_calificaciones_cortes cc ON cc.matricula_id = m.id
LEFT JOIN LATERAL (
  SELECT CASE cc.corte
    WHEN 1 THEN pa.corte1_porcentaje
    WHEN 2 THEN pa.corte2_porcentaje
    WHEN 3 THEN pa.corte3_porcentaje
  END AS corte_pct
  FROM univ_ent_secciones ss
  JOIN univ_ent_periodos_academicos pa ON pa.id = ss.periodo_id
  WHERE ss.id = m.seccion_id
) pe ON TRUE
WHERE m.estado = 'Activa'
GROUP BY m.id, m.seccion_id, s.institucion_sk, up.id, up.nombres, up.apellidos,
         up.correo, up.ultimo_ingreso_at, pr.nota_minima_aprobacion, pr.dias_inactividad_riesgo
HAVING
  ROUND(COALESCE(SUM(cc.nota * pe.corte_pct) FILTER (WHERE cc.nota IS NOT NULL) /
        NULLIF(SUM(pe.corte_pct) FILTER (WHERE cc.nota IS NOT NULL), 0), 0)::numeric, 2) < pr.nota_minima_aprobacion
  OR (up.ultimo_ingreso_at IS NOT NULL AND EXTRACT(DAY FROM (now() - up.ultimo_ingreso_at)) > pr.dias_inactividad_riesgo)
  OR up.ultimo_ingreso_at IS NULL;

-- =====================================================================
-- FIN DEL SCRIPT — resumen de tablas creadas: 46 tablas + 1 vista.
-- Ejecute este archivo completo antes de iniciar el backend. El backend
-- (ver carpeta /server) asume que estas tablas ya existen y NO las crea
-- automáticamente (a diferencia del kv_store original), para mantener
-- el control de versiones del esquema separado del código de la app.
-- =====================================================================
