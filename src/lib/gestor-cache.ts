// ════════════════════════════════════════════════════════════════════════════
// CACHÉ COMPARTIDA DE LA LISTA DE INSTITUCIONES DEL SÚPER ADMIN (gestorDB)
// ------------------------------------------------------------------------------
// gestorDB.platforms (guardada en kv_store bajo la clave GESTOR_SK) es la
// fuente de verdad de si una institución está activa/bloqueada/con
// "Pantalla en Blanco" — tanto el sistema K-12 (src/index.ts) como el
// universitario (src/routes/university.ts) necesitan consultarla, y AMBOS
// la consultan en CADA petición (no solo al iniciar sesión), para que un
// cambio del Súper Admin corte el acceso de inmediato aunque alguien ya
// tenga una sesión abierta.
//
// Consultar la base de datos en cada una de esas peticiones —incluida la
// más frecuente de todo el sistema, GET/POST /api/inetis/db, que se llama
// constantemente por el guardado automático y la sincronización periódica—
// duplicaría innecesariamente la carga de lectura sobre Neon. Por eso se
// comparte AQUÍ una caché en memoria muy corta (unos segundos): el cambio
// de un candado del Súper Admin no necesita reflejarse en menos de un
// segundo, y de todas formas se invalida al instante en cuanto el propio
// Súper Admin guarda un cambio (ver invalidarCacheGestorDB(), llamada
// desde POST /api/inetis/gestordb en src/index.ts).
// ════════════════════════════════════════════════════════════════════════════
import { db } from '../db/index.js';
import { kvStore } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const GESTOR_SK = '__gestor_academico_yc__';
const CACHE_TTL_MS = 8000; // 8s: imperceptible para el uso normal, evita duplicar la carga de lectura en los endpoints más usados del sistema

let _cache: { data: any; ts: number } | null = null;

export async function obtenerGestorDBCacheado(): Promise<any | null> {
  const ahora = Date.now();
  if (_cache && (ahora - _cache.ts) < CACHE_TTL_MS) return _cache.data;
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
  const data = rows.length ? rows[0].value : null;
  _cache = { data, ts: ahora };
  return data;
}

// Se llama justo después de que el Súper Admin guarda cualquier cambio en
// su lista de instituciones (activar, bloquear, pantalla en blanco,
// sincronización, editar, eliminar, etc.) para que el efecto sea
// INMEDIATO en vez de esperar hasta 8 segundos a que la caché expire sola.
export function invalidarCacheGestorDB(): void {
  _cache = null;
}

// Encuentra la ficha de una institución por su "sk" — soporta también los
// "sk" de años históricos archivados (sufijo "_hist_<año>"), que comparten
// las mismas banderas de la institución "base".
export async function leerFichaPlataformaGestor(sk: string): Promise<any | null> {
  const baseSk = String(sk || '').replace(/_hist_.*/, '');
  if (!baseSk) return null;
  const gestorDB = await obtenerGestorDBCacheado();
  if (!gestorDB) return null;
  return (gestorDB.platforms || []).find((p: any) => p.sk === baseSk) || null;
}

export interface EstadoInstitucion {
  ok: boolean;
  motivo?: string;
  institucionPausada?: boolean;
  pantallaBlancaActiva?: boolean;
}

// Verificación genérica (activa / bloqueada / pantalla en blanco), contra
// el registro REAL del Súper Admin — no algo que el cliente pueda alterar.
// Si la institución no aparece en la lista (por ejemplo, un "sk" que no
// corresponde a ninguna plataforma registrada, o gestorDB aún no
// inicializada), se deja pasar: esta verificación es un candado adicional,
// no el mecanismo de identidad/existencia de la institución.
export async function verificarEstadoInstitucion(sk: string): Promise<EstadoInstitucion> {
  try {
    const plat = await leerFichaPlataformaGestor(sk);
    if (!plat) return { ok: true };
    if (plat.activa === false) {
      return { ok: false, motivo: 'Esta institución está suspendida por el administrador del sistema.', institucionPausada: true };
    }
    if (plat.bloqueada) {
      return { ok: false, motivo: 'Esta institución está bloqueada por el administrador del sistema.', institucionPausada: true };
    }
    if (plat.pantallaBlanca) {
      return { ok: false, motivo: 'Acceso desactivado por el administrador del sistema.', pantallaBlancaActiva: true };
    }
    return { ok: true };
  } catch {
    // Ante un error de esta verificación puntual, no se tumba todo el
    // sistema — se deja pasar (igual filosofía que ya tenía university.ts).
    return { ok: true };
  }
}
