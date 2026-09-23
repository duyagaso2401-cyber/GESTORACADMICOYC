// ════════════════════════════════════════════════════════════════════════════
// RONDA 49 — LÓGICA PURA DE UMBRALES DE INFRAESTRUCTURA (sin dependencias
// externas, solo módulos nativos de Node) + medición de disco.
// ------------------------------------------------------------------------------
// Se separó deliberadamente de src/services/infraTelemetry.ts (que sí
// importa drizzle-orm, el pool de Postgres y el motor de correo) para que
// esta parte — la que decide qué es "preventiva" o "crítica", y la
// medición real de disco — se pueda probar con ejecución real de forma
// aislada, sin necesitar una base de datos ni node_modules instalados (ver
// test_ronda49_telemetria_infraestructura.mjs, que hace `import()` dinámico
// de ESTE archivo, no del que depende de drizzle-orm).
// ════════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const UMBRAL_PREVENTIVO_PCT = 80;
export const UMBRAL_CRITICO_PCT = 90;
export const UMBRAL_POOL_SATURADO_PCT = 90;
export const INTERVALO_MONITOREO_MS = 15 * 60 * 1000; // 15 minutos, tal como se pidió

export function redondear(n: number, decimales = 1): number {
  const factor = Math.pow(10, decimales);
  return Math.round((Number(n) || 0) * factor) / factor;
}

export function formatearBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let valor = bytes;
  while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i++; }
  return `${redondear(valor, 2)} ${unidades[i]}`;
}

export interface MedicionDisco { totalBytes: number; libreBytes: number; usadoBytes: number; porcentajeUso: number; metodo: 'fs.statfs' | 'df' | 'no-disponible' }

/**
 * Método primario: `fs.promises.statfs` (nativo desde Node ≥18.15/19.6 —
 * el Dockerfile de este proyecto usa `node:20-alpine`, así que está
 * disponible en el entorno de despliegue real). Fallback: `df -k` vía
 * `child_process` (comando POSIX estándar, sin dependencias nuevas,
 * presente incluso en la imagen Alpine vía BusyBox).
 */
export async function medirDisco(ruta: string): Promise<MedicionDisco> {
  try {
    if (typeof (fs.promises as any).statfs === 'function') {
      const s: any = await (fs.promises as any).statfs(ruta);
      const totalBytes = Number(s.blocks) * Number(s.bsize);
      const libreBytes = Number(s.bavail) * Number(s.bsize); // bavail (disponible para no-root), más representativo que bfree
      const usadoBytes = Math.max(0, totalBytes - libreBytes);
      const porcentajeUso = totalBytes > 0 ? redondear((usadoBytes / totalBytes) * 100, 1) : 0;
      return { totalBytes, libreBytes, usadoBytes, porcentajeUso, metodo: 'fs.statfs' };
    }
  } catch {
    // Cae al fallback de abajo.
  }
  try {
    const { stdout } = await execAsync(`df -k "${ruta.replace(/"/g, '')}" | tail -1`);
    const partes = stdout.trim().split(/\s+/);
    // Formato típico de `df -k`: Filesystem 1K-blocks Used Available Use% Mounted
    const totalKb = Number(partes[1]);
    const usadoKb = Number(partes[2]);
    const libreKb = Number(partes[3]);
    if (Number.isFinite(totalKb) && totalKb > 0) {
      const totalBytes = totalKb * 1024;
      const usadoBytes = usadoKb * 1024;
      const libreBytes = libreKb * 1024;
      const porcentajeUso = redondear((usadoBytes / totalBytes) * 100, 1);
      return { totalBytes, libreBytes, usadoBytes, porcentajeUso, metodo: 'df' };
    }
  } catch {
    // Ambos métodos fallaron — se documenta como "no-disponible", nunca se lanza.
  }
  return { totalBytes: 0, libreBytes: 0, usadoBytes: 0, porcentajeUso: 0, metodo: 'no-disponible' };
}

export type NivelAlerta = 'ok' | 'preventiva' | 'critica';
export interface AlertaInfraestructura {
  area: 'ram' | 'disco' | 'conexiones';
  nivel: NivelAlerta;
  porcentaje: number;
  mensaje: string;
  sugerencia: string;
}

export interface TelemetriaInfraestructura {
  timestamp: string;
  ram: { totalBytes: number; libreBytes: number; usadoBytes: number; porcentajeUso: number; totalLegible: string; usadoLegible: string };
  cpu: { nucleos: number; loadAvg1: number; loadAvg5: number; loadAvg15: number; porcentajeCargaAprox: number };
  disco: { ruta: string; totalBytes: number; libreBytes: number; usadoBytes: number; porcentajeUso: number; metodo: string; totalLegible: string; usadoLegible: string };
  baseDatos: { poolAplicacion: { total: number; inactivas: number; esperando: number; max: number; porcentajeUso: number }; conexionesPgStatActivity: number | null; tamanoBytes: number | null; tamanoLegible: string };
  uptimeProcesoSegundos: number;
  uptimeServidorSegundos: number;
}

function _nivelPorPorcentaje(pct: number): NivelAlerta {
  if (pct >= UMBRAL_CRITICO_PCT) return 'critica';
  if (pct >= UMBRAL_PREVENTIVO_PCT) return 'preventiva';
  return 'ok';
}

/**
 * Evalúa los 3 umbrales (RAM, Disco, conexiones del pool de la aplicación)
 * sobre una telemetría ya recolectada. Función PURA (no hace I/O ni
 * depende de nada externo), para poder probarla con ejecución real y
 * datos simulados. CPU/Load Average se muestra como KPI informativo pero
 * NO participa aquí (ver comentario extenso de decisiones de ingeniería en
 * src/services/infraTelemetry.ts, punto 3).
 */
export function evaluarAlertas(t: TelemetriaInfraestructura): AlertaInfraestructura[] {
  const alertas: AlertaInfraestructura[] = [];

  const nivelRam = _nivelPorPorcentaje(t.ram.porcentajeUso);
  if (nivelRam !== 'ok') {
    alertas.push({
      area: 'ram', nivel: nivelRam, porcentaje: t.ram.porcentajeUso,
      mensaje: `⚠️ ALERTA DE MEMORIA RAM: el uso está al ${t.ram.porcentajeUso}%.`,
      sugerencia: nivelRam === 'critica'
        ? 'Reinicie el servicio (docker compose restart backend) para liberar memoria acumulada, y considere aumentar la RAM del VPS si esto se repite seguido.'
        : 'Vigile la tendencia — si sigue subiendo, planee un reinicio del servicio o un aumento de RAM antes de que llegue al 90%.',
    });
  }

  const nivelDisco = t.disco.metodo === 'no-disponible' ? 'ok' : _nivelPorPorcentaje(t.disco.porcentajeUso);
  if (nivelDisco !== 'ok') {
    alertas.push({
      area: 'disco', nivel: nivelDisco, porcentaje: t.disco.porcentajeUso,
      mensaje: `⚠️ ALERTA DE DISCO: el almacenamiento está al ${t.disco.porcentajeUso}%.`,
      sugerencia: nivelDisco === 'critica'
        ? 'Ejecute la limpieza de respaldos antiguos desde el panel, o borre archivos temporales/logs viejos del servidor — el disco lleno puede impedir que la aplicación guarde datos nuevos.'
        : 'Revise si hay respaldos o logs antiguos que pueda limpiar pronto, antes de llegar al 90%.',
    });
  }

  const pctPool = t.baseDatos.poolAplicacion.porcentajeUso;
  const nivelConexiones: NivelAlerta = pctPool >= UMBRAL_POOL_SATURADO_PCT ? 'critica' : (pctPool >= UMBRAL_PREVENTIVO_PCT ? 'preventiva' : 'ok');
  if (nivelConexiones !== 'ok') {
    alertas.push({
      area: 'conexiones', nivel: nivelConexiones, porcentaje: pctPool,
      mensaje: `⚠️ ALERTA DE CONEXIONES A LA BASE DE DATOS: el pool está al ${pctPool}% de su máximo (${t.baseDatos.poolAplicacion.total}/${t.baseDatos.poolAplicacion.max}).`,
      sugerencia: nivelConexiones === 'critica'
        ? 'Las conexiones a la base de datos están casi agotadas — revise si hay consultas colgadas o un pico de tráfico inusual; reiniciar el servicio libera las conexiones abiertas.'
        : 'El uso de conexiones está alto — vigile si sigue subiendo antes de que se agoten por completo.',
    });
  }

  return alertas;
}
