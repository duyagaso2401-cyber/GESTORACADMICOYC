const { Client } = require('pg');
require('dotenv').config();

const NEW_DB_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_pGOMY9tc1kem@ep-red-flower-b4q5t8l1-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

async function verificar() {
  const client = new Client({ 
    connectionString: NEW_DB_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  
  try {
    await client.connect();
    console.log("🔍 Conectado con éxito a la nueva base de datos de Neon...\n");

    // Consulta limpia convirtiendo el tamaño a bytes/caracteres
    const res = await client.query(`
      SELECT 
        key, 
        length(value::text) as caracteres,
        updated_at
      FROM kv_store;
    `);

    console.log(`📌 Se encontraron ${res.rows.length} contenedores principales (keys) migrados:\n`);
    
    res.rows.forEach((row, index) => {
      const aproxKB = (row.caracteres / 1024).toFixed(2);
      console.log(`--------------------------------------------------`);
      console.log(` [${index + 1}] Clave / Contenedor: ${row.key}`);
      console.log(`     📦 Cantidad de caracteres JSON: ${row.caracteres.toLocaleString()}`);
      console.log(`     💾 Peso aproximado: ${aproxKB} KB`);
      console.log(`     📅 Fecha de registro: ${row.updated_at}`);
    });

    console.log(`--------------------------------------------------\n`);
    
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}

verificar();