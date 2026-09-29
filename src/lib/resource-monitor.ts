// ════════════════════════════════════════════════════════════════════════════
// RONDA 88 — MÓDULO DE MONITOREO DE RECURSOS Y CUOTAS (Render API & Neon API)
// ------------------------------------------------------------------------------
// OBJETIVO (pedido por el usuario): que el Súper Administrador pueda ver, sin
// salir del Gestor Académico YC, cuánto ancho de banda saliente (Outbound
// Bandwidth) lleva consumido el servicio de Render y cuánta transferencia de
// red (Net Transfer) lleva consumida el proyecto de Neon Postgres, para
// evitar bloqueos/sobrecostos sorpresa.
//
// DECISIÓN DE ALCANCE (Súper Admin, NO Admin/Rector de cada institución):
// el usuario pidió originalmente este widget dentro del "Panel de
// Administración/Rectoría", pero Render/Neon facturan UN solo servicio/
// proyecto compartido por TODA la plataforma (todas las instituciones viven
// en el mismo backend y la misma base de datos) — exponer esto al Rector de
// cada institución filtraría costos/infraestructura compartida entre
// clientes que no tienen por qué verse entre sí. Se consultó explícitamente
// al usuario (AskUserQuestion) entre 3 opciones y eligió la recomendada:
// "Panel de Súper Administrador". Por eso este módulo cuelga del mismo
// panel/gestorSesion que ya usa el monitoreo de Infraestructura de la
// Ronda 49 (_gestorPag==='infraestructura'), NO de sesion.r==='admin'.
//
// CONTROL DE ACCESO DEL ENDPOINT (ver src/index.ts,
// GET /api/admin/resource-quotas-status): se reutiliza EXACTAMENTE el mismo
// mecanismo ya elegido en la Ronda 49 para el mismo tipo de necesidad (un
// endpoint que el panel sondea repetidamente sin volver a pedir contraseña)
// — el token de rescate firmado del Súper Admin (`_tieneRescateValido`),
// en vez de reinventar un esquema de credenciales nuevo.
//
// HONESTIDAD SOBRE LAS APIs EXTERNAS: ni la Render API
// (https://api.render.com/v1) ni la Neon API (https://api.neon.tech)
// publican, con ejemplos completos y estables, la forma EXACTA del payload
// de sus endpoints de métricas de consumo — sí se confirmaron (buscando en
// su documentación oficial vigente) los ENDPOINTS y los NOMBRES DE CAMPO
// reales:
//   - Render: GET /v1/services?ownerId=... (estado de cada servicio, incluido
//     si está "suspended") y GET /v1/metrics/bandwidth?resource=<id>&
//     startTime=...&endTime=... (métricas de ancho de banda saliente).
//   - Neon: el histórico de consumo expone los campos
//     `public_network_transfer_bytes` / `private_network_transfer_bytes`
//     (ver guía oficial "Querying consumption metrics").
// Como el anidamiento exacto de esas respuestas no está garantizado por la
// documentación pública, este módulo NUNCA asume una ruta rígida: usa
// `sumarCamposNumericos()` (ver resource-quota-thresholds.ts) para
// encontrar esos campos en cualquier nivel del JSON devuelto, y si de
// verdad no aparecen (porque el proveedor cambió su esquema, la cuenta no
// tiene datos ese mes, o las credenciales no tienen permiso), el widget
// simplemente muestra "no disponible" en vez de inventar un número o
// tumbar el panel. Esta es la misma filosofía "nunca lanza, se degrada con
// honestidad" que ya usa infraTelemetry.ts con pg_stat_activity.
//
// CACHÉ: entre 15 y 30 minutos pedidos por el usuario — se usa 20 minutos,
// para no agotar la cuota de consultas de las propias APIs de Render/Neon.
// El botón "Recargar" del panel fuerza un refresco saltándose la caché.
// ════════════════════════════════════════════════════════════════════════════
import {
  calcularPorcentaje, nivelPorPorcentaje, estaServicioSuspendido, sumarCamposNumericos,
  sumarMetricasPorNombre,
  formatearBytes, CACHE_RECURSOS_TTL_MS,
  type NivelCuota,
} from './resource-quota-thresholds.js';

export { CACHE_RECURSOS_TTL_MS } from './resource-quota-thresholds.js';

// ────────────────────────────────────────────────────────────────────────
// Configuración (variables de entorno — NUNCA hardcodeadas, ver .env.example)
// ────────────────────────────────────────────────────────────────────────
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const RENDER_WORKSPACE_ID = process.env.RENDER_WORKSPACE_ID || '';
const NEON_API_KEY = process.env.NEON_API_KEY || '';
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID || '';
// RONDA 91 — el endpoint VIGENTE de métricas de red de Neon
// (`/consumption_history/v2/projects`, ver más abajo) exige `org_id` de
// forma obligatoria (confirmado en la referencia oficial vigente). Todas
// las cuentas de Neon están organizadas en una "organization" desde su
// migración a facturación por organización, así que este valor SIEMPRE
// existe en el panel de Neon (Settings → General → Org ID), aunque no se
// use directamente en la consola de un solo proyecto. Es opcional a nivel
// de configuración (si falta, el módulo se degrada al endpoint legacy en
// vez de fallar) pero recomendado para que Neon devuelva datos reales.
const NEON_ORG_ID = process.env.NEON_ORG_ID || '';

export const RENDER_CONFIGURADO = !!(RENDER_API_KEY && RENDER_WORKSPACE_ID);
export const NEON_CONFIGURADO = !!(NEON_API_KEY && NEON_PROJECT_ID);

// Límite del plan contratado: ni Render ni Neon exponen de forma confiable,
// vía API pública, el límite EXACTO del plan contratado (solo el consumo) —
// se deja configurable por variable de entorno (con un valor por defecto
// razonable del plan gratuito de cada proveedor) para que el Súper Admin lo
// ajuste a su plan real sin tocar código.
const RENDER_BANDWIDTH_LIMITE_GB = Number(process.env.RENDER_BANDWIDTH_LIMITE_GB) || 100; // Render: 100 GB/mes incluidos en la mayoría de planes pagos
const NEON_TRANSFER_LIMITE_GB = Number(process.env.NEON_TRANSFER_LIMITE_GB) || 5; // Neon: 5 GB/mes en el plan Free

// Permite fijar la base de la API de Neon (que ha versionado su API pública
// entre v1/v2 con alias console.neon.tech/api.neon.tech) sin tener que
// modificar código si el proveedor cambia de versión de nuevo.
//
// RONDA 90 — CORRECCIÓN: el host por defecto usado hasta la v20
// (`https://api.neon.tech/v2`) es INCORRECTO — produce el "HTTP 0" que
// reportó el usuario en producción (el fetch no logra resolver/completar la
// conexión contra ese host para este endpoint). Se confirmó contra la
// referencia oficial de Neon (api-docs.neon.tech/reference/
// getconsumptionhistoryperproject) que el host+ruta real es
// `https://console.neon.tech/api/v2`.
const NEON_API_BASE = (process.env.NEON_API_BASE_URL || 'https://console.neon.tech/api/v2').replace(/\/+$/, '');
const RENDER_API_BASE = (process.env.RENDER_API_BASE_URL || 'https://api.render.com/v1').replace(/\/+$/, '');

if (!RENDER_CONFIGURADO) {
  console.warn('⚠️ RENDER_API_KEY/RENDER_WORKSPACE_ID no configuradas: el widget de "Estado de Servidor y Cuotas" mostrará Render como no disponible.');
}
if (!NEON_CONFIGURADO) {
  console.warn('⚠️ NEON_API_KEY/NEON_PROJECT_ID no configuradas: el widget de "Estado de Servidor y Cuotas" mostrará Neon como no disponible.');
} else if (!NEON_ORG_ID) {
  console.warn('⚠️ NEON_ORG_ID no configurada: el endpoint vigente de consumo de Neon (/consumption_history/v2/projects) lo exige — el módulo intentará el endpoint legacy como respaldo, pero puede fallar según el plan de la cuenta. Configúrala en Neon: Settings → General → Org ID.');
}

// ────────────────────────────────────────────────────────────────────────
// Tipos de la respuesta combinada que consume el frontend
// ────────────────────────────────────────────────────────────────────────
export interface ServicioRender { id: string; nombre: string; suspendido: boolean; estado: 'Online' | 'Suspended' }
export interface CuotaInfo {
  configurado: boolean;
  usadoBytes: number | null;
  usadoLegible: string;
  limiteBytes: number;
  limiteLegible: string;
  porcentajeUso: number | null;
  nivel: NivelCuota;
  disponible: boolean;
  error?: string | null;
}
export interface EstadoRecursos {
  timestamp: string;
  render: { configurado: boolean; servicios: ServicioRender[]; algunoSuspendido: boolean; bandwidth: CuotaInfo; erroresApi?: string | null };
  neon: { configurado: boolean; transfer: CuotaInfo; erroresApi?: string | null };
}

function _cuotaNoDisponible(configurado: boolean, limiteBytes: number, error?: string | null): CuotaInfo {
  return {
    configurado, usadoBytes: null, usadoLegible: 'no disponible',
    limiteBytes, limiteLegible: formatearBytes(limiteBytes),
    porcentajeUso: null, nivel: 'ok', disponible: false, error: error || null,
  };
}

async function _fetchJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status?: number; body?: any; error?: string }> {
  try {
    const r = await fetch(url, { headers });
    // RONDA 91 — se intenta leer el cuerpo SIEMPRE, incluso en respuestas de
    // error (antes solo se leía en 200 OK), porque las APIs de Render/Neon
    // devuelven un mensaje de error legible en el cuerpo (p. ej. Neon indica
    // exactamente qué parámetro rechazó) — sin esto, un HTTP 400/403 era una
    // caja negra que solo se podía diagnosticar adivinando. Nunca se asume
    // que el cuerpo exista (`.catch(() => null)`), así que esto no cambia el
    // comportamiento si el proveedor responde con texto plano o vacío.
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: r.status, body };
    return { ok: true, status: r.status, body };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────
async function _consultarRender(): Promise<EstadoRecursos['render']> {
  const limiteBytes = RENDER_BANDWIDTH_LIMITE_GB * 1024 ** 3;
  if (!RENDER_CONFIGURADO) {
    return { configurado: false, servicios: [], algunoSuspendido: false, bandwidth: _cuotaNoDisponible(false, limiteBytes) };
  }
  const headers = { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' };

  const rServ = await _fetchJson(`${RENDER_API_BASE}/services?ownerId=${encodeURIComponent(RENDER_WORKSPACE_ID)}&limit=100`, headers);
  let servicios: ServicioRender[] = [];
  if (rServ.ok && Array.isArray(rServ.body)) {
    servicios = rServ.body.map((it: any) => {
      const s = it?.service || it || {};
      const suspendido = estaServicioSuspendido(s.suspended);
      return { id: String(s.id || ''), nombre: String(s.name || s.id || 'servicio'), suspendido, estado: suspendido ? 'Suspended' : 'Online' } as ServicioRender;
    }).filter((s: ServicioRender) => s.id);
  }

  let bandwidthBytes: number | null = null;
  let bandwidthError: string | null = null;
  try {
    const inicioMes = new Date();
    inicioMes.setUTCDate(1);
    inicioMes.setUTCHours(0, 0, 0, 0);
    const params = new URLSearchParams({ startTime: inicioMes.toISOString(), endTime: new Date().toISOString() });
    for (const s of servicios) params.append('resource', s.id);
    if (servicios.length) {
      const rBw = await _fetchJson(`${RENDER_API_BASE}/metrics/bandwidth?${params.toString()}`, headers);
      if (rBw.ok) {
        // RONDA 90 — Render no publica un ejemplo de payload de este
        // endpoint (confirmado: su documentación oficial no incluye una
        // respuesta de muestra), pero el resto de sus endpoints de métricas
        // (cpu/memory/http-requests, de la misma familia "Enhanced service
        // metrics") devuelven series de tiempo por recurso con la forma
        // `[{ ..., values: [{ time, value }, ...] }]` — es decir, el número
        // de bytes viaja en un campo llamado literalmente "value" (o
        // "usageValue" en variantes previas de esa misma API), NO en una
        // clave que contenga las palabras "bandwidth"/"bytes" como asumía
        // la Ronda 88. Por eso cuentas Free/Workspace mostraban "no incluyó
        // un campo de bytes reconocible": el campo SÍ estaba, con otro
        // nombre. Se prueba primero el patrón original (por si alguna
        // cuenta/versión sí nombra el campo con "bandwidth"/"bytes") y,
        // si no aparece, se cae a los nombres genéricos de serie temporal.
        bandwidthBytes = sumarCamposNumericos(rBw.body, /bandwidth|bytes/i);
        if (bandwidthBytes === null) {
          bandwidthBytes = sumarCamposNumericos(rBw.body, /^value$|^usageValue$/i);
        }
        if (bandwidthBytes === null) bandwidthError = 'La respuesta de Render no incluyó un campo de bytes reconocible';
      } else {
        bandwidthError = `HTTP ${rBw.status ?? '?'} al consultar /metrics/bandwidth`;
      }
    } else if (rServ.ok) {
      bandwidthError = 'El workspace no tiene servicios activos para medir ancho de banda';
    }
  } catch (e: any) {
    bandwidthError = e?.message || 'Error inesperado al consultar el ancho de banda de Render';
  }

  const porcentajeUso = calcularPorcentaje(bandwidthBytes, limiteBytes);
  const bandwidth: CuotaInfo = {
    configurado: true,
    usadoBytes: bandwidthBytes,
    usadoLegible: bandwidthBytes !== null ? formatearBytes(bandwidthBytes) : 'no disponible',
    limiteBytes, limiteLegible: formatearBytes(limiteBytes),
    porcentajeUso, nivel: nivelPorPorcentaje(porcentajeUso),
    disponible: bandwidthBytes !== null, error: bandwidthError,
  };

  return {
    configurado: true,
    servicios,
    algunoSuspendido: servicios.some((s) => s.suspendido),
    bandwidth,
    erroresApi: rServ.ok ? null : `No se pudo listar los servicios de Render (HTTP ${rServ.status ?? '?'})`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Neon
// ────────────────────────────────────────────────────────────────────────
async function _consultarNeon(): Promise<EstadoRecursos['neon']> {
  const limiteBytes = NEON_TRANSFER_LIMITE_GB * 1024 ** 3;
  if (!NEON_CONFIGURADO) {
    return { configurado: false, transfer: _cuotaNoDisponible(false, limiteBytes) };
  }
  const headers = { Authorization: `Bearer ${NEON_API_KEY}`, Accept: 'application/json' };

  let transferBytes: number | null = null;
  let error: string | null = null;
  try {
    const hoy = new Date();
    const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const desdeIso = inicioMes.toISOString();
    const hastaIso = hoy.toISOString();

    let ultimoStatus: number | undefined;
    let cuerpoError: any = null;

    // ──────────────────────────────────────────────────────────────────
    // RONDA 93 — CORRECCIÓN DEL "0 B usados" (dato incorrecto, no un
    // error): en producción, con una cuenta en plan Free, el endpoint
    // LEGACY de consumption_history (sin org_id) respondía 200 OK — NO un
    // error — pero con una estructura vacía o en ceros para esa cuenta (el
    // plan Free simplemente no tiene datos reales detrás de ese esquema).
    // Como `transferBytes` quedaba en 0 (un número válido, no `null`), el
    // código de la Ronda 92 daba ese 0 por bueno y SALTABA por completo el
    // respaldo de GET /projects/{project_id} — que si tenía el dato real
    // (3.14 GB) pero nunca llegaba a consultarse. Es decir: el respaldo
    // existía, pero el intento anterior "fallaba en silencio" con éxito
    // aparente en vez de con un error, y el guard `if(transferBytes===null)`
    // no distinguía esos dos casos.
    //
    // FIX: se invierte el orden. GET /projects/{project_id} pasa a ser el
    // PRIMER intento — confirmado en la guía oficial vigente de Neon
    // (neon.com/docs/introduction/network-transfer): el campo
    // `data_transfer_bytes` de este endpoint "is available on free plans"
    // y es "a running total of network transfer for the current billing
    // period", combinando exactamente lo que el panel de Neon muestra como
    // "Public network transfer" + "Private network transfer". No exige
    // org_id ni un plan de pago, a diferencia de consumption_history. Los
    // endpoints de consumption_history (v2 y legacy) quedan como intento
    // SOLO si este primero de verdad falla (error de red, HTTP no-2xx, o
    // el campo no aparece en la respuesta) — nunca se usan para "corregir"
    // un 0 que ya vino de aquí, porque este es ahora el más confiable.
    // ──────────────────────────────────────────────────────────────────
    const rProyecto = await _fetchJson(`${NEON_API_BASE}/projects/${encodeURIComponent(NEON_PROJECT_ID)}`, headers);
    // Log solicitado explícitamente por el usuario (punto 3 de su pedido):
    // el objeto COMPLETO que devuelve la API de Neon, para poder confirmar
    // de un vistazo bajo qué propiedad exacta viene la cifra si este
    // endpoint llegara a cambiar de forma otra vez. No es información
    // sensible (son solo estadísticas de consumo del propio proyecto, sin
    // credenciales), así que se deja activo de forma permanente, no solo
    // "temporalmente" — mismo criterio que ya usan otros módulos de este
    // proyecto para diagnosticar problemas en producción sin acceso directo
    // a los logs del proveedor externo.
    console.log('[ResourceMonitor] Neon GET /projects/{id} → status:', rProyecto.status ?? '(sin respuesta)', '— body:', (() => { try { return JSON.stringify(rProyecto.body); } catch { return String(rProyecto.body); } })());
    if (rProyecto.ok) {
      transferBytes = sumarCamposNumericos(rProyecto.body, /^data_transfer_bytes$/i);
    } else {
      ultimoStatus = rProyecto.status;
      cuerpoError = rProyecto.body ?? rProyecto.error ?? null;
    }

    // Respaldo (solo si /projects/{id} no dio un número utilizable): el
    // endpoint VIGENTE con desglose público/privado, si hay NEON_ORG_ID
    // configurada — ver RONDA 91 para el porqué exacto de esta URL y de
    // exigir org_id/metrics.
    if (transferBytes === null && NEON_ORG_ID) {
      const paramsV2 = new URLSearchParams({ from: desdeIso, to: hastaIso, granularity: 'daily', org_id: NEON_ORG_ID });
      paramsV2.append('project_ids', NEON_PROJECT_ID);
      paramsV2.append('metrics', 'public_network_transfer_bytes');
      paramsV2.append('metrics', 'private_network_transfer_bytes');
      const rV2 = await _fetchJson(`${NEON_API_BASE}/consumption_history/v2/projects?${paramsV2.toString()}`, headers);
      if (rV2.ok) {
        transferBytes = sumarMetricasPorNombre(rV2.body, /network_transfer_bytes$/i);
        if (transferBytes === null) transferBytes = sumarCamposNumericos(rV2.body, /network_transfer_bytes$/i);
      } else if (ultimoStatus === undefined) {
        ultimoStatus = rV2.status;
        cuerpoError = rV2.body ?? rV2.error ?? null;
      }
    }

    // Último respaldo: el endpoint legacy de consumption_history (sin
    // org_id/metrics) — se mantiene por compatibilidad con cuentas que
    // todavía tengan acceso a ese esquema anterior, pero ya NO puede
    // enmascarar el dato real de /projects/{id}: si este devuelve 200 con
    // una estructura vacía/en ceros para una cuenta Free (como ocurrió en
    // producción), simplemente no encontrará campos que sumar y
    // `transferBytes` seguirá en null en vez de fijarse en 0 por error.
    if (transferBytes === null) {
      const paramsLegacy = new URLSearchParams({ from: desdeIso, to: hastaIso, granularity: 'daily' });
      paramsLegacy.append('project_ids', NEON_PROJECT_ID);
      if (NEON_ORG_ID) paramsLegacy.append('org_id', NEON_ORG_ID);
      const rLegacy = await _fetchJson(`${NEON_API_BASE}/consumption_history/projects?${paramsLegacy.toString()}`, headers);
      if (rLegacy.ok) {
        transferBytes = sumarMetricasPorNombre(rLegacy.body, /network_transfer_bytes$/i);
        if (transferBytes === null) transferBytes = sumarCamposNumericos(rLegacy.body, /network_transfer_bytes$/i);
      } else if (ultimoStatus === undefined) {
        ultimoStatus = rLegacy.status;
        cuerpoError = rLegacy.body ?? rLegacy.error ?? null;
      }
    }

    if (transferBytes === null) {
      // Log temporal pedido por el usuario para diagnosticar el mensaje
      // EXACTO que devuelve Neon — nunca se registran credenciales, solo
      // el status y el cuerpo de error que el propio proveedor envía.
      console.error('[ResourceMonitor] Neon: ningún endpoint de consumo respondió con datos utilizables. Último status:', ultimoStatus ?? '(sin respuesta)', '— Cuerpo:', (() => { try { return JSON.stringify(cuerpoError).slice(0, 500); } catch { return String(cuerpoError); } })());

      // RONDA 92 — si el motivo de fondo es una restricción de PLAN (403
      // explícito de Neon), se muestra un mensaje honesto y amigable en
      // vez de un código HTTP crudo — no es un error del sistema, es una
      // limitación documentada del plan Free de Neon para el historial de
      // consumo detallado.
      // Nota: un 400 sin NEON_ORG_ID configurada se deja como mensaje
      // TÉCNICO específico (más abajo) en vez de agruparlo aquí — a
      // diferencia de un 403 (rechazo explícito e inequívoco de Neon por
      // el plan de la cuenta), un 400 por falta de `org_id` SÍ tiene una
      // corrección concreta y barata (configurar esa variable), así que no
      // conviene ocultarla detrás de un mensaje que asume sin certeza que
      // el plan es la causa de fondo.
      const esRestriccionDePlan = ultimoStatus === 403;
      if (esRestriccionDePlan) {
        error = 'Tu plan actual de Neon no incluye el historial detallado de consumo por API (limitación del plan Free/Launch, no un error del sistema). Puedes ver tu transferencia de red exacta entrando a console.neon.tech → tu proyecto → pestaña "Billing"/"Usage". El panel seguirá revisando automáticamente por si el acceso cambia (p. ej. al actualizar de plan).';
      } else if (ultimoStatus === 404) {
        error = 'La cuenta no pertenece a la organización indicada en NEON_ORG_ID (HTTP 404) — revisa esa variable de entorno, o el ID del proyecto (NEON_PROJECT_ID).';
      } else if (ultimoStatus === 406) {
        error = 'El rango de fechas solicitado no es válido para la granularidad usada (HTTP 406).';
      } else if (ultimoStatus === 400 && !NEON_ORG_ID) {
        error = 'HTTP 400 al consultar /consumption_history — falta configurar NEON_ORG_ID (obligatoria para el endpoint vigente de Neon).';
      } else if (ultimoStatus !== undefined) {
        error = `HTTP ${ultimoStatus} al consultar el consumo de Neon (ni /consumption_history ni /projects/{id} devolvieron un dato utilizable).`;
      } else {
        error = 'La respuesta de Neon no incluyó campos de transferencia de red reconocibles';
      }
    }
  } catch (e: any) {
    error = e?.message || 'Error inesperado al consultar el consumo de Neon';
  }

  const porcentajeUso = calcularPorcentaje(transferBytes, limiteBytes);
  const transfer: CuotaInfo = {
    configurado: true,
    usadoBytes: transferBytes,
    usadoLegible: transferBytes !== null ? formatearBytes(transferBytes) : 'no disponible',
    limiteBytes, limiteLegible: formatearBytes(limiteBytes),
    porcentajeUso, nivel: nivelPorPorcentaje(porcentajeUso),
    disponible: transferBytes !== null, error,
  };
  return { configurado: true, transfer, erroresApi: transfer.disponible ? null : error };
}

// ────────────────────────────────────────────────────────────────────────
// Caché (20 min) + combinación de ambos proveedores
// ────────────────────────────────────────────────────────────────────────
let _cache: { data: EstadoRecursos; ts: number } | null = null;

/** Se expone para pruebas y para permitir que un futuro botón de "forzar"
 * en otro lugar del sistema invalide el estado sin esperar el TTL. */
export function invalidarCacheRecursos(): void {
  _cache = null;
}

/**
 * Punto de entrada único del módulo. `forzar=true` (botón "🔄 Recargar" del
 * panel) se salta la caché; de lo contrario, reutiliza el resultado si
 * tiene menos de CACHE_RECURSOS_TTL_MS de antigüedad — así no se agota la
 * cuota de consultas de las propias APIs de Render/Neon aunque el Súper
 * Admin deje la pestaña abierta y la recargue varias veces.
 */
export async function obtenerEstadoRecursos(forzar = false): Promise<EstadoRecursos> {
  const ahora = Date.now();
  if (!forzar && _cache && (ahora - _cache.ts) < CACHE_RECURSOS_TTL_MS) {
    return _cache.data;
  }
  const [render, neon] = await Promise.all([
    _consultarRender().catch((e) => {
      console.error('[ResourceMonitor] Falló la consulta a Render:', e?.message || e);
      return { configurado: RENDER_CONFIGURADO, servicios: [], algunoSuspendido: false, bandwidth: _cuotaNoDisponible(RENDER_CONFIGURADO, RENDER_BANDWIDTH_LIMITE_GB * 1024 ** 3, 'Error inesperado consultando Render'), erroresApi: 'Error inesperado consultando Render' } as EstadoRecursos['render'];
    }),
    _consultarNeon().catch((e) => {
      console.error('[ResourceMonitor] Falló la consulta a Neon:', e?.message || e);
      return { configurado: NEON_CONFIGURADO, transfer: _cuotaNoDisponible(NEON_CONFIGURADO, NEON_TRANSFER_LIMITE_GB * 1024 ** 3, 'Error inesperado consultando Neon'), erroresApi: 'Error inesperado consultando Neon' } as EstadoRecursos['neon'];
    }),
  ]);
  const data: EstadoRecursos = { timestamp: new Date().toISOString(), render, neon };
  _cache = { data, ts: ahora };
  return data;
}
