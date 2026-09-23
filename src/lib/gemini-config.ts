// ════════════════════════════════════════════════════════════════════════════
// RONDA 48 — CONFIGURACIÓN CENTRAL DE MODELOS GEMINI + WRAPPER DE RESILIENCIA
// ------------------------------------------------------------------------------
// CONTEXTO (para que quien lea esto en el futuro entienda por qué existe este
// archivo y no una simple constante más):
//
//   Ronda 47 fijó 'gemini-2.5-flash' como primario tras retirar
//   'gemini-1.5-flash' (confirmado deprecado por 404 real en los logs del
//   usuario). Una ronda después, el mismo usuario reporta que AHORA es
//   'gemini-2.5-flash' el que da 404 intermitentemente, y sugiere volver a
//   'gemini-1.5-flash' — que, según la documentación pública de Google
//   (ai.google.dev/gemini-api/docs/deprecations, consultada en esta ronda),
//   está retirado desde hace tiempo y NO debe reintroducirse bajo ninguna
//   circunstancia, sin importar qué tan tentador parezca como "solución
//   rápida" — reintroducirlo solo cambiaría un 404 garantizado por otro.
//
//   La familia Gemini 2.5 (ai.google.dev/gemini-api/docs/deprecations) está
//   documentada con fecha de retiro aproximada a mediados de octubre de 2026
//   — es decir, TODAVÍA puede funcionar por unas semanas, pero ya no es una
//   apuesta segura como ÚNICO modelo. La generación recomendada en esta
//   fecha (documentada en ai.google.dev/gemini-api/docs/gemini-3 y
//   ai.google.dev/gemini-api/docs/latest-model) es la familia Gemini 3.x.
//
//   LECCIÓN DE FONDO: perseguir "el nombre de modelo correcto" ronda tras
//   ronda NO es sostenible — ni este entorno ni el ingeniero que atiende la
//   siguiente ronda tienen acceso de red en vivo a la API de Google para
//   confirmar cuál modelo responde 200 en el momento exacto en que se lee
//   este comentario, y Google depreca modelos con una cadencia más rápida
//   que el ciclo de rondas de este proyecto. La solución de fondo NO es
//   adivinar mejor — es que el propio sistema prueba una LISTA ordenada de
//   candidatos, con reintento y cambio automático de modelo, y que esa
//   lista se pueda ajustar con una sola variable de entorno (GEMINI_MODEL)
//   sin esperar una nueva ronda de desarrollo ni tocar código.
//
// ⚠️ MANTENIMIENTO: esta lista de candidatos deberá revisarse periódicamente
// (cada pocos meses, o en cuanto la consola de Google Cloud / los logs del
// servidor muestren 404 persistentes en TODOS los candidatos) porque Google
// deprecia modelos con frecuencia. Ajustar el primario sin tocar código:
// variable de entorno GEMINI_MODEL (ver .env.example).
// ════════════════════════════════════════════════════════════════════════════

/** Normaliza un nombre de modelo: quita el prefijo 'models/' (algunas
 * respuestas/documentación de Google lo incluyen) y espacios accidentales. */
function _normalizarModelo(nombre: string): string {
  return String(nombre || '').replace(/^models\//, '').trim();
}

/**
 * Modelo primario: SIEMPRE configurable sin tocar código vía GEMINI_MODEL.
 * Si no está seteada, se usa un default razonable de la generación actual
 * (Gemini 3.x, documentada como recomendada en septiembre 2026). Este
 * default también quedará obsoleto eventualmente — por eso existe
 * MODEL_FALLBACKS debajo, y por eso GEMINI_MODEL es la vía recomendada para
 * ajustarlo sin esperar una nueva ronda.
 */
export const DEFAULT_PRIMARY_MODEL = 'gemini-3.5-flash';
export const PRIMARY_MODEL = _normalizarModelo(process.env.GEMINI_MODEL || DEFAULT_PRIMARY_MODEL);

/**
 * Red de seguridad ordenada de modelos de respaldo, probados EN ESTE ORDEN
 * si el primario falla (404 persistente, o agotó sus reintentos en
 * 429/503). Deliberadamente NUNCA incluye 'gemini-1.5-flash' (familia
 * retirada — ver comentario de cabecera). Incluye variantes 3.x adicionales,
 * el alias 'gemini-flash-latest' (documentado por Google como apuntador al
 * flash más reciente, pero con reportes de 404 inesperados cuando Google
 * re-apunta el alias antes de actualizar su propia documentación — por eso
 * va como una opción más de la lista, nunca como primario ni como única
 * red de seguridad) y 'gemini-2.5-flash' al final, como puente de
 * transición mientras esa familia siga respondiendo (documentada con
 * retiro aproximado a mediados de octubre de 2026 — revisar esta lista
 * cuando esa fecha se acerque o pase).
 */
// RONDA 50 — el usuario volvió a mencionar 'gemini-1.5-flash' como ejemplo
// en su reporte de bug. Se investigó de nuevo (mismo criterio de Ronda 48,
// sin acceso de red en vivo a la API de Google desde este entorno): la
// familia Gemini 1.5 sigue documentada como RETIRADA por completo en
// ai.google.dev/gemini-api/docs/deprecations, así que NO se reintroduce bajo
// ninguna circunstancia — hacerlo solo cambiaría un 404/429 real por otro
// 404 garantizado. Se añade en cambio 'gemini-2.0-flash' AL FINAL de la
// lista (después de 'gemini-2.5-flash', como red de seguridad de último
// recurso): es un modelo real y fue GA (disponibilidad general) documentado
// por Google. No se puede confirmar en vivo desde este entorno si sigue
// activo hoy (22 de septiembre de 2026) o si ya fue retirado igual que 1.5 —
// esa es la incertidumbre honesta que se documenta aquí. Como va al final de
// la cadena de fallback (nunca como primario), el peor caso de que también
// esté retirado es un 404 más antes de agotar la lista, sin costo real de
// disponibilidad; el mejor caso es una red de seguridad adicional real.
export const MODEL_FALLBACKS: string[] = [
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
].map(_normalizarModelo);

/** Lista final, deduplicada, con el primario siempre de primero. */
export const ALL_CANDIDATE_MODELS: string[] = [PRIMARY_MODEL, ...MODEL_FALLBACKS].filter(
  (modelo, indice, self) => Boolean(modelo) && self.indexOf(modelo) === indice
);

// RONDA 52 — TIMEOUT EXPLÍCITO PARA EL FLUJO DE FUNCTION CALLING (Agente
// Auditor / consultas contra Neon).
//
// Investigación: el SDK `@google/genai` NO aplica ningún timeout por
// defecto a sus llamadas HTTP (internamente, `timeout_ms` vale -1 —
// "sin límite" — salvo que `httpOptions.timeout` se pase explícitamente en
// la llamada). Es decir, el "timeout de la llamada a Gemini" que el usuario
// reporta no era un valor corto mal configurado — era la AUSENCIA total de
// un límite, lo cual es peor: un intento individual puede quedar colgado
// indefinidamente (una conexión TCP que nunca responde ni falla) sin que el
// wrapper de resiliencia (llamarGeminiConResiliencia, Ronda 48/50) siquiera
// entre a su lógica de backoff/cambio de modelo, porque esa lógica solo
// actúa DESPUÉS de que la llamada actual termina (con éxito o error). El
// Agente Auditor (src/services/ecosystemAgent.js) procesa instituciones EN
// SERIE, cada una con su propia llamada de Function Calling — si una sola
// llamada se cuelga sin límite, el ciclo completo de auditoría (y la
// petición HTTP que lo disparó, POST /api/agent/run-full-audit) puede
// tardar mucho más de lo esperado antes de que CUALQUIER capa (Express,
// Render, el navegador) decida cortar la conexión — lo que el usuario
// percibe como "lento y a veces timeout".
//
// Solución: fijar explícitamente `httpOptions.timeout` en 18000ms (dentro
// del margen de 15-20s pedido) SOLO para la llamada de Function Calling del
// Agente Auditor (el flujo específico reportado — no se tocan los otros 4
// endpoints conversacionales de Adán, que no hacen Function Calling y no
// fueron parte de este reporte). Este timeout es POR INTENTO (se reinicia
// en cada reintento del wrapper de resiliencia), así que NO se acumula ni
// genera "timeouts en cascada": un intento colgado se corta a los 18s como
// máximo, y entonces (recién ahí) el wrapper decide si reintenta el mismo
// modelo (con su propio backoff ya existente) o pasa al siguiente —
// exactamente el mismo flujo de decisión de siempre, solo que ahora un
// intento individual tiene un techo razonable en vez de ser potencialmente
// infinito.
export const TIMEOUT_GEMINI_FUNCTION_CALLING_MS = 18000;

export interface OpcionesResilienciaGemini {
  /** Máximo de intentos (incluyendo el primero) POR modelo antes de pasar al
   * siguiente candidato cuando el error es 503 (saturación temporal).
   * Default: 3. */
  maxReintentosPorModelo?: number;
  /** Base del backoff exponencial en milisegundos para 503 (1er reintento
   * espera esto, el 2do el doble, el 3ro el cuádruple, etc.). Default: 1000. */
  backoffBaseMs?: number;
  /** RONDA 50 — máximo de intentos (incluyendo el primero) POR MODELO
   * específicamente para 429 (RESOURCE_EXHAUSTED / límite de cuota). Ver
   * comentario de diseño debajo de `_clasificarErrorGemini` para la
   * justificación de por qué es un número MENOR que para 503. Default: 2. */
  maxReintentosPor429?: number;
  /** RONDA 50 — base del backoff exponencial en milisegundos específica para
   * 429. Default: 4000 (más lento que el de 503, ver justificación abajo). */
  backoffBase429Ms?: number;
  /** Lista de modelos candidatos a usar en vez de ALL_CANDIDATE_MODELS
   * (por ejemplo, para el Agente Auditor, que tiene su propia variable de
   * entorno GEMINI_AGENT_MODEL como primario). */
  modelos?: string[];
  /** Etiqueta para los logs (ej. 'Adán chat', 'Agente Auditor'), para poder
   * distinguir en consola qué punto de instanciación reintentó/cambió de
   * modelo. */
  etiqueta?: string;
}

export interface ResultadoResilienciaGemini<T> {
  ok: boolean;
  resultado?: T;
  modeloUsado?: string;
  modelosIntentados: string[];
  error?: any;
  /** RONDA 50 — clasificación del último error (cuando ok:false), ya lista
   * para mapear a un mensaje amigable con `mensajeAmigablePorError()`. */
  tipoError?: TipoErrorGemini;
}

export type TipoErrorGemini = 'RATE_LIMIT_429' | 'OVERLOAD_503' | 'NOT_FOUND' | 'OTRO';

/**
 * Clasifica un error devuelto por el SDK de Gemini (@google/genai). El SDK
 * expone `ApiError` con una propiedad `.status` (código HTTP numérico) — se
 * usa esa como fuente principal. Como red de seguridad adicional (por si el
 * SDK cambia de forma en una versión futura, o el error viene de una capa
 * intermedia como fetch), también se inspecciona el texto del mensaje.
 *
 * RONDA 50 — DECISIÓN DE DISEÑO (separación 429 vs 503):
 * Ronda 48 trataba 429 y 503 como el mismo caso ('RATE_LIMIT'), con el mismo
 * backoff (reintentar el MISMO modelo 3 veces, 1s/2s/4s). El usuario reportó
 * un mensaje de error crudo filtrándose cuando se agotan TODOS los modelos
 * bajo 429, y el coordinador pidió reconsiderar el backoff específicamente
 * para 429. Análisis:
 *   - 503 (UNAVAILABLE/overloaded) es saturación TEMPORAL del servidor de
 *     Google — puede resolverse en segundos, así que reintentar el MISMO
 *     modelo con backoff corto (1s/2s/4s, hasta 3 intentos) sigue siendo
 *     razonable: se mantiene exactamente el comportamiento de Ronda 48 para
 *     este caso.
 *   - 429 (RESOURCE_EXHAUSTED) es un límite de CUOTA (por minuto, por día, o
 *     por RPM del plan de la API key) — reintentar el MISMO modelo en un
 *     bucle rápido de pocos segundos casi nunca libera cuota a tiempo, y
 *     además maltrata la API key repitiendo peticiones contra un límite que
 *     ya se sabe que está excedido ("no satures la API Key en bucle rápido",
 *     pedido explícito del coordinador). Por eso, para 429 se usan MENOS
 *     reintentos por modelo (2 en vez de 3: un solo reintento antes de
 *     rendirse con ese modelo) y un backoff INICIAL más largo (4000ms en vez
 *     de 1000ms) — así se le da más tiempo real a la cuota de refrescar en
 *     ese único reintento, pero se pasa MÁS RÁPIDO al siguiente modelo de la
 *     lista (que típicamente tiene su propia cuota independiente), en vez de
 *     insistir en un modelo ya bloqueado. Ambos parámetros son configurables
 *     vía `OpcionesResilienciaGemini.maxReintentosPor429` /
 *     `backoffBase429Ms` si un despliegue concreto necesita ajustarlos.
 */
function _clasificarErrorGemini(err: any): TipoErrorGemini {
  const status = Number(err?.status ?? err?.statusCode ?? err?.code);
  if (status === 429) return 'RATE_LIMIT_429';
  if (status === 503) return 'OVERLOAD_503';
  if (status === 404) return 'NOT_FOUND';
  const msg = String(err?.message || err || '').toLowerCase();
  if (/\b429\b/.test(msg) || msg.includes('resource_exhausted') || msg.includes('quota')) {
    return 'RATE_LIMIT_429';
  }
  if (/\b503\b/.test(msg) || msg.includes('overloaded') || msg.includes('unavailable')) {
    return 'OVERLOAD_503';
  }
  if (/\b404\b/.test(msg) || msg.includes('not_found') || msg.includes('not found') || msg.includes('is not found for api version')) {
    return 'NOT_FOUND';
  }
  return 'OTRO';
}

/**
 * RONDA 50 — mapea la clasificación de un error de Gemini a un mensaje
 * amigable y limpio para el usuario final. NUNCA incluye el objeto de error
 * crudo del SDK, JSON.stringify de la respuesta, ni el `.message` técnico
 * original — exactamente lo que el usuario reportó que se estaba filtrando
 * al chat. Se usa en los 4 puntos de instanciación reales (`/ai/chat` SSE,
 * `/ai/general`, `/ai/psicopedagogico`, Asistente Universitario) como última
 * línea de defensa antes de escribir cualquier cosa a la respuesta HTTP.
 */
// RONDA 51 — el usuario pidió el mensaje amigable de 429/503 con un texto
// LIGERAMENTE distinto al fijado en Ronda 50, y esta vez pidió explícitamente
// que sea EL MISMO texto para ambos códigos (429 de cuota y 503 de
// saturación), no dos mensajes distintos como se hizo en Ronda 50. Se
// respeta el pedido literal: ambos casos devuelven ahora exactamente este
// texto. La clasificación interna (RATE_LIMIT_429 vs OVERLOAD_503) y el
// backoff diferenciado de Ronda 50 NO se tocan — solo convergen en el mismo
// mensaje visible al usuario final.
const MENSAJE_AMIGABLE_ALTO_VOLUMEN_IA = '⚡ El servicio de IA está experimentando un alto volumen de consultas en este momento. Por favor, intenta tu pregunta nuevamente en unos segundos.';

export function mensajeAmigablePorError(errOrResultado: any): string {
  const tipo: TipoErrorGemini = errOrResultado && typeof errOrResultado === 'object' && 'tipoError' in errOrResultado && errOrResultado.tipoError
    ? errOrResultado.tipoError
    : _clasificarErrorGemini(errOrResultado?.error ?? errOrResultado);
  switch (tipo) {
    case 'RATE_LIMIT_429':
    case 'OVERLOAD_503':
      return MENSAJE_AMIGABLE_ALTO_VOLUMEN_IA;
    case 'NOT_FOUND':
      return '⚠️ El servicio de IA no está disponible en este momento. Por favor, contacta al administrador del sistema si el problema persiste.';
    default:
      return '⚠️ Ocurrió un problema inesperado al conectar con el servicio de IA. Por favor, intenta de nuevo en unos minutos.';
  }
}

function _dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrapper único de resiliencia para TODAS las llamadas a Gemini del
 * sistema. Recibe una función `construirLlamada(modelo)` que hace la
 * llamada real al SDK con ese modelo (generateContent, chats.create +
 * sendMessageStream, etc. — este wrapper es agnóstico a la forma exacta de
 * la llamada, así puede reutilizarse tanto para respuestas simples como
 * para streaming) y:
 *
 *   1) Prueba PRIMARY_MODEL (o el primer elemento de `opciones.modelos`)
 *      primero.
 *   2) Si el error es 429/503 (saturación puntual): reintenta el MISMO
 *      modelo con backoff exponencial (1s, 2s, 4s, ... hasta
 *      `maxReintentosPorModelo`) antes de darse por vencido con ese modelo.
 *   3) Si el error es 404 (modelo no encontrado/descontinuado) o se agotó
 *      el backoff sin éxito: pasa al siguiente modelo de la lista,
 *      repitiendo el mismo patrón de retry.
 *   4) Si TODOS los modelos fallan: devuelve `{ ok:false, error, ... }` —
 *      NUNCA lanza una excepción no capturada ni tumba el proceso; el
 *      llamador decide cómo convertir esto en un mensaje amable.
 *
 * Logging limpio: un único log INFO por reintento o cambio de modelo (nunca
 * un stack trace crudo para estos casos esperados) — un fallo real e
 * inesperado (tipo 'OTRO') sí se deja visible vía `console.warn` una vez,
 * para no ocultar bugs genuinos, pero tampoco revienta el proceso.
 */
export async function llamarGeminiConResiliencia<T>(
  construirLlamada: (modelo: string) => Promise<T>,
  opciones: OpcionesResilienciaGemini = {}
): Promise<ResultadoResilienciaGemini<T>> {
  const modelos = opciones.modelos && opciones.modelos.length ? opciones.modelos : ALL_CANDIDATE_MODELS;
  const maxReintentos503 = Math.max(1, opciones.maxReintentosPorModelo ?? 3);
  const backoffBase503 = Math.max(1, opciones.backoffBaseMs ?? 1000);
  // RONDA 50 — parámetros separados para 429 (ver comentario de diseño junto
  // a _clasificarErrorGemini): menos reintentos por modelo, backoff inicial
  // más largo, para no saturar la API key en bucle rápido y pasar más rápido
  // al siguiente modelo de respaldo.
  const maxReintentos429 = Math.max(1, opciones.maxReintentosPor429 ?? 2);
  const backoffBase429 = Math.max(1, opciones.backoffBase429Ms ?? 4000);
  const etiqueta = opciones.etiqueta || 'Gemini';
  const modelosIntentados: string[] = [];
  let ultimoError: any = null;
  let ultimoTipo: TipoErrorGemini = 'OTRO';

  for (let mi = 0; mi < modelos.length; mi++) {
    const modelo = modelos[mi];
    modelosIntentados.push(modelo);

    for (let intento = 1; ; intento++) {
      try {
        const resultado = await construirLlamada(modelo);
        if (mi > 0) {
          console.log(`[${etiqueta}] Modelo anterior no disponible, usando fallback ${modelo} (intento ${modelosIntentados.length}/${modelos.length} de la lista de candidatos).`);
        } else if (intento > 1) {
          console.log(`[${etiqueta}] Reintento ${intento} exitoso en ${modelo}.`);
        }
        return { ok: true, resultado, modeloUsado: modelo, modelosIntentados };
      } catch (err: any) {
        ultimoError = err;
        const tipo = _clasificarErrorGemini(err);
        ultimoTipo = tipo;

        if (tipo === 'RATE_LIMIT_429') {
          if (intento < maxReintentos429) {
            const espera = backoffBase429 * Math.pow(2, intento - 1);
            console.log(`[${etiqueta}] Reintento ${intento}/${maxReintentos429} tras 429 (cuota) en ${modelo} (esperando ${espera}ms)...`);
            await _dormir(espera);
            continue; // mismo modelo, siguiente intento (pocos, backoff largo)
          }
          const siguiente = modelos[mi + 1];
          console.log(`[${etiqueta}] ${modelo} sigue con límite de cuota (429) tras ${maxReintentos429} intento(s)${siguiente ? `, pasando de inmediato al fallback ${siguiente}` : ' — sin más modelos de respaldo en la lista'}.`);
          break; // pasa al siguiente modelo, sin insistir más en este
        }

        if (tipo === 'OVERLOAD_503') {
          if (intento < maxReintentos503) {
            const espera = backoffBase503 * Math.pow(2, intento - 1);
            console.log(`[${etiqueta}] Reintento ${intento}/${maxReintentos503} tras 503 (saturación temporal) en ${modelo} (esperando ${espera}ms)...`);
            await _dormir(espera);
            continue; // mismo modelo, siguiente intento
          }
          const siguiente = modelos[mi + 1];
          console.log(`[${etiqueta}] ${modelo} sigue saturado (503) tras ${maxReintentos503} intentos${siguiente ? `, usando fallback ${siguiente}` : ' — sin más modelos de respaldo en la lista'}.`);
          break;
        }

        if (tipo === 'NOT_FOUND') {
          const siguiente = modelos[mi + 1];
          console.log(`[${etiqueta}] Modelo ${modelo} no disponible (404)${siguiente ? `, usando fallback ${siguiente}` : ' — sin más modelos de respaldo en la lista'}.`);
          break; // pasa al siguiente modelo del arreglo externo
        }

        // Error de tipo 'OTRO' (no es un 404/429/503 esperado): se deja un
        // aviso (no un stack trace crudo) y se pasa al siguiente modelo,
        // por si el fallo es específico de este modelo/región y no del
        // sistema en general — nunca se detiene el proceso por esto.
        console.warn(`[${etiqueta}] Error inesperado con ${modelo}: ${err?.message || err}`);
        break;
      }
    }
  }

  return { ok: false, error: ultimoError, modelosIntentados, tipoError: ultimoTipo };
}

/**
 * Atajo para el caso más común: una llamada simple `genAI.models.generateContent(...)`.
 * `params` es todo lo que va dentro de `generateContent` EXCEPTO `model`
 * (el wrapper lo va sustituyendo por cada candidato).
 */
export async function generarContenidoConResiliencia(
  genAI: any,
  params: Record<string, any>,
  opciones: OpcionesResilienciaGemini = {}
): Promise<ResultadoResilienciaGemini<any>> {
  return llamarGeminiConResiliencia((modelo) => genAI.models.generateContent({ ...params, model: modelo }), opciones);
}
