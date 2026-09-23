const { Client } = require('pg');
require('dotenv').config();

// Conexiones usando URLs explícitas o de entorno
const clienteViejo = new Client({
  connectionString: process.env.DATABASE_URL_VIEJA || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const clienteNuevo = new Client({
  connectionString: process.env.DATABASE_URL_NUEVA,
  ssl: { rejectUnauthorized: false }
});

async function clonarEsquemaReal() {
  try {
    console.log('Conectando a la base de datos vieja...');
    await clienteViejo.connect();
    
    // Extraer todo el SQL del esquema desde la base de datos vieja
    const res = await clienteViejo.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);

    console.log('Conectando a la base de datos nueva...');
    await clienteNuevo.connect();

    console.log('Clonando tablas reales del proyecto...');
    for (const row of res.rows) {
      const tabla = row.table_name;
      // Obtener el DDL o la estructura real de la tabla vieja
      const columnas = await clienteViejo.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = '${tabla}';
      `);
      
      // Recrear cada tabla en la base de datos nueva
      let sql = `CREATE TABLE IF NOT EXISTS "${tabla}" (`;
      const defs = columnas.rows.map(c => {
        let col = `"${c.column_name}" ${c.data_type.toUpperCase()}`;
        if (c.is_nullable === 'NO') col += ' NOT NULL';
        if (c.column_default) col += ` DEFAULT ${c.column_default}`;
        return col;
      });
      sql += defs.join(', ') + ');';
      
      await clienteNuevo.query(sql);
      console.log(`Tabla "${tabla}" creada correctamente.`);
    }

    console.log('--------------------------------------------------');
    console.log('¡TODAS LAS TABLAS REALES HAN SIDO CREADAS EN NEON!');
    console.log('--------------------------------------------------');
  } catch (err) {
    console.error('ERROR AL CLONAR ESQUEMA:', err.message);
  } finally {
    await clienteViejo.end();
    await clienteNuevo.end();
  }
}

clonarEsquemaReal();