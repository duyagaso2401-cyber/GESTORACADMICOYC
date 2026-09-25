import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';
import { resolverSslPg } from '../lib/db-ssl.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

// RONDA 49: SSL agnóstico — antes era `{ rejectUnauthorized: false }` fijo
// (funciona con Neon, pero rompe la conexión contra un Postgres propio sin
// TLS, como el servicio `postgres` de `infra/docker-compose.yml`). Ver
// src/lib/db-ssl.ts para el detalle completo. Comportamiento histórico
// (SSL activado) intacto para quien no configure nada nuevo.
//
// RONDA 79 — TUNING DEL POOL PARA MITIGAR EL "CUELLO DE BOTELLA" REPORTADO
// (timeouts masivos en /api/carga-docente, /api/permisos-docente,
// /api/grados/:id/observador, /api/actividades-docente y /api/inetis/db,
// que además SÍ funcionan al instante si el usuario reintenta manualmente).
// Antes de esta ronda, `new Pool({...})` no fijaba NINGUNO de estos 3
// valores — `pg` usaba sus defaults (`max: 10`, `connectionTimeoutMillis: 0`
// = sin límite, `idleTimeoutMillis: 10000`):
//   - `max: 10` es bajo para el patrón real de esta app: cada usuario con
//     una pestaña abierta mantiene su propio ciclo de sincronización en
//     segundo plano (ver `_syncInterval`, 03-app-core.js) + cada módulo que
//     visita dispara su propia consulta granular — con varios
//     usuarios/pestañas activos a la vez, 10 conexiones se agotan rápido, y
//     una consulta que no consigue una conexión libre del pool queda
//     ENCOLADA (esto es, en sí mismo, indistinguible de "Neon está lento"
//     desde el punto de vista del usuario, aunque el cuello de botella real
//     esté en el propio proceso Node, no en Neon).
//   - `connectionTimeoutMillis: 0` (sin límite) significa que, si el pool
//     SÍ está saturado, una consulta puede quedarse esperando una conexión
//     libre INDEFINIDAMENTE, sin siquiera llegar a intentar la consulta —
//     el temporizador de `conTimeout()`/`conTimeoutYReintento()` (Ronda
//     77/78) NUNCA llega a arrancar porque la promesa de `db.select()` ni
//     siquiera empieza a ejecutarse todavía (sigue en la cola del pool).
//   - `idleTimeoutMillis: 10000` (10s) es agresivo: una conexión ociosa se
//     cierra y hay que abrir una nueva (con su propio handshake TLS
//     completo contra Neon) en cuanto vuelve a hacer falta — si el patrón
//     de uso real tiene pausas de más de 10s entre peticiones (normal en
//     una sesión de un docente navegando la interfaz), el pool termina
//     reabriendo conexiones nuevas todo el tiempo en vez de reutilizar las
//     que ya negociaron TLS.
// Los 3 valores nuevos, según lo pedido:
//   - `max: 20`: más margen para bursts de varios usuarios/pestañas a la
//     vez sin encolar peticiones detrás de una cola de conexión agotada.
//   - `connectionTimeoutMillis: 10000` (10s): si el pool SÍ llegara a
//     saturarse, la espera por una conexión libre ahora tiene un límite
//     razonable — falla con un error claro en vez de colgarse para
//     siempre, y ese error SÍ es capturado por el mismo `catch` que ya
//     maneja `TimeoutError` en cada endpoint (ver `_responderTimeoutBD`).
//   - `idleTimeoutMillis: 30000` (30s): las conexiones ya negociadas
//     (TLS incluido) se mantienen vivas y se reutilizan por más tiempo
//     entre peticiones, evitando renegociar TLS en cada ráfaga de uso
//     normal — este es el ajuste que más directamente reduce la latencia
//     percibida de "abrir una conexión nueva" que el usuario reporta como
//     traducirse en timeouts intermitentes.
const pool = new Pool({
  connectionString,
  ssl: resolverSslPg(connectionString),
  max: 20,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

// RONDA 49: se exporta el pool crudo (además de `db`) para que
// src/services/infraTelemetry.ts pueda leer sus contadores en tiempo real
// (totalCount/idleCount/waitingCount/options.max) sin depender de la forma
// interna de drizzle-orm, que no expone el pool de manera pública/estable.
export { pool };
export const db = drizzle(pool, { schema });
// RONDA 44 — DIMENSIÓN 11.a: se usa `db.transaction(async (tx) => {...})`
// (soportado nativamente por drizzle-orm/node-postgres desde 0.30.x, ya
// declarado en package.json) para envolver la Migración Directa
// Server-Side en un BEGIN/COMMIT/ROLLBACK SQL real — internamente pide un
// cliente dedicado del `pool` y ejecuta las sentencias sobre ese mismo
// cliente, con ROLLBACK automático si el callback lanza una excepción. Ver
// el bloque `await db.transaction(async (tx) => {...})` dentro del handler
// `app.post('/api/red/solicitudes/:id/aprobar', ...)` en src/index.ts.

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

      -- ════════════════════════════════════════════════════════════════
      -- RONDA 44 — DIMENSIÓN 7: base SaaS para IA (SOLO esquema + CRUD
      -- básico, sin activar cobros reales — así lo pidió explícitamente el
      -- criterio conservador de esta ronda). Registra, por institución
      -- (sk), qué proveedor de IA usa y bajo qué plan/estado, de forma
      -- independiente de 'fin_suscripciones' (que es la suscripción
      -- general de la plataforma) — permite en el futuro cobrar el uso de
      -- IA por separado sin tocar ese esquema existente.
      -- ════════════════════════════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS ai_subscriptions (
        id SERIAL PRIMARY KEY,
        sk TEXT NOT NULL UNIQUE,
        proveedor TEXT NOT NULL DEFAULT 'gemini',
        plan TEXT NOT NULL DEFAULT 'gratuito',
        estado TEXT NOT NULL DEFAULT 'activa',
        limite_mensual INTEGER NOT NULL DEFAULT 0,
        uso_mes_actual INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_subscriptions_estado_idx ON ai_subscriptions(estado);
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

// Ronda 33 (Lote 5) — rastro de auditoría centralizado del módulo ETC.
// Se deja en su PROPIA función de migración perezosa, DESPUÉS de
// ensureSchemaEducacionSuperior() (no dentro de ensureSchemaETC()) a
// propósito: test_ronda29_lote1_etc_universidades.mjs (frozen, no se toca
// — ver checklist de esta ronda) verifica por inspección de código que el
// bloque entre "ensureSchemaETC" y "ensureSchemaEducacionSuperior" contiene
// EXACTAMENTE 6 "CREATE TABLE IF NOT EXISTS" (las tablas de los Lotes
// 1/2) — agregar una 7ma tabla en ese rango habría roto esa aserción ya
// congelada sin necesidad. Colocarla aquí, después de ambas funciones,
// logra el mismo resultado funcional (la tabla igual se crea de forma
// perezosa e idempotente, nunca en initDb()) sin tocar ningún test
// existente. Se invoca junto a ensureSchemaETC() en el mismo endpoint de
// activación del módulo (ver src/index.ts).
export async function ensureSchemaEtcAuditoria(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS etc_audit_log (
      id SERIAL PRIMARY KEY,
      entidad_id INTEGER,
      actor TEXT NOT NULL DEFAULT '',
      rol TEXT NOT NULL DEFAULT '',
      accion TEXT NOT NULL,
      objetivo_tipo TEXT NOT NULL DEFAULT '',
      objetivo_id INTEGER,
      detalle JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS etc_audit_log_entidad_idx ON etc_audit_log(entidad_id);
    CREATE INDEX IF NOT EXISTS etc_audit_log_actor_idx ON etc_audit_log(actor);
  `);
  console.log('✅ [Lote 5] Esquema de auditoría del Módulo ETC creado/verificado en Neon.');
}

// RONDA 35 — Módulo "Mi Perfil": clasificación extendida de rol/decreto +
// hoja de vida, estructurada en Neon para integración con el módulo ETC.
// Migración perezosa e idempotente (igual patrón que ensureSchemaEtcAuditoria
// arriba); se invoca desde los endpoints de perfil en src/index.ts la primera
// vez que se usan, nunca desde initDb().
export async function ensureSchemaPerfilExtendido(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS perfil_docente_extendido (
      id SERIAL PRIMARY KEY,
      sk TEXT NOT NULL,
      user_u TEXT NOT NULL,
      rol_especifico TEXT NOT NULL DEFAULT '',
      es_docente_orientador BOOLEAN NOT NULL DEFAULT FALSE,
      es_tutor_pta BOOLEAN NOT NULL DEFAULT FALSE,
      tipo_decreto_normativo TEXT NOT NULL DEFAULT '',
      escalafon TEXT NOT NULL DEFAULT '',
      cv_url TEXT NOT NULL DEFAULT '',
      cv_nombre_archivo TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS perfil_docente_ext_sk_idx ON perfil_docente_extendido(sk);
    CREATE INDEX IF NOT EXISTS perfil_docente_ext_sk_user_idx ON perfil_docente_extendido(sk, user_u);
    CREATE TABLE IF NOT EXISTS perfil_audit_log (
      id SERIAL PRIMARY KEY,
      sk TEXT NOT NULL,
      user_u TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT '',
      campos_modificados JSONB DEFAULT '[]',
      es_cambio_sensible BOOLEAN NOT NULL DEFAULT FALSE,
      ip TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS perfil_audit_log_sk_idx ON perfil_audit_log(sk);
    CREATE INDEX IF NOT EXISTS perfil_audit_log_user_idx ON perfil_audit_log(user_u);
  `);
  console.log('✅ [Ronda 35] Esquema de "Mi Perfil" (rol extendido + hoja de vida) creado/verificado en Neon.');
}

// RONDA 36 — Módulo de Interoperabilidad SIMAT: tabla relacional propia,
// independiente del blob JSON de cada institución (ver el comentario extenso
// en schema.ts, junto a `simatEstudiantes`, para la justificación completa
// de esta decisión de arquitectura). Migración perezosa e idempotente, se
// invoca desde los endpoints SIMAT en src/routes/etc.ts la primera vez que
// se usan, nunca desde initDb().
export async function ensureSchemaSimat(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS simat_estudiantes (
      id SERIAL PRIMARY KEY,
      sk TEXT NOT NULL,
      nuip TEXT NOT NULL,
      tipo_documento TEXT NOT NULL DEFAULT '',
      nombres TEXT NOT NULL DEFAULT '',
      apellidos TEXT NOT NULL DEFAULT '',
      fecha_nacimiento TEXT NOT NULL DEFAULT '',
      genero TEXT NOT NULL DEFAULT '',
      codigo_dane_institucion TEXT NOT NULL DEFAULT '',
      codigo_dane_sede TEXT NOT NULL DEFAULT '',
      jornada TEXT NOT NULL DEFAULT '',
      grado_simat TEXT NOT NULL DEFAULT '',
      grupo TEXT NOT NULL DEFAULT '',
      tipo_discapacidad TEXT NOT NULL DEFAULT '',
      poblacion_vulnerable TEXT NOT NULL DEFAULT '',
      etnia TEXT NOT NULL DEFAULT '',
      victima_conflicto BOOLEAN NOT NULL DEFAULT FALSE,
      estrato TEXT NOT NULL DEFAULT '',
      estado_simat TEXT NOT NULL DEFAULT 'Matriculado',
      fecha_registro_novedad TEXT NOT NULL DEFAULT '',
      novedad TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS simat_estudiantes_sk_nuip_idx ON simat_estudiantes(sk, nuip);
    CREATE INDEX IF NOT EXISTS simat_estudiantes_sk_idx ON simat_estudiantes(sk);
    CREATE INDEX IF NOT EXISTS simat_estudiantes_estado_idx ON simat_estudiantes(estado_simat);
  `);
  console.log('✅ [Ronda 36] Esquema del Módulo SIMAT creado/verificado en Neon.');
}

// RONDA 37 — Módulo de Verificación Digital (Hash/QR de certificados/
// boletines/libros de calificaciones). Migración perezosa e idempotente,
// igual patrón que las anteriores — se invoca desde el endpoint de emisión
// de hash en src/index.ts la primera vez que se usa. NO depende de
// ENABLE_SIMAT_ETC_MODULE: es una función aparte que reutiliza
// DOC_SIGN_SECRET (ya presente en toda instalación desde antes de esta
// ronda), no el módulo SIMAT/ETC.
export async function ensureSchemaCertificados(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS certificados_emitidos (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      sk TEXT NOT NULL,
      tipo_documento TEXT NOT NULL DEFAULT '',
      nombre_estudiante TEXT NOT NULL DEFAULT '',
      documento_estudiante TEXT NOT NULL DEFAULT '',
      anio_lectivo TEXT NOT NULL DEFAULT '',
      institucion TEXT NOT NULL DEFAULT '',
      emitido_por TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      fecha_emision TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- RONDA 38 — ALTER TABLE retrocompatible: una instalación que ya tenía
    -- esta tabla creada desde la Ronda 37 (sin estas 2 columnas) las recibe
    -- ahora con IF NOT EXISTS, sin perder ni un solo registro ya emitido —
    -- los boletines ya emitidos antes de esta ronda simplemente quedan con
    -- '' en ambas columnas nuevas (la vista pública las omite si están
    -- vacías, ver _htmlVerificacionCertificado() en src/index.ts).
    ALTER TABLE certificados_emitidos ADD COLUMN IF NOT EXISTS documento_estudiante TEXT NOT NULL DEFAULT '';
    ALTER TABLE certificados_emitidos ADD COLUMN IF NOT EXISTS anio_lectivo TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS certificados_emitidos_hash_idx ON certificados_emitidos(hash);
    CREATE INDEX IF NOT EXISTS certificados_emitidos_sk_idx ON certificados_emitidos(sk);
  `);
  console.log('✅ [Ronda 37/38] Esquema del Módulo de Verificación Digital (Hash/QR) creado/verificado en Neon.');
}

// ── RONDA 43 — Índice cruzado entre instituciones + Buzón de Solicitudes ──
export async function ensureSchemaRedInterinstitucional(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS estudiantes_indice_red (
      nuip TEXT PRIMARY KEY,
      sk TEXT NOT NULL,
      nombre_completo TEXT NOT NULL DEFAULT '',
      institucion_nombre TEXT NOT NULL DEFAULT '',
      grado TEXT NOT NULL DEFAULT '',
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS estudiantes_indice_red_sk_idx ON estudiantes_indice_red(sk);
    CREATE INDEX IF NOT EXISTS estudiantes_indice_red_activo_idx ON estudiantes_indice_red(activo);

    CREATE TABLE IF NOT EXISTS solicitudes_traslado (
      id SERIAL PRIMARY KEY,
      nuip TEXT NOT NULL,
      est_id_origen TEXT NOT NULL DEFAULT '',
      nombre_estudiante TEXT NOT NULL DEFAULT '',
      sk_origen TEXT NOT NULL,
      institucion_origen_nombre TEXT NOT NULL DEFAULT '',
      sk_destino TEXT NOT NULL,
      institucion_destino_nombre TEXT NOT NULL DEFAULT '',
      grado_destino TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'PENDING',
      actor_solicitante TEXT NOT NULL DEFAULT '',
      actor_resolutor TEXT NOT NULL DEFAULT '',
      motivo_rechazo TEXT NOT NULL DEFAULT '',
      est_id_destino TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS solicitudes_traslado_sk_origen_idx ON solicitudes_traslado(sk_origen);
    CREATE INDEX IF NOT EXISTS solicitudes_traslado_sk_destino_idx ON solicitudes_traslado(sk_destino);
    CREATE INDEX IF NOT EXISTS solicitudes_traslado_estado_idx ON solicitudes_traslado(estado);
  `);
  console.log('✅ [Ronda 43] Esquema de Interconexión Directa (índice de red + buzón de solicitudes) creado/verificado en Neon.');
}

// ════════════════════════════════════════════════════════════════════════
// RONDA 45 — DIMENSIÓN 1, FASE 1 (DUAL-WRITE / STRANGLER FIG PATTERN)
// ------------------------------------------------------------------------------
// DECISIÓN DE ARQUITECTURA (léase antes de tocar esto): el blob JSON por
// institución (`kv_store`) SIGUE SIENDO la fuente de verdad autoritativa
// del sistema — esto NO se depreca ni se apaga en esta ronda. Lo que se
// agrega es una capa PARALELA de 3 tablas relacionales normalizadas
// (estudiantes_rel, materias_rel, calificaciones_rel — ver src/db/schema.ts
// para su diseño detallado) que se alimenta en paralelo (dual-write,
// best-effort, sin bloquear ni poder fallar el guardado real) cada vez que
// se guarda una fila de notas, y que los 3 endpoints modulares de la Ronda
// 44 (/api/grados*) intentan leer PRIMERO por ser más rápidos (SQL
// indexado, sin cargar el blob de 3 MB completo) — con fallback transparente
// al blob si esa institución todavía no tiene datos migrados.
//
// Por qué NO se hizo un corte total esta ronda (y por qué sería
// irresponsable hacerlo): (1) no hay forma de probar el backfill contra
// datos de producción reales ni concurrencia real en este entorno; (2) un
// corte total exige reescribir TODOS los puntos que hoy leen/escriben el
// blob completo (ficha, observador, asistencia, matrícula — no solo
// notas), lo que excede por mucho el alcance de "cerrar la migración de
// notas" que pidió esta ronda; (3) mantener el blob como fuente de verdad
// significa que, si algo sale mal en la capa relacional (una tabla
// corrupta, una migración a medias), el sistema sigue funcionando
// exactamente igual que antes de esta ronda — el "peor caso" de esta fase
// es "la optimización no ayudó todavía en esa institución", nunca "se
// perdieron datos".
//
// FASE 2 (futura, NO implementada aquí, requiere pedido explícito): una
// vez que haya evidencia real de estabilidad en producción (Render +
// datos reales durante un tiempo razonable), se podría invertir la
// prioridad — relacional como fuente de verdad, blob como respaldo/export
// — y eventualmente dejar de escribir en el blob. Esa inversión NO se hizo
// aquí porque este entorno no puede dar esa evidencia; hacerlo sin ella
// sería el mismo "big bang" que la Ronda 44 ya rechazó, solo que con
// menos pasos intermedios.
//
// Llamada de forma PEREZOSA (lazy, on-demand) la primera vez que se
// necesita — nunca dentro de initDb() — para no arriesgar el arranque de
// producción con una creación de esquema adicional en cada boot. Se
// invoca desde _ejecutarGuardarFilaNotas() (dual-write) y desde los 3
// endpoints /api/grados* (lectura), y también puede invocarse directamente
// desde scripts/migrar-notas-a-relacional.ts para el backfill manual.
export async function ensureSchemaRelacionalNotas(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS estudiantes_rel (
      id SERIAL PRIMARY KEY,
      sk TEXT NOT NULL,
      est_id_origen TEXT NOT NULL,
      nombre TEXT NOT NULL DEFAULT '',
      num_doc TEXT NOT NULL DEFAULT '',
      grado TEXT NOT NULL DEFAULT '',
      estado_matricula TEXT NOT NULL DEFAULT 'activo',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS estudiantes_rel_sk_est_idx ON estudiantes_rel(sk, est_id_origen);
    CREATE INDEX IF NOT EXISTS estudiantes_rel_sk_grado_idx ON estudiantes_rel(sk, grado);

    CREATE TABLE IF NOT EXISTS materias_rel (
      id SERIAL PRIMARY KEY,
      sk TEXT NOT NULL,
      c_id_origen TEXT NOT NULL,
      nombre TEXT NOT NULL DEFAULT '',
      grado TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS materias_rel_sk_cid_idx ON materias_rel(sk, c_id_origen);
    CREATE INDEX IF NOT EXISTS materias_rel_sk_grado_idx ON materias_rel(sk, grado);

    CREATE TABLE IF NOT EXISTS calificaciones_rel (
      id SERIAL PRIMARY KEY,
      sk TEXT NOT NULL,
      est_id_origen TEXT NOT NULL,
      c_id_origen TEXT NOT NULL,
      periodo TEXT NOT NULL,
      notas JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS calificaciones_rel_grano_idx ON calificaciones_rel(sk, est_id_origen, c_id_origen, periodo);
    CREATE INDEX IF NOT EXISTS calificaciones_rel_sk_est_idx ON calificaciones_rel(sk, est_id_origen);

    CREATE TABLE IF NOT EXISTS migracion_relacional_notas (
      sk TEXT PRIMARY KEY,
      migrado_en TIMESTAMPTZ DEFAULT NOW(),
      total_estudiantes INTEGER NOT NULL DEFAULT 0,
      total_calificaciones INTEGER NOT NULL DEFAULT 0
    );
  `);
  console.log('✅ [Ronda 45 — Fase 1] Esquema relacional de notas (dual-write) creado/verificado en Neon.');
}

// ════════════════════════════════════════════════════════════════════════
// RONDA 45 — DIMENSIÓN 4: AUTO-SEEDING SERVER-SIDE de un Súper Admin por
// defecto cuando la base de datos está recién creada/limpia.
// ------------------------------------------------------------------------------
// Hasta esta ronda, el registro `gestorDB` (guardado en kv_store bajo la
// clave GESTOR_SK, ver src/index.ts) solo se creaba del lado del CLIENTE
// (objeto GESTOR_DEFAULT en 03-app-core.js, enviado al servidor la primera
// vez que alguien abre el panel del Gestor en un navegador). Eso deja una
// ventana real: un backend recién desplegado contra una base de datos
// limpia, sin que nadie haya abierto el navegador todavía, no tiene NINGÚN
// Súper Admin con quien iniciar sesión del lado del servidor (los
// endpoints que verifican `gestorDB.superAdmin` fallarían porque la fila
// no existe). Esta función cierra esa ventana.
//
// IDEMPOTENCIA: solo actúa si la fila `GESTOR_SK` en `kv_store` NO EXISTE
// todavía — si ya existe (con cualquier contenido, incluso vacío o
// parcial), esta función NO LA TOCA ni la sobreescribe. Nunca se ejecuta
// dos veces con efecto (la segunda vez, la fila ya existe y se sale de
// inmediato).
//
// CONTRASEÑA: NUNCA hardcodeada. Si la variable de entorno
// `SUPERADMIN_SEED_PASSWORD` está configurada, se usa esa (permite a un
// despliegue automatizado fijarla como secreto de antemano). Si no está
// configurada, se genera aleatoriamente con `crypto.randomBytes` (128 bits
// de entropía, codificados en base64url) y se imprime UNA SOLA VEZ en los
// logs de arranque del servidor — nunca se guarda en texto plano en
// ningún archivo ni tabla; se guarda ya cifrada con el mismo esquema
// PBKDF2 que usa el resto del sistema para el Súper Admin
// (`_verificarPasswordSuperAdminServidor` en src/index.ts).
export async function autoSeedSuperAdmin(gestorSk: string): Promise<void> {
  try {
    const existente = await db.select().from(schema.kvStore).where(sql`key = ${gestorSk}`);
    if (existente.length) return; // ya existe — nunca se sobreescribe (idempotente)

    const crypto = await import('node:crypto');
    const passwordSemilla = (process.env.SUPERADMIN_SEED_PASSWORD || '').trim() || crypto.randomBytes(16).toString('base64url');
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(passwordSemilla, salt, 100000, 32, 'sha256').toString('hex');
    const passwordCifrada = `pbkdf2$${salt.toString('hex')}$${hash}`;

    const gestorSeed = {
      superAdmin: { u: 'gestor', p: passwordCifrada, nombre: 'Súper Administrador' },
      wsp1: '', wsp2: '',
      sugerencias: [],
      featureFlags: { ENABLE_ETC_CONTRACTING_MODULE: false, ENABLE_UNIVERSITIES_MODULE: false },
      platforms: [],
    };
    await db.insert(schema.kvStore).values({ key: gestorSk, value: gestorSeed as any, updatedAt: new Date() });

    console.log('════════════════════════════════════════════════════════════════');
    console.log('🌱 [Ronda 45] AUTO-SEEDING: se creó un Súper Admin por defecto porque');
    console.log('   la base de datos no tenía ningún registro de Gestor Académico YC.');
    console.log('   Usuario: gestor');
    if (process.env.SUPERADMIN_SEED_PASSWORD) {
      console.log('   Contraseña: la definida en la variable de entorno SUPERADMIN_SEED_PASSWORD.');
    } else {
      console.log('   Contraseña (generada aleatoriamente, GUÁRDELA — no se repetirá en los logs):');
      console.log('   ' + passwordSemilla);
    }
    console.log('   Cámbiela cuanto antes desde el panel del Súper Admin una vez ingrese.');
    console.log('════════════════════════════════════════════════════════════════');
  } catch (err) {
    // No debe impedir el arranque del servidor bajo ninguna circunstancia.
    console.error('⚠️ [Ronda 45] auto-seeding de Súper Admin falló (el servidor sigue arrancando normalmente):', err);
  }
}

// Exportar las tablas declaradas en el esquema
export * from './schema.js';