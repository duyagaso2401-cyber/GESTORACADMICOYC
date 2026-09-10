import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ 
  connectionString, 
  ssl: { rejectUnauthorized: false } 
});

export const db = drizzle(pool, { schema });

// --- CREACIÓN AUTOMÁTICA DE TABLAS ---
async function initDb() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value JSONB,
        updated_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        sk TEXT,
        kind TEXT,
        actor TEXT,
        message TEXT,
        meta JSONB,
        seen BOOLEAN,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sk TEXT;
      CREATE INDEX IF NOT EXISTS notifications_sk_idx ON notifications(sk);
      CREATE TABLE IF NOT EXISTS documents (
        clave TEXT PRIMARY KEY,
        est_id TEXT,
        data JSONB
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        user_u TEXT NOT NULL,
        rol TEXT DEFAULT '',
        est_id TEXT,
        endpoint TEXT NOT NULL UNIQUE,
        subscription JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS push_subs_sk_idx ON push_subscriptions(sk);
      CREATE TABLE IF NOT EXISTS repositorio_resources (
        id SERIAL PRIMARY KEY,
        institucion_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        author TEXT DEFAULT '',
        level TEXT DEFAULT 'General',
        skill TEXT DEFAULT '',
        metadata TEXT DEFAULT '',
        type TEXT DEFAULT '',
        description TEXT DEFAULT '',
        uploader TEXT DEFAULT '',
        link TEXT,
        file_data TEXT,
        file_name TEXT,
        rating_sum INTEGER NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        comments JSONB DEFAULT '[]',
        downloads_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS repositorio_users (
        id SERIAL PRIMARY KEY,
        institucion_id TEXT NOT NULL DEFAULT 'default',
        username TEXT NOT NULL,
        fullname TEXT NOT NULL,
        role TEXT NOT NULL,
        pass TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repositorio_stats (
        institucion_id TEXT PRIMARY KEY,
        views INTEGER NOT NULL DEFAULT 0,
        downloads INTEGER NOT NULL DEFAULT 0,
        logs JSONB DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS repositorio_config (
        institucion_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'REPOSITORIO INSTITUCIONAL',
        logo TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS repositorio_areas (
        id SERIAL PRIMARY KEY,
        institucion_id TEXT NOT NULL DEFAULT 'default',
        nombre TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repositorio_grados (
        id SERIAL PRIMARY KEY,
        institucion_id TEXT NOT NULL DEFAULT 'default',
        nombre TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repositorio_tipos (
        id SERIAL PRIMARY KEY,
        institucion_id TEXT NOT NULL DEFAULT 'default',
        nombre TEXT NOT NULL
      );

      -- ══════════════════════════════════════════════════════════════════
      -- MÓDULO EDUCACIÓN SUPERIOR / LMS (Aula Virtual) — Fase 1: esquema.
      -- Ver el comentario detallado en src/db/schema.ts sobre por qué usa
      -- "sk" (texto) en vez de una tabla "instituciones" separada, y por
      -- qué "grupo_asignatura_id"/"catedratico_u"/"estudiante_id" son
      -- texto en vez de llaves foráneas (esos datos viven en el bloque
      -- JSON de cada institución, no en tablas SQL).
      -- ══════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS lms_planes_estudio (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        nombre_carrera TEXT NOT NULL,
        total_creditos INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS lms_planes_sk_idx ON lms_planes_estudio(sk);

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

      CREATE TABLE IF NOT EXISTS lms_recursos (
        id SERIAL PRIMARY KEY,
        unidad_id INTEGER NOT NULL REFERENCES lms_unidades(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'DOCUMENTO',
        url_cloudinary TEXT DEFAULT '',
        contenido_html TEXT DEFAULT '',
        orden INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS lms_recursos_unidad_idx ON lms_recursos(unidad_id);

      CREATE TABLE IF NOT EXISTS lms_actividades (
        id SERIAL PRIMARY KEY,
        unidad_id INTEGER NOT NULL REFERENCES lms_unidades(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        instruccion TEXT DEFAULT '',
        tipo TEXT NOT NULL DEFAULT 'TAREA',
        fecha_apertura TIMESTAMPTZ,
        fecha_cierre TIMESTAMPTZ,
        porcentaje_corte TEXT DEFAULT '',
        max_calificacion TEXT NOT NULL DEFAULT '5.0',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS lms_activ_unidad_idx ON lms_actividades(unidad_id);

      CREATE TABLE IF NOT EXISTS lms_entregas (
        id SERIAL PRIMARY KEY,
        actividad_id INTEGER NOT NULL REFERENCES lms_actividades(id) ON DELETE CASCADE,
        estudiante_id TEXT NOT NULL,
        archivo_url_cloudinary TEXT DEFAULT '',
        texto_entrega TEXT DEFAULT '',
        fecha_envio TIMESTAMPTZ DEFAULT NOW(),
        nota TEXT DEFAULT '',
        retroalimentacion TEXT DEFAULT '',
        estado TEXT NOT NULL DEFAULT 'ENVIADO'
      );
      CREATE INDEX IF NOT EXISTS lms_entregas_actividad_idx ON lms_entregas(actividad_id);
      CREATE INDEX IF NOT EXISTS lms_entregas_estudiante_idx ON lms_entregas(estudiante_id);

      -- Columnas "metadata" nuevas en tablas ya existentes — se agregan con
      -- IF NOT EXISTS para no fallar en instituciones que ya tenían estas
      -- tablas creadas de antes.
      ALTER TABLE lms_asignaturas_universidad ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
      ALTER TABLE lms_actividades ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

      -- ════════════════════════════════════════════════════════════════
      -- AMPLIACIÓN: Secciones, Matrículas y Calificaciones por Corte
      -- (prefijo "univ_") — ver el comentario detallado en
      -- src/db/schema.ts sobre por qué se separaron de las tablas "lms_"
      -- existentes en vez de renombrarlas.
      -- ════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS univ_secciones (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        asignatura_id INTEGER NOT NULL REFERENCES lms_asignaturas_universidad(id) ON DELETE CASCADE,
        catedratico_u TEXT NOT NULL,
        grupo TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_secciones_sk_idx ON univ_secciones(sk);
      CREATE INDEX IF NOT EXISTS univ_secciones_asignatura_idx ON univ_secciones(asignatura_id);

      CREATE TABLE IF NOT EXISTS univ_matriculas (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        seccion_id INTEGER NOT NULL REFERENCES univ_secciones(id) ON DELETE CASCADE,
        estudiante_id TEXT NOT NULL,
        fecha_matricula TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(seccion_id, estudiante_id)
      );
      CREATE INDEX IF NOT EXISTS univ_matriculas_sk_idx ON univ_matriculas(sk);
      CREATE INDEX IF NOT EXISTS univ_matriculas_seccion_idx ON univ_matriculas(seccion_id);
      CREATE INDEX IF NOT EXISTS univ_matriculas_estudiante_idx ON univ_matriculas(estudiante_id);

      CREATE TABLE IF NOT EXISTS univ_calificaciones_cortes (
        id SERIAL PRIMARY KEY,
        matricula_id INTEGER NOT NULL REFERENCES univ_matriculas(id) ON DELETE CASCADE,
        corte TEXT NOT NULL,
        porcentaje TEXT NOT NULL DEFAULT '0',
        nota TEXT DEFAULT '',
        actualizado_en TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(matricula_id, corte)
      );
      CREATE INDEX IF NOT EXISTS univ_calif_matricula_idx ON univ_calificaciones_cortes(matricula_id);

      -- Pensums (mallas curriculares versionadas por programa)
      CREATE TABLE IF NOT EXISTS univ_pensums (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        plan_estudio_id INTEGER NOT NULL REFERENCES lms_planes_estudio(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        vigente_desde TEXT DEFAULT '',
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_pensums_sk_idx ON univ_pensums(sk);
      CREATE INDEX IF NOT EXISTS univ_pensums_plan_idx ON univ_pensums(plan_estudio_id);

      CREATE TABLE IF NOT EXISTS univ_pensum_asignaturas (
        id SERIAL PRIMARY KEY,
        pensum_id INTEGER NOT NULL REFERENCES univ_pensums(id) ON DELETE CASCADE,
        asignatura_id INTEGER NOT NULL REFERENCES lms_asignaturas_universidad(id) ON DELETE CASCADE,
        UNIQUE(pensum_id, asignatura_id)
      );
      CREATE INDEX IF NOT EXISTS univ_pensum_asig_pensum_idx ON univ_pensum_asignaturas(pensum_id);

      -- Perfiles ampliados (foto, teléfono, biografía, estado de perfil completado)
      CREATE TABLE IF NOT EXISTS univ_perfiles (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        usuario_id TEXT NOT NULL,
        rol TEXT NOT NULL,
        foto_url VARCHAR(500) DEFAULT '',
        telefono TEXT DEFAULT '',
        correo TEXT DEFAULT '',
        biografia TEXT DEFAULT '',
        perfil_completado BOOLEAN NOT NULL DEFAULT FALSE,
        actualizado_en TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(sk, usuario_id)
      );
      CREATE INDEX IF NOT EXISTS univ_perfiles_sk_idx ON univ_perfiles(sk);

      -- Configuración de cortes evaluativos por institución
      CREATE TABLE IF NOT EXISTS univ_config_cortes (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL UNIQUE,
        cortes JSONB DEFAULT '[{"nombre":"Corte 1","porcentaje":30},{"nombre":"Corte 2","porcentaje":30},{"nombre":"Corte 3","porcentaje":40}]',
        actualizado_en TIMESTAMPTZ DEFAULT NOW()
      );

      -- ════════════════════════════════════════════════════════════════
      -- FASE: ESTRUCTURA INSTITUCIONAL + CALENDARIO ACADÉMICO
      -- ════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS univ_facultades (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        nombre TEXT NOT NULL,
        decano TEXT DEFAULT '',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_facultades_sk_idx ON univ_facultades(sk);

      CREATE TABLE IF NOT EXISTS univ_departamentos (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        facultad_id INTEGER NOT NULL REFERENCES univ_facultades(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        jefe_departamento TEXT DEFAULT '',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_departamentos_sk_idx ON univ_departamentos(sk);
      CREATE INDEX IF NOT EXISTS univ_departamentos_facultad_idx ON univ_departamentos(facultad_id);

      -- Columnas nuevas sobre la tabla YA EXISTENTE de Programas —
      -- IF NOT EXISTS para no fallar en instituciones que ya la tenían.
      ALTER TABLE lms_planes_estudio ADD COLUMN IF NOT EXISTS departamento_id INTEGER REFERENCES univ_departamentos(id) ON DELETE SET NULL;
      ALTER TABLE lms_planes_estudio ADD COLUMN IF NOT EXISTS nivel TEXT DEFAULT 'PREGRADO';

      CREATE TABLE IF NOT EXISTS univ_periodos_academicos (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        nombre TEXT NOT NULL,
        fecha_inicio TIMESTAMPTZ,
        fecha_fin TIMESTAMPTZ,
        fecha_apertura_prematricula TIMESTAMPTZ,
        fecha_cierre_prematricula TIMESTAMPTZ,
        fecha_apertura_adiciones TIMESTAMPTZ,
        fecha_cierre_adiciones TIMESTAMPTZ,
        fecha_inicio_clases TIMESTAMPTZ,
        fecha_cierre_clases TIMESTAMPTZ,
        cortes JSONB DEFAULT '[]',
        activo BOOLEAN NOT NULL DEFAULT FALSE,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_periodos_sk_idx ON univ_periodos_academicos(sk);

      CREATE TABLE IF NOT EXISTS univ_parametros (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL UNIQUE,
        escala_tipo TEXT NOT NULL DEFAULT 'NUMERICA',
        nota_maxima TEXT NOT NULL DEFAULT '5.0',
        nota_minima_aprobacion TEXT NOT NULL DEFAULT '3.0',
        escala_personalizada JSONB DEFAULT '[{"nombre":"Bajo","min":0.0,"max":2.9},{"nombre":"Básico","min":3.0,"max":3.9},{"nombre":"Alto","min":4.0,"max":4.6},{"nombre":"Superior","min":4.7,"max":5.0}]',
        tope_fallas_porcentaje TEXT NOT NULL DEFAULT '20',
        metadata JSONB DEFAULT '{}',
        actualizado_en TIMESTAMPTZ DEFAULT NOW()
      );
      -- Columnas nuevas sobre la tabla si ya existía de una entrega anterior
      ALTER TABLE univ_parametros ADD COLUMN IF NOT EXISTS nota_maxima TEXT NOT NULL DEFAULT '5.0';
      ALTER TABLE univ_parametros ADD COLUMN IF NOT EXISTS escala_personalizada JSONB DEFAULT '[{"nombre":"Bajo","min":0.0,"max":2.9},{"nombre":"Básico","min":3.0,"max":3.9},{"nombre":"Alto","min":4.0,"max":4.6},{"nombre":"Superior","min":4.7,"max":5.0}]';

      -- ════════════════════════════════════════════════════════════════
      -- FASE 2: PENSUM AVANZADO — Correquisitos + Carácter de asignatura
      -- ════════════════════════════════════════════════════════════════
      ALTER TABLE lms_asignaturas_universidad ADD COLUMN IF NOT EXISTS caracter TEXT NOT NULL DEFAULT 'OBLIGATORIA';

      CREATE TABLE IF NOT EXISTS univ_correquisitos (
        id SERIAL PRIMARY KEY,
        asignatura_id INTEGER NOT NULL REFERENCES lms_asignaturas_universidad(id) ON DELETE CASCADE,
        correquisito_id INTEGER NOT NULL REFERENCES lms_asignaturas_universidad(id) ON DELETE CASCADE,
        UNIQUE(asignatura_id, correquisito_id)
      );
      CREATE INDEX IF NOT EXISTS univ_correq_asignatura_idx ON univ_correquisitos(asignatura_id);

      -- ════════════════════════════════════════════════════════════════
      -- FASE 3: MOTOR DE CUESTIONARIOS/QUIZ
      -- ════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS univ_lms_banco_preguntas (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        categoria TEXT NOT NULL,
        docente_u TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_banco_sk_idx ON univ_lms_banco_preguntas(sk);
      CREATE INDEX IF NOT EXISTS univ_banco_docente_idx ON univ_lms_banco_preguntas(docente_u);

      CREATE TABLE IF NOT EXISTS univ_lms_preguntas (
        id SERIAL PRIMARY KEY,
        banco_id INTEGER NOT NULL REFERENCES univ_lms_banco_preguntas(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        enunciado TEXT NOT NULL,
        opciones JSONB DEFAULT '[]',
        respuesta_corta JSONB DEFAULT '[]',
        puntaje TEXT NOT NULL DEFAULT '1.0',
        retroalimentacion TEXT DEFAULT '',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_preguntas_banco_idx ON univ_lms_preguntas(banco_id);

      CREATE TABLE IF NOT EXISTS univ_lms_cuestionarios (
        id SERIAL PRIMARY KEY,
        actividad_id INTEGER NOT NULL UNIQUE REFERENCES lms_actividades(id) ON DELETE CASCADE,
        tiempo_limite_minutos INTEGER,
        intentos_permitidos INTEGER NOT NULL DEFAULT 1,
        metodo_calificacion TEXT NOT NULL DEFAULT 'NOTA_MAS_ALTA',
        barajar_preguntas BOOLEAN NOT NULL DEFAULT FALSE,
        barajar_respuestas BOOLEAN NOT NULL DEFAULT FALSE,
        retroalimentacion TEXT NOT NULL DEFAULT 'AL_FINALIZAR',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS univ_lms_cuestionario_preguntas (
        id SERIAL PRIMARY KEY,
        cuestionario_id INTEGER NOT NULL REFERENCES univ_lms_cuestionarios(id) ON DELETE CASCADE,
        pregunta_id INTEGER NOT NULL REFERENCES univ_lms_preguntas(id) ON DELETE CASCADE,
        orden INTEGER NOT NULL DEFAULT 0,
        puntaje_override TEXT,
        UNIQUE(cuestionario_id, pregunta_id)
      );
      CREATE INDEX IF NOT EXISTS univ_cq_preguntas_cuestionario_idx ON univ_lms_cuestionario_preguntas(cuestionario_id);

      CREATE TABLE IF NOT EXISTS univ_lms_intentos (
        id SERIAL PRIMARY KEY,
        cuestionario_id INTEGER NOT NULL REFERENCES univ_lms_cuestionarios(id) ON DELETE CASCADE,
        estudiante_id TEXT NOT NULL,
        numero_intento INTEGER NOT NULL DEFAULT 1,
        fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
        fecha_fin TIMESTAMPTZ,
        respuestas JSONB DEFAULT '{}',
        nota_obtenida TEXT,
        nota_maxima TEXT NOT NULL DEFAULT '0',
        tiene_pendientes_manual BOOLEAN NOT NULL DEFAULT FALSE,
        estado TEXT NOT NULL DEFAULT 'EN_CURSO'
      );
      CREATE INDEX IF NOT EXISTS univ_intentos_cuestionario_idx ON univ_lms_intentos(cuestionario_id);
      CREATE INDEX IF NOT EXISTS univ_intentos_estudiante_idx ON univ_lms_intentos(estudiante_id);

      -- ════════════════════════════════════════════════════════════════
      -- FASE 4: LIBRO DE CALIFICACIONES (GRADEBOOK) — categorías ponderadas
      -- ════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS univ_gradebook_categorias (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL,
        seccion_id INTEGER NOT NULL REFERENCES univ_secciones(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        porcentaje TEXT NOT NULL DEFAULT '0',
        orden INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS univ_gb_cat_sk_idx ON univ_gradebook_categorias(sk);
      CREATE INDEX IF NOT EXISTS univ_gb_cat_seccion_idx ON univ_gradebook_categorias(seccion_id);

      ALTER TABLE lms_actividades ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES univ_gradebook_categorias(id) ON DELETE SET NULL;
    `);
    console.log("✅ Tablas verificadas/creadas en Neon exitosamente.");
  } catch (err) {
    console.error("❌ Error inicializando tablas:", err);
  }
}

initDb();

// Exportar las tablas declaradas en el esquema
export * from './schema.js';