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

      -- ════════════════════════════════════════════════════════════════
      -- "4 pilares de autonomía" — Pilar 2: MÓDULO FINANCIERO Y PASARELA
      -- DE PAGO (andamiaje). Ver el comentario detallado en src/db/schema.ts.
      -- ════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS fin_transacciones (
        id SERIAL PRIMARY KEY,
        sk TEXT,
        tipo TEXT NOT NULL,
        concepto TEXT NOT NULL DEFAULT '',
        estudiante_id TEXT,
        proveedor TEXT NOT NULL,
        proveedor_pago_id TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        monto_centavos INTEGER NOT NULL DEFAULT 0,
        moneda TEXT NOT NULL DEFAULT 'COP',
        metadata JSONB DEFAULT '{}',
        entregable_generado BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fin_transacciones_sk_idx ON fin_transacciones(sk);
      CREATE INDEX IF NOT EXISTS fin_transacciones_estado_idx ON fin_transacciones(estado);
      CREATE UNIQUE INDEX IF NOT EXISTS fin_transacciones_proveedor_pago_idx ON fin_transacciones(proveedor, proveedor_pago_id);

      -- Ronda 13: cierre del ciclo financiero (certificados verificables
      -- públicamente + revocación por reembolso/contracargo).
      ALTER TABLE fin_transacciones ADD COLUMN IF NOT EXISTS codigo_verificacion TEXT;
      ALTER TABLE fin_transacciones ADD COLUMN IF NOT EXISTS revocado BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE INDEX IF NOT EXISTS fin_transacciones_codigo_verificacion_idx ON fin_transacciones(codigo_verificacion);

      CREATE TABLE IF NOT EXISTS fin_suscripciones (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL DEFAULT 'basico',
        estado TEXT NOT NULL DEFAULT 'inactiva',
        proveedor TEXT,
        proveedor_suscripcion_id TEXT,
        vigente_hasta TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fin_suscripciones_estado_idx ON fin_suscripciones(estado);
      ALTER TABLE fin_suscripciones ADD COLUMN IF NOT EXISTS alerta_vencimiento_enviada BOOLEAN NOT NULL DEFAULT FALSE;

      -- ════════════════════════════════════════════════════════════════
      -- AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA — bitácora.
      -- Ver el comentario detallado en src/db/schema.ts (agentAuditLogs).
      -- Esta creación ocurre UNA SOLA VEZ al arrancar el servidor (igual
      -- que el resto de tablas de este bloque) — es el mecanismo normal
      -- de despliegue del proyecto, no algo que el propio agente ejecute
      -- en tiempo de ejecución. El agente en sí NUNCA emite ALTER TABLE ni
      -- CREATE TABLE — ver la regla de "Control de Esquema de BD" en
      -- src/services/ecosystemAgent.js.
      -- ════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS agent_audit_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        category TEXT NOT NULL,
        issue_detected TEXT NOT NULL,
        action_taken TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Informativo',
        details JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS agent_audit_logs_timestamp_idx ON agent_audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS agent_audit_logs_category_idx ON agent_audit_logs(category);
      CREATE INDEX IF NOT EXISTS agent_audit_logs_status_idx ON agent_audit_logs(status);
    `);
    console.log("✅ Tablas verificadas/creadas en Neon exitosamente.");
  } catch (err) {
    console.error("❌ Error inicializando tablas:", err);
  }
}

initDb();

// ════════════════════════════════════════════════════════════════════════════
// LOTE 1 — MIGRACIONES BAJO DEMANDA (Feature Flags): a diferencia de
// initDb() de arriba (que crea TODAS las tablas del resto del sistema en
// CADA arranque del servidor), estas dos funciones NO se llaman aquí ni en
// ningún otro punto de arranque — se ejecutan ÚNICAMENTE cuando el Súper
// Admin presiona por primera vez el botón de activación correspondiente
// (ver POST /api/superadmin/activar-modulo-etc / activar-modulo-
// universidades en src/index.ts, y src/lib/feature-flags.ts). Mientras el
// módulo permanezca desactivado, estas funciones nunca se invocan y, por
// lo tanto, nunca se ejecuta ni una sola sentencia SQL sobre Neon para él
// — tal como se pidió explícitamente ("no se ejecutará ninguna consulta o
// script SQL sobre Neon" mientras el flag esté en false).
//
// Ambas son 100% idempotentes (CREATE TABLE IF NOT EXISTS) — se pueden
// volver a llamar sin riesgo si el Súper Admin desactiva y reactiva el
// módulo más adelante; nunca se pierde ni se borra nada.
// ════════════════════════════════════════════════════════════════════════════
export async function ensureSchemaETC(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS etc_entidades (
      id SERIAL PRIMARY KEY,
      nombre_entidad TEXT NOT NULL,
      tipo_entidad TEXT NOT NULL DEFAULT 'Municipio_Certificado',
      nit TEXT NOT NULL DEFAULT '',
      direccion TEXT NOT NULL DEFAULT '',
      telefono TEXT NOT NULL DEFAULT '',
      email_contacto TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      firma_representante_url TEXT NOT NULL DEFAULT '',
      custom_form_schema JSONB DEFAULT '{}',
      sms_provider_config JSONB DEFAULT '{}',
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      creado_por TEXT DEFAULT '',
      actualizado_por TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- Arquitectura de notificaciones multicanal: instalaciones que ya
    -- activaron el Módulo ETC antes de este ajuste no tienen esta columna
    -- — se agrega de forma aditiva/idempotente, en '{}' (= sin SMS
    -- configurado = siempre correo) para todas las entidades existentes.
    ALTER TABLE etc_entidades ADD COLUMN IF NOT EXISTS sms_provider_config JSONB DEFAULT '{}';
    CREATE INDEX IF NOT EXISTS etc_entidades_activo_idx ON etc_entidades(activo);

    CREATE TABLE IF NOT EXISTS etc_instituciones (
      id SERIAL PRIMARY KEY,
      entidad_id INTEGER NOT NULL REFERENCES etc_entidades(id) ON DELETE CASCADE,
      codigo_dane TEXT NOT NULL,
      nombre_institucion TEXT NOT NULL,
      usa_plataforma_yc BOOLEAN NOT NULL DEFAULT FALSE,
      sk_plataforma_yc TEXT DEFAULT '',
      auto_report_entidad BOOLEAN NOT NULL DEFAULT FALSE,
      activa BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- Lote 3: instalaciones que ya activaron el Módulo ETC en el Lote 1
    -- tienen esta tabla creada SIN la columna nueva — ALTER...ADD COLUMN
    -- IF NOT EXISTS la agrega de forma aditiva/idempotente, sin tocar filas
    -- existentes (quedan en su valor por defecto, FALSE = manual).
    ALTER TABLE etc_instituciones ADD COLUMN IF NOT EXISTS auto_report_entidad BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS etc_instituciones_entidad_idx ON etc_instituciones(entidad_id);
    CREATE UNIQUE INDEX IF NOT EXISTS etc_instituciones_dane_idx ON etc_instituciones(entidad_id, codigo_dane);

    CREATE TABLE IF NOT EXISTS etc_contratos (
      id SERIAL PRIMARY KEY,
      entidad_id INTEGER NOT NULL REFERENCES etc_entidades(id) ON DELETE CASCADE,
      docente_cedula TEXT NOT NULL,
      nombre_completo TEXT NOT NULL,
      correo TEXT NOT NULL DEFAULT '',
      telefono TEXT NOT NULL DEFAULT '',
      municipio TEXT NOT NULL DEFAULT '',
      institucion_destino_dane TEXT NOT NULL DEFAULT '',
      usa_plataforma_yc BOOLEAN NOT NULL DEFAULT FALSE,
      estado_contrato TEXT NOT NULL DEFAULT 'Pendiente',
      token_acceso_unico TEXT DEFAULT '',
      creado_por TEXT DEFAULT '',
      actualizado_por TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS etc_contratos_entidad_idx ON etc_contratos(entidad_id);
    CREATE INDEX IF NOT EXISTS etc_contratos_cedula_idx ON etc_contratos(docente_cedula);
    CREATE INDEX IF NOT EXISTS etc_contratos_estado_idx ON etc_contratos(estado_contrato);
    CREATE UNIQUE INDEX IF NOT EXISTS etc_contratos_token_idx ON etc_contratos(token_acceso_unico);

    CREATE TABLE IF NOT EXISTS etc_documentos (
      id SERIAL PRIMARY KEY,
      contrato_id INTEGER NOT NULL REFERENCES etc_contratos(id) ON DELETE CASCADE,
      tipo_documento TEXT NOT NULL,
      url_documento_cloud TEXT NOT NULL DEFAULT '',
      estado_revision TEXT NOT NULL DEFAULT 'Pendiente',
      observaciones_admin TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS etc_documentos_contrato_idx ON etc_documentos(contrato_id);

    CREATE TABLE IF NOT EXISTS docente_permisos (
      id SERIAL PRIMARY KEY,
      docente_id TEXT NOT NULL,
      institucion_id INTEGER NOT NULL REFERENCES etc_instituciones(id) ON DELETE CASCADE,
      entidad_id INTEGER NOT NULL REFERENCES etc_entidades(id) ON DELETE CASCADE,
      tipo_permiso TEXT NOT NULL,
      fecha_inicio TEXT NOT NULL DEFAULT '',
      fecha_fin TEXT NOT NULL DEFAULT '',
      motivo TEXT DEFAULT '',
      datos_adicionales JSONB DEFAULT '{}',
      url_soporte_cloud TEXT DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'Pendiente',
      respuesta_rector TEXT DEFAULT '',
      reportado_entidad BOOLEAN NOT NULL DEFAULT FALSE,
      fecha_reporte_entidad TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS docente_permisos_institucion_idx ON docente_permisos(institucion_id);
    CREATE INDEX IF NOT EXISTS docente_permisos_entidad_idx ON docente_permisos(entidad_id);
    CREATE INDEX IF NOT EXISTS docente_permisos_docente_idx ON docente_permisos(docente_id);
    CREATE INDEX IF NOT EXISTS docente_permisos_estado_idx ON docente_permisos(estado);

    CREATE TABLE IF NOT EXISTS etc_otp_codigos (
      id SERIAL PRIMARY KEY,
      cedula TEXT NOT NULL,
      codigo TEXT NOT NULL,
      canal TEXT NOT NULL DEFAULT 'correo',
      destino TEXT NOT NULL DEFAULT '',
      contrato_id INTEGER REFERENCES etc_contratos(id) ON DELETE CASCADE,
      expira_en TIMESTAMPTZ NOT NULL,
      usado BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS etc_otp_cedula_idx ON etc_otp_codigos(cedula);
  `);
  console.log('✅ [Lote 1/2] Esquema del Módulo ETC creado/verificado en Neon.');
}

export async function ensureSchemaEducacionSuperior(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS universidad_entidades (
      id SERIAL PRIMARY KEY,
      nombre_universidad TEXT NOT NULL,
      codigo_snies TEXT NOT NULL DEFAULT '',
      nit TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS universidad_programas (
      id SERIAL PRIMARY KEY,
      universidad_id INTEGER NOT NULL REFERENCES universidad_entidades(id) ON DELETE CASCADE,
      nombre_programa TEXT NOT NULL,
      nivel TEXT NOT NULL DEFAULT 'Pregrado',
      facultad TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS universidad_programas_universidad_idx ON universidad_programas(universidad_id);

    CREATE TABLE IF NOT EXISTS universidad_docentes_estudiantes (
      id SERIAL PRIMARY KEY,
      persona_cedula TEXT NOT NULL,
      tipo_rol TEXT NOT NULL DEFAULT 'Estudiante',
      programa_id INTEGER NOT NULL REFERENCES universidad_programas(id) ON DELETE CASCADE,
      datos_adicionales JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS universidad_docestud_persona_idx ON universidad_docentes_estudiantes(persona_cedula);
    CREATE INDEX IF NOT EXISTS universidad_docestud_programa_idx ON universidad_docentes_estudiantes(programa_id);
  `);
  console.log('✅ [Lote 1] Esquema del Módulo Universidades/Educación Superior creado/verificado en Neon.');
}

// Exportar las tablas declaradas en el esquema
export * from './schema.js';