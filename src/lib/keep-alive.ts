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
// RONDA 24 — HORARIO ADAPTATIVO SEGÚN LA VENTANA OPERATIVA REAL DE LA
// INSTITUCIÓN (pedido explícito, reemplaza el esquema "por actividad
// detectada" que tenía este archivo desde la Ronda 17):
//   • VENTANA ACTIVA (trabajo docente/administrativo real, por defecto
//     2:00 p.m.–6:00 p.m. hora de Colombia): auto-ping cada 14 minutos —
//     con margen de sobra frente al tiempo de suspensión de Render (15
//     minutos en el plan gratuito), para que el servidor nunca llegue a
//     dormirse mientras hay actividad esperada.
//   • VENTANA DE REPOSO PROFUNDO (el resto del día, por defecto 6:00 p.m.–
//     2:00 p.m. del día siguiente): CERO auto-pings — el mecanismo no
//     genera ningún tráfico de red hacia Render en esas horas, dejando que
//     el servidor se suspenda solo si de verdad nadie lo usa. Si alguien sí
//     entra fuera de la ventana activa (una excepción real, no la regla),
//     esa misma visita ya cuenta como actividad para Render — el auto-ping
//     no es la única forma de mantenerlo despierto, solo evita pagar el
//     costo de red cuando se sabe de antemano que nadie va a estar ahí.
// Los 3 números (inicio/fin de la ventana activa e intervalo del ping) son
// configurables por variable de entorno sin tener que tocar código, por si
// la institución cambia su horario de trabajo.
//
// Qué se conserva de la versión anterior (Ronda 17), sin duplicar ni volver
// a implementar: registrarActividadPlataforma()/estadoActividadReciente()
// siguen existiendo con la misma firma — GET /api/health y POST
// /api/inetis/db (ver src/index.ts) los siguen llamando exactamente igual,
// sin necesidad de tocar esos archivos — solo que ahora son puramente
// informativos (quién quiera saber "¿hubo actividad hace poco?" lo sigue
// pudiendo consultar), y ya NO deciden la frecuencia del auto-ping: eso lo
// decide únicamente la ventana horaria de este archivo, tal como se pidió.
// Tampoco se agrega ninguna dependencia nueva: se sigue usando "fetch"
// nativo de Node y un temporizador simple (setInterval), igual que ya usan
// iniciarRespaldosAutomaticosProgramados()/iniciarTareasAutonomasProgramadas()
// en src/index.ts.
// ════════════════════════════════════════════════════════════════════════════

const VENTANA_ACTIVA_INICIO_HORA = parseInt(process.env.KEEP_ALIVE_ACTIVA_INICIO_HORA || '14', 10); // 2:00 p.m.
const VENTANA_ACTIVA_FIN_HORA    = parseInt(process.env.KEEP_ALIVE_ACTIVA_FIN_HORA    || '18', 10); // 6:00 p.m.
const INTERVALO_ACTIVO_MS = (parseInt(process.env.KEEP_ALIVE_INTERVALO_ACTIVO_MIN || '14', 10)) * 60 * 1000; // cada 14 min dentro de la ventana activa
const TICK_MS = 60 * 1000; // revisa cada minuto si toca hacer el siguiente auto-ping (sin red: solo lee el reloj) — da precisión de ±1 min sobre el intervalo de 14 min y sobre el arranque/apagado exacto de la ventana

let _ultimaActividadGlobalAt = 0;
const _ultimaActividadPorSk = new Map<string, number>();
let _ultimoAutoPingAt = 0;
let _tickTimer: ReturnType<typeof setInterval> | null = null;

/** Llamado desde POST /api/inetis/db (y puede llamarse desde cualquier otro endpoint de escritura real) cada vez que hay un guardado exitoso. Ronda 24: se conserva sin cambios de firma — sigue siendo información útil (para el panel de salud / diagnóstico), aunque ya no controla la frecuencia del auto-ping. */
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

/** true = hora actual (Colombia) dentro de la ventana operativa activa (por defecto 2:00 p.m.–6:00 p.m.). */
function _enVentanaActiva(): boolean {
  const h = _horaColombia();
  if (VENTANA_ACTIVA_INICIO_HORA <= VENTANA_ACTIVA_FIN_HORA) {
    return h >= VENTANA_ACTIVA_INICIO_HORA && h < VENTANA_ACTIVA_FIN_HORA;
  }
  // Ventana activa que cruzara medianoche (config no estándar) — se soporta igual, por completitud.
  return h >= VENTANA_ACTIVA_INICIO_HORA || h < VENTANA_ACTIVA_FIN_HORA;
}

/** Resumen liviano usado por GET /api/health (sin tocar Neon) y por el propio auto-ping. */
export function estadoActividadReciente(): { actividadReciente: boolean; minutosDesdeUltimaActividad: number | null; ventanaActiva: boolean; ventanaMadrugada: boolean } {
  const ahora = Date.now();
  const minutos = _ultimaActividadGlobalAt ? Math.round((ahora - _ultimaActividadGlobalAt) / 60000) : null;
  const ventanaActiva = _enVentanaActiva();
  return {
    actividadReciente: !!_ultimaActividadGlobalAt && (ahora - _ultimaActividadGlobalAt) <= 30 * 60 * 1000,
    minutosDesdeUltimaActividad: minutos,
    ventanaActiva,
    // "ventanaMadrugada" se conserva (mismo nombre de campo que antes de la
    // Ronda 24) por compatibilidad con quien ya estuviera leyendo este JSON
    // desde fuera (ej. un monitor externo) — ahora significa "fuera de la
    // ventana activa", que es la ventana de reposo profundo pedida.
    ventanaMadrugada: !ventanaActiva,
  };
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
  // Ronda 24 — regla central pedida: fuera de la ventana activa, CERO pings,
  // sin excepción y sin ninguna otra condición (ni actividad reciente, ni
  // nada) que pueda reactivarlo — es una "ventana de reposo profundo" real.
  if (!_enVentanaActiva()) return;
  const ahora = Date.now();
  if (ahora - _ultimoAutoPingAt < INTERVALO_ACTIVO_MS) return; // aún no toca (cada 14 min dentro de la ventana)
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
  // servidor termine de levantar) en vez de esperar el primer TICK_MS —
  // sigue sin hacer ningún ping si en ese momento no toca (fuera de la
  // ventana activa, o dentro de ella pero aún no pasan los 14 min).
  setTimeout(() => { _tick().catch(() => {}); }, 15000);
}
