// ════════════════════════════════════════════════════════════════════════════
// AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA — Gestor Académico YC
// ------------------------------------------------------------------------------
// Servicio en JavaScript plano (ESM), igual convención que el subsistema
// src/university-lms/ — se elige .js (no .ts) exactamente como se pidió, y
// porque este servicio no necesita tipos estáticos propios: reutiliza los
// tipos ya inferidos de drizzle a través de src/db/index.js.
//
// QUÉ HACE: audita de forma periódica (o bajo demanda) TODAS las
// instituciones que tuvieron cambios recientes en Neon — rendimiento
// académico, inasistencias, integridad técnica de la base de datos y el
// estado de la sincronización offline-first — y ejecuta, de forma
// autónoma, un conjunto acotado y seguro de "herramientas" (Function
// Calling de Gemini) para reparar fallos TÉCNICOS o levantar alertas
// PEDAGÓGICAS. Nunca toca una nota real ingresada por un docente.
//
// ARQUITECTURA DE SEGURIDAD (léase antes de tocar este archivo):
//   1) SOBERANÍA ACADÉMICA — este archivo NUNCA escribe en
//      d.ests[].nts[cId][per].{s,sb,h} salvo para reemplazar un valor que
//      ya es técnicamente inválido (null/undefined/NaN/string no numérico)
//      por 0 — el mismo valor por defecto que el propio frontend ya usa
//      cuando esas dimensiones faltan (ver _baseNota()/calcNotaDef() en
//      gestor-academico/dist/modules/03-app-core.js). JAMÁS cambia un
//      número válido que un docente haya ingresado, sin importar cuán
//      "atípico" parezca (una nota de 1.2 no es un error técnico, es una
//      nota baja real). Un promedio bajo o una inasistencia alta NUNCA
//      disparan una reparación — solo una alerta (flagAcademicAlert).
//   2) CONTROL DE ESQUEMA DE BD — este archivo no ejecuta jamás
//      ALTER TABLE ni CREATE TABLE. Toda esta bitácora vive en la tabla
//      fija agent_audit_logs (creada una sola vez por src/db/index.ts al
//      arrancar el servidor, igual que las demás tablas del proyecto) y
//      cualquier metadato adicional que el agente necesite recordar se
//      guarda dentro de su columna JSONB "details" — nunca como columna
//      física nueva. Si el agente detecta que de verdad hría falta una
//      columna nueva, deja esa sugerencia registrada en el log
//      (status:'Informativo', details.sugerenciaEsquema) para que el
//      desarrollador la evalúe — nunca la crea por su cuenta.
//   3) OPTIMIZACIÓN DE RED — ver runFullAudit(): consulta incremental
//      (updated_at > cursor), consolidación en memoria + UNA sola
//      escritura en lote a agent_audit_logs, y "silencio total" (cero
//      llamadas adicionales a Neon o a Gemini) si no hubo cambios.
//
// FUNCTION CALLING: cuando GEMINI_API_KEY está configurada, el motor
// determinista (siempre activo) detecta los hallazgos y se los entrega a
// Gemini junto con las 4 herramientas declaradas; Gemini decide qué
// herramienta invocar para cada hallazgo y redacta el resumen ejecutivo
// final (notifySuperadmin). Como salvaguarda, SOLO se ejecuta una llamada
// a función de Gemini si su "target" coincide con un hallazgo que el
// propio motor determinista ya detectó de forma independiente — así, aunque
// el modelo alucinara un id que no existe, nunca se ejecuta contra datos
// reales. Sin GEMINI_API_KEY (modo de degradación elegante) el motor
// determinista ejecuta exactamente las mismas herramientas por su cuenta,
// sin narrativa generativa — el servidor Express nunca se cae por esto.
// ════════════════════════════════════════════════════════════════════════════

import { GoogleGenAI, Type } from '@google/genai';
import { eq, and, gt, ne, asc, desc, sql as sqlOp } from 'drizzle-orm';
import { db, kvStore, agentAuditLogs, notifications } from '../db/index.js';
import { broadcastChange, contarClientesSse } from '../lib/sync-bus.js';
import { invalidarDbCache } from '../lib/db-cache.js';
import { checkAiAuditorEnabled, checkAiNeonEnabled } from '../lib/feature-flags.js';
import { MODEL_FALLBACKS, DEFAULT_PRIMARY_MODEL, llamarGeminiConResiliencia, TIMEOUT_GEMINI_FUNCTION_CALLING_MS } from '../lib/gemini-config.js';

// ────────────────────────────────────────────────────────────────────────────
// 1) CONFIGURACIÓN Y CONEXIÓN A GEMINI (con degradación elegante)
// ────────────────────────────────────────────────────────────────────────────

const GESTOR_SK = '__gestor_academico_yc__';
const AGENT_STATE_SK = '__agent_ecosistema_state__'; // cursor "última auditoría" — vive en kv_store como cualquier otro blob, NUNCA como columna física nueva

// RONDA 52 — LÍMITE EXPLÍCITO DE LA CONSULTA INCREMENTAL A NEON.
// La consulta de runFullAudit() ya era incremental (updated_at > cursor,
// solo 3 columnas — ver comentario ahí), pero NO tenía un LIMIT: si pasa
// mucho tiempo sin correr una auditoría (el agente estuvo apagado, o es el
// primer arranque tras el despliegue), "cursor" puede ser muy antiguo y la
// consulta puede traer decenas o cientos de instituciones cambiadas de una
// sola vez. El bucle de abajo procesa cada institución EN SERIE, y cada una
// puede disparar su propia llamada de Function Calling a Gemini (con sus
// propios reintentos/backoff del wrapper central) — con muchas
// instituciones en una sola corrida, la duración total se acumula y el
// usuario percibe "lentitud" o incluso un timeout de la petición HTTP que
// disparó la auditoría manual (POST /api/agent/run-full-audit).
// Con este LIMIT, cada ciclo procesa como máximo N instituciones (ordenadas
// por updated_at ASC, las más antiguas primero — ni una institución se
// "salta" ni queda huérfana: ver el cálculo del nuevo cursor más abajo, que
// avanza solo hasta la última fila REALMENTE procesada en este ciclo, nunca
// hasta "ahora", cuando el LIMIT recortó el resultado). Si quedan más
// instituciones pendientes, el próximo ciclo (programado cada semana, o un
// disparo manual inmediato) las recoge automáticamente desde ese punto —
// no se pierde ningún cambio, solo se reparte en más de un ciclo.
const LIMITE_INSTITUCIONES_POR_CICLO = 20;

// RONDA 48: el Agente Auditor conserva su propia variable de entorno
// GEMINI_AGENT_MODEL (puede querer un modelo distinto al de Adán/asistente
// de chat), pero ya NO declara su propia lista de fallback dispersa — usa
// MODEL_FALLBACKS de la configuración central (src/lib/gemini-config.ts)
// como red de seguridad, para no repetir/desincronizar nombres de modelo
// en dos archivos.
export const AGENT_MODEL = (process.env.GEMINI_AGENT_MODEL || process.env.GEMINI_MODEL || DEFAULT_PRIMARY_MODEL).replace(/^models\//, '').trim();
const AGENT_CANDIDATE_MODELS = [AGENT_MODEL, ...MODEL_FALLBACKS].filter((m, i, self) => Boolean(m) && self.indexOf(m) === i);

let _avisoSinClaveMostrado = false;

/** Lee la clave DIRECTO de las variables de entorno, tal como pide la especificación (sección 1). */
function getAgentGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

/** Devuelve un cliente GoogleGenAI listo para usar, o null si no hay clave / falló la inicialización — NUNCA lanza, para que el resto del servidor siga funcionando (degradación elegante). */
function getAgentGenAI() {
  const apiKey = getAgentGeminiApiKey();
  if (!apiKey) {
    if (!_avisoSinClaveMostrado) {
      console.warn('⚠️  [EcosystemAgent] GEMINI_API_KEY no configurada — el Agente Auditor seguirá auditando con su motor de reglas determinista, sin razonamiento generativo ni Function Calling de Gemini. El servidor no se ve afectado.');
      _avisoSinClaveMostrado = true;
    }
    return null;
  }
  try {
    return new GoogleGenAI({ apiKey });
  } catch (err) {
    console.error('❌ [EcosystemAgent] Error al inicializar GoogleGenAI:', err?.message || err);
    return null;
  }
}

export function agentGeminiConfigurado() {
  return !!getAgentGeminiApiKey();
}

// ────────────────────────────────────────────────────────────────────────────
// 2) SYSTEM PROMPT HOLÍSTICO
// ────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el Agente Administrador y Auditor Supremo del Gestor Académico YC. Tu objetivo es auditar de forma continua el rendimiento académico, el control de inasistencias, la integridad de la base de datos Neon PostgreSQL, el estado de la sincronización offline-first y la salud del servidor. Tienes herramientas asignadas para ejecutar reparaciones y ajustes de forma autónoma, respetando siempre la soberanía de las notas asignadas por los docentes, la integridad del esquema de la base de datos y la optimización de ancho de banda en la red.

REGLAS ESTRICTAS QUE NUNCA PUEDES ROMPER:
1. SOBERANÍA ACADÉMICA: tienes ESTRICTAMENTE PROHIBIDO alterar, subir o modificar las calificaciones reales ingresadas por los docentes, a favor o en contra de cualquier estudiante. Si un estudiante tiene un promedio reprobatorio (< 3.0) o una inasistencia crítica, tu ÚNICA acción posible es invocar flagAcademicAlert — nunca modificas la nota en sí.
2. repairDataIntegrity se limita EXCLUSIVAMENTE a errores técnicos o de cómputo (valores nulos, no numéricos o desfasados por fallos de sincronización) en las dimensiones Ser/Saber/Hacer — nunca a "corregir" una nota baja real.
3. CONTROL DE ESQUEMA: nunca ejecutas ni sugieres ejecutar ALTER TABLE ni CREATE TABLE contra Neon PostgreSQL. Cualquier dato nuevo que necesites recordar va dentro del campo JSONB de la bitácora de auditoría; si de verdad hace falta una columna física nueva, solo lo registras como sugerencia para que el desarrollador la evalúe.
4. OPTIMIZACIÓN DE RED: solo actúas sobre los hallazgos que se te entregan (ya filtrados de forma incremental) — nunca pides releer toda la base de datos, y solo invocas herramientas cuando de verdad hay algo que hacer.
5. Solo puedes invocar una herramienta usando exactamente un "targetId" o "studentId" de los hallazgos que se te entregaron — nunca inventes identificadores.`;

// ────────────────────────────────────────────────────────────────────────────
// 3) DECLARACIÓN DE HERRAMIENTAS (Function Calling)
// ────────────────────────────────────────────────────────────────────────────

export const TOOLS_DECLARATION = [{
  functionDeclarations: [
    {
      name: 'repairDataIntegrity',
      description: 'Recalcula promedios desfasados por fallos técnicos, repara notas nulas/no numéricas por desincronización, o corrige incongruencias de cómputo en las dimensiones Ser/Saber/Hacer. NUNCA se usa para cambiar una nota baja real.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: 'Tipo de reparación técnica, ej. "dimension_no_numerica"' },
          targetId: { type: Type.STRING, description: 'Identificador exacto del hallazgo entregado (sk_cId_per_estId u otro id ya detectado por el motor de reglas)' },
        },
        required: ['type', 'targetId'],
      },
    },
    {
      name: 'triggerSystemSync',
      description: 'Reintenta o destraba la sincronización en tiempo real de una institución, forzando un nuevo aviso a todos sus dispositivos conectados.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          nodeId: { type: Type.STRING, description: 'El "sk" (identificador) de la institución a sincronizar' },
        },
        required: ['nodeId'],
      },
    },
    {
      name: 'flagAcademicAlert',
      description: 'Registra una alerta pedagógica (promedio reprobatorio o inasistencia crítica) para orientación/coordinación. Es la ÚNICA acción permitida ante un problema académico real — nunca modifica la nota.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          studentId: { type: Type.STRING, description: 'Id del estudiante, tal como aparece en el hallazgo' },
          reason: { type: Type.STRING, description: 'Motivo de la alerta, en lenguaje claro para el docente/coordinador' },
          level: { type: Type.STRING, enum: ['preventivo', 'critico'], description: 'Nivel de severidad de la alerta' },
        },
        required: ['studentId', 'reason', 'level'],
      },
    },
    {
      name: 'notifySuperadmin',
      description: 'Escribe el reporte final consolidado del ciclo de auditoría en la bitácora de la base de datos, para el panel "🤖 Auditoría IA / Agente" del Súper Admin.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: 'Resumen ejecutivo de una o dos frases de todo el ciclo de auditoría' },
          details: { type: Type.STRING, description: 'Detalle ampliado (opcional)' },
          actionsTaken: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Lista de acciones autónomas ejecutadas en este ciclo' },
        },
        required: ['summary'],
      },
    },
  ],
}];

// ────────────────────────────────────────────────────────────────────────────
// 4) HELPERS PUROS — réplica fiel de las fórmulas del frontend
//    (gestor-academico/dist/modules/03-app-core.js: _baseNota/calcNotaDef,
//    gestor-academico/dist/modules/06-documentos-y-resto.js: % inasistencia)
//    Se mantienen puros y exportados a propósito para poder probarlos de
//    forma aislada, igual que el resto de este proyecto.
// ────────────────────────────────────────────────────────────────────────────

/** true si "v" es un valor de dimensión (Ser/Saber/Hacer) técnicamente inválido — nunca confunde esto con "nota baja real": 0, 1.2, etc. son válidos. */
export function esDimensionInvalidaTecnicamente(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'string') return v.trim() === '' || !Number.isFinite(Number(v));
  return true; // objeto, array, boolean, etc. — nunca es un número válido de nota
}

/** Réplica exacta de _baseNota() del frontend (columnasBase o pctSer/pctSaber/pctHacer + columnasExtra). */
export function baseNotaPort(n, cfg) {
  const colsBase = cfg && cfg.columnasBase;
  if (colsBase && colsBase.length) {
    let sum = 0, totalPct = 0;
    colsBase.forEach((c) => { const p = parseFloat(c.pct) || 0; sum += (n[c.key] || 0) * p; totalPct += p; });
    return parseFloat((totalPct > 0 ? sum / totalPct : 0).toFixed(2));
  }
  const cols = (cfg && cfg.columnasExtra) || [];
  const totalExtraPct = cols.reduce((s, c) => (s + (parseFloat(c.pct) || 0) / 100), 0);
  const scale = Math.max(0, 1 - totalExtraPct);
  const pS = (cfg && cfg.pctSer != null ? cfg.pctSer : 0.25) * scale;
  const pSb = (cfg && cfg.pctSaber != null ? cfg.pctSaber : 0.35) * scale;
  const pH = (cfg && cfg.pctHacer != null ? cfg.pctHacer : 0.40) * scale;
  let extraSum = 0;
  cols.forEach((col, i) => { extraSum += (n['ex' + i] || 0) * (parseFloat(col.pct) || 0) / 100; });
  return parseFloat(((n.s || 0) * pS + (n.sb || 0) * pSb + (n.h || 0) * pH + extraSum).toFixed(2));
}

/** Réplica exacta de calcNotaDef() del frontend (aplica recuperación/nivelación). */
export function calcNotaDefPort(nts, cId, per, cfg, numPerActual) {
  if (!nts) return 0;
  const n = (nts[cId] || {})[per] || { s: 0, sb: 0, h: 0, rec: 0, niv: 0 };
  const base = baseNotaPort(n, cfg || {});
  const rec = n.rec || 0;
  const def = (base < 3.0 && rec > 0) ? rec : base;
  if (per == numPerActual && (n.niv || 0) > 0) return n.niv;
  return def;
}

/** Réplica exacta del % de inasistencia por asignatura de analizarInasistenciaAdan()/_verificarAlertaInasistenciaCriticaSiAplica(). */
export function pctInasistenciaEst(dbInst, estId, grado, cId) {
  const clases = (dbInst.asistencia || []).filter((a) => !a.deletedAt && a.grado === grado && String(a.cargaId) === String(cId));
  const totalClases = clases.length;
  if (totalClases < 3) return { pct: 0, totalClases, aus: 0, muestraInsuficiente: true }; // misma regla del frontend: muestra insuficiente
  const aus = clases.filter((c) => (c.ausentes || []).some((x) => String(x) === String(estId))).length;
  return { pct: (aus / totalClases) * 100, totalClases, aus, muestraInsuficiente: false };
}

// ────────────────────────────────────────────────────────────────────────────
// 5) HERRAMIENTAS (implementación real — mutan datos con las salvaguardas
//    descritas arriba) — cada una devuelve {ok, mensaje, log:{...}} listo
//    para acumularse en memoria y escribirse en UN SOLO batch insert.
// ────────────────────────────────────────────────────────────────────────────

/**
 * repairDataIntegrity({ type, targetId }, ctx)
 * targetId esperado: "sk::cargaId::periodo::estudianteId" — SOLO repara
 * dimensiones (s/sb/h/rec/niv) que ya son técnicamente inválidas (ver
 * esDimensionInvalidaTecnicamente). Nunca toca un valor numérico válido.
 */
export async function repairDataIntegrity({ type, targetId }, ctx) {
  const partes = String(targetId || '').split('::');
  const [sk, cId, per, estId] = partes;
  if (!sk || !cId || !per || !estId) {
    return { ok: false, mensaje: `targetId inválido para repairDataIntegrity: "${targetId}"` };
  }
  const blob = ctx?.blobsPorSk?.get(sk);
  if (!blob) return { ok: false, mensaje: `Institución ${sk} no disponible en este ciclo de auditoría.` };
  const est = (blob.ests || []).find((e) => String(e.id) === String(estId));
  if (!est || !est.nts || !est.nts[cId] || !est.nts[cId][per]) {
    return { ok: false, mensaje: `No se encontró el registro de notas ${targetId} — pudo haber sido eliminado o movido entre el momento del hallazgo y la reparación.` };
  }
  const n = est.nts[cId][per];
  const antes = { s: n.s, sb: n.sb, h: n.h };
  const reparados = [];
  ['s', 'sb', 'h'].forEach((dim) => {
    if (esDimensionInvalidaTecnicamente(n[dim])) {
      n[dim] = 0; // mismo valor por defecto que ya usa el propio frontend cuando la dimensión falta
      reparados.push(dim);
    }
  });
  if (!reparados.length) {
    return { ok: true, sinCambios: true, mensaje: `Las dimensiones de ${targetId} ya eran válidas — no se necesitó ninguna reparación (posible falso positivo ya resuelto).` };
  }
  ctx.blobsModificados.add(sk);
  return {
    ok: true,
    mensaje: `Reparadas ${reparados.length} dimensión(es) técnicamente inválida(s) (${reparados.join(', ')}) en ${est.n || estId}, carga ${cId}, periodo ${per}.`,
    log: {
      category: 'Tecnico',
      issueDetected: `Dimensión(es) no numérica(s)/nula(s) por fallo de sincronización: ${reparados.join(', ')} — estudiante ${est.n || estId} (${sk}), carga ${cId}, periodo ${per}.`,
      actionTaken: `Recalculadas a 0 (valor técnico por defecto) vía repairDataIntegrity — no se modificó ninguna nota numérica válida.`,
      status: 'Corregido',
      details: { sk, cId, per, estId, dimensionesReparadas: reparados, antes, despues: { s: n.s, sb: n.sb, h: n.h } },
    },
  };
}

/**
 * triggerSystemSync({ nodeId }) — nodeId es el "sk" de la institución.
 * Como la cola de sincronización offline-first vive en cada dispositivo
 * (no en el servidor), "destrabar" significa forzar de inmediato un nuevo
 * aviso SSE a todos los dispositivos ya conectados de esa institución —
 * ver src/lib/sync-bus.ts.
 */
export async function triggerSystemSync({ nodeId }) {
  const conectados = contarClientesSse(nodeId);
  broadcastChange(nodeId, { origen: 'ecosystem-agent' });
  return {
    ok: true,
    mensaje: conectados > 0
      ? `Se forzó un nuevo aviso de sincronización a ${conectados} dispositivo(s) conectado(s) de ${nodeId}.`
      : `Se emitió el aviso de sincronización para ${nodeId} (sin dispositivos conectados en este momento — lo recibirán al reconectarse).`,
    log: {
      category: 'Sincronizacion',
      issueDetected: `Se solicitó destrabar/reintentar la sincronización en tiempo real de la institución ${nodeId}.`,
      actionTaken: `Reenviado aviso SSE de cambio vía triggerSystemSync (${conectados} dispositivo(s) conectado(s) en el momento del reenvío).`,
      status: 'Corregido',
      details: { sk: nodeId, dispositivosConectados: conectados },
    },
  };
}

/**
 * flagAcademicAlert({ studentId, reason, level }) — ÚNICA reacción
 * permitida ante un hallazgo académico real. Escribe una notificación
 * in-app (misma tabla "notifications" que ya usa todo el sistema, visible
 * para docente/coordinación/rectoría/Súper Admin) y un registro de
 * auditoría — nunca toca la nota ni la asistencia en sí.
 */
const DIAS_ANTIALERTA_DUPLICADA = 7; // no repetir la MISMA alerta (mismo estudiante+nivel+institución) más de una vez por semana

export async function flagAcademicAlert({ studentId, reason, level }, ctx) {
  const sk = ctx?.sk || '';
  const nivel = level === 'critico' ? 'critico' : 'preventivo';

  // ── Anti-duplicado: si la situación de este estudiante sigue igual
  // (mismo nivel de severidad) semana tras semana, no hace falta repetirle
  // la misma alerta a docente/coordinación en cada ciclo de auditoría —
  // ya está notificada y en seguimiento. Si el nivel EMPEORA (preventivo →
  // crítico) sí se considera una alerta nueva y distinta. ──────────────
  const desde = new Date(Date.now() - DIAS_ANTIALERTA_DUPLICADA * 24 * 60 * 60 * 1000);
  const yaAlertado = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.kind, 'alerta-agente-ia'),
      eq(notifications.sk, sk),
      gt(notifications.createdAt, desde),
      sqlOp`${notifications.meta} ->> 'studentId' = ${String(studentId)}`,
      sqlOp`${notifications.meta} ->> 'level' = ${nivel}`,
    ))
    .limit(1);
  if (yaAlertado.length) {
    return {
      ok: true,
      sinCambios: true,
      mensaje: `${studentId} ya tenía una alerta ${nivel} vigente (últimos ${DIAS_ANTIALERTA_DUPLICADA} días) — no se repite para no saturar a docencia/coordinación.`,
      log: {
        category: 'Academico',
        issueDetected: reason,
        actionTaken: `Alerta NO repetida — ya existía una alerta "${nivel}" para este mismo estudiante en los últimos ${DIAS_ANTIALERTA_DUPLICADA} días.`,
        status: 'Informativo',
        details: { sk, studentId, level: nivel, duplicada: true },
      },
    };
  }

  await db.insert(notifications).values({
    sk: sk || null,
    kind: 'alerta-agente-ia',
    actor: 'Agente Auditor IA (automático)',
    message: `${nivel === 'critico' ? '🔴' : '🟡'} ${reason}`,
    meta: { studentId, reason, level: nivel, automatica: true, origen: 'ecosystemAgent', fecha: new Date().toISOString() },
    seen: false,
  });
  return {
    ok: true,
    mensaje: `Alerta ${nivel} registrada para el estudiante ${studentId}: ${reason}`,
    log: {
      category: 'Academico',
      issueDetected: reason,
      actionTaken: `Alerta pedagógica de nivel "${nivel}" registrada vía flagAcademicAlert — notificada a docente/coordinación/rectoría. NO se modificó ninguna nota ni registro de asistencia.`,
      status: 'Alerta',
      details: { sk, studentId, level: nivel },
    },
  };
}

/**
 * notifySuperadmin({ summary, details, actionsTaken }) — reporte final del
 * ciclo. Se acumula igual que los demás logs y se escribe en el mismo
 * batch insert al final de runFullAudit().
 */
export function notifySuperadmin({ summary, details, actionsTaken }) {
  return {
    ok: true,
    mensaje: summary,
    log: {
      category: 'Tecnico',
      issueDetected: 'Reporte consolidado de ciclo de auditoría del Agente Ecosistema.',
      actionTaken: summary + (Array.isArray(actionsTaken) && actionsTaken.length ? ' — Acciones: ' + actionsTaken.join('; ') : ''),
      status: 'Informativo',
      details: { details: details || '', actionsTaken: actionsTaken || [] },
    },
  };
}

const EJECUTORES_HERRAMIENTAS = {
  repairDataIntegrity,
  triggerSystemSync,
  flagAcademicAlert,
  notifySuperadmin,
};

// ────────────────────────────────────────────────────────────────────────────
// 6) CURSOR DE ÚLTIMA AUDITORÍA (guardado en kv_store — sin columnas nuevas)
// ────────────────────────────────────────────────────────────────────────────

async function leerCursorUltimaAuditoria() {
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, AGENT_STATE_SK));
  const val = rows[0]?.value;
  return val?.lastAuditAt ? new Date(val.lastAuditAt) : new Date(0); // sin auditoría previa → epoch, para que la primera corrida revise todo
}

async function guardarCursorUltimaAuditoria(fecha, resumen) {
  await db.insert(kvStore).values({
    key: AGENT_STATE_SK,
    value: { lastAuditAt: fecha.toISOString(), ultimoResumen: resumen || null },
    updatedAt: fecha,
  }).onConflictDoUpdate({
    target: kvStore.key,
    set: { value: { lastAuditAt: fecha.toISOString(), ultimoResumen: resumen || null }, updatedAt: fecha },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 7) MOTOR DE DETECCIÓN DETERMINISTA (siempre corre, con o sin Gemini)
// ────────────────────────────────────────────────────────────────────────────

/** Recorre SOLO las instituciones que cambiaron desde el cursor — nunca "SELECT *" de todo Neon. */
function auditarInstitucion(sk, blob) {
  const hallazgosTecnicos = [];
  const hallazgosAcademicos = [];
  if (!blob || typeof blob !== 'object') return { hallazgosTecnicos, hallazgosAcademicos };

  const cfg = blob.config || {};
  const numPer = cfg.numPeriodos || 4;
  const pctCrit = Number(cfg.pctInasistenciaCritica || 25);
  const pctPrev = Number(cfg.pctInasistenciaPreventiva || 20);

  // Validación de forma del interruptor de sincronización automática — el
  // CUMPLIMIENTO en sí ya se corrigió en el cliente (Ronda 14); aquí solo se
  // valida que el dato en sí no esté corrupto por una fusión defectuosa.
  // (Este campo vive en gestorDB.platforms, no en el blob de la institución
  // — se audita aparte, en auditarFlagsSincronizacion().)

  (blob.ests || []).forEach((est) => {
    if (est.deletedAt) return;
    if (est.nts) {
      Object.keys(est.nts).forEach((cId) => {
        Object.keys(est.nts[cId] || {}).forEach((per) => {
          const n = est.nts[cId][per];
          if (!n || typeof n !== 'object') return;
          const dimsInvalidas = ['s', 'sb', 'h'].filter((d) => esDimensionInvalidaTecnicamente(n[d]));
          if (dimsInvalidas.length) {
            hallazgosTecnicos.push({
              targetId: `${sk}::${cId}::${per}::${est.id}`,
              type: 'dimension_no_numerica',
              descripcion: `${dimsInvalidas.length} dimensión(es) técnicamente inválida(s) (${dimsInvalidas.join(', ')}) en ${est.n || est.id}, carga ${cId}, periodo ${per}.`,
            });
            return; // si hay corrupción técnica, no se evalúa el promedio de este periodo — sería comparar contra un dato ya sabido inválido
          }
          const nota = calcNotaDefPort(est.nts, cId, per, cfg, numPer);
          if (nota > 0 && nota < 3.0) {
            const carga = (blob.carga || []).find((c) => String(c.id) === String(cId));
            hallazgosAcademicos.push({
              studentId: String(est.id),
              nombre: est.n || String(est.id),
              reason: `${est.n || est.id} (${est.g || '—'}) tiene un promedio reprobatorio de ${nota.toFixed(2)} en ${carga ? (carga.m || carga.a) : ('la carga ' + cId)}, periodo ${per}.`,
              level: 'critico',
              origen: 'promedio',
              sk,
            });
          }
        });
      });
    }
    // Inasistencia — una comprobación por combinación grado+carga ya vista, para no duplicar el mismo hallazgo por cada estudiante de la misma carga.
    (blob.carga || []).forEach((carga) => {
      if (carga.g !== est.g) return;
      const { pct, totalClases, muestraInsuficiente } = pctInasistenciaEst(blob, est.id, est.g, carga.id);
      if (muestraInsuficiente) return;
      if (pct >= pctCrit) {
        hallazgosAcademicos.push({
          studentId: String(est.id),
          nombre: est.n || String(est.id),
          reason: `${est.n || est.id} (${est.g || '—'}) alcanzó ${pct.toFixed(1)}% de inasistencia en ${carga.m || carga.a} (umbral crítico institucional: ${pctCrit}%, ${totalClases} clases registradas).`,
          level: 'critico',
          origen: 'inasistencia',
          sk,
        });
      } else if (pct >= pctPrev) {
        hallazgosAcademicos.push({
          studentId: String(est.id),
          nombre: est.n || String(est.id),
          reason: `${est.n || est.id} (${est.g || '—'}) alcanzó ${pct.toFixed(1)}% de inasistencia en ${carga.m || carga.a} (umbral preventivo institucional: ${pctPrev}%, ${totalClases} clases registradas).`,
          level: 'preventivo',
          origen: 'inasistencia',
          sk,
        });
      }
    });
  });

  return { hallazgosTecnicos, hallazgosAcademicos };
}

/** Valida la FORMA del interruptor plat.sincronizacionAutomatica en gestorDB.platforms — nunca simula ni verifica el comportamiento del cliente (eso ya es responsabilidad del propio navegador, ver Ronda 14). */
function auditarFlagsSincronizacion(gestorBlob) {
  const hallazgos = [];
  if (!gestorBlob || !Array.isArray(gestorBlob.platforms)) return hallazgos;
  gestorBlob.platforms.forEach((plat) => {
    const v = plat.sincronizacionAutomatica;
    if (v !== undefined && typeof v !== 'boolean') {
      hallazgos.push({
        sk: plat.sk,
        descripcion: `El interruptor "sincronizacionAutomatica" de la institución "${plat.nombre || plat.sk}" tiene un valor no-booleano (${JSON.stringify(v)}), probablemente por una fusión de datos defectuosa — el cliente lo trata como "activado" por defecto salvo que sea EXACTAMENTE false, así que no bloquea nada, pero conviene normalizarlo.`,
      });
    }
  });
  return hallazgos;
}

// ────────────────────────────────────────────────────────────────────────────
// 8) ORQUESTADOR PRINCIPAL — runFullAudit()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta un ciclo completo de auditoría. Devuelve un resumen liviano (para
 * la respuesta HTTP de /api/agent/run-full-audit) — el detalle completo
 * queda en agent_audit_logs.
 */
export async function runFullAudit({ trigger } = {}) {
  const inicio = Date.now();
  const cursor = await leerCursorUltimaAuditoria();
  const ahora = new Date(); // usado como cursor SOLO cuando este ciclo procesó TODO lo pendiente (ver más abajo)

  // ── OPTIMIZACIÓN DE RED: consulta incremental — NUNCA "SELECT *" de Neon.
  // Solo se traen las columnas necesarias (key, value, updated_at), SOLO de
  // las filas de kv_store modificadas desde el último ciclo, ordenadas por
  // updated_at ASC (las más antiguas primero) y acotadas con LIMIT
  // explícito (RONDA 52 — ver comentario junto a
  // LIMITE_INSTITUCIONES_POR_CICLO más arriba: sin este LIMIT, un cursor
  // muy antiguo podía traer cientos de instituciones y disparar cientos de
  // llamadas seriadas a Gemini en un solo ciclo, causando la lentitud/
  // timeout reportados). ──────────────────────────────────────────────
  const filasCambiadas = await db
    .select({ key: kvStore.key, value: kvStore.value, updatedAt: kvStore.updatedAt })
    .from(kvStore)
    .where(and(gt(kvStore.updatedAt, cursor), ne(kvStore.key, AGENT_STATE_SK)))
    .orderBy(asc(kvStore.updatedAt))
    .limit(LIMITE_INSTITUCIONES_POR_CICLO);

  if (!filasCambiadas.length) {
    // "Silencio en Inactividad": cero llamadas adicionales a Neon o a
    // Gemini, y ni siquiera se actualiza el cursor (nada que auditar, así
    // que la próxima corrida puede seguir mirando desde el mismo punto sin
    // perder ningún cambio intermedio).
    return { ok: true, sinCambios: true, mensaje: 'Sin actividad detectada desde la última auditoría — ciclo omitido, cero llamadas adicionales a la base de datos o a Gemini.', trigger: trigger || 'manual', durationMs: Date.now() - inicio };
  }

  let gestorBlob = null;
  const institucionesCambiadas = [];
  filasCambiadas.forEach((f) => {
    if (f.key === GESTOR_SK) { gestorBlob = f.value; return; }
    institucionesCambiadas.push(f);
  });

  // RONDA 53 — PRIORIZACIÓN POR INSTITUCIONES ACTIVAS EN ESTE MOMENTO.
  // IMPORTANTE: esto NO es lo mismo que el chat conversacional de Adán
  // (/api/inetis/ai/chat) — ver la investigación documentada en
  // CHECKLIST_DESPLIEGUE.md, Ronda 53: el chat ya estaba (y sigue estando)
  // completamente separado de este ciclo de auditoría, con su propio cliente
  // GoogleGenAI por petición y sin ninguna cola compartida ni espera cruzada.
  // Este cambio es una mejora real y acotada al barrido de fondo en sí
  // (periódico o manual, con el LIMIT de Ronda 52): dentro del lote ya
  // capado, se reordena (orden ESTABLE, no se altera el criterio de avance
  // del cursor — eso sigue usando `filasCambiadas`, no este arreglo
  // reordenado) para procesar PRIMERO las instituciones que tienen al menos
  // un dispositivo con una sesión en vivo conectada por SSE ahora mismo
  // (`contarClientesSse`, ya usado por triggerSystemSync) — así, si hay 2 o
  // 3 colegios con gente usando el sistema en este instante mientras otros
  // quedaron con cambios pendientes de auditar pero sin nadie conectado, los
  // primeros reciben su reparación/aviso de sincronización antes que los
  // segundos, sin cambiar CUÁNTAS instituciones se procesan por ciclo (sigue
  // siendo como máximo LIMITE_INSTITUCIONES_POR_CICLO) ni el criterio de
  // avance del cursor (que sigue siendo seguro y determinista, ver arriba).
  institucionesCambiadas.sort((a, b) => {
    const activaA = contarClientesSse(a.key) > 0 ? 1 : 0;
    const activaB = contarClientesSse(b.key) > 0 ? 1 : 0;
    return activaB - activaA; // activas (1) primero, inactivas (0) después; Array.prototype.sort es estable en Node/V8 moderno, así que dentro de cada grupo se conserva el orden ASC original por updated_at
  });

  const logsAcumulados = []; // CONSOLIDACIÓN EN MEMORIA — se escriben todos juntos en un solo batch insert al final
  const accionesTotales = [];
  let totalHallazgosTecnicos = 0;
  let totalHallazgosAcademicos = 0;
  let totalReparaciones = 0;
  let usoRazonamientoGenerativoAlguno = false;
  const genAI = getAgentGenAI();

  // Se procesa UNA institución a la vez, cada una con su propio contexto
  // aislado — así un "studentId" nunca se puede confundir entre dos
  // instituciones distintas que por coincidencia reutilicen el mismo id
  // interno (frecuente, porque cada institución numera sus propios
  // estudiantes desde 1). También mantiene cada llamada a Gemini pequeña
  // (solo los hallazgos de ESA institución), en línea con la optimización
  // de red pedida.
  for (const fila of institucionesCambiadas) {
    const sk = fila.key;
    const blobActual = fila.value; // se muta en memoria y se persiste al final SOLO si hubo una reparación real
    const { hallazgosTecnicos, hallazgosAcademicos } = auditarInstitucion(sk, blobActual);
    totalHallazgosTecnicos += hallazgosTecnicos.length;
    totalHallazgosAcademicos += hallazgosAcademicos.length;
    if (!hallazgosTecnicos.length && !hallazgosAcademicos.length) continue; // "Silencio en Inactividad" también a nivel de institución individual

    const ctx = { blobsPorSk: new Map([[sk, blobActual]]), blobsModificados: new Set() };
    const accionesInstitucion = [];
    let usoGenAI = false;

    // Ronda 34 — Switch "Agente IA - Consultas Base de Datos Neon"
    // (ENABLE_AI_NEON_QUERIES): si está apagado, se bloquea ESPECÍFICAMENTE
    // la vía de Function Calling de Gemini (la IA decidiendo/ejecutando
    // acciones sobre Neon), no la auditoría entera — el motor determinista
    // de abajo (reglas fijas, sin razonamiento generativo) sigue
    // reparando exactamente igual, porque esas reparaciones no las decide
    // ninguna IA. Se consulta el flag EN CADA institución procesada (no
    // una vez al iniciar runFullAudit), consistente con el resto de flags
    // de esta ronda.
    const neonViaIaHabilitado = await checkAiNeonEnabled();

    if (genAI && neonViaIaHabilitado) {
      // ── CAMINO CON GEMINI (Function Calling real) ────────────────────
      try {
        const idsValidosTecnicos = new Set(hallazgosTecnicos.map((h) => h.targetId));
        const idsValidosAcademicos = new Set(hallazgosAcademicos.map((h) => h.studentId));
        const promptHallazgos = `Institución auditada (sk): ${sk}\n\nHallazgos técnicos de esta institución:\n${JSON.stringify(hallazgosTecnicos)}\n\nHallazgos académicos de esta institución:\n${JSON.stringify(hallazgosAcademicos.map((h) => ({ studentId: h.studentId, reason: h.reason, level: h.level })))}\n\nPara cada hallazgo técnico invoca repairDataIntegrity con su targetId exacto. Para cada hallazgo académico invoca flagAcademicAlert con su studentId exacto, el "reason" dado y el "level" dado. Al final invoca notifySuperadmin con el resumen ejecutivo de esta institución.`;

        // RONDA 48: migrado al wrapper central de resiliencia — reintenta
        // el mismo modelo con backoff ante 429/503 y cambia de modelo ante
        // 404, antes de caer al motor determinista (catch de abajo).
        // RONDA 52: httpOptions.timeout explícito (ver comentario junto a
        // TIMEOUT_GEMINI_FUNCTION_CALLING_MS en gemini-config.ts) — sin
        // esto, un intento colgado podía consumir tiempo indefinido antes
        // de que el wrapper de resiliencia entrara a decidir el siguiente
        // paso, causando la lentitud/timeout reportados.
        const intentoFC = await llamarGeminiConResiliencia((modelo) => genAI.models.generateContent({
          model: modelo,
          contents: promptHallazgos,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.2, // baja: esto ejecuta acciones reales, no conversa
            tools: TOOLS_DECLARATION,
            httpOptions: { timeout: TIMEOUT_GEMINI_FUNCTION_CALLING_MS },
          },
        }), { modelos: AGENT_CANDIDATE_MODELS, etiqueta: 'Agente Auditor' });
        if (!intentoFC.ok) throw intentoFC.error || new Error('Ningún modelo Gemini disponible para Function Calling.');
        const respuesta = intentoFC.resultado;

        const llamadas = respuesta.functionCalls || [];
        usoGenAI = true;
        for (const llamada of llamadas) {
          const nombre = llamada.name;
          const args = llamada.args || {};
          const ejecutor = EJECUTORES_HERRAMIENTAS[nombre];
          if (!ejecutor) continue;
          // SALVAGUARDA ANTI-ALUCINACIÓN: nunca se ejecuta una función cuyo
          // target no fue detectado de forma independiente por el motor
          // determinista PARA ESTA MISMA INSTITUCIÓN.
          if (nombre === 'repairDataIntegrity' && !idsValidosTecnicos.has(args.targetId)) {
            logsAcumulados.push({ category: 'Tecnico', issueDetected: `Gemini propuso repairDataIntegrity con un targetId ("${args.targetId}") que no corresponde a ningún hallazgo técnico real de ${sk}.`, actionTaken: 'Llamada IGNORADA por seguridad.', status: 'Informativo', details: { sk, nombre, args } });
            continue;
          }
          if (nombre === 'flagAcademicAlert' && !idsValidosAcademicos.has(args.studentId)) {
            logsAcumulados.push({ category: 'Academico', issueDetected: `Gemini propuso flagAcademicAlert con un studentId ("${args.studentId}") que no corresponde a ningún hallazgo académico real de ${sk}.`, actionTaken: 'Llamada IGNORADA por seguridad.', status: 'Informativo', details: { sk, nombre, args } });
            continue;
          }
          if (nombre === 'triggerSystemSync' && args.nodeId !== sk) {
            continue; // fuera de alcance de esta institución — se ignora en silencio (no es un hallazgo, solo una desviación de alcance)
          }
          const ctxLlamada = nombre === 'flagAcademicAlert' ? { sk } : ctx;
          const resultado = await ejecutor(args, ctxLlamada);
          if (resultado?.log) logsAcumulados.push(resultado.log);
          if (resultado?.mensaje) accionesInstitucion.push(resultado.mensaje);
        }
      } catch (err) {
        console.warn(`⚠️  [EcosystemAgent] Falló Function Calling de Gemini para ${sk}, se completa con el motor determinista:`, err?.message || err);
        usoGenAI = false;
      }
    }

    if (!usoGenAI) {
      // ── CAMINO DETERMINISTA (sin Gemini, o Gemini falló) — misma cobertura, sin narrativa generativa ──
      for (const h of hallazgosTecnicos) {
        const r = await repairDataIntegrity({ type: h.type, targetId: h.targetId }, ctx);
        if (r?.log) logsAcumulados.push(r.log);
        if (r?.mensaje) accionesInstitucion.push(r.mensaje);
      }
      for (const h of hallazgosAcademicos) {
        const r = await flagAcademicAlert({ studentId: h.studentId, reason: h.reason, level: h.level }, { sk });
        if (r?.log) logsAcumulados.push(r.log);
        if (r?.mensaje) accionesInstitucion.push(r.mensaje);
      }
    } else {
      usoRazonamientoGenerativoAlguno = true;
    }

    // Persiste la reparación (si hubo alguna) y re-sincroniza de inmediato
    // a los dispositivos ya conectados de esa institución, sin esperar su
    // próximo ciclo de polling.
    if (ctx.blobsModificados.has(sk)) {
      const tsReparacion = new Date();
      await db.update(kvStore).set({ value: blobActual, updatedAt: tsReparacion }).where(eq(kvStore.key, sk));
      invalidarDbCache(sk); // misma caché de 5s que ya usa GET /api/inetis/db — sin esto, un dispositivo podría ver el dato viejo hasta por 5s más tras la reparación
      await triggerSystemSync({ nodeId: sk });
      totalReparaciones++;
    }

    accionesTotales.push(...accionesInstitucion.map((m) => `[${sk}] ${m}`));
  }

  const hallazgosSincronizacion = auditarFlagsSincronizacion(gestorBlob);
  hallazgosSincronizacion.forEach((h) => {
    logsAcumulados.push({
      category: 'Sincronizacion',
      issueDetected: h.descripcion,
      actionTaken: 'Registrado como sugerencia para el desarrollador — el agente no modifica gestorDB.platforms directamente (fuera del alcance de sus 4 herramientas autorizadas).',
      status: 'Informativo',
      details: { sk: h.sk, sugerenciaEsquema: false },
    });
  });

  // Reporte final consolidado de TODO el ciclo (todas las instituciones).
  const resumenFinal = notifySuperadmin({
    summary: `Ciclo de auditoría (${trigger || 'manual'}): ${totalHallazgosTecnicos} hallazgo(s) técnico(s) y ${totalHallazgosAcademicos} hallazgo(s) académico(s) sobre ${institucionesCambiadas.length} institución(es) con cambios recientes. ${totalReparaciones} institución(es) recibieron una reparación técnica.`,
    actionsTaken: accionesTotales,
  });
  logsAcumulados.push(resumenFinal.log);

  // ── UNA SOLA escritura en lote — nunca una fila a la vez. ───────────────
  if (logsAcumulados.length) {
    await db.insert(agentAuditLogs).values(logsAcumulados.map((l) => ({
      category: l.category,
      issueDetected: l.issueDetected,
      actionTaken: l.actionTaken,
      status: l.status,
      details: l.details || {},
    })));
  }

  // RONDA 52 — el cursor NUNCA debe avanzar hasta "ahora" cuando el LIMIT
  // recortó el resultado (filasCambiadas.length === LIMITE_INSTITUCIONES_POR_CICLO
  // significa "puede haber más filas pendientes que no vimos en este
  // ciclo"): si avanzara hasta "ahora", esas filas restantes (con
  // updated_at menor a "ahora" pero mayor al cursor viejo) quedarían
  // huérfanas para siempre, porque la próxima consulta usa `gt(cursor)`.
  // En cambio, se avanza solo hasta el updated_at de la ÚLTIMA fila
  // REALMENTE procesada en este ciclo (filasCambiadas está ordenada ASC,
  // así que es la más reciente del lote) — el próximo ciclo retoma
  // exactamente donde este se quedó, sin perder ni repetir ninguna fila.
  // Cuando NO se llegó al límite (se procesó todo lo pendiente), se sigue
  // usando "ahora" como antes, igual que en Rondas previas.
  const hayMasInstitucionesPendientes = filasCambiadas.length === LIMITE_INSTITUCIONES_POR_CICLO;
  const nuevoCursor = hayMasInstitucionesPendientes
    ? filasCambiadas[filasCambiadas.length - 1].updatedAt
    : ahora;

  await guardarCursorUltimaAuditoria(nuevoCursor, {
    institucionesRevisadas: institucionesCambiadas.length,
    hallazgosTecnicos: totalHallazgosTecnicos,
    hallazgosAcademicos: totalHallazgosAcademicos,
    usoRazonamientoGenerativoAlguno,
    hayMasInstitucionesPendientes,
  });

  return {
    ok: true,
    sinCambios: false,
    trigger: trigger || 'manual',
    institucionesRevisadas: institucionesCambiadas.length,
    hallazgosTecnicos: totalHallazgosTecnicos,
    hallazgosAcademicos: totalHallazgosAcademicos,
    reparacionesAplicadas: totalReparaciones,
    usoRazonamientoGenerativo: usoRazonamientoGenerativoAlguno,
    hayMasInstitucionesPendientes,
    logsEscritos: logsAcumulados.length,
    durationMs: Date.now() - inicio,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 9) CONSULTA DE LOGS PARA EL PANEL /ADMIN
// ────────────────────────────────────────────────────────────────────────────

// RONDA 55 — paginación real por página (page/limit), pedida explícitamente
// por el coordinador para "logs de auditoría". Antes solo existía `limit`
// (tope simple, sin forma de pedir la SIGUIENTE tanda) — se agrega `page`
// (1-based) y `offset` calculado, manteniendo el mismo tope máximo de 300
// por página (documentado, ya existía) y el mismo default de 100. Se pide
// `limit+1` filas para saber si hay más sin una segunda consulta COUNT(*)
// aparte contra Neon.
export async function listarLogsAuditoria({ status, category, limit, page } = {}) {
  const condiciones = [
    status ? eq(agentAuditLogs.status, status) : undefined,
    category ? eq(agentAuditLogs.category, category) : undefined,
  ].filter(Boolean);
  const limiteReal = Math.min(parseInt(limit || '100', 10) || 100, 300);
  const paginaReal = Math.max(parseInt(page || '1', 10) || 1, 1);
  const offset = (paginaReal - 1) * limiteReal;
  const filas = await db
    .select()
    .from(agentAuditLogs)
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(agentAuditLogs.timestamp))
    .limit(limiteReal + 1)
    .offset(offset);
  const hasMore = filas.length > limiteReal;
  return { filas: hasMore ? filas.slice(0, limiteReal) : filas, page: paginaReal, limit: limiteReal, hasMore };
}

// ────────────────────────────────────────────────────────────────────────────
// 10) PARSER DE VOZ/AUDIO A NOTAS (Structured Outputs de Gemini)
// ────────────────────────────────────────────────────────────────────────────

const VOICE_GRADES_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    notas: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          estudianteNombreDetectado: { type: Type.STRING, description: 'Nombre del estudiante tal como se mencionó al dictar' },
          nota: { type: Type.NUMBER, description: 'Valor numérico de la nota, entre 0.0 y 5.0' },
          confianza: { type: Type.STRING, enum: ['alta', 'media', 'baja'], description: 'Qué tan seguro está el modelo de haber entendido correctamente el nombre y el valor' },
        },
        required: ['estudianteNombreDetectado', 'nota', 'confianza'],
      },
    },
  },
  required: ['notas'],
};

/**
 * Convierte un dictado de voz (transcrito a texto por el navegador, igual
 * que ya hace iniciarVozNota()/iniciarVozNotaAct() en el frontend) en un
 * arreglo estructurado {estudianteNombreDetectado, nota, confianza} listo
 * para que EL DOCENTE lo revise y confirme antes de guardarlo — este
 * endpoint NUNCA escribe directamente en la base de datos: solo interpreta
 * texto y devuelve JSON. Guardar la nota sigue siendo, como siempre, una
 * acción explícita del docente contra /api/inetis/db — así se respeta la
 * Soberanía Académica también aquí: la IA nunca decide una nota por su
 * cuenta, solo ayuda a transcribir varias de un tirón.
 */
export async function processVoiceGrades({ transcript, listaEstudiantes }) {
  const genAI = getAgentGenAI();
  if (!genAI) {
    return { ok: false, error: 'GEMINI_API_KEY_NO_CONFIGURADA', mensaje: 'El parser de voz a notas requiere GEMINI_API_KEY configurada en el servidor.' };
  }
  const nombresConocidos = Array.isArray(listaEstudiantes) && listaEstudiantes.length
    ? `Lista de estudiantes válidos del grupo (usa EXACTAMENTE estos nombres cuando reconozcas a quién se refiere, aunque el dictado tenga errores de pronunciación): ${listaEstudiantes.join(', ')}.`
    : '';
  const prompt = `Un docente colombiano dictó de corrido una lista de notas de sus estudiantes (escala 0.0 a 5.0) para varias personas seguidas, por ejemplo: "Ana María cuatro punto cinco, Carlos tres, Beatriz cinco". Extrae cada pareja (estudiante, nota) del siguiente dictado transcrito. ${nombresConocidos}\n\nDictado transcrito:\n"""${String(transcript || '').slice(0, 4000)}"""`;
  try {
    // RONDA 48: migrado al wrapper central de resiliencia.
    const intentoVoz = await llamarGeminiConResiliencia((modelo) => genAI.models.generateContent({
      model: modelo,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: VOICE_GRADES_SCHEMA,
      },
    }), { modelos: AGENT_CANDIDATE_MODELS, etiqueta: 'Agente Auditor (voz a notas)' });
    if (!intentoVoz.ok) throw intentoVoz.error || new Error('Ningún modelo Gemini disponible.');
    const respuesta = intentoVoz.resultado;
    const texto = respuesta.text || '{"notas":[]}';
    const parsed = JSON.parse(texto);
    const notas = (parsed.notas || []).map((n) => ({
      ...n,
      nota: Math.min(5, Math.max(0, Number(n.nota) || 0)),
    }));
    return { ok: true, notas };
  } catch (err) {
    console.error('❌ [EcosystemAgent] Error en processVoiceGrades:', err?.message || err);
    return { ok: false, error: 'ERROR_GEMINI', mensaje: err?.message || 'No se pudo procesar el dictado de voz.' };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 11) CRON JOB — auditoría global semanal (domingo 2:00 a.m., hora Colombia)
//     Mismo patrón (setInterval + comprobación de hora) que ya usan
//     iniciarRespaldosAutomaticosProgramados()/iniciarTareasAutonomasProgramadas()
//     en src/index.ts — no hacía falta agregar node-cron como dependencia
//     nueva para esto.
// ────────────────────────────────────────────────────────────────────────────

let _ultimaEjecucionCronDia = -1; // evita disparar 2 veces dentro del mismo minuto/hora si el proceso reinicia

function _esMomentoDeAuditoriaSemanal() {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const partes = fmt.formatToParts(new Date());
    const map = Object.fromEntries(partes.map((p) => [p.type, p.value]));
    const esDomingo = map.weekday === 'Sun';
    const hora = parseInt(map.hour, 10);
    const minuto = parseInt(map.minute, 10);
    return esDomingo && hora === 2 && minuto < 15; // ventana de 15 min para no depender de que el timer caiga justo en el minuto exacto
  } catch {
    return false;
  }
}

export function iniciarAuditoriaProgramada() {
  setInterval(async () => {
    // Ronda 34 — Switch "Agente IA - Auditoría Automática del Ecosistema"
    // (ENABLE_AI_ECOSYSTEM_AUDITOR): se consulta EN CADA tick del
    // temporizador (no solo al arrancar el servidor), así que apagarlo
    // desde el panel del Súper Admin detiene la auditoría semanal
    // programada de inmediato (máximo el retraso de la caché de 8s de
    // gestorDB) sin reiniciar el proceso en Render. El disparo MANUAL
    // (POST /api/agent/run-full-audit, botón "Disparar Auditoría Ahora"
    // del panel) NO se ve afectado por este flag a propósito: el pedido
    // es desactivar específicamente "cron jobs, tareas programadas o
    // eventos en segundo plano", no una acción explícita del Súper Admin.
    if (!(await checkAiAuditorEnabled())) return;
    if (!_esMomentoDeAuditoriaSemanal()) return;
    const hoy = new Date().toDateString();
    if (_ultimaEjecucionCronDia === hoy) return;
    _ultimaEjecucionCronDia = hoy;
    try {
      const resultado = await runFullAudit({ trigger: 'cron-semanal' });
      console.log('🕵️  [EcosystemAgent] Auditoría semanal ejecutada:', JSON.stringify(resultado));
    } catch (err) {
      console.error('❌ [EcosystemAgent] Falló la auditoría semanal programada:', err?.message || err);
    }
  }, 10 * 60 * 1000); // revisa cada 10 min si ya es domingo 2 a.m. — igual de liviano que los demás cron caseros del proyecto
}
