// ============================================================
// MIGRACIÓN DE BASE DE DATOS — de la actual a una Neon nueva y limpia
// ============================================================
// UBICACIÓN: este archivo debe vivir en "scripts/migrate-db.ts", en
// la RAÍZ del proyecto (al mismo nivel que "src", "package.json",
// "node_modules") — NO dentro de "src/scripts/". Si se ejecuta desde
// el lugar equivocado, los import de abajo ("../src/lib/...") van a
// fallar con un error de "Cannot find module" al arrancar.
// Qué hace:
//   1. Se conecta a DOS bases de datos: la ACTUAL (DATABASE_URL, de
//      donde se lee) y la NUEVA (NEW_DATABASE_URL, a donde se escribe).
//   2. Crea en la base NUEVA las mismas 11 tablas que ya existen en la
//      actual (usuarios, instituciones, estudiantes y notas viven
//      dentro de kv_store — un JSON por institución/año — así que se
//      copian automáticamente al copiar esa tabla; no son tablas
//      aparte).
//   3. Antes de escribir cada registro en la base nueva, recorre TODO
//      su contenido buscando textos Base64 (data:image/...;base64,...
//      o data:application/pdf;base64,...) — fotos de estudiantes,
//      logos, escudos, firmas, PDFs de actas, planes de área,
//      planeaciones, material para estudiantes, archivos de
//      pre-matrícula, etc. — los sube a Cloudinary, y en la base
//      nueva guarda ÚNICAMENTE la URL pública (secure_url). Así la
//      base de datos nueva nace limpia, sin ese peso, y no vuelve a
//      dispararse el consumo de "Network Transfer" de Neon.
//   4. Es seguro ejecutarlo más de una vez: usa "upsert" (inserta o
//      actualiza si ya existe) en vez de duplicar filas, así que si
//      se corta a la mitad se puede volver a correr sin problema.
//
// CÓMO USARLO:
//   1. En Neon, cree un proyecto/base de datos NUEVO y vacío.
//   2. En su archivo .env, dejando DATABASE_URL apuntando TODAVÍA a
//      la base ACTUAL (la de siempre), agregue una línea nueva:
//        NEW_DATABASE_URL=postgresql://.....(la de la base nueva)
//      Y confirme que también estén CLOUDINARY_CLOUD_NAME,
//      CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.
//   3. Ejecute:  npm run migrate-db
//   4. Revise el resumen al final (cuántos registros, cuántos
//      archivos se subieron, si hubo algún error).
//   5. SOLO cuando esté conforme con el resultado, cambie DATABASE_URL
//      en su .env para que apunte a la base NUEVA, y reinicie el
//      servidor. La base ACTUAL no se modifica ni se borra en ningún
//      momento — este script solo LEE de ahí.
// ============================================================
import 'dotenv/config';
import pg from 'pg';
import { subirBase64ACloudinary, esDataUriBase64 } from '../src/lib/upload.js';
import { cloudinaryConfigurado } from '../src/lib/cloudinary.js';

const { Pool } = pg;

const SOURCE_URL = process.env.DATABASE_URL || '';
const TARGET_URL = process.env.NEW_DATABASE_URL || '';

function fallarConMensaje(msg: string): never {
  console.error('\n❌ ' + msg + '\n');
  process.exit(1);
}

if (!SOURCE_URL) {
  fallarConMensaje('Falta DATABASE_URL en el .env (debe apuntar a la base de datos ACTUAL, de donde se copian los datos).');
}
if (!TARGET_URL) {
  fallarConMensaje(
    'Falta NEW_DATABASE_URL en el .env (debe apuntar a la base de datos NUEVA y limpia, a donde se copian los datos).\n' +
    '   Cree primero un proyecto/base de datos nuevo en Neon y agregue su cadena de conexión como NEW_DATABASE_URL en el .env.'
  );
}
if (SOURCE_URL === TARGET_URL) {
  fallarConMensaje('DATABASE_URL y NEW_DATABASE_URL son exactamente iguales — deben ser DOS bases de datos distintas (origen y destino).');
}
if (!cloudinaryConfigurado) {
  console.warn(
    '⚠️  ADVERTENCIA: Cloudinary no está configurado (faltan CLOUDINARY_CLOUD_NAME, ' +
    'CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET). El script va a copiar los datos ' +
    'igualmente, pero NO podrá subir las imágenes/PDFs en Base64 que encuentre — ' +
    'esos van a quedar copiados tal cual en la base nueva, sin limpiar. Se recomienda ' +
    'configurar Cloudinary antes de continuar.'
  );
}

const source = new Pool({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false } });
const target = new Pool({ connectionString: TARGET_URL, ssl: { rejectUnauthorized: false } });

interface Estadisticas {
  archivosSubidos: number;
  archivosFallidos: number;
  bytesBase64Encontrados: number;
  errores: string[];
}

const stats: Estadisticas = { archivosSubidos: 0, archivosFallidos: 0, bytesBase64Encontrados: 0, errores: [] };

// ── Crea en la base NUEVA las mismas tablas que ya existen en la actual ──
async function crearTablasEnDestino() {
  await target.query(`
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
  `);
  console.log('✅ Tablas verificadas/creadas en la base de datos NUEVA.');
}

// ── Recorre profundamente cualquier valor (objeto, arreglo, texto) buscando
//    Base64 y subiéndolo a Cloudinary. Esto es lo que limpia, dentro del
//    JSON de cada institución, las fotos de estudiantes, logos, escudos,
//    firmas, PDFs de actas/planes/planeaciones/material, y archivos de
//    pre-matrícula — sin importar en qué parte del JSON estén anidados. ──
async function limpiarBase64Profundo(valor: unknown, ruta: string): Promise<unknown> {
  if (typeof valor === 'string') {
    if (esDataUriBase64(valor)) {
      stats.bytesBase64Encontrados += valor.length;
      try {
        const resultado = await subirBase64ACloudinary(valor, { folder: 'gestor-yc/migracion' });
        stats.archivosSubidos++;
        return resultado.url;
      } catch (e) {
        stats.archivosFallidos++;
        stats.errores.push(ruta + ': ' + (e instanceof Error ? e.message : String(e)));
        return valor; // si falla la subida, se conserva el dato original — nunca se pierde información
      }
    }
    return valor;
  }
  if (Array.isArray(valor)) {
    const resultado: unknown[] = [];
    for (let i = 0; i < valor.length; i++) {
      resultado.push(await limpiarBase64Profundo(valor[i], ruta + '[' + i + ']'));
    }
    return resultado;
  }
  if (valor && typeof valor === 'object') {
    const resultado: Record<string, unknown> = {};
    for (const clave of Object.keys(valor as Record<string, unknown>)) {
      resultado[clave] = await limpiarBase64Profundo((valor as Record<string, unknown>)[clave], ruta + '.' + clave);
    }
    return resultado;
  }
  return valor;
}

// ── kv_store: la tabla más importante — un JSON por institución/año, con
//    usuarios, grados, carga académica, estudiantes y sus notas de los 4
//    periodos, todo anidado adentro. ──
async function migrarKvStore() {
  const { rows } = await source.query('SELECT key, value, updated_at FROM kv_store');
  console.log(`\n📦 kv_store: ${rows.length} registro(s) (instituciones y años archivados).`);
  for (const row of rows) {
    process.stdout.write(`   → ${row.key} ... `);
    const valorLimpio = cloudinaryConfigurado
      ? await limpiarBase64Profundo(row.value, row.key)
      : row.value;
    await target.query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [row.key, valorLimpio, row.updated_at]
    );
    console.log('✅');
  }
}

async function migrarNotifications() {
  const { rows } = await source.query('SELECT id, sk, kind, actor, message, meta, seen, created_at FROM notifications');
  console.log(`\n📦 notifications: ${rows.length} registro(s).`);
  for (const row of rows) {
    await target.query(
      `INSERT INTO notifications (id, sk, kind, actor, message, meta, seen, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET sk=EXCLUDED.sk, kind=EXCLUDED.kind, actor=EXCLUDED.actor, message=EXCLUDED.message, meta=EXCLUDED.meta, seen=EXCLUDED.seen, created_at=EXCLUDED.created_at`,
      [row.id, row.sk, row.kind, row.actor, row.message, row.meta, row.seen, row.created_at]
    );
  }
  // Re-sincronizar la secuencia del ID (evita colisiones futuras con nuevas notificaciones)
  await target.query(`SELECT setval(pg_get_serial_sequence('notifications','id'), COALESCE((SELECT MAX(id) FROM notifications), 1))`);
  console.log('   ✅ Copiado.');
}

async function migrarDocuments() {
  const { rows } = await source.query('SELECT clave, est_id, data FROM documents');
  console.log(`\n📦 documents: ${rows.length} registro(s).`);
  for (const row of rows) {
    const dataLimpia = cloudinaryConfigurado ? await limpiarBase64Profundo(row.data, 'documents.' + row.clave) : row.data;
    await target.query(
      `INSERT INTO documents (clave, est_id, data) VALUES ($1,$2,$3)
       ON CONFLICT (clave) DO UPDATE SET est_id=EXCLUDED.est_id, data=EXCLUDED.data`,
      [row.clave, row.est_id, dataLimpia]
    );
  }
  console.log('   ✅ Copiado.');
}

async function migrarPushSubscriptions() {
  const { rows } = await source.query('SELECT id, sk, user_u, rol, est_id, endpoint, subscription, created_at FROM push_subscriptions');
  console.log(`\n📦 push_subscriptions: ${rows.length} registro(s).`);
  for (const row of rows) {
    await target.query(
      `INSERT INTO push_subscriptions (id, sk, user_u, rol, est_id, endpoint, subscription, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (endpoint) DO UPDATE SET sk=EXCLUDED.sk, user_u=EXCLUDED.user_u, rol=EXCLUDED.rol, est_id=EXCLUDED.est_id, subscription=EXCLUDED.subscription`,
      [row.id, row.sk, row.user_u, row.rol, row.est_id, row.endpoint, row.subscription, row.created_at]
    );
  }
  await target.query(`SELECT setval(pg_get_serial_sequence('push_subscriptions','id'), COALESCE((SELECT MAX(id) FROM push_subscriptions), 1))`);
  console.log('   ✅ Copiado.');
}

async function migrarRepositorioResources() {
  const { rows } = await source.query('SELECT * FROM repositorio_resources');
  console.log(`\n📦 repositorio_resources: ${rows.length} registro(s).`);
  for (const row of rows) {
    // file_data es un campo de texto plano (no JSON) — si contiene un Base64
    // completo, se sube igual que cualquier otro archivo encontrado.
    let fileData = row.file_data;
    if (cloudinaryConfigurado && esDataUriBase64(fileData)) {
      try {
        const resultado = await subirBase64ACloudinary(fileData, { folder: 'gestor-yc/migracion/repositorio' });
        fileData = resultado.url;
        stats.archivosSubidos++;
      } catch (e) {
        stats.archivosFallidos++;
        stats.errores.push('repositorio_resources.' + row.id + ': ' + (e instanceof Error ? e.message : String(e)));
      }
    }
    await target.query(
      `INSERT INTO repositorio_resources (id, institucion_id, title, author, level, skill, metadata, type, description, uploader, link, file_data, file_name, rating_sum, rating_count, comments, downloads_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, author=EXCLUDED.author, level=EXCLUDED.level, skill=EXCLUDED.skill,
         metadata=EXCLUDED.metadata, type=EXCLUDED.type, description=EXCLUDED.description, uploader=EXCLUDED.uploader,
         link=EXCLUDED.link, file_data=EXCLUDED.file_data, file_name=EXCLUDED.file_name, rating_sum=EXCLUDED.rating_sum,
         rating_count=EXCLUDED.rating_count, comments=EXCLUDED.comments, downloads_count=EXCLUDED.downloads_count`,
      [row.id, row.institucion_id, row.title, row.author, row.level, row.skill, row.metadata, row.type, row.description,
       row.uploader, row.link, fileData, row.file_name, row.rating_sum, row.rating_count, row.comments, row.downloads_count, row.created_at]
    );
  }
  await target.query(`SELECT setval(pg_get_serial_sequence('repositorio_resources','id'), COALESCE((SELECT MAX(id) FROM repositorio_resources), 1))`);
  console.log('   ✅ Copiado.');
}

// ── Tablas simples de catálogo del Repositorio (usuarios, estadísticas,
//    configuración, áreas, grados, tipos) — se copian tal cual, no suelen
//    tener archivos Base64. ──
async function migrarTablaCatalogo(tabla: string, columnas: string[], conflictoPor: string, resincronizarId: boolean) {
  const { rows } = await source.query(`SELECT ${columnas.join(', ')} FROM ${tabla}`);
  console.log(`\n📦 ${tabla}: ${rows.length} registro(s).`);
  for (const row of rows) {
    const placeholders = columnas.map((_, i) => '$' + (i + 1)).join(', ');
    const actualizarSet = columnas.filter(c => c !== conflictoPor).map(c => `${c}=EXCLUDED.${c}`).join(', ');
    await target.query(
      `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (${conflictoPor}) DO UPDATE SET ${actualizarSet || columnas[0] + '=EXCLUDED.' + columnas[0]}`,
      columnas.map(c => row[c])
    );
  }
  if (resincronizarId) {
    await target.query(`SELECT setval(pg_get_serial_sequence('${tabla}','id'), COALESCE((SELECT MAX(id) FROM ${tabla}), 1))`);
  }
  console.log('   ✅ Copiado.');
}

async function main() {
  console.log('============================================================');
  console.log('  MIGRACIÓN DE BASE DE DATOS — Gestor Académico YC');
  console.log('============================================================');
  console.log('Origen (DATABASE_URL):      ' + SOURCE_URL.replace(/:[^:@]+@/, ':****@'));
  console.log('Destino (NEW_DATABASE_URL): ' + TARGET_URL.replace(/:[^:@]+@/, ':****@'));
  console.log('Cloudinary configurado:     ' + (cloudinaryConfigurado ? 'sí ✅' : 'NO ⚠️'));
  console.log('------------------------------------------------------------');

  await crearTablasEnDestino();
  await migrarKvStore();
  await migrarNotifications();
  await migrarDocuments();
  await migrarPushSubscriptions();
  await migrarRepositorioResources();
  await migrarTablaCatalogo('repositorio_users', ['id', 'institucion_id', 'username', 'fullname', 'role', 'pass'], 'id', true);
  await migrarTablaCatalogo('repositorio_stats', ['institucion_id', 'views', 'downloads', 'logs'], 'institucion_id', false);
  await migrarTablaCatalogo('repositorio_config', ['institucion_id', 'name', 'logo'], 'institucion_id', false);
  await migrarTablaCatalogo('repositorio_areas', ['id', 'institucion_id', 'nombre'], 'id', true);
  await migrarTablaCatalogo('repositorio_grados', ['id', 'institucion_id', 'nombre'], 'id', true);
  await migrarTablaCatalogo('repositorio_tipos', ['id', 'institucion_id', 'nombre'], 'id', true);

  console.log('\n============================================================');
  console.log('  RESUMEN');
  console.log('============================================================');
  console.log(`Archivos Base64 subidos a Cloudinary: ${stats.archivosSubidos}`);
  console.log(`Archivos que fallaron al subir:       ${stats.archivosFallidos}`);
  console.log(`Peso aproximado de Base64 encontrado: ${(stats.bytesBase64Encontrados / (1024 * 1024)).toFixed(2)} MB`);
  if (stats.errores.length) {
    console.log('\n⚠️  Errores al subir (esos archivos quedaron en Base64 en la base nueva, revíselos manualmente):');
    stats.errores.forEach(e => console.log('   - ' + e));
  }
  console.log('\n✅ Migración completa.');
  console.log('   Revise que todo esté correcto en la base de datos NUEVA antes de');
  console.log('   cambiar DATABASE_URL en su .env para que apunte a ella.');
  console.log('   La base de datos ACTUAL no fue modificada — solo se leyó de ahí.\n');

  await source.end();
  await target.end();
}

main().catch(e => {
  console.error('\n❌ Error durante la migración:', e);
  process.exit(1);
});
