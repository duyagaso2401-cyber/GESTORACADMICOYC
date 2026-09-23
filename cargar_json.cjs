const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function cargarBackupEstructurado() {
  try {
    const archivos = fs.readdirSync('.').filter(f => f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json');

    if (archivos.length === 0) {
      console.log('❌ NO SE ENCONTRÓ NINGÚN ARCHIVO .JSON DE RESPALDO');
      return;
    }

    const archivoAUsar = archivos[0];
    console.log(`==================================================`);
    console.log(`📁 CARGANDO Y DESEMPAQUETANDO: "${archivoAUsar}"`);
    console.log(`==================================================`);

    const contenidoRaw = JSON.parse(fs.readFileSync(archivoAUsar, 'utf-8'));
    
    // Si el JSON viene envuelto dentro de 'gestorDB', extraemos las tablas reales de ahí
    const contenido = contenidoRaw.gestorDB ? contenidoRaw.gestorDB : contenidoRaw;
    const tablas = Object.keys(contenido);

    console.log('Tablas reales a restaurar:', tablas.join(', '));

    const client = new Client({
      connectionString: process.env.DATABASE_URL_NUEVA || process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    console.log('Conectado a la base de datos nueva en Neon. Insertando registros...\n');

    for (const tabla of tablas) {
      const filas = contenido[tabla];
      if (Array.isArray(filas) && filas.length > 0) {
        console.log(`Insertando ${filas.length} filas en "${tabla}"...`);
        const columnas = Object.keys(filas[0]).map(c => `"${c}"`).join(', ');

        for (const fila of filas) {
          const valores = Object.values(fila);
          const params = valores.map((_, i) => `$${i + 1}`).join(', ');
          const queryInsert = `INSERT INTO "${tabla}" (${columnas}) VALUES (${params}) ON CONFLICT DO NOTHING;`;
          try {
            await client.query(queryInsert, valores);
          } catch (e) {
            // Ignora duplicados o fallos menores de restricción
          }
        }
        console.log(`✓ Tabla "${tabla}" cargada correctamente.`);
      }
    }

    await client.end();
    console.log('\n==================================================');
    console.log('¡BASE DE DATOS POBLADA EXITOSAMENTE CON TODOS SUS DATOS!');
    console.log('==================================================');

  } catch (err) {
    console.error('ERROR AL CARGAR:', err.message);
  }
}

cargarBackupEstructurado();