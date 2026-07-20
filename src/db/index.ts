import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm'; // Importa sql
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

export const db = drizzle(pool, { schema });

// --- AGREGA ESTO PARA QUE SE CREEN LAS TABLAS AUTOMÁTICAMENTE ---
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
        kind TEXT,
        actor TEXT,
        message TEXT,
        meta JSONB,
        seen BOOLEAN,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS documents (
        clave TEXT PRIMARY KEY,
        est_id TEXT,
        data JSONB
      );
    `);
    console.log("✅ Tablas verificadas/creadas en Neon exitosamente.");
  } catch (err) {
    console.error("❌ Error al crear tablas:", err);
  }
}
initDb();
// -----------------------------------------------------------------

export * from './schema.js';
