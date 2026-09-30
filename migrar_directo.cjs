const { Pool } = require('pg');

// ⚠️ PEGA AQUÍ TUS DOS STRINGS DE CONEXIÓN EXACTOS DE NEON
const OLD_DB_URL = "postgresql://neondb_owner:npg_bEoiVm7Gsyw5@ep-muddy-credit-b5sv4tvf-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=verify-full";
const NEW_DB_URL = "postgresql://neondb_owner:npg_pGOMY9tc1kem@ep-red-flower-b4q5t8l1-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=verify-full";

const poolOld = new Pool({ connectionString: OLD_DB_URL, ssl: { rejectUnauthorized: false } });
const poolNew = new Pool({ connectionString: NEW_DB_URL, ssl: { rejectUnauthorized: false } });

async function migrar() {
  console.log("🚀 Conectando a ambas bases de datos...");
  try {
    // 1. Asegurar que la tabla kv_store exista en la BD Nueva
    await poolNew.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Estructura 'kv_store' verificada en la base de datos nueva.");

    // 2. Traer todos los registros de la BD Vieja
    const resOld = await poolOld.query("SELECT key, value FROM kv_store;");
    console.log(`📦 Registros encontrados en la base de datos vieja: ${resOld.rows.length}`);

    if (resOld.rows.length === 0) {
      console.log("⚠️ No se encontraron registros en la BD vieja.");
      return;
    }

    // 3. Copiar fila por fila convirtiendo el valor a formato JSON válido
    let cont = 0;
    for (const row of resOld.rows) {
      const valJson = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      
      await poolNew.query(
        `INSERT INTO kv_store (key, value) 
         VALUES ($1, $2::jsonb) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
        [row.key, valJson]
      );
      cont++;
      process.stdout.write(`⏳ Migrando registro ${cont} de ${resOld.rows.length}...\r`);
    }

    console.log(`\n🎉 ¡MIGRACIÓN COMPLETADA! Se copiaron ${cont} registros con éxito.`);
  } catch (err) {
    console.error("\n❌ Error durante la migración:", err.message);
  } finally {
    await poolOld.end();
    await poolNew.end();
    process.exit(0);
  }
}

migrar();