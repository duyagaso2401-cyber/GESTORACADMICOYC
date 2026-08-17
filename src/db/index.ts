import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';

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
    console.log("✅ Tablas verificadas/creadas en Neon exitosamente.");
  } catch (err) {
    console.error("❌ Error inicializando tablas:", err);
  }
}

initDb();