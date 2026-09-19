// ════════════════════════════════════════════════════════════════════════════
// RONDA 37 — GENERADOR DINÁMICO DE ESQUEMA SIMAT (Dynamic Schema Generator)
// ------------------------------------------------------------------------------
// DECISIÓN DE ARQUITECTURA (documentada aquí para explicarla con claridad):
//
// La Ronda 36 creó `simat_estudiantes` como una tabla FIJA con las columnas
// que el Anexo 6A/SIMAT usa típicamente (NUIP, tipo de documento, nombres,
// grado, sede, caracterización, estado de matrícula...). El usuario señaló,
// correctamente, que no todas las ETC/instituciones usan exactamente esas
// mismas columnas en su plantilla real — algunas traen columnas adicionales
// propias (ej. "programa_alimentacion", "ruta_transporte_escolar",
// "resguardo_indigena", campos que cada Secretaría de Educación agrega a su
// plantilla local del Anexo 6A).
//
// En vez de: (a) descartar la tabla fija de la Ronda 36, o (b) crear una
// tabla nueva por cada ETC con un nombre derivado de su identificador (lo
// que multiplicaría tablas de esquema casi idéntico y sería más difícil de
// mantener/consultar de forma consolidada para el Portal ETC/Gobernación),
// se optó por un tercer camino, HÍBRIDO, siguiendo la sugerencia explícita
// del usuario de "no descartar el trabajo previo, hibridarlo":
//
//   `simat_estudiantes` se mantiene como la tabla BASE/mínima común (con
//   (sk, nuip) como llave de upsert — igual que en la Ronda 36), y este
//   módulo AÑADE columnas adicionales a ESA MISMA tabla compartida mediante
//   `ALTER TABLE simat_estudiantes ADD COLUMN IF NOT EXISTS <col> TEXT`
//   cuando detecta, en el archivo importado de una ETC, encabezados que no
//   corresponden a ninguna columna del esquema base.
//
// ¿Por qué una tabla compartida con columnas añadidas, y no una tabla nueva
// por ETC? Porque el Portal ETC/Gobernación (GET /api/etc/simat/consolidado)
// necesita poder consultar y agregar datos de varias instituciones a la vez
// sin tener que enumerar dinámicamente N tablas distintas; una columna de
// más que una ETC nunca usa (queda NULL/'' para las demás) es un costo mucho
// menor que fragmentar el esquema en tablas por institución. El parámetro
// `etcId` se conserva en la firma de `generarEsquemaSimatDinamico()` (tal
// como se pidió) y se usa hoy solo para fines de auditoría/registro — queda
// disponible para, en el futuro, prefijar columnas por ETC si dos
// instituciones necesitaran el MISMO nombre de columna con significados
// distintos (no es el caso detectado hasta ahora).
//
// SEGURIDAD DEL DDL DINÁMICO (crítico, se documenta con total transparencia):
// Nunca se interpola en el SQL un nombre de columna/tabla tal como llega del
// archivo del usuario. Todo nombre de columna pasa OBLIGATORIAMENTE por
// `_sanitizarNombreColumnaSimat()`, que:
//   1) Quita tildes/diacríticos (para no perder información legible al
//      convertir "Núcleo Educativo" -> "nucleo_educativo").
//   2) Pasa a minúsculas.
//   3) Reemplaza CUALQUIER carácter que no sea [a-z0-9_] por "_" — esto es
//      lo que impide la inyección SQL: comillas, punto y coma, espacios,
//      paréntesis, comentarios SQL ("--", "/*"), etc. nunca sobreviven a
//      este paso porque ninguno de esos caracteres pertenece a la lista
//      blanca.
//   4) Recorta a 48 caracteres (límite razonable de PostgreSQL es 63; se
//      deja margen para no chocar con el límite en columnas ya largas).
//   5) Si el resultado no empieza por una letra (ej. quedó "123_algo"), se
//      le antepone el prefijo fijo "col_" — un identificador de columna en
//      PostgreSQL no puede empezar por un dígito.
// El nombre de tabla NUNCA se construye a partir de una entrada del
// usuario/archivo: siempre es el literal fijo 'simat_estudiantes' escrito en
// el código fuente de este archivo — así se elimina por completo el riesgo
// de inyección también por ese lado (no hay ningún `etcId` ni ningún otro
// dato externo interpolado en el nombre de la tabla).
//
// TIPOS: todas las columnas dinámicas se crean como TEXT. Es una inferencia
// deliberadamente conservadora (ver limitación documentada en el checklist):
// un lector de CSV/Excel no puede garantizar con certeza si una columna es
// numérica, de fecha o de texto libre solo mirando unas pocas filas de
// muestra (una columna de "Código DANE" puede traer ceros a la izquierda,
// que se perderían si se infiriera como entero) — TEXT nunca pierde datos,
// aunque implique que cualquier comparación numérica futura sobre esas
// columnas dinámicas deba convertir el tipo en la consulta (CAST).
// ════════════════════════════════════════════════════════════════════════════
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

// Columnas ya cubiertas por el esquema base (ensureSchemaSimat(), en
// src/db/index.ts) — en snake_case, tal como existen realmente en Postgres.
// Cualquier encabezado detectado que sanitice a uno de estos nombres NO
// dispara ningún ALTER TABLE (la columna ya existe).
export const COLUMNAS_BASE_SIMAT: ReadonlySet<string> = new Set([
  'id', 'sk', 'nuip', 'tipo_documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'genero',
  'codigo_dane_institucion', 'codigo_dane_sede', 'jornada', 'grado_simat', 'grupo',
  'tipo_discapacidad', 'poblacion_vulnerable', 'etnia', 'victima_conflicto', 'estrato',
  'estado_simat', 'fecha_registro_novedad', 'novedad', 'created_at', 'updated_at',
]);

// También se aceptan alias en camelCase/con espacios que el importador ya
// normaliza a esas mismas columnas base (ver _validarCamposObligatoriosSimat
// y el mapeo del importador en src/routes/etc.ts) — se listan aquí para que
// un encabezado como "FechaNacimiento" o "Fecha Nacimiento" no termine
// creando una columna dinámica redundante `fecha_nacimiento` (que de todas
// formas sería inofensiva por el IF NOT EXISTS, pero es más limpio evitarla).
const ALIAS_A_COLUMNA_BASE: Record<string, string> = {
  nombres: 'nombres', apellidos: 'apellidos', nuip: 'nuip', documento: 'nuip',
  tipodocumento: 'tipo_documento', fechanacimiento: 'fecha_nacimiento', genero: 'genero',
  codigodaneinstitucion: 'codigo_dane_institucion', codigodanesede: 'codigo_dane_sede',
  jornada: 'jornada', gradosimat: 'grado_simat', grupo: 'grupo',
  tipodiscapacidad: 'tipo_discapacidad', poblacionvulnerable: 'poblacion_vulnerable',
  etnia: 'etnia', victimaconflicto: 'victima_conflicto', estrato: 'estrato',
  estadosimat: 'estado_simat', fecharegistronovedad: 'fecha_registro_novedad', novedad: 'novedad',
};

export function _sanitizarNombreColumnaSimat(nombreCrudo: string): string | null {
  const base = String(nombreCrudo ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita tildes/diacríticos
    .toLowerCase();
  // Alias directo (sin espacios/guiones) a una columna base ya existente.
  const claveAlias = base.replace(/[^a-z0-9]/g, '');
  if (ALIAS_A_COLUMNA_BASE[claveAlias]) return ALIAS_A_COLUMNA_BASE[claveAlias];

  let normalizado = base
    .replace(/[^a-z0-9_]/g, '_') // whitelist estricta: única línea que importa para la seguridad del DDL
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (!normalizado) return null;
  if (!/^[a-z]/.test(normalizado)) normalizado = `col_${normalizado}`;
  return normalizado || null;
}

// Memoria de proceso (no persistente) de las columnas dinámicas ya creadas,
// para no lanzar un ALTER TABLE de más en cada fila de un mismo import — el
// ALTER TABLE ... IF NOT EXISTS ya es idempotente en Postgres, así que esta
// caché es solo una optimización, nunca una condición de seguridad.
const _columnasDinamicasConocidas = new Set<string>();

export interface ResultadoEsquemaDinamicoSimat {
  columnasAgregadas: string[];
  columnasIgnoradas: string[]; // encabezados vacíos/no sanitizables (ej. una columna sin nombre)
}

// Firma EXACTA pedida: generarEsquemaSimatDinamico(etcId, columnasDetectadas).
// `etcId` se conserva para auditoría/uso futuro (ver comentario de
// arquitectura arriba) — hoy no se usa para construir el nombre de la tabla
// ni de ninguna columna, precisamente para eliminar cualquier superficie de
// inyección SQL por ese lado.
export async function generarEsquemaSimatDinamico(
  etcId: string,
  columnasDetectadas: string[],
): Promise<ResultadoEsquemaDinamicoSimat> {
  const columnasAgregadas: string[] = [];
  const columnasIgnoradas: string[] = [];
  if (!Array.isArray(columnasDetectadas)) return { columnasAgregadas, columnasIgnoradas };

  for (const crudo of columnasDetectadas) {
    const col = _sanitizarNombreColumnaSimat(String(crudo ?? ''));
    if (!col) { columnasIgnoradas.push(String(crudo ?? '')); continue; }
    if (COLUMNAS_BASE_SIMAT.has(col)) continue; // ya existe en el esquema base
    if (_columnasDinamicasConocidas.has(col)) continue; // ya se agregó en este proceso

    // `col` ya pasó por la whitelist estricta de arriba (solo [a-z0-9_],
    // no puede contener comillas, ';', '--', espacios ni ninguna otra
    // secuencia de inyección) — por eso, y SOLO por eso, es seguro
    // interpolarlo aquí con sql.raw(). El nombre de la tabla es un literal
    // fijo del código fuente, nunca un dato externo.
    await db.execute(sql.raw(`ALTER TABLE simat_estudiantes ADD COLUMN IF NOT EXISTS ${col} TEXT`));
    _columnasDinamicasConocidas.add(col);
    columnasAgregadas.push(col);
  }

  return { columnasAgregadas, columnasIgnoradas };
}

// Guarda, para una fila ya existente (identificada por sk+nuip), el valor de
// las columnas dinámicas detectadas (las que no pertenecen al esquema base).
// Se hace con una sentencia UPDATE por columna, usando un parámetro real
// para el VALOR (nunca interpolado) y sql.raw() únicamente para el NOMBRE de
// columna ya sanitizado — mismo principio de seguridad que arriba.
export async function guardarValoresDinamicosSimat(
  sk: string,
  nuip: string,
  valoresPorColumna: Record<string, string>,
): Promise<void> {
  const entradas = Object.entries(valoresPorColumna || {});
  for (const [col, valor] of entradas) {
    if (COLUMNAS_BASE_SIMAT.has(col) || !_columnasDinamicasConocidas.has(col)) continue; // defensa extra: solo columnas ya creadas por este generador
    await db.execute(sql`UPDATE simat_estudiantes SET ${sql.raw(col)} = ${String(valor ?? '')} WHERE sk = ${sk} AND nuip = ${nuip}`);
  }
}

// Utilidad de exposición para pruebas/otros módulos: columnas dinámicas
// creadas hasta el momento en este proceso (no es una fuente de verdad de
// Neon, solo la memoria local de este proceso Node).
export function columnasDinamicasSimatConocidas(): string[] {
  return Array.from(_columnasDinamicasConocidas);
}
