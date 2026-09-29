// ════════════════════════════════════════════════════════════════════════════
// RONDA 88 — LÓGICA PURA DEL MÓDULO DE MONITOREO DE RECURSOS Y CUOTAS
// (Render API & Neon API), sin dependencias externas (solo lo que ya expone
// src/lib/infra-thresholds.ts, que tampoco depende de nada externo).
// ------------------------------------------------------------------------------
// Se separa deliberadamente de src/lib/resource-monitor.ts (que sí hace
// I/O: llamadas HTTP a api.render.com / api.neon.tech y lectura de
// process.env) siguiendo EXACTAMENTE el mismo criterio ya usado en la
// Ronda 49 para infra-thresholds.ts vs. services/infraTelemetry.ts: la
// parte que decide "qué porcentaje es preventivo/crítico" y la que
// interpreta formas de respuesta ambiguas de una API externa se puede
// probar con ejecución real y datos simulados, sin necesitar credenciales
// reales de Render/Neon ni node_modules instalados.
//
// DECISIÓN DE UMBRALES: se reutilizan los MISMOS umbrales ya usados en todo
// el panel de Súper Admin (80% preventivo/ámbar, 90% crítico/rojo — ver
// UMBRAL_PREVENTIVO_PCT/UMBRAL_CRITICO_PCT en infra-thresholds.ts y
// _colorPorPorcentaje() en 03-app-core.js), en vez de inventar una escala
// nueva solo para este módulo. Esto también coincide con lo pedido por el
// usuario para Render ("alerta en rojo si excede el 80%" — aquí eso cae en
// nivel "crítica" solo a partir de 90%, y "preventiva"/ámbar ya desde 80%,
// que es un criterio ligeramente más conservador/seguro que lo pedido
// literalmente, documentado aquí de forma transparente).
// ════════════════════════════════════════════════════════════════════════════
import { redondear, UMBRAL_PREVENTIVO_PCT, UMBRAL_CRITICO_PCT } from './infra-thresholds.js';

export { redondear, formatearBytes, UMBRAL_PREVENTIVO_PCT, UMBRAL_CRITICO_PCT } from './infra-thresholds.js';

export type NivelCuota = 'ok' | 'preventiva' | 'critica';

/** Porcentaje de uso de una cuota, protegido contra límite 0/negativo/NaN
 * (que de otro modo produciría Infinity o NaN y rompería el widget). */
export function calcularPorcentaje(usadoBytes: number | null, limiteBytes: number): number | null {
  if (usadoBytes === null || usadoBytes === undefined || !Number.isFinite(usadoBytes)) return null;
  if (!Number.isFinite(limiteBytes) || limiteBytes <= 0) return null;
  return redondear((usadoBytes / limiteBytes) * 100, 1);
}

export function nivelPorPorcentaje(pct: number | null): NivelCuota {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'ok';
  if (pct >= UMBRAL_CRITICO_PCT) return 'critica';
  if (pct >= UMBRAL_PREVENTIVO_PCT) return 'preventiva';
  return 'ok';
}

/** Normaliza el campo "suspended" de un servicio de Render: la API lo ha
 * expuesto históricamente como string ('suspended'/'not_suspended') en
 * algunas versiones y como booleano en otras — se acepta cualquiera de las
 * dos formas para no depender de una versión exacta de su esquema. */
export function estaServicioSuspendido(valorSuspended: unknown): boolean {
  if (typeof valorSuspended === 'boolean') return valorSuspended;
  if (typeof valorSuspended === 'string') return valorSuspended.toLowerCase() === 'suspended';
  return false;
}

/**
 * Recorre recursivamente un objeto/array de respuesta JSON y suma todos los
 * valores numéricos encontrados bajo una clave cuyo nombre coincide con
 * `patronNombreCampo` (case-insensitive).
 *
 * POR QUÉ EXISTE: ni la Render API ni la Neon API documentan públicamente,
 * de forma estable y con ejemplos completos de payload, la forma EXACTA de
 * anidamiento de sus respuestas de métricas de consumo (ver comentarios de
 * cabecera en resource-monitor.ts) — sí se confirmó, buscando en su
 * documentación oficial, el NOMBRE de los campos relevantes
 * (`public_network_transfer_bytes`/`private_network_transfer_bytes` en
 * Neon; un valor de bytes de ancho de banda en Render). En vez de
 * codificar una ruta de acceso rígida (`body.data[0].values...`) que se
 * rompería silenciosamente ante cualquier cambio menor de anidamiento, se
 * usa esta búsqueda tolerante: si el campo existe en CUALQUIER nivel del
 * JSON devuelto, se encuentra y se suma. Si no aparece en absoluto (porque
 * la API cambió el nombre del campo, o la cuenta no tiene datos ese mes),
 * devuelve null — nunca inventa un número.
 */
export function sumarCamposNumericos(obj: unknown, patronNombreCampo: RegExp, _visto = new WeakSet<object>()): number | null {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return null;
  if (_visto.has(obj as object)) return null; // por si acaso hubiera referencias circulares
  _visto.add(obj as object);

  let total: number | null = null;
  const acumular = (n: number) => { total = (total === null ? 0 : total) + n; };

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const sub = sumarCamposNumericos(item, patronNombreCampo, _visto);
      if (sub !== null) acumular(sub);
    }
    return total;
  }

  for (const [clave, valor] of Object.entries(obj as Record<string, unknown>)) {
    if (patronNombreCampo.test(clave) && typeof valor === 'number' && Number.isFinite(valor)) {
      acumular(valor);
    } else if (valor && typeof valor === 'object') {
      const sub = sumarCamposNumericos(valor, patronNombreCampo, _visto);
      if (sub !== null) acumular(sub);
    }
  }
  return total;
}

export const CACHE_RECURSOS_TTL_MS = 20 * 60 * 1000; // 20 minutos — dentro del rango 15-30 min pedido por el usuario

/**
 * RONDA 90 — búsqueda tolerante para APIs que exponen sus métricas como
 * PARES {nombre, valor} en vez de como una clave literal (p. ej. Neon
 * devuelve `{ metric_name: "public_network_transfer_bytes", value: N }`
 * dentro de `projects[].periods[].consumption[].metrics[]`, en lugar de
 * `{ public_network_transfer_bytes: N }` directamente). `sumarCamposNumericos`
 * (arriba) NUNCA puede encontrar este tipo de campo porque busca el nombre
 * como CLAVE del objeto, no como VALOR de un campo "nombre" acompañado de un
 * campo "valor" separado — de ahí que, aunque la respuesta HTTP sea exitosa,
 * la extracción fallaba en silencio. Se aceptan varios alias de nombre de
 * campo (`metric_name`/`metricName`/`name`) y de valor (`value`/`usageValue`
 * /`amount`) para no depender de una única variante exacta, siguiendo la
 * misma filosofía "búsqueda tolerante, nunca inventa un número" que ya usa
 * `sumarCamposNumericos`.
 */
export function sumarMetricasPorNombre(obj: unknown, patronNombreMetrica: RegExp, _visto = new WeakSet<object>()): number | null {
  if (obj === null || obj === undefined || typeof obj !== 'object') return null;
  if (_visto.has(obj as object)) return null; // por si acaso hubiera referencias circulares
  _visto.add(obj as object);

  let total: number | null = null;
  const acumular = (n: number) => { total = (total === null ? 0 : total) + n; };

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const sub = sumarMetricasPorNombre(item, patronNombreMetrica, _visto);
      if (sub !== null) acumular(sub);
    }
    return total;
  }

  const registro = obj as Record<string, unknown>;
  const nombreMetrica = registro.metric_name ?? registro.metricName ?? registro.name;
  const valor = registro.value ?? registro.usageValue ?? registro.amount;
  if (typeof nombreMetrica === 'string' && patronNombreMetrica.test(nombreMetrica) && typeof valor === 'number' && Number.isFinite(valor)) {
    acumular(valor);
  }
  for (const v of Object.values(registro)) {
    if (v && typeof v === 'object') {
      const sub = sumarMetricasPorNombre(v, patronNombreMetrica, _visto);
      if (sub !== null) acumular(sub);
    }
  }
  return total;
}
