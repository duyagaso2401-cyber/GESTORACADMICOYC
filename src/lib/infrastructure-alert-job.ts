// ════════════════════════════════════════════════════════════════════════════
// RONDA 89 — JOB EN SEGUNDO PLANO: ALERTAS PROACTIVAS DE CUOTAS (Render/Neon)
// ------------------------------------------------------------------------------
// Cada 2 horas (INTERVALO_JOB_ALERTAS_MS, ver infra-alert-thresholds.ts):
//   1) Consulta el estado combinado de Render/Neon (obtenerEstadoRecursos de
//      la Ronda 88 — reutiliza su misma caché de 20 min, así que este job NO
//      agrega presión adicional a las APIs de Render/Neon más allá de lo que
//      ya generaba el panel).
//   2) Para cada servicio (render/neon) con un porcentaje de uso disponible,
//      determina si dispara 'advertencia' (≥85%) o 'critica' (≥90%) — ver
//      nivelAlertaDisparado() en infra-alert-thresholds.ts.
//   3) Por cada alerta disparada, revisa el cooldown de 24h en la tabla
//      infra_alert_cooldown (clave 'render:critica', 'neon:advertencia',
//      etc.) — si ya se avisó esa MISMA combinación servicio+nivel hace
//      menos de 24h, la omite (evita spam). Si no, envía Push a TODOS los
//      dispositivos del Súper Admin (enviarPushATodosLosSuperAdmins) Y un
//      mensaje al Bot de Telegram (enviarAlertaTelegram) — ambos canales,
//      siempre, si están disponibles — y registra el envío en
//      agent_audit_logs (auditoría,
//      mismo criterio que infraTelemetry.ts) además de actualizar el
//      cooldown.
//
// NUNCA LANZA ni interrumpe el arranque del servidor: cualquier error de
// una parte (por ejemplo, Render caído) no debe impedir que se evalúe la
// otra (Neon), y un fallo del job completo en un ciclo no debe impedir que
// el siguiente ciclo (2h después) se ejecute con normalidad — mismo patrón
// de guardas try/catch por partes que ya usa infraTelemetry.ts.
// ════════════════════════════════════════════════════════════════════════════
import { eq } from 'drizzle-orm';
import { db, infraAlertCooldown, agentAuditLogs } from '../db/index.js';
import { obtenerEstadoRecursos } from './resource-monitor.js';
import { enviarPushATodosLosSuperAdmins } from './push-provider.js';
import { enviarAlertaTelegram } from './telegram-alert.js';
import {
  nivelAlertaDisparado, claveCooldown, debeEnviarAlerta, construirMensajeAlerta, construirMensajeAlertaTelegramHtml,
  INTERVALO_JOB_ALERTAS_MS,
  type NivelAlertaCuota,
} from './infra-alert-thresholds.js';

// ────────────────────────────────────────────────────────────────────────
// Cooldown persistido (tabla infra_alert_cooldown) — ver comentario de
// cabecera en src/db/schema.ts sobre por qué esto vive en la base de datos
// y no solo en memoria.
// ────────────────────────────────────────────────────────────────────────
async function _obtenerUltimoEnvioMs(clave: string): Promise<number | null> {
  try {
    const filas = await db.select().from(infraAlertCooldown).where(eq(infraAlertCooldown.clave, clave));
    const fecha = filas[0]?.ultimoEnvioEn;
    return fecha ? new Date(fecha as any).getTime() : null;
  } catch (e: any) {
    console.error('[InfraAlertJob] No se pudo leer el cooldown de', clave, ':', e?.message || e);
    return null; // ante la duda, se permite enviar — mejor un aviso de más que dejar pasar un riesgo real de sobrecosto
  }
}

async function _registrarEnvio(clave: string, momento: Date): Promise<void> {
  try {
    await db.insert(infraAlertCooldown).values({ clave, ultimoEnvioEn: momento })
      .onConflictDoUpdate({ target: infraAlertCooldown.clave, set: { ultimoEnvioEn: momento } });
  } catch (e: any) {
    console.error('[InfraAlertJob] No se pudo registrar el cooldown de', clave, ':', e?.message || e);
  }
}

async function _registrarAuditoria(servicio: 'render' | 'neon', nivel: NivelAlertaCuota, pct: number, canalesOk: string[]): Promise<void> {
  try {
    await db.insert(agentAuditLogs).values({
      category: 'AlertasInfraestructura',
      issueDetected: `${servicio === 'render' ? 'Render (Outbound Bandwidth)' : 'Neon (Net Transfer)'} al ${pct}% de su cuota (${nivel === 'critica' ? 'crítico' : 'advertencia'}).`,
      actionTaken: canalesOk.length ? `Alerta enviada por: ${canalesOk.join(', ')}.` : 'No se pudo entregar por ningún canal (revisar configuración de Push/Telegram).',
      status: nivel === 'critica' ? 'Alerta' : 'Informativo',
      details: { servicio, nivel, porcentaje: pct, canalesOk },
    });
  } catch (e: any) {
    console.error('[InfraAlertJob] No se pudo registrar la auditoría:', e?.message || e);
  }
}

export interface ResultadoAlertaDisparada { servicio: 'render' | 'neon'; nivel: NivelAlertaCuota; porcentaje: number; canalesOk: string[]; omitidaPorCooldown: boolean }

/**
 * Evalúa Render y Neon y despacha las alertas que correspondan. Se expone
 * como función independiente (no solo dentro del setInterval) para que se
 * pueda invocar directamente desde las pruebas o, en el futuro, desde un
 * botón manual "Probar alertas ahora" sin tener que esperar 2 horas.
 */
export async function verificarYNotificarCuotas(): Promise<ResultadoAlertaDisparada[]> {
  const resultados: ResultadoAlertaDisparada[] = [];
  let estado;
  try {
    estado = await obtenerEstadoRecursos(false);
  } catch (e: any) {
    console.error('[InfraAlertJob] No se pudo obtener el estado de recursos:', e?.message || e);
    return resultados;
  }

  const candidatos: Array<{ servicio: 'render' | 'neon'; pct: number | null | undefined }> = [
    { servicio: 'render', pct: estado?.render?.bandwidth?.porcentajeUso },
    { servicio: 'neon', pct: estado?.neon?.transfer?.porcentajeUso },
  ];

  for (const { servicio, pct } of candidatos) {
    try {
      const nivel = nivelAlertaDisparado(pct);
      if (!nivel || pct === null || pct === undefined) continue;

      const clave = claveCooldown(servicio, nivel);
      const ultimoEnvioMs = await _obtenerUltimoEnvioMs(clave);
      const ahora = new Date();
      if (!debeEnviarAlerta(ultimoEnvioMs, ahora.getTime())) {
        resultados.push({ servicio, nivel, porcentaje: pct, canalesOk: [], omitidaPorCooldown: true });
        continue;
      }

      const { titulo, cuerpo } = construirMensajeAlerta(servicio, nivel, pct);
      const canalesOk: string[] = [];

      try {
        const r = await enviarPushATodosLosSuperAdmins(titulo, cuerpo, 'alerta-infraestructura');
        if (r.enviados > 0) canalesOk.push(`Push (${r.enviados}/${r.total} dispositivo(s))`);
      } catch (e: any) {
        console.error('[InfraAlertJob] Falló el envío Push:', e?.message || e);
      }

      try {
        const r = await enviarAlertaTelegram(construirMensajeAlertaTelegramHtml(servicio, nivel, pct));
        if (r.ok) canalesOk.push('Telegram');
      } catch (e: any) {
        console.error('[InfraAlertJob] Falló el envío de Telegram:', e?.message || e);
      }

      await _registrarEnvio(clave, ahora);
      await _registrarAuditoria(servicio, nivel, pct, canalesOk);
      resultados.push({ servicio, nivel, porcentaje: pct, canalesOk, omitidaPorCooldown: false });
    } catch (e: any) {
      // Un fallo evaluando UN servicio no debe impedir que se evalúe el otro.
      console.error(`[InfraAlertJob] Error evaluando alertas de ${servicio}:`, e?.message || e);
    }
  }

  return resultados;
}

let _jobIniciado = false;
export function iniciarJobAlertasInfraestructura(): void {
  if (_jobIniciado) return; // evita doble arranque si el servidor llama esto más de una vez
  _jobIniciado = true;
  // Primer chequeo a los 3 minutos de arrancar (deja que el resto del
  // servidor termine de inicializar), luego cada 2 horas — mismo patrón
  // (setTimeout inicial + setInterval) que infraTelemetry.ts (Ronda 49).
  setTimeout(() => {
    verificarYNotificarCuotas().catch((e) => console.error('[InfraAlertJob] Error en el primer chequeo:', e?.message || e));
    setInterval(() => {
      verificarYNotificarCuotas().catch((e) => console.error('[InfraAlertJob] Error en el chequeo periódico:', e?.message || e));
    }, INTERVALO_JOB_ALERTAS_MS);
  }, 3 * 60 * 1000);
}
