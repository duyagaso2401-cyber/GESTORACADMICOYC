// ════════════════════════════════════════════════════════════════════════════
// LOTE 1 — FEATURE FLAGS / ACTIVACIÓN DINÁMICA DE MÓDULOS OPCIONALES
// ------------------------------------------------------------------------------
// Los dos módulos grandes nuevos (Entidades Territoriales Certificadas /
// "ETC" y Universidades/Educación Superior) NO están activos por defecto en
// ninguna instalación — se piden explícitamente que permanezcan apagados
// hasta que el Súper Admin decida activarlos, y que mientras estén apagados
// no se toque Neon para nada relacionado con ellos (ni una consulta, ni una
// migración).
//
// Estos flags se pidieron con nombre de VARIABLE DE ENTORNO
// (ENABLE_ETC_CONTRACTING_MODULE / ENABLE_UNIVERSITIES_MODULE), pero el
// requisito también pide que el Súper Admin los prenda con un botón desde
// su panel, en caliente, sin necesitar un redeploy en Render (que sí haría
// falta si fueran variables de entorno de verdad). Por eso este archivo
// implementa un diseño híbrido, documentado aquí de forma transparente:
//
//   1) El interruptor REAL y DINÁMICO vive en gestorDB.featureFlags (el
//      mismo blob JSON en kv_store, clave GESTOR_SK, donde ya viven
//      sincronizacionAutomatica/autoGuardarHabilitado/pantallaBlanca — ver
//      src/lib/gestor-cache.ts) bajo las claves EXACTAS que se pidieron
//      (ENABLE_ETC_CONTRACTING_MODULE / ENABLE_UNIVERSITIES_MODULE), en
//      false por defecto. El botón del Súper Admin activa este flag DESPUÉS
//      de que la migración SQL específica de ese módulo termine sin error
//      (ver activarFlagEnGestorDB(), abajo, llamada solo desde los
//      endpoints POST /api/superadmin/activar-modulo-etc/universidades en
//      src/index.ts) — así nunca queda un flag "encendido" con tablas que
//      no llegaron a crearse.
//   2) Adicionalmente, para dar también la posibilidad de un apagado de
//      emergencia a nivel de infraestructura (sin depender de que alguien
//      entre al panel), si el operador SÍ define la variable de entorno
//      real en Render con el valor 'false' (o '0'), eso actúa como un
//      "kill switch" que fuerza el módulo a apagado sin importar lo que
//      diga gestorDB — pero NUNCA lo enciende por sí sola: solo puede
//      forzar a false, jamás a true. Si la variable de entorno no está
//      definida (el caso normal), no bloquea nada y todo el control real
//      queda en manos del interruptor dinámico del Súper Admin, tal como
//      se pidió.
//
// moduloHabilitado()/checkModuleEnabled() son el ÚNICO punto que el resto
// del backend debe usar para decidir si un módulo está activo — igual
// filosofía de centralización que _sincronizacionAutoHabilitadaAhora()/
// _debeSincronizarEnSegundoPlano() en el frontend (03-app-core.js): un
// solo lugar que ningún endpoint nuevo pueda "olvidar" revisar.
// ════════════════════════════════════════════════════════════════════════════
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { kvStore } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { obtenerGestorDBCacheado, invalidarCacheGestorDB } from './gestor-cache.js';

const GESTOR_SK = '__gestor_academico_yc__';

export const MODULOS_DINAMICOS = {
  ETC_CONTRACTING: 'ENABLE_ETC_CONTRACTING_MODULE',
  UNIVERSITIES: 'ENABLE_UNIVERSITIES_MODULE',
} as const;

export type ModuloDinamico = keyof typeof MODULOS_DINAMICOS;

function _bloqueadoPorVariableDeEntorno(nombreModulo: ModuloDinamico): boolean {
  const envKey = MODULOS_DINAMICOS[nombreModulo];
  const val = process.env[envKey];
  return val === 'false' || val === '0';
}

// Consulta el estado REAL de un módulo (gestorDB.featureFlags, con caché
// compartida de 8s — ver gestor-cache.ts — más el kill-switch de entorno).
export async function moduloHabilitado(nombreModulo: ModuloDinamico): Promise<boolean> {
  if (_bloqueadoPorVariableDeEntorno(nombreModulo)) return false;
  try {
    const gestorDB = await obtenerGestorDBCacheado();
    const flags = (gestorDB && gestorDB.featureFlags) || {};
    return flags[MODULOS_DINAMICOS[nombreModulo]] === true;
  } catch {
    // Ante cualquier error de esta verificación, se falla CERRADO (módulo
    // apagado) — a diferencia de verificarEstadoInstitucion() en
    // gestor-cache.ts (que falla abierto porque es un candado ADICIONAL
    // sobre un sistema que ya existe); aquí, si no se puede confirmar que
    // el módulo está activo, lo correcto es tratarlo como si no lo
    // estuviera, para nunca exponer endpoints de un módulo cuyas tablas
    // podrían no existir todavía.
    return false;
  }
}

// Middleware Express reutilizable: se monta en TODAS las rutas de cada
// módulo nuevo (ver src/routes/etc.ts y src/routes/educacion-superior.ts).
// Responde exactamente "403 / Módulo no activado" tal como se pidió.
export function checkModuleEnabled(nombreModulo: ModuloDinamico) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const habilitado = await moduloHabilitado(nombreModulo);
      if (!habilitado) {
        return res.status(403).json({ error: 'Módulo no activado', modulo: MODULOS_DINAMICOS[nombreModulo] });
      }
      return next();
    } catch (e) {
      console.error('checkModuleEnabled', nombreModulo, e);
      return res.status(403).json({ error: 'Módulo no activado' });
    }
  };
}

// Enciende el flag en gestorDB — se llama SOLO desde los endpoints de
// activación (src/index.ts), y SOLO después de que la migración SQL del
// módulo correspondiente ya terminó sin lanzar ninguna excepción. Deja,
// además, una marca de auditoría de cuándo se activó por primera vez (sin
// pisarla si ya existía, para conservar la fecha real de la primera
// activación aunque el módulo se desactive/reactive después).
export async function activarFlagEnGestorDB(nombreModulo: ModuloDinamico): Promise<void> {
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
  const gestorDB: any = rows[0]?.value ? { ...rows[0].value } : {};
  gestorDB.featureFlags = { ...(gestorDB.featureFlags || {}) };
  const flagKey = MODULOS_DINAMICOS[nombreModulo];
  gestorDB.featureFlags[flagKey] = true;
  if (!gestorDB.featureFlags[flagKey + '_ACTIVADO_EN']) {
    gestorDB.featureFlags[flagKey + '_ACTIVADO_EN'] = new Date().toISOString();
  }
  const nowTs = new Date();
  await db
    .insert(kvStore)
    .values({ key: GESTOR_SK, value: gestorDB, updatedAt: nowTs })
    .onConflictDoUpdate({ target: kvStore.key, set: { value: gestorDB, updatedAt: nowTs } });
  invalidarCacheGestorDB();
}

// Apaga el flag (uso futuro: un botón de "Desactivar" — no pedido en el
// Lote 1, pero se deja lista la función simétrica para no tener que volver
// a tocar este archivo más adelante). NO borra las tablas ni los datos ya
// creados — desactivar solo oculta el módulo y bloquea sus endpoints de
// nuevo, nunca destruye información.
export async function desactivarFlagEnGestorDB(nombreModulo: ModuloDinamico): Promise<void> {
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
  const gestorDB: any = rows[0]?.value ? { ...rows[0].value } : {};
  gestorDB.featureFlags = { ...(gestorDB.featureFlags || {}) };
  gestorDB.featureFlags[MODULOS_DINAMICOS[nombreModulo]] = false;
  const nowTs = new Date();
  await db
    .insert(kvStore)
    .values({ key: GESTOR_SK, value: gestorDB, updatedAt: nowTs })
    .onConflictDoUpdate({ target: kvStore.key, set: { value: gestorDB, updatedAt: nowTs } });
  invalidarCacheGestorDB();
}

// ════════════════════════════════════════════════════════════════════════════
// "FLAGS SIMPLES" — igual mecanismo (gestorDB.featureFlags + kill-switch de
// entorno) que los MODULOS_DINAMICOS de arriba, pero para un interruptor
// que NO gatea un router completo ni dispara ninguna migración SQL propia
// — por eso no vive en el enum ModuloDinamico/MODULOS_DINAMICOS (eso sigue
// siendo exclusivo de checkModuleEnabled()/ensureSchema*()). Se agregó
// para ENABLE_SMS_NOTIFICATIONS (arquitectura de notificaciones
// multicanal — ver src/lib/sms-provider.ts): un simple sí/no global sobre
// si el sistema PUEDE intentar enviar SMS, sin tocar ninguna tabla nueva.
// Cualquier interruptor global futuro que no necesite su propia migración
// puede reutilizar estas dos funciones en vez de duplicar este patrón.
export async function flagSimpleHabilitado(clave: string): Promise<boolean> {
  const val = process.env[clave];
  if (val === 'false' || val === '0') return false;
  try {
    const gestorDB = await obtenerGestorDBCacheado();
    const flags = (gestorDB && gestorDB.featureFlags) || {};
    return flags[clave] === true;
  } catch {
    return false;
  }
}

export async function establecerFlagSimpleEnGestorDB(clave: string, valor: boolean): Promise<void> {
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
  const gestorDB: any = rows[0]?.value ? { ...rows[0].value } : {};
  gestorDB.featureFlags = { ...(gestorDB.featureFlags || {}) };
  gestorDB.featureFlags[clave] = valor;
  const nowTs = new Date();
  await db
    .insert(kvStore)
    .values({ key: GESTOR_SK, value: gestorDB, updatedAt: nowTs })
    .onConflictDoUpdate({ target: kvStore.key, set: { value: gestorDB, updatedAt: nowTs } });
  invalidarCacheGestorDB();
}
