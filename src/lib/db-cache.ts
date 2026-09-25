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
import { conTimeout, TimeoutError, TIMEOUT_CONSULTA_BD_MS } from './timeout.js';

export { TimeoutError };

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

// ════════════════════════════════════════════════════════════════════════
// RONDA 79 — DEDUPLICADOR DE LECTURAS CONCURRENTES ("SINGLE-FLIGHT") POR SK.
// ------------------------------------------------------------------------
// SÍNTOMA reportado: al iniciar sesión o entrar a un módulo, el navegador
// dispara varias peticiones GET casi simultáneas (/api/inetis/db,
// /api/carga-docente, /api/permisos-docente, /api/grados/:id/observador,
// /api/actividades-docente...) para la MISMA institución (mismo "sk"). Cada
// una de ellas, si la caché de 5s de arriba todavía está vacía (por ejemplo,
// justo después de un período de inactividad, cuando Neon puede estar en
// "cold start"), dispara su PROPIA consulta independiente a `kv_store` —
// es decir, 4-5 consultas IDÉNTICAS golpeando a Neon al mismo tiempo, cada
// una compitiendo por una conexión del pool y por la atención de una
// instancia que además puede estar todavía "despertando". Esto explica el
// patrón exacto que describió el usuario: la carga automática (que dispara
// varias de estas peticiones a la vez) falla, pero un reintento manual
// (que dispara UNA sola, con el pool y Neon ya "calientes" de la ráfaga
// anterior) funciona al instante.
//
// La caché de 5s (arriba) solo evita relecturas DESPUÉS de que la primera
// consulta ya terminó — no evita que 2+ consultas arranquen EN PARALELO
// mientras la primera todavía está en vuelo, que es exactamente el
// escenario descrito. `leerFilaKvStoreConDedup()` cierra ese hueco: la
// PRIMERA petición para un "sk" dado inicia la consulta real (con el
// timeout/reintento que decida su llamador — ver `ejecutarConsulta`);
// cualquier petición adicional para el MISMO "sk" que llegue mientras esa
// consulta sigue en vuelo simplemente espera y reutiliza el mismo
// resultado, sin abrir una segunda conexión ni disparar una segunda
// consulta — mismo patrón "single-flight" ya aplicado en el frontend a
// _pullDB() (Ronda 78, 03-app-core.js), ahora también en el backend.
// ════════════════════════════════════════════════════════════════════════
interface ResultadoLecturaKv {
  value: any;
  updatedAt: Date | null;
  existe: boolean;
}

const _lecturasEnVuelo = new Map<string, Promise<ResultadoLecturaKv>>();

/**
 * Lee (con caché de 5s + deduplicación de lecturas concurrentes) la fila de
 * `kv_store` para un "sk". `ejecutarConsulta` es la función que realiza la
 * consulta REAL contra Neon (ya envuelta en `conTimeout()`/
 * `conTimeoutYReintento()` por el llamador) — solo se invoca cuando ni la
 * caché de 5s ni una lectura ya en vuelo pueden resolver la petición.
 *
 * Si YA hay una lectura en vuelo para ese mismo "sk" (sin importar qué
 * endpoint la haya iniciado — GET /api/inetis/db, /api/carga-docente,
 * /api/permisos-docente, etc., todos comparten este mismo deduplicador),
 * esta llamada NO invoca `ejecutarConsulta` de nuevo: espera y reutiliza el
 * resultado de la que ya está en curso.
 */
export async function leerFilaKvStoreConDedup(
  sk: string,
  ejecutarConsulta: () => Promise<ResultadoLecturaKv>
): Promise<ResultadoLecturaKv> {
  const cacheada = leerDbCacheado(sk);
  if (cacheada) return { value: cacheada.value, updatedAt: cacheada.updatedAt, existe: cacheada.existe };

  const enVuelo = _lecturasEnVuelo.get(sk);
  if (enVuelo) return enVuelo;

  const promesa = (async () => {
    try {
      const resultado = await ejecutarConsulta();
      guardarDbCache(sk, resultado.value, resultado.updatedAt, resultado.existe);
      return resultado;
    } finally {
      // Se limpia SIEMPRE (éxito o error) para que la próxima petición para
      // este "sk" (ej. tras resolverse un TimeoutError) pueda intentar una
      // consulta fresca en vez de quedar bloqueada para siempre esperando
      // una lectura que ya falló.
      _lecturasEnVuelo.delete(sk);
    }
  })();
  _lecturasEnVuelo.set(sk, promesa);
  return promesa;
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
  // RONDA 77 — TIMEOUT DE SEGURIDAD: si Neon tarda más de
  // TIMEOUT_CONSULTA_BD_MS, conTimeout() rechaza con TimeoutError en vez de
  // dejar este await colgado para siempre. El llamador (index.ts) decide
  // cómo responder al navegador ante ese error específico (ver el catch de
  // cada endpoint: distingue TimeoutError de un error genérico de BD).
  const rows = await conTimeout(
    db.select().from(kvStore).where(eq(kvStore.key, sk)),
    TIMEOUT_CONSULTA_BD_MS,
    'Timeout consultando kv_store (leerBlobInstitucion)'
  );
  const existe = rows.length > 0;
  const value = existe ? rows[0].value : null;
  const updatedAt = existe ? rows[0].updatedAt : null;
  guardarDbCache(sk, value, updatedAt, existe);
  return value;
}
