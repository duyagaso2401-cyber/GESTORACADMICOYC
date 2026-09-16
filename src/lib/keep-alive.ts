// ════════════════════════════════════════════════════════════════════════════
// KEEP-ALIVE INTELIGENTE (optimización para Render, plan gratuito/hobby)
// ------------------------------------------------------------------------------
// Render suspende el contenedor cuando pasa un tiempo sin recibir peticiones
// HTTP entrantes — la próxima persona que entre paga un "arranque en frío" de
// varios segundos o minutos. La forma estándar de evitarlo es que el propio
// servidor se haga una petición HTTP a sí mismo (a GET /api/health, ya
// existente) de vez en cuando: para Render eso cuenta exactamente igual que
// una visita real, así que el contenedor nunca se considera "inactivo".
//
// La parte "inteligente" (pedida explícitamente) es que la frecuencia de ese
// auto-ping se ADAPTA a la actividad real de la plataforma en vez de ser fija:
//   • Si hubo actividad real hace poco (alguien guardó una nota, una
//     planilla, una asistencia — ver registrarActividadPlataforma(), que
//     POST /api/inetis/db llama en cada guardado exitoso) → auto-ping cada
//     15 minutos: son las horas en que de verdad importa que el servidor no
//     se duerma.
//   • Si NO hay actividad reciente pero sigue siendo horario "activo" del
//     día (fuera de la ventana de madrugada configurada) → cada 30 minutos.
//   • Si además cae dentro de la ventana de madrugada/inactividad prolongada
//     (por defecto 12:00 a.m.–5:00 a.m., hora de Colombia) → el intervalo se
//     espacia hasta 2 horas (o se pausa del todo, según
//     KEEP_ALIVE_MODO_MADRUGADA), para no generar tráfico de red innecesario
//     contra Render en las horas en que nadie va a notar ni a sufrir un
//     arranque en frío ocasional.
//
// No agrega ninguna dependencia nueva: usa el "fetch" nativo de Node (ya
// disponible desde Node 18, la misma versión que ya exige este proyecto) y
// un temporizador simple (setInterval), siguiendo el mismo patrón que ya
// usan iniciarRespaldosAutomaticosProgramados()/iniciarTareasAutonomasProgramadas()
// en src/index.ts — ningún runner nuevo tipo "node-cron" hacía falta para
// esto, exactamente igual que en esos dos mecanismos ya existentes.
// ════════════════════════════════════════════════════════════════════════════

const VENTANA_INACTIVA_INICIO_HORA = parseInt(process.env.KEEP_ALIVE_MADRUGADA_INICIO || '0', 10);   // 12:00 a.m.
const VENTANA_INACTIVA_FIN_HORA    = parseInt(process.env.KEEP_ALIVE_MADRUGADA_FIN    || '5', 10);   // 5:00 a.m.
const MODO_MADRUGADA = (process.env.KEEP_ALIVE_MODO_MADRUGADA || 'espaciar').trim(); // 'espaciar' | 'pausar'
const ACTIVIDAD_RECIENTE_MIN_MS = 30 * 60 * 1000;      // últimos 30 min = "hay actividad"
const INTERVALO_ACTIVO_MS       = 15 * 60 * 1000;      // 15 min con actividad reciente
const INTERVALO_SIN_ACTIVIDAD_MS = 30 * 60 * 1000;     // 30 min sin actividad, pero en horario normal
const INTERVALO_MADRUGADA_MS    = 2 * 60 * 60 * 1000;  // 2 horas en ventana de madrugada sin actividad
const TICK_MS = 5 * 60 * 1000; // revisa cada 5 min si ya toca hacer el siguiente auto-ping

let _ultimaActividadGlobalAt = 0;
const _ultimaActividadPorSk = new Map<string, number>();
let _ultimoAutoPingAt = 0;
let _tickTimer: ReturnType<typeof setInterval> | null = null;

/** Llamado desde POST /api/inetis/db (y puede llamarse desde cualquier otro endpoint de escritura real) cada vez que hay un guardado exitoso. */
export function registrarActividadPlataforma(sk?: string): void {
  const ahora = Date.now();
  _ultimaActividadGlobalAt = ahora;
  if (sk) _ultimaActividadPorSk.set(sk, ahora);
}

function _horaColombia(): number {
  try {
    // "America/Bogota" no tiene horario de verano — es un offset fijo (UTC-5),
    // pero se usa Intl para no hardcodear el offset y que siga siendo correcto
    // si Node corre en cualquier zona horaria del contenedor de despliegue.
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false });
    return parseInt(fmt.format(new Date()), 10) % 24;
  } catch {
    return new Date().getUTCHours(); // fallback si el runtime no tiene datos de zona horaria (raro)
  }
}

function _enVentanaMadrugada(): boolean {
  const h = _horaColombia();
  if (VENTANA_INACTIVA_INICIO_HORA <= VENTANA_INACTIVA_FIN_HORA) {
    return h >= VENTANA_INACTIVA_INICIO_HORA && h < VENTANA_INACTIVA_FIN_HORA;
  }
  // Ventana que cruza medianoche (ej. 22 → 6)
  return h >= VENTANA_INACTIVA_INICIO_HORA || h < VENTANA_INACTIVA_FIN_HORA;
}

/** Resumen liviano usado por GET /api/health (sin tocar Neon) y por el propio auto-ping. */
export function estadoActividadReciente(): { actividadReciente: boolean; minutosDesdeUltimaActividad: number | null; ventanaMadrugada: boolean } {
  const ahora = Date.now();
  const minutos = _ultimaActividadGlobalAt ? Math.round((ahora - _ultimaActividadGlobalAt) / 60000) : null;
  return {
    actividadReciente: !!_ultimaActividadGlobalAt && (ahora - _ultimaActividadGlobalAt) <= ACTIVIDAD_RECIENTE_MIN_MS,
    minutosDesdeUltimaActividad: minutos,
    ventanaMadrugada: _enVentanaMadrugada(),
  };
}

function _intervaloVigenteMs(): number {
  const { actividadReciente } = estadoActividadReciente();
  if (actividadReciente) return INTERVALO_ACTIVO_MS;
  if (_enVentanaMadrugada()) return INTERVALO_MADRUGADA_MS;
  return INTERVALO_SIN_ACTIVIDAD_MS;
}

function _urlAutoPing(): string | null {
  // Render define automáticamente RENDER_EXTERNAL_URL con la URL pública real
  // del servicio — es la forma más confiable de auto-referenciarse sin tener
  // que configurar nada a mano. KEEP_ALIVE_SELF_URL permite forzar otra URL
  // (por ejemplo si se despliega en otro proveedor sin esa variable).
  const base = (process.env.KEEP_ALIVE_SELF_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!base) return null; // en local (sin Render) simplemente no hay nada que auto-pingear
  return base.replace(/\/+$/, '') + '/api/health';
}

async function _tick(): Promise<void> {
  if (_enVentanaMadrugada() && MODO_MADRUGADA === 'pausar' && !estadoActividadReciente().actividadReciente) {
    return; // "Silencio en Inactividad": ni siquiera se intenta el auto-ping
  }
  const intervalo = _intervaloVigenteMs();
  const ahora = Date.now();
  if (ahora - _ultimoAutoPingAt < intervalo) return; // aún no toca
  const url = _urlAutoPing();
  if (!url) return; // sin URL pública configurada (desarrollo local) — no hay nada que hacer
  _ultimoAutoPingAt = ahora;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    await fetch(url, { signal: ctrl.signal }).catch(() => {});
    clearTimeout(timeout);
  } catch {
    // Un auto-ping fallido no es un error del sistema — se reintenta en el
    // siguiente ciclo, sin alarmar en los logs de producción.
  }
}

/** Arranca el temporizador de Keep-Alive Inteligente — llamar una sola vez al iniciar el servidor. */
export function iniciarKeepAliveInteligente(): void {
  if (_tickTimer) return; // idempotente — evita duplicar el temporizador si algo lo llama dos veces
  _tickTimer = setInterval(() => { _tick().catch(() => {}); }, TICK_MS);
  // Primer chequeo casi inmediato (con un pequeño respiro para que el
  // servidor termine de levantar) en vez de esperar los 5 minutos del tick.
  setTimeout(() => { _tick().catch(() => {}); }, 15000);
}
