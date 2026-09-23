const { Client } = require('pg');
require('dotenv').config();

const clienteViejo = new Client({
  connectionString: process.env.DATABASE_URL_VIEJA || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const clienteNuevo = new Client({
  connectionString: process.env.DATABASE_URL_NUEVA,
  ssl: { rejectUnauthorized: false }
});

async function diagnosticoYMigracion() {
  try {
    console.log('Conectando a bases de datos...');
    await clienteViejo.connect();
    await clienteNuevo.connect();

    // 1. Revisar si existen estudiantes en la base VIEJA
    const resEst = await clienteViejo.query('SELECT COUNT(*) FROM "Estudiante";');
    console.log('==================================================');
    console.log('ESTUDIANTES EN LA BASE VIEJA:', resEst.rows[0].count);
    console.log('==================================================');

    if (parseInt(resEst.rows[0].count) === 0) {
      console.log('⚠️ ATENCIÓN: La variable DATABASE_URL_VIEJA en el .env apunta a una base de datos que NO tiene estudiantes.');
      console.log('Por favor revise si la URL de la base vieja en el .env es la correcta.');
      return;
    }

    // 2. Si hay estudiantes, migrar todas las tablas principales
    const tablasPrincipales = [
      'Institucion', 'Sede', 'Jornada', 'Grado', 'Grupo', 
      'Usuario', 'Docente', 'Estudiante', 'Acudiente', 
      'Asignatura', 'Matricula', 'Logro', 'Nota'
    ];

    for (const tabla of tablasPrincipales) {
      try {
        const datos = await clienteViejo.query(`SELECT * FROM "${tabla}";`);
        if (datos.rows.length > 0) {
          console.log(`Transferiendo ${datos.rows.length} filas de "${tabla}"...`);
          const columnas = Object.keys(datos.rows[0]).map(c => `"${c}"`).join(', ');
          
          for (const fila of datos.rows) {
            const valores = Object.values(fila);
            const params = valores.map((_, i) => `$${i + 1}`).join(', ');
            await clienteNuevo.query(
              `INSERT INTO "${tabla}" (${columnas}) VALUES (${params}) ON CONFLICT DO NOTHING;`,
              valores
            );
          }
          console.log(`✓ "${tabla}" migrada con éxito.`);
        }
      } catch (errTabla) {
        console.log(`Nota sobre tabla "${tabla}": ${errTabla.message}`);
      }
    }

    console.log('==================================================');
    console.log('¡MIGRACIÓN CONSOLIDADA COMPLETADA!');
    console.log('==================================================');

  } catch (err) {
    console.error('ERROR GENERAL:', err.message);
  } finally {
    await clienteViejo.end();
    await clienteNuevo.end();
  }
}

diagnosticoYMigracion();