// ════════════════════════════════════════════════════════════════════════
// RONDA 103 — Bitácora de auditoría de acciones sensibles (ítem 1.6 de la
// hoja de ruta de mejoras).
//
// PROBLEMA QUE RESUELVE: varias acciones importantes del sistema (ajustar
// manualmente el puesto de un estudiante, eliminar un estudiante o un
// usuario, cambiar la configuración de la institución) se guardan como
// parte del mismo blob JSON genérico que absolutamente todo lo demás
// (notas, asistencia, matrícula...) — no existe un endpoint dedicado para
// cada una de ellas. Eso significa que hasta ahora NO quedaba ningún
// rastro consultable de quién hizo esos cambios ni cuándo.
//
// CÓMO SE DETECTAN SIN CAMBIAR CADA PANTALLA: en vez de pedirle a cada uno
// de los módulos del frontend que avise activamente "oye, acabo de borrar
// un estudiante", este módulo compara el blob COMPLETO de la institución
// ANTES y DESPUÉS de cada guardado (POST /api/inetis/db ya tenía, desde la
// Ronda 44, una instantánea de "antes" en caché para otro propósito — aquí
// se reutiliza la misma idea). Como updDB()/saveDB()/_pushDB() en el
// frontend son el ÚNICO punto por el que pasa CUALQUIER mutación real de
// "db" (ver el comentario de Ronda 24 junto a updDB() en 03-app-core.js),
// comparar el "antes" contra el "después" en el servidor es suficiente
// para no perderse ninguna de estas acciones, sin importar desde qué
// pantalla se originó.
//
// Funciones 100% puras — sin Express, sin Drizzle, sin red — para poder
// probarlas directamente con `npx tsx`, igual que login-lockout.ts y
// cors-allowlist.ts.
//
// LIMITACIÓN HONESTA (documentada, no silenciada): este módulo NO detecta
// todavía "cambios de nota después de cerrado el periodo" (otro de los
// casos mencionados en la hoja de ruta) porque las calificaciones de este
// sistema no viven en un campo simple y estable del blob — están
// repartidas según el módulo (Planilla, actas, y una migración parcial en
// curso hacia tablas relacionales — ver estudiantesRel/materiasRel/
// calificacionesRel). Diseñar ese detector específico sin falsos negativos
// requiere más investigación dedicada y queda documentado como trabajo
// pendiente en la hoja de ruta, en vez de implementarse a medias aquí.
// ════════════════════════════════════════════════════════════════════════

export interface EventoAuditoria {
  accion: string;
  detalle: Record<string, unknown>;
}

/** Compara dos versiones de `db.puestoOverrides` (`{ "<estId>_<grado>":
 * {puesto, fecha} }`, ver _clavePuestoOverride en 03-app-core.js) y emite
 * un evento por cada entrada agregada, cambiada o quitada. */
function diffPuestoOverrides(anterior: any, nueva: any): EventoAuditoria[] {
  const eventos: EventoAuditoria[] = [];
  const antes = (anterior && typeof anterior === 'object') ? anterior : {};
  const despues = (nueva && typeof nueva === 'object') ? nueva : {};
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  for (const clave of claves) {
    const valorAntes = antes[clave];
    const valorDespues = despues[clave];
    if (JSON.stringify(valorAntes) === JSON.stringify(valorDespues)) continue;
    eventos.push({
      accion: 'ajuste_puesto_manual',
      detalle: { clave, puestoAnterior: valorAntes ?? null, puestoNuevo: valorDespues ?? null },
    });
  }
  return eventos;
}

/** Detecta registros que existían en `antes` y ya no están en `despues`,
 * comparando por un campo llave (`id` para estudiantes, `u` para
 * usuarios/docentes). Usado tanto para estudiantes como para usuarios. */
function diffEliminaciones(
  antes: any[],
  despues: any[],
  campoLlave: string,
  accion: string,
  construirDetalle: (registro: any) => Record<string, unknown>
): EventoAuditoria[] {
  const listaAntes = Array.isArray(antes) ? antes : [];
  const listaDespues = Array.isArray(despues) ? despues : [];
  const llavesDespues = new Set(listaDespues.map((r) => String(r && r[campoLlave])));
  const eventos: EventoAuditoria[] = [];
  for (const registro of listaAntes) {
    const llave = String(registro && registro[campoLlave]);
    if (!llave || llave === 'undefined') continue;
    if (!llavesDespues.has(llave)) {
      eventos.push({ accion, detalle: construirDetalle(registro) });
    }
  }
  return eventos;
}

/** Diff superficial (shallow) de `db.config`: reporta cada campo de primer
 * nivel que se agregó, cambió o se quitó. No baja a sub-objetos anidados
 * a propósito — es suficiente para detectar el tipo de cambio ("algo en
 * la configuración institucional cambió, y qué campo fue") sin generar
 * ruido por reordenamientos internos irrelevantes. */
function diffConfig(anterior: any, nueva: any): EventoAuditoria[] {
  const eventos: EventoAuditoria[] = [];
  const antes = (anterior && typeof anterior === 'object') ? anterior : {};
  const despues = (nueva && typeof nueva === 'object') ? nueva : {};
  const campos = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  for (const campo of campos) {
    const valorAntes = antes[campo];
    const valorDespues = despues[campo];
    if (JSON.stringify(valorAntes) === JSON.stringify(valorDespues)) continue;
    eventos.push({
      accion: 'configuracion_institucional_modificada',
      detalle: { campo, valorAnterior: valorAntes ?? null, valorNuevo: valorDespues ?? null },
    });
  }
  return eventos;
}

/** Punto de entrada principal: recibe el blob ANTES y DESPUÉS de un
 * guardado y devuelve la lista de eventos de auditoría a registrar.
 *
 * Si `dataAnterior` es null/undefined (primer guardado de la institución,
 * o no se pudo leer la caché a tiempo), se devuelve una lista vacía
 * deliberadamente: no hay nada contra qué comparar, y tratar la creación
 * inicial completa como si fueran decenas de "cambios" sería puro ruido
 * (inundaría la bitácora el día que se carga una institución nueva, que es
 * exactamente lo opuesto de lo que debe hacer un registro de auditoría
 * útil). */
export function detectarAccionesSensibles(dataAnterior: unknown, dataNueva: unknown): EventoAuditoria[] {
  if (!dataAnterior || typeof dataAnterior !== 'object') return [];
  if (!dataNueva || typeof dataNueva !== 'object') return [];
  const antes = dataAnterior as any;
  const despues = dataNueva as any;

  return [
    ...diffPuestoOverrides(antes.puestoOverrides, despues.puestoOverrides),
    ...diffEliminaciones(antes.ests, despues.ests, 'id', 'estudiante_eliminado', (e) => ({
      id: e.id, nombre: e.nom || e.nombre || null, numDoc: e.numDoc || null,
    })),
    ...diffEliminaciones(antes.users, despues.users, 'u', 'usuario_eliminado', (u) => ({
      usuario: u.u, nombre: u.n || null, rol: u.r || null,
    })),
    ...diffConfig(antes.config, despues.config),
  ];
}
