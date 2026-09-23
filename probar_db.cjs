const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL_VIEJA || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function exportarAJson() {
  try {
    await client.connect();
    console.log('Conectado a la base de datos VIEJA. Obteniendo respaldo...');

    // Consultar todas las tablas existentes
    const resTablas = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);

    const respaldo = {};

    for (const row of resTablas.rows) {
      const tabla = row.table_name;
      const datos = await client.query(`SELECT * FROM "${tabla}";`);
      if (datos.rows.length > 0) {
        respaldo[tabla] = datos.rows;
        console.log(`✓ Exportada tabla "${tabla}" (${datos.rows.length} registros)`);
      }
    }

    fs.writeFileSync('backup_completo.json', JSON.stringify(respaldo, null, 2));
    console.log('==================================================');
    console.log('¡RESPALDO GUARDADO EN "backup_completo.json"!');
    console.log('==================================================');

  } catch (err) {
    console.error('ERROR AL EXPORTAR:', err.message);
  } finally {
    await client.end();
  }
}

exportarAJson();