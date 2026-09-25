// ════════════════════════════════════════════════════════════════════════════
// RONDA 77 — TIMEOUT DE SEGURIDAD PARA CONSULTAS A LA BASE DE DATOS REMOTA
// ------------------------------------------------------------------------------
// Se reportó lentitud/congelamiento extremo al navegar entre módulos (todos
// los roles) cuando Neon (la BD remota) sufre latencia: sin ningún límite de
// tiempo, un `await db.select()...` que Neon tarda en responder deja la
// petición HTTP completa colgada indefinidamente — el cliente nunca recibe
// ni siquiera un error, solo silencio, y el Skeleton Loader del frontend
// (que SÍ está garantizado a desmontarse — Ronda 76 — en cuanto la promesa
// de la que depende se resuelva O se rechace) queda esperando para siempre
// porque esa promesa nunca hace ninguna de las dos cosas.
//
// Este módulo es intencionalmente una función PURA sin ninguna dependencia
// externa (ni de Drizzle, ni de Express, ni de Neon): solo usa Promise/
// setTimeout nativos de Node. Esto permite:
//   (a) reutilizarla en CUALQUIER consulta a la BD del backend (no solo
//       kv_store) sin acoplarla a un driver o esquema en particular, y
//   (b) probarla de forma aislada y determinística (ver
//       test_ronda77_optimizacion_rendimiento.mjs) sin necesitar una
//       conexión real a Postgres/Neon.
// ════════════════════════════════════════════════════════════════════════════

/** Se lanza cuando una promesa envuelta con conTimeout() no resolvió a tiempo. */
export class TimeoutError extends Error {
  constructor(mensaje?: string) {
    super(mensaje || 'Tiempo de espera agotado consultando la base de datos.');
    this.name = 'TimeoutError';
  }
}

/**
 * Envuelve cualquier promesa (típicamente una consulta a Neon vía Drizzle)
 * con un límite de tiempo. Si la promesa original no se resuelve ni rechaza
 * dentro de "ms" milisegundos, conTimeout() rechaza de inmediato con un
 * TimeoutError — SIN cancelar la consulta original en la base de datos (eso
 * requeriría soporte del propio driver), pero sí liberando de inmediato al
 * llamador (el endpoint HTTP), que puede entonces responder rápido con un
 * error amigable en vez de dejar la petición del navegador colgada.
 *
 * Si la promesa original gana la carrera (se resuelve o rechaza primero),
 * su resultado/error se propaga tal cual — conTimeout() es transparente en
 * el camino feliz.
 */
export function conTimeout<T>(promesa: Promise<T>, ms: number, mensaje?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => {
      reject(new TimeoutError(mensaje));
    }, ms);
    // Node no cuenta este temporizador contra el cierre del proceso si nada
    // más lo mantiene vivo (evita que un timeout perdido impida un cierre
    // limpio en pruebas o en un shutdown ordenado).
    if (typeof (temporizador as any).unref === 'function') (temporizador as any).unref();
    promesa.then(
      (valor) => { clearTimeout(temporizador); resolve(valor); },
      (error) => { clearTimeout(temporizador); reject(error); }
    );
  });
}

/**
 * Timeout por defecto para consultas de LECTURA a Neon.
 * RONDA 78 — se subió de 7000ms a 12000ms: pruebas reales del usuario
 * mostraron que, cuando la instancia remota de Neon entra en "cold start"
 * (suspendida por inactividad), despertar y responder la PRIMERA consulta
 * puede tardar más de 7s por sí solo — 7000ms cortaba esa primera consulta
 * antes de darle tiempo a Neon de "despertar", generando un 503 espurio en
 * vez de simplemente esperar un poco más a algo que sí iba a responder.
 */
export const TIMEOUT_CONSULTA_BD_MS = 12000;

/**
 * RONDA 78 — REINTENTO AUTOMÁTICO PARA ARRANQUE EN FRÍO DE NEON.
 * ------------------------------------------------------------------------
 * Envuelve una FÁBRICA de promesas (no una promesa ya iniciada — hace falta
 * poder "volver a intentar" la consulta original desde cero, con su propio
 * temporizador, no reutilizar una promesa que ya perdió la carrera) con
 * conTimeout(), y si el PRIMER intento agota su tiempo por un cold start de
 * Neon, espera "esperaMs" (por defecto 3000ms — tiempo típico que necesita
 * Neon para terminar de reanimarse tras la primera consulta que lo
 * "despertó") y hace UN SEGUNDO intento, con el mismo límite de tiempo,
 * antes de rendirse y dejar que el TimeoutError se propague normalmente
 * (el llamador responde 503 igual que siempre).
 *
 * Solo reintenta ante un TimeoutError (arranque en frío/latencia) — un
 * error real de la consulta (SQL inválido, conexión rechazada, etc.) se
 * propaga de inmediato en el primer intento, sin reintento, porque
 * reintentar eso no cambiaría el resultado y solo retrasaría un error que
 * de todas formas hay que reportar.
 */
export async function conTimeoutYReintento<T>(
  fabricaPromesa: () => Promise<T>,
  ms: number,
  mensaje?: string,
  esperaMs: number = 3000
): Promise<T> {
  try {
    return await conTimeout(fabricaPromesa(), ms, mensaje);
  } catch (e) {
    if (!(e instanceof TimeoutError)) throw e;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, esperaMs);
      if (typeof (t as any).unref === 'function') (t as any).unref();
    });
    // Segundo y último intento: si también agota el tiempo (o falla por
    // cualquier otra razón), el error se propaga tal cual al llamador.
    return await conTimeout(fabricaPromesa(), ms, mensaje);
  }
}
