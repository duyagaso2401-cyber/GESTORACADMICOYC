-- ══════════════════════════════════════════════════════════════════════════
-- GESTOR ACADÉMICO YC — MÓDULO EDUCACIÓN SUPERIOR / LMS (Aula Virtual)
-- Migración Fase 1: esquema de base de datos
-- ══════════════════════════════════════════════════════════════════════════
-- Nota de diseño: a diferencia del resto del sistema (que guarda los datos
-- de cada institución como un bloque JSON en "kv_store"), este módulo usa
-- tablas relacionales propias porque el contenido (unidades, recursos,
-- actividades, entregas) es más pesado y tiene una jerarquía más profunda.
--
-- Las instituciones NO tienen una tabla propia aquí — ya se administran en
-- el panel del Súper Admin (dentro de su propio bloque JSON). Estas tablas
-- se relacionan con una institución mediante "sk" (el mismo identificador
-- de texto que ya usan las tablas "notifications" y "push_subscriptions").
--
-- Puede ejecutar este script directamente (es seguro correrlo varias veces:
-- todo usa "IF NOT EXISTS"), o simplemente reiniciar el servidor — ya
-- quedó integrado en la creación automática de tablas al arrancar.
-- ══════════════════════════════════════════════════════════════════════════

-- Plan de estudios / malla curricular
CREATE TABLE IF NOT EXISTS lms_planes_estudio (
  id SERIAL PRIMARY KEY,
  sk TEXT NOT NULL,
  nombre_carrera TEXT NOT NULL,
  total_creditos INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lms_planes_sk_idx ON lms_planes_estudio(sk);

-- Asignaturas universitarias (créditos, horas, prerrequisitos)
CREATE TABLE IF NOT EXISTS lms_asignaturas_universidad (
  id SERIAL PRIMARY KEY,
  sk TEXT NOT NULL,
  plan_estudio_id INTEGER REFERENCES lms_planes_estudio(id) ON DELETE SET NULL,
  codigo_materia TEXT NOT NULL,
  nombre TEXT NOT NULL,
  creditos INTEGER NOT NULL DEFAULT 0,
  horas_presenciales INTEGER NOT NULL DEFAULT 0,
  horas_independientes INTEGER NOT NULL DEFAULT 0,
  semestre INTEGER NOT NULL DEFAULT 1,
  prerrequisito_id INTEGER REFERENCES lms_asignaturas_universidad(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lms_asig_sk_idx ON lms_asignaturas_universidad(sk);
CREATE INDEX IF NOT EXISTS lms_asig_plan_idx ON lms_asignaturas_universidad(plan_estudio_id);

-- Aula virtual (una por grupo/asignatura, con su catedrático)
CREATE TABLE IF NOT EXISTS lms_aulas_virtuales (
  id SERIAL PRIMARY KEY,
  sk TEXT NOT NULL,
  grupo_asignatura_id TEXT NOT NULL,
  catedratico_u TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activa',
  link_clase_vivo TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lms_aulas_sk_idx ON lms_aulas_virtuales(sk);
CREATE INDEX IF NOT EXISTS lms_aulas_grupo_idx ON lms_aulas_virtuales(grupo_asignatura_id);

-- Unidades de aprendizaje dentro de un aula
CREATE TABLE IF NOT EXISTS lms_unidades (
  id SERIAL PRIMARY KEY,
  aula_id INTEGER NOT NULL REFERENCES lms_aulas_virtuales(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  orden INTEGER NOT NULL DEFAULT 0,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lms_unidades_aula_idx ON lms_unidades(aula_id);

-- Recursos (material de apoyo) dentro de una unidad
CREATE TABLE IF NOT EXISTS lms_recursos (
  id SERIAL PRIMARY KEY,
  unidad_id INTEGER NOT NULL REFERENCES lms_unidades(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'DOCUMENTO', -- DOCUMENTO | VIDEO_EMBED | ENLACE_EXTERNO | TEXTO_HTML
  url_cloudinary TEXT DEFAULT '',
  contenido_html TEXT DEFAULT '',
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lms_recursos_unidad_idx ON lms_recursos(unidad_id);

-- Actividades (tareas, foros, quizzes) dentro de una unidad
CREATE TABLE IF NOT EXISTS lms_actividades (
  id SERIAL PRIMARY KEY,
  unidad_id INTEGER NOT NULL REFERENCES lms_unidades(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  instruccion TEXT DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'TAREA', -- TAREA | FORO | QUIZ
  fecha_apertura TIMESTAMPTZ,
  fecha_cierre TIMESTAMPTZ,
  porcentaje_corte TEXT DEFAULT '', -- a qué corte/periodo académico alimenta
  max_calificacion TEXT NOT NULL DEFAULT '5.0',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lms_activ_unidad_idx ON lms_actividades(unidad_id);

-- Entregas de los estudiantes para cada actividad
CREATE TABLE IF NOT EXISTS lms_entregas (
  id SERIAL PRIMARY KEY,
  actividad_id INTEGER NOT NULL REFERENCES lms_actividades(id) ON DELETE CASCADE,
  estudiante_id TEXT NOT NULL,
  archivo_url_cloudinary TEXT DEFAULT '',
  texto_entrega TEXT DEFAULT '',
  fecha_envio TIMESTAMPTZ DEFAULT NOW(),
  nota TEXT DEFAULT '',
  retroalimentacion TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'ENVIADO' -- ENVIADO | CALIFICADO | ATRASADO
);
CREATE INDEX IF NOT EXISTS lms_entregas_actividad_idx ON lms_entregas(actividad_id);
CREATE INDEX IF NOT EXISTS lms_entregas_estudiante_idx ON lms_entregas(estudiante_id);
