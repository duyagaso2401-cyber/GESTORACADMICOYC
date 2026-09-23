// ════════════════════════════════════════════════════════════════════════════
// RONDA 49 — MONITOREO DE INFRAESTRUCTURA Y TELEMETRÍA DEL SERVIDOR
// ------------------------------------------------------------------------------
// Módulo nuevo, independiente de ecosystemAgent.js (ese es el Auditor de
// DATOS del ecosistema — académico/técnico/sincronización; este es
// monitoreo de SALUD DE LA MÁQUINA — RAM, CPU, disco, conexiones de BD).
// Se mantiene separado a propósito para no mezclar dos responsabilidades
// distintas en el mismo archivo, aunque ambos reutilizan el mismo patrón
// de tarea programada (setTimeout inicial + setInterval, igual que
// iniciarTareasAutonomasProgramadas() en src/index.ts) y el mismo mecanismo
// de notificación interna (tabla `agent_audit_logs`, categoría nueva
// 'Infraestructura').
//
// La lógica de umbrales (qué es "preventiva"/"crítica") y la medición de
// disco viven en src/lib/infra-thresholds.ts, un archivo SIN dependencias
// externas (solo `fs`/`child_process` nativos), separado a propósito para
// poder probarlo con ejecución real de forma aislada, sin necesitar una
// base de datos real ni node_modules instalados (ver
// test_ronda49_telemetria_infraestructura.mjs). Ese archivo explica en su
// propia cabecera las decisiones de ingeniería del disco/CPU/umbrales.
//
// DECISIONES DE INGENIERÍA ESPECÍFICAS DE ESTE ARCHIVO (backend con I/O):
//
// 1) CONEXIONES DE BASE DE DATOS — dos números distintos, mostrados por
//    separado para que quien lea el panel entienda la diferencia:
//    a) "Pool de la aplicación" (`pool.totalCount`/`pool.idleCount`/
//       `pool.waitingCount`/`pool.options.max`, propiedades ya expuestas
//       por `pg-pool` sin necesitar ninguna consulta SQL) — cuántas
//       conexiones está usando ESTA instancia de Node ahora mismo, contra
//       cuántas tiene permitidas (`max`, 10 por defecto en `pg` si no se
//       configuró explícitamente — ver src/db/index.ts).
//    b) "Conexiones reales en Postgres" (`pg_stat_activity`, filtrado por
//       `datname = current_database()`) — cuántas conexiones ve el propio
//       servidor de Postgres para esta base de datos, sin importar de qué
//       proceso vengan. Esta consulta puede fallar por permisos en algunos
//       proveedores administrados que restringen la visibilidad de
//       `pg_stat_activity` a las conexiones del propio rol — se envuelve en
//       try/catch y, si falla, el panel sigue funcionando mostrando solo
//       (a); esto se documenta como limitación honesta.
//    "Saturación" para efectos de ALERTA se define sobre (a) — el pool de
//    la propia aplicación, el número sobre el que el sistema tiene control
//    real — > 90% de `pool.options.max` en uso simultáneo.
//
// 2) ANTI-SPAM DE CORREO — el job corre cada 15 minutos; si una condición
//    crítica persiste durante horas, no se reenvía un correo cada 15
//    minutos (saturaría la bandeja) — se recuerda en memoria el ÚLTIMO
//    nivel de alerta por área (ram/disco/conexiones) y solo se envía un
//    correo nuevo cuando el nivel EMPEORA (de "ok" a "preventiva", de
//    "preventiva" a "crítica") o, tras estar en alerta, cuando se
//    normaliza (se registra la recuperación, sin correo). Esta memoria
//    vive en una variable de módulo (no en Neon) — se reinicia si el
//    proceso Node se reinicia, lo cual en el peor caso solo provoca UN
//    correo de más tras un reinicio con la condición aún activa, nunca
//    menos alertas de las debidas. Documentado como limitación aceptada.
//
// 3) SIN FLAG ENABLE_* NUEVO — es monitoreo de salud del propio servidor
//    (no un módulo de negocio opcional como ETC/Universidades), así que no
//    tiene sentido poder "apagarlo" por institución ni tenerlo detrás de
//    un feature flag — mismo criterio que ya aplica Keep-Alive Inteligente
//    (src/lib/keep-alive.ts), que tampoco tiene flag propio.
// ════════════════════════════════════════════════════════════════════════════
import os from 'os';
import { sql } from 'drizzle-orm';
import { db, pool, agentAuditLogs } from '../db/index.js';
import { enviarCorreoGeneral } from '../lib/email-general.js';
import {
  redondear, formatearBytes, medirDisco, evaluarAlertas,
  UMBRAL_PREVENTIVO_PCT, INTERVALO_MONITOREO_MS,
  type TelemetriaInfraestructura, type AlertaInfraestructura, type NivelAlerta,
} from '../lib/infra-thresholds.js';

export { UMBRAL_PREVENTIVO_PCT, UMBRAL_CRITICO_PCT, UMBRAL_POOL_SATURADO_PCT, INTERVALO_MONITOREO_MS, evaluarAlertas } from '../lib/infra-thresholds.js';
export type { TelemetriaInfraestructura, AlertaInfraestructura, NivelAlerta } from '../lib/infra-thresholds.js';

// ────────────────────────────────────────────────────────────────────────
// 1) RECOLECCIÓN DE TELEMETRÍA
// ────────────────────────────────────────────────────────────────────────

/** Conexiones activas del propio pool de la aplicación (pg-pool, sin SQL).
 * Se usa el pool crudo exportado por src/db/index.ts (no el objeto `db` de
 * drizzle, que no expone estos contadores de forma pública/estable). */
function _telemetriaPoolAplicacion(): { total: number; inactivas: number; esperando: number; max: number; porcentajeUso: number } {
  if (!pool || typeof (pool as any).totalCount !== 'number') {
    return { total: 0, inactivas: 0, esperando: 0, max: 0, porcentajeUso: 0 };
  }
  const max = Number((pool as any).options?.max) || 10;
  const total = Number((pool as any).totalCount) || 0;
  const porcentajeUso = max > 0 ? redondear((total / max) * 100, 1) : 0;
  return { total, inactivas: Number((pool as any).idleCount) || 0, esperando: Number((pool as any).waitingCount) || 0, max, porcentajeUso };
}

async function _telemetriaBaseDatos(): Promise<TelemetriaInfraestructura['baseDatos']> {
  const poolAplicacion = _telemetriaPoolAplicacion();
  let conexionesPgStatActivity: number | null = null;
  let tamanoBytes: number | null = null;
  try {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`);
    conexionesPgStatActivity = Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n ?? null);
  } catch {
    // Permiso denegado en algunos proveedores administrados — se degrada a
    // null, el panel lo muestra como "no disponible" sin romper nada más.
    conexionesPgStatActivity = null;
  }
  try {
    const r = await db.execute(sql`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const raw = (r as any).rows?.[0]?.bytes ?? (r as any)[0]?.bytes ?? null;
    tamanoBytes = raw !== null && raw !== undefined ? Number(raw) : null;
  } catch {
    tamanoBytes = null;
  }
  return { poolAplicacion, conexionesPgStatActivity, tamanoBytes, tamanoLegible: tamanoBytes !== null ? formatearBytes(tamanoBytes) : 'no disponible' };
}

export async function obtenerTelemetria(): Promise<TelemetriaInfraestructura> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usadoMem = Math.max(0, totalMem - freeMem);
  const porcentajeRam = totalMem > 0 ? redondear((usadoMem / totalMem) * 100, 1) : 0;

  const nucleos = os.cpus()?.length || 1;
  const [loadAvg1, loadAvg5, loadAvg15] = os.loadavg();
  const porcentajeCargaAprox = redondear((loadAvg1 / nucleos) * 100, 1);

  const rutaDisco = process.cwd();
  const disco = await medirDisco(rutaDisco);
  const baseDatos = await _telemetriaBaseDatos();

  return {
    timestamp: new Date().toISOString(),
    ram: {
      totalBytes: totalMem, libreBytes: freeMem, usadoBytes: usadoMem, porcentajeUso: porcentajeRam,
      totalLegible: formatearBytes(totalMem), usadoLegible: formatearBytes(usadoMem),
    },
    cpu: { nucleos, loadAvg1: redondear(loadAvg1, 2), loadAvg5: redondear(loadAvg5, 2), loadAvg15: redondear(loadAvg15, 2), porcentajeCargaAprox },
    disco: {
      ruta: rutaDisco, totalBytes: disco.totalBytes, libreBytes: disco.libreBytes, usadoBytes: disco.usadoBytes,
      porcentajeUso: disco.porcentajeUso, metodo: disco.metodo,
      totalLegible: formatearBytes(disco.totalBytes), usadoLegible: formatearBytes(disco.usadoBytes),
    },
    baseDatos,
    uptimeProcesoSegundos: Math.round(process.uptime()),
    uptimeServidorSegundos: Math.round(os.uptime()),
  };
}

// ────────────────────────────────────────────────────────────────────────
// 2) NOTIFICACIÓN INTERNA (agent_audit_logs) + CORREO (solo crítica, con
//    anti-spam por transición de nivel)
// ────────────────────────────────────────────────────────────────────────

const _ultimoNivelPorArea: Record<string, NivelAlerta> = { ram: 'ok', disco: 'ok', conexiones: 'ok' };

async function _registrarNotificacionInterna(alerta: AlertaInfraestructura): Promise<void> {
  try {
    await db.insert(agentAuditLogs).values({
      category: 'Infraestructura',
      issueDetected: alerta.mensaje,
      actionTaken: alerta.sugerencia,
      status: alerta.nivel === 'critica' ? 'Alerta' : 'Informativo',
      details: { area: alerta.area, nivel: alerta.nivel, porcentaje: alerta.porcentaje },
    });
  } catch (err) {
    console.error('[InfraTelemetry] No se pudo registrar la notificación interna en agent_audit_logs:', (err as any)?.message || err);
  }
}

async function _enviarCorreoEmergencia(alerta: AlertaInfraestructura): Promise<void> {
  const destino = (process.env.SUPERADMIN_ALERT_EMAIL || '').trim();
  if (!destino) {
    console.warn('[InfraTelemetry] Alerta crítica detectada pero SUPERADMIN_ALERT_EMAIL no está configurada — no se envía correo (ver .env.example). La notificación interna sí quedó registrada.');
    return;
  }
  try {
    await enviarCorreoGeneral({
      to: destino,
      subject: `🚨 Alerta crítica de infraestructura — Gestor Académico YC (${alerta.area})`,
      text: `${alerta.mensaje}\n\nSugerencia: ${alerta.sugerencia}\n\nEste es un correo automático del monitoreo de infraestructura (Ronda 49). Revise el panel "🖥️ Estado del Servidor & Infraestructura" en el panel de Súper Admin para más detalle.`,
      html: `<p><strong>${alerta.mensaje}</strong></p><p>${alerta.sugerencia}</p><p style="color:#888;font-size:0.85em">Correo automático del monitoreo de infraestructura. Revise el panel "🖥️ Estado del Servidor &amp; Infraestructura" en el panel de Súper Admin.</p>`,
    });
  } catch (err) {
    console.error('[InfraTelemetry] Falló el envío del correo de alerta crítica (no se detiene el proceso):', (err as any)?.message || err);
  }
}

/** Procesa una lista de alertas ya evaluadas: registra notificación interna
 * para TODAS (preventiva y crítica), y envía correo SOLO cuando una alerta
 * de nivel 'critica' representa una TRANSICIÓN (no estaba ya en 'critica'
 * en el ciclo anterior) — evita reenviar el mismo correo cada 15 minutos
 * mientras la condición persiste. También registra (sin correo) cuando un
 * área vuelve a 'ok' tras haber estado en alerta, para que el historial del
 * panel muestre la recuperación. */
export async function procesarAlertas(alertas: AlertaInfraestructura[]): Promise<void> {
  const areasConAlerta = new Set(alertas.map((a) => a.area));

  for (const alerta of alertas) {
    const nivelAnterior = _ultimoNivelPorArea[alerta.area] || 'ok';
    await _registrarNotificacionInterna(alerta);
    if (alerta.nivel === 'critica' && nivelAnterior !== 'critica') {
      await _enviarCorreoEmergencia(alerta);
    }
    _ultimoNivelPorArea[alerta.area] = alerta.nivel;
  }

  // Áreas que ya NO están en la lista de alertas (volvieron a 'ok'): si
  // antes estaban en alerta, se registra la recuperación una sola vez.
  for (const area of Object.keys(_ultimoNivelPorArea) as Array<'ram' | 'disco' | 'conexiones'>) {
    if (!areasConAlerta.has(area) && _ultimoNivelPorArea[area] !== 'ok') {
      try {
        await db.insert(agentAuditLogs).values({
          category: 'Infraestructura',
          issueDetected: `✅ El área "${area}" volvió a un nivel normal (por debajo del ${UMBRAL_PREVENTIVO_PCT}%).`,
          actionTaken: 'Ninguna acción requerida — se registra para el historial.',
          status: 'Informativo',
          details: { area, nivel: 'ok' },
        });
      } catch { /* no crítico */ }
      _ultimoNivelPorArea[area] = 'ok';
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 3) JOB PROGRAMADO (cada 15 minutos)
// ────────────────────────────────────────────────────────────────────────

let _cicloEnCurso = false;
export async function ejecutarCicloMonitoreo(): Promise<{ telemetria: TelemetriaInfraestructura; alertas: AlertaInfraestructura[] }> {
  if (_cicloEnCurso) {
    // Evita solapar ciclos si uno tarda más de lo esperado (ej. Neon lento) — mismo criterio que _auditoriaEnCurso en src/routes/agent.js.
    const telemetria = await obtenerTelemetria();
    return { telemetria, alertas: [] };
  }
  _cicloEnCurso = true;
  try {
    const telemetria = await obtenerTelemetria();
    const alertas = evaluarAlertas(telemetria);
    await procesarAlertas(alertas);
    return { telemetria, alertas };
  } finally {
    _cicloEnCurso = false;
  }
}

export function iniciarMonitoreoInfraestructura(): void {
  // Primer ciclo a los 2 minutos de arrancar (deja que el servidor termine
  // de inicializar todo lo demás primero), luego cada 15 minutos — mismo
  // patrón (setTimeout inicial + setInterval) que el resto de tareas
  // autónomas de src/index.ts.
  setTimeout(() => {
    ejecutarCicloMonitoreo().catch((err) => console.error('[InfraTelemetry] Error en el primer ciclo de monitoreo:', err?.message || err));
    setInterval(() => {
      ejecutarCicloMonitoreo().catch((err) => console.error('[InfraTelemetry] Error en el ciclo de monitoreo:', err?.message || err));
    }, INTERVALO_MONITOREO_MS);
  }, 2 * 60 * 1000);
}
