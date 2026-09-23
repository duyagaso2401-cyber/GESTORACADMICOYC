// =====================================================================
// server/lib/db.js
// Conexión PostgreSQL — agnóstica de proveedor (Supabase / Neon / Render /
// Railway). Usa la MISMA convención de SSL que ya usa el proyecto
// (rejectUnauthorized:false) para no romper compatibilidad con Neon.
//
// Exporta:
//   - pool            → pg.Pool crudo (por si se necesita en otro módulo)
//   - query(text,params)      → ejecuta una consulta suelta
//   - withTransaction(fn)     → ejecuta fn(client) dentro de BEGIN/COMMIT,
//                               con ROLLBACK automático si algo falla.
//                               Úsalo SIEMPRE para el batching de notas.
// =====================================================================
import 'dotenv/config';
import pg from 'pg';
import { resolverSslPg } from '../../lib/db-ssl.js';

const { Pool } = pg;

const connectionString = process.env.UNIV_LMS_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('[univ-lms] DATABASE_URL (o UNIV_LMS_DATABASE_URL) es obligatoria (reutiliza la misma que ya usa Gestor Académico YC).');
}

// Pool separado y pequeño: este módulo puede vivir junto al pool de
// Drizzle que ya existe en src/db/index.ts sin pisarlo. Si prefieres
// reutilizar exactamente el mismo pool, exporta el `pool` desde
// src/db/index.ts y sustituye este archivo por un simple re-export.
// RONDA 49: SSL agnóstico (ver src/lib/db-ssl.ts) — antes era fijo, ahora
// respeta `?sslmode=disable` en la cadena o `DATABASE_SSL=false`, igual
// que el pool principal de src/db/index.ts.
export const pool = new Pool({
  connectionString,
  ssl: resolverSslPg(connectionString),
  max: Number(process.env.UNIV_DB_POOL_MAX || 8),
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Una conexión inactiva que se cae no debe tumbar el proceso.
  console.error('[univ-lms] Error inesperado en el pool de PostgreSQL:', err.message);
});

/** Ejecuta una consulta parametrizada. Nunca uses interpolación de strings
 * para construir SQL — todo va por $1, $2... para evitar inyección. */
export async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.UNIV_DB_DEBUG === '1') {
    console.log('[univ-lms][sql]', { text: text.slice(0, 120), ms: Date.now() - start, rows: res.rowCount });
  }
  return res;
}

/** Ejecuta varias operaciones dentro de UNA sola transacción. Es la base
 * del "batching" del autoguardado: N notas modificadas por el docente en
 * los últimos 1-2 segundos se aplican todas aquí adentro, en un solo
 * viaje a la base de datos, o ninguna si algo falla. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export default { pool, query, withTransaction };
