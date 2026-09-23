// ════════════════════════════════════════════════════════════════════════════
// RONDA 45 — DIMENSIÓN 1, FASE 1 (DUAL-WRITE / STRANGLER FIG): SCRIPT DE
// BACKFILL HISTÓRICO del blob JSON hacia las tablas relacionales nuevas
// (estudiantes_rel, materias_rel, calificaciones_rel).
// ------------------------------------------------------------------------------
// QUÉ HACE: recorre TODAS las instituciones (todas las filas de `kv_store`
// que no sean la fila especial del Gestor Académico YC, `GESTOR_SK`), y
// para cada una copia sus estudiantes, materias (`blob.carga`) y notas
// (`e.nts[cId][per]`) hacia las 3 tablas relacionales — usando el MISMO
// `UPSERT (INSERT ... ON CONFLICT DO UPDATE)` que ya usa el dual-write en
// caliente de src/index.ts (`_dualWriteCalificacionRel`), así que correrlo
// más de una vez es seguro: nunca duplica filas, solo actualiza. Al
// terminar CADA institución sin errores, escribe (upsert) una fila en
// `migracion_relacional_notas` — el "interruptor" que activa la lectura
// relacional para esa institución en los 3 endpoints /api/grados* (ver
// `_institucionYaMigradaRelacional()` en src/index.ts).
//
// NO SE EJECUTA AUTOMÁTICAMENTE EN CADA ARRANQUE (a propósito, tal como
// pidió el coordinador): para una institución grande, recorrer todo su
// blob y hacer cientos/miles de UPSERTs puede tardar bastante — hacerlo
// en cada `npm start` arriesgaría el tiempo de arranque en producción. Se
// ejecuta MANUALMENTE (o disparado por quien opere el despliegue) cuando
// se decida activar la Fase 1 para el ambiente real.
//
// CÓMO USARLO:
//   npx tsx scripts/migrar-notas-a-relacional.ts
//   npx tsx scripts/migrar-notas-a-relacional.ts --sk=ie_sincelejito_db_v4   (una sola institución)
//   npx tsx scripts/migrar-notas-a-relacional.ts --dry-run                  (solo cuenta, no escribe nada)
//
// HONESTIDAD SOBRE LO QUE ESTE ENTORNO PUDO VERIFICAR: este script se
// probó por inspección de código y con una simulación en memoria de su
// lógica de agrupamiento/backfill (ver test_ronda45_*.mjs) — NO se pudo
// ejecutar contra una Neon real con datos de producción reales en este
// entorno (no hay una base de datos de prueba disponible aquí). Antes de
// usarlo contra la base de datos real, se recomienda:
//   1. Correrlo primero con --dry-run contra una copia/backup.
//   2. Verificar los conteos que imprime contra lo esperado.
//   3. Correrlo de verdad fuera de horario pico (aunque no bloquea nada,
//      añade carga de escritura a Neon mientras corre).
// ════════════════════════════════════════════════════════════════════════════
import 'dotenv/config';
import { db, kvStore, estudiantesRel, materiasRel, calificacionesRel, migracionRelacionalNotas, ensureSchemaRelacionalNotas } from '../src/db/index.js';
import { eq, ne } from 'drizzle-orm';

const GESTOR_SK = '__gestor_academico_yc__';

function parseArgs() {
  const args = process.argv.slice(2);
  const skFiltro = args.find((a) => a.startsWith('--sk='))?.split('=')[1] || null;
  const dryRun = args.includes('--dry-run');
  return { skFiltro, dryRun };
}

async function migrarInstitucion(sk: string, blob: any, dryRun: boolean): Promise<{ estudiantes: number; materias: number; calificaciones: number }> {
  const ests: any[] = Array.isArray(blob?.ests) ? blob.ests : [];
  const cargas: any[] = Array.isArray(blob?.carga) ? blob.carga : [];
  let nEst = 0, nMat = 0, nCal = 0;

  if (!dryRun) {
    for (const e of ests) {
      if (!e || e.id === undefined || e.id === null) continue;
      await db.insert(estudiantesRel)
        .values({ sk, estIdOrigen: String(e.id), nombre: e.n || '', numDoc: e.numDoc || '', grado: e.g || '', estadoMatricula: e.estadoMatricula || 'activo', updatedAt: new Date() })
        .onConflictDoUpdate({ target: [estudiantesRel.sk, estudiantesRel.estIdOrigen], set: { nombre: e.n || '', numDoc: e.numDoc || '', grado: e.g || '', estadoMatricula: e.estadoMatricula || 'activo', updatedAt: new Date() } });
      nEst++;
    }
    for (const c of cargas) {
      if (!c || c.id === undefined || c.id === null) continue;
      await db.insert(materiasRel)
        .values({ sk, cIdOrigen: String(c.id), nombre: c.m || '', grado: c.g || '', updatedAt: new Date() })
        .onConflictDoUpdate({ target: [materiasRel.sk, materiasRel.cIdOrigen], set: { nombre: c.m || '', grado: c.g || '', updatedAt: new Date() } });
      nMat++;
    }
    for (const e of ests) {
      if (!e || !e.nts) continue;
      for (const cId of Object.keys(e.nts)) {
        const periodos = e.nts[cId];
        if (!periodos || typeof periodos !== 'object') continue;
        for (const per of Object.keys(periodos)) {
          await db.insert(calificacionesRel)
            .values({ sk, estIdOrigen: String(e.id), cIdOrigen: String(cId), periodo: String(per), notas: periodos[per], updatedAt: new Date() })
            .onConflictDoUpdate({ target: [calificacionesRel.sk, calificacionesRel.estIdOrigen, calificacionesRel.cIdOrigen, calificacionesRel.periodo], set: { notas: periodos[per], updatedAt: new Date() } });
          nCal++;
        }
      }
    }
    await db.insert(migracionRelacionalNotas)
      .values({ sk, migradoEn: new Date(), totalEstudiantes: nEst, totalCalificaciones: nCal })
      .onConflictDoUpdate({ target: migracionRelacionalNotas.sk, set: { migradoEn: new Date(), totalEstudiantes: nEst, totalCalificaciones: nCal } });
  } else {
    nEst = ests.length;
    nMat = cargas.length;
    nCal = ests.reduce((acc, e) => acc + (e?.nts ? Object.values(e.nts).reduce((a: number, per: any) => a + (per && typeof per === 'object' ? Object.keys(per).length : 0), 0) : 0), 0);
  }
  return { estudiantes: nEst, materias: nMat, calificaciones: nCal };
}

async function main() {
  const { skFiltro, dryRun } = parseArgs();
  console.log(`════════════════════════════════════════════════════════════════`);
  console.log(`RONDA 45 — Backfill de notas a esquema relacional (Fase 1, dual-write)`);
  console.log(`Modo: ${dryRun ? 'DRY-RUN (solo cuenta, no escribe nada)' : 'REAL (escribe en Neon)'}`);
  console.log(`Filtro de institución: ${skFiltro || '(todas)'}`);
  console.log(`════════════════════════════════════════════════════════════════`);

  if (!dryRun) await ensureSchemaRelacionalNotas();

  const filas = skFiltro
    ? await db.select().from(kvStore).where(eq(kvStore.key, skFiltro))
    : await db.select().from(kvStore).where(ne(kvStore.key, GESTOR_SK));

  let totalInst = 0, totalEst = 0, totalMat = 0, totalCal = 0;
  for (const fila of filas) {
    const sk = fila.key;
    const blob: any = fila.value;
    if (!blob || typeof blob !== 'object') continue;
    const r = await migrarInstitucion(sk, blob, dryRun);
    totalInst++;
    totalEst += r.estudiantes;
    totalMat += r.materias;
    totalCal += r.calificaciones;
    console.log(`  ✓ ${sk}: ${r.estudiantes} estudiantes, ${r.materias} materias, ${r.calificaciones} calificaciones`);
  }

  console.log(`════════════════════════════════════════════════════════════════`);
  console.log(`Instituciones procesadas: ${totalInst}`);
  console.log(`Total estudiantes: ${totalEst} | Total materias: ${totalMat} | Total calificaciones: ${totalCal}`);
  if (dryRun) console.log('DRY-RUN: no se escribió nada. Corra sin --dry-run para aplicar de verdad.');
  console.log(`════════════════════════════════════════════════════════════════`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error fatal en la migración:', err);
  process.exit(1);
});
