// ════════════════════════════════════════════════════════════════════════════
// CACHÉ EN MEMORIA DEL BLOB DE DATOS POR INSTITUCIÓN (kv_store, clave = "sk")
// ------------------------------------------------------------------------------
// "6 pilares de rendimiento" — Pilar 2 (caché para reducir lecturas repetidas
// contra Neon). GET /api/inetis/db es, con mucha diferencia, el endpoint más
// llamado de todo el sistema: cada dispositivo abierto (docente, estudiante,
// padre, admin) lo consulta periódicamente para el guardado automático y la
// sincronización en segundo plano. La mayoría de esas llamadas, la mayor
// parte del tiempo, devuelven exactamente los mismos datos que la llamada
// anterior — nadie guardó nada nuevo en el ínterin.
//
// GET /api/inetis/db YA tenía una optimización de red (ETag/If-None-Match:
// si el navegador ya tiene la versión vigente, se responde 304 sin cuerpo).
// Eso ahorra ANCHO DE BANDA, pero NO ahorra la consulta SQL en sí: el
// servidor igual debe golpear Neon en cada petición para saber la versión
// actual antes de poder decidir "304 o 200". Esta caché añade la pieza que
// faltaba: durante una ventana corta, ni siquiera se toca Neon.
//
// Mismo patrón ya usado y probado en gestor-cache.ts (caché de gestorDB):
// una ventana corta en memoria (por proceso), invalidada de inmediato en
// cuanto ALGUIEN guarda un cambio para esa misma institución — así ningún
// otro dispositivo puede quedarse viendo datos obsoletos por más de la
// ventana de caché, y quien SÍ guarda ve su propio cambio reflejado al
// instante (la invalidación ocurre en el mismo request de guardado, antes
// de responder). No requiere ninguna librería nueva (node-cache, etc.):
// un Map en memoria del propio proceso es suficiente y evita una
// dependencia adicional para algo de esta escala.
// ════════════════════════════════════════════════════════════════════════════

import { db } from '../db/index.js';
import { kvStore } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const CACHE_TTL_MS = 5000; // 5s: absorbe ráfagas de sincronización de varios dispositivos sin notarse

interface EntradaCacheDb {
  value: any;
  updatedAt: Date | null;
  existe: boolean; // false = se confirmó que esa institución no tiene datos guardados aún
  ts: number;
}

const _cache = new Map<string, EntradaCacheDb>();

/** Devuelve la entrada cacheada para ese "sk" si todavía está vigente, o null si hay que consultar Neon. */
export function leerDbCacheado(sk: string): EntradaCacheDb | null {
  const e = _cache.get(sk);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    _cache.delete(sk);
    return null;
  }
  return e;
}

/** Guarda (o reemplaza) en caché el resultado de una consulta reciente a kv_store para ese "sk". */
export function guardarDbCache(sk: string, value: any, updatedAt: Date | null, existe: boolean): void {
  _cache.set(sk, { value, updatedAt, existe, ts: Date.now() });
}

/**
 * Invalida de inmediato la caché de un "sk" — se llama justo después de que
 * POST /api/inetis/db guarda un cambio, o DELETE /api/inetis/db borra la
 * institución, para que el efecto sea instantáneo en vez de esperar hasta
 * CACHE_TTL_MS a que expire sola.
 */
export function invalidarDbCache(sk: string): void {
  _cache.delete(sk);
}

/**
 * Helper de conveniencia: lee el blob JSON completo de una institución
 * (mismo dato que devuelve GET /api/inetis/db), usando esta misma caché
 * de 5s. Pensado para lógica de servidor que necesita leer los datos de
 * la institución de forma puntual (por ejemplo, el registro por código de
 * invitación y el restablecimiento de contraseña con token de un solo
 * uso), sin duplicar la consulta a Neon si /api/inetis/db ya la resolvió
 * hace unos segundos.
 */
export async function leerBlobInstitucion(sk: string): Promise<any | null> {
  const cacheada = leerDbCacheado(sk);
  if (cacheada) return cacheada.existe ? cacheada.value : null;
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
  const existe = rows.length > 0;
  const value = existe ? rows[0].value : null;
  const updatedAt = existe ? rows[0].updatedAt : null;
  guardarDbCache(sk, value, updatedAt, existe);
  return value;
}
