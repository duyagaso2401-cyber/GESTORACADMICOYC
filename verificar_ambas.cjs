const { Client } = require('pg');
require('dotenv').config();

async function verificarBasesDeDatos() {
  console.log('==================================================');
  console.log('🔍 AUDITORÍA Y VERIFICACIÓN DE BASES DE DATOS');
  console.log('==================================================\n');

  const url1 = process.env.DATABASE_URL;
  const url2 = process.env.DATABASE_URL_VIEJA;

  // Función para probar una conexión individual
  async function consultarDB(url, etiquetaVariable) {
    if (!url) {
      console.log(`⚠️ La variable ${etiquetaVariable} no está definida en el archivo .env\n`);
      return;
    }

    // Extraer el host de Neon para identificarla claramente
    const hostMatch = url.match(/@([^/]+)/);
    const host = hostMatch ? hostMatch[1] : 'Host desconocido';

    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();
      
      // Contar estudiantes
      const resEst = await client.query('SELECT COUNT(*) FROM "ESTS";').catch(() => ({ rows: [{ count: 'Tabla no existe' }] }));
      // Contar descriptores
      const resDesc = await client.query('SELECT COUNT(*) FROM "descriptores";').catch(() => ({ rows: [{ count: 'Tabla no existe' }] }));
      // Contar plataformas (superadmin)
      const resPlat = await client.query('SELECT COUNT(*) FROM "platforms";').catch(() => ({ rows: [{ count: 'Tabla no existe' }] }));

      console.log(`📌 Variable: ${etiquetaVariable}`);
      console.log(`🌐 Host en Neon: ${host}`);
      console.log(`   - Estudiantes (ESTS): ${resEst.rows[0].count}`);
      console.log(`   - Descriptores:       ${resDesc.rows[0].count}`);
      console.log(`   - Plataformas:        ${resPlat.rows[0].count}`);
      console.log('--------------------------------------------------\n');

      await client.end();
    } catch (err) {
      console.log(`❌ Error conectando a ${etiquetaVariable}: ${err.message}\n`);
    }
  }

  await consultarDB(url1, 'DATABASE_URL');
  await consultarDB(url2, 'DATABASE_URL_VIEJA');
}

verificarBasesDeDatos();