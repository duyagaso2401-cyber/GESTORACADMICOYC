// ════════════════════════════════════════════════════════════════════════════
// RONDA 67 — SCRIPT DE DIAGNÓSTICO STANDALONE PARA GEMINI (punto 3 del
// reporte del usuario).
// ------------------------------------------------------------------------------
// CONTEXTO: el usuario reportó que el chat de IA muestra el mensaje amigable
// genérico ("El servicio de IA no está disponible en este momento...") incluso
// para una consulta trivial ("2+2?"), tanto con como sin acceso a BD. Ese
// mensaje viene de `mensajeAmigablePorError()` en `src/lib/gemini-config.ts`
// (Rondas 48/50) — es intencional que NUNCA muestre el error técnico crudo al
// usuario final, así que la app en sí no sirve para diagnosticar la causa
// real. Este script existe para eso: se ejecuta APARTE de la aplicación
// completa, imprime el detalle técnico exacto que el chat nunca muestra, y no
// requiere abrir el navegador ni interpretar logs de Express/Render.
//
// QUÉ HACE (en este orden):
//   1) Lee GEMINI_API_KEY (o GOOGLE_API_KEY como alternativa, mismo criterio
//      que `getGeminiApiKey()` en src/index.ts) desde las variables de
//      entorno — carga `.env` con `dotenv` primero, igual que el servidor.
//   2) Si la clave está ausente, lo dice explícitamente y se detiene ahí (esa
//      es, por sí sola, una causa suficiente y muy común del síntoma
//      reportado — especialmente en un entorno local donde nunca se configuró
//      una clave real).
//   3) Si la clave está presente, hace UNA llamada mínima real a la API de
//      Gemini ("Responde solo: OK" / maxOutputTokens bajo) usando el MISMO
//      modelo primario y la MISMA lista de candidatos de respaldo que ya usa
//      la aplicación completa (`PRIMARY_MODEL`/`ALL_CANDIDATE_MODELS` de
//      `src/lib/gemini-config.ts` — este script NUNCA hardcodea un nombre de
//      modelo aparte, para que el diagnóstico sea fiel a lo que la app
//      realmente intenta).
//   4) Reporta con claridad: si la llamada tuvo éxito (y con qué modelo de la
//      lista), o si falló (con qué modelo, qué código de estado HTTP y qué
//      mensaje exacto devolvió Google) — la única "traducción" que hace este
//      script es agregar una interpretación en español de la causa más
//      probable (clave inválida, cuota agotada, modelo no encontrado, etc.),
//      pero SIEMPRE junto al detalle técnico crudo, nunca en su lugar.
//
// CÓMO EJECUTARLO (ver también README de despliegue):
//   npx tsx scripts/diagnostico-gemini.ts
//   — o, si el proyecto ya tiene sus dependencias instaladas (`npm install`
//     ya corrido) —
//   npm exec tsx scripts/diagnostico-gemini.ts
//
// HONESTIDAD IMPORTANTE: este script no puede ejecutarse dentro del entorno
// donde se preparó esta ronda (sin acceso de red saliente a la API de
// Google ni una GEMINI_API_KEY real disponible aquí) — se entrega verificado
// solo en su SINTAXIS (con los métodos ya establecidos en este proyecto para
// archivos .ts) y en su LÓGICA (revisada línea por línea contra el mismo
// patrón que ya usa `GET /api/inetis/ai/status` en src/index.ts, que sí es
// código en producción). El usuario debe ejecutarlo en su propio entorno
// (local o en Render, vía shell) para obtener el resultado real con su
// propia clave.
// ════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { PRIMARY_MODEL, ALL_CANDIDATE_MODELS, DEFAULT_PRIMARY_MODEL } from '../src/lib/gemini-config.js';

function linea(caracter: string = '─'): string {
  return caracter.repeat(72);
}

function imprimirEncabezado(): void {
  console.log(linea('═'));
  console.log('  DIAGNÓSTICO DE CONECTIVIDAD — GEMINI / GOOGLE GENERATIVE AI');
  console.log('  (Ronda 67 — script standalone, no requiere el servidor completo)');
  console.log(linea('═'));
  console.log('');
}

/** Extrae, de forma robusta, el status HTTP y el mensaje de un error del SDK
 * `@google/genai` (o de una capa intermedia como `fetch`) — mismo criterio
 * que `_clasificarErrorGemini()` en `src/lib/gemini-config.ts`, pero aquí se
 * imprime tal cual para el usuario, sin traducirlo a un mensaje amigable
 * (ese "no ocultar nada" es justamente el propósito de este script). */
function describirError(err: any): { status: string; mensaje: string } {
  const status = String(err?.status ?? err?.statusCode ?? err?.code ?? 'desconocido');
  const mensaje = (err && (err.message || String(err))) || 'sin mensaje';
  return { status, mensaje };
}

/** Interpretación en español de la causa más probable, SOLO como ayuda de
 * lectura — nunca reemplaza el detalle técnico crudo que se imprime junto a
 * ella. */
function interpretarCausaProbable(status: string, mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (/api key not valid|invalid api key|api_key_invalid/.test(m)) {
    return 'La API key parece estar INVÁLIDA o mal copiada (Google la rechazó explícitamente). Verifique que GEMINI_API_KEY no tenga espacios, comillas ni caracteres de más, y que sea una clave activa generada en https://aistudio.google.com/apikey.';
  }
  if (status === '429' || /resource_exhausted|quota/.test(m)) {
    return 'Límite de CUOTA excedido (429) — no es un problema de configuración: la clave funciona, pero se agotó su límite de peticiones por minuto/día. Reintente en unos minutos, o revise el plan/cuota de esa clave en Google AI Studio.';
  }
  if (status === '503' || /overloaded|unavailable/.test(m)) {
    return 'El servidor de Google está SATURADO temporalmente (503) — no es un problema de esta aplicación ni de la clave. Reintente en unos segundos.';
  }
  if (status === '404' || /not_found|not found|is not found for api version/.test(m)) {
    return `El modelo probado NO fue encontrado por la API (404) — el nombre de modelo puede haber sido retirado/renombrado por Google desde la última revisión de src/lib/gemini-config.ts, o esta API key pertenece a un tipo de acceso (ej. Vertex AI en vez de la Generative Language API pública) que no reconoce ese nombre de modelo. Esto NO significa que deba reintroducirse 'gemini-1.5-flash' — esa familia está confirmada como retirada por completo (ver el comentario de cabecera de src/lib/gemini-config.ts, con la fuente de documentación de Google consultada) — significa que la lista de candidatos en ese archivo necesita revisarse contra el listado de modelos vigente de Google en este momento.`;
  }
  if (/network|fetch failed|enotfound|econnrefused|timeout/.test(m)) {
    return 'Parece un problema de RED (no de la API key ni del modelo) — este entorno no pudo alcanzar los servidores de Google. Verifique la conexión a internet o cualquier proxy/firewall corporativo que pueda estar bloqueando la salida a generativelanguage.googleapis.com.';
  }
  return 'Causa no reconocida automáticamente por este script — revise el mensaje técnico completo de arriba tal cual lo devolvió Google.';
}

async function main(): Promise<void> {
  imprimirEncabezado();

  // ── Paso 1: ¿está la clave presente? ─────────────────────────────────────
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  console.log('Paso 1 — Variable de entorno:');
  if (!apiKey) {
    console.log('  ❌ NINGUNA de GEMINI_API_KEY ni GOOGLE_API_KEY está configurada en este entorno.');
    console.log('');
    console.log('  Esta es, por sí sola, una causa suficiente del síntoma reportado');
    console.log('  ("El servicio de IA no está disponible..." incluso para "2+2?"):');
    console.log('  sin una clave, la aplicación NUNCA llega a intentar contactar a Gemini.');
    console.log('');
    console.log('  Solución: agregue una de estas 2 líneas a su archivo .env (en la raíz');
    console.log('  del proyecto, junto a package.json) con una clave real generada en');
    console.log('  https://aistudio.google.com/apikey, y reinicie el servidor:');
    console.log('');
    console.log('    GEMINI_API_KEY=AIza...su_clave_real...');
    console.log('    (o, alternativamente:)  GOOGLE_API_KEY=AIza...su_clave_real...');
    console.log('');
    console.log(linea('═'));
    process.exitCode = 1;
    return;
  }
  const enmascarada = apiKey.length > 8 ? apiKey.slice(0, 4) + '…' + apiKey.slice(-4) : '(muy corta — revísela)';
  console.log(`  ✅ Clave detectada (mostrada parcialmente por seguridad): ${enmascarada}`);
  console.log(`     Longitud: ${apiKey.length} caracteres. Fuente de la variable de entorno leída: ` +
    (process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY') + '.');
  console.log('');

  // ── Paso 2: modelo(s) que se van a probar (los MISMOS que usa la app) ────
  console.log('Paso 2 — Modelo(s) configurados en src/lib/gemini-config.ts (los mismos que usa la aplicación real, no una lista aparte):');
  console.log(`  Modelo primario (PRIMARY_MODEL): ${PRIMARY_MODEL}` +
    (PRIMARY_MODEL !== DEFAULT_PRIMARY_MODEL ? ' (tomado de la variable de entorno GEMINI_MODEL — el default de código es ' + DEFAULT_PRIMARY_MODEL + ')' : ' (el default de código; no hay GEMINI_MODEL configurada)'));
  console.log(`  Lista completa de candidatos, en orden de intento: ${ALL_CANDIDATE_MODELS.join(' → ')}`);
  console.log('');

  // ── Paso 3: inicializar el cliente ───────────────────────────────────────
  console.log('Paso 3 — Inicializando el cliente de Google GenAI...');
  let genAI: GoogleGenAI;
  try {
    genAI = new GoogleGenAI({ apiKey });
    console.log('  ✅ Cliente inicializado sin errores (esto NO confirma todavía que la clave sea válida — eso se prueba en el paso 4).');
  } catch (err: any) {
    const { status, mensaje } = describirError(err);
    console.log('  ❌ El SDK lanzó un error AL INICIALIZARSE (antes de siquiera llamar a un modelo):');
    console.log(`     status=${status} · mensaje="${mensaje}"`);
    console.log('');
    console.log(linea('═'));
    process.exitCode = 1;
    return;
  }
  console.log('');

  // ── Paso 4: llamada mínima real, probando cada candidato en orden ────────
  console.log('Paso 4 — Llamada mínima real a la API ("Responde solo: OK"), probando cada modelo candidato en orden hasta que uno responda:');
  console.log('');
  let exitoso = false;
  for (const modelo of ALL_CANDIDATE_MODELS) {
    process.stdout.write(`  → Probando modelo "${modelo}"... `);
    try {
      const inicio = Date.now();
      const respuesta = await genAI.models.generateContent({
        model: modelo,
        contents: 'Responde solo con la palabra: OK',
        config: { maxOutputTokens: 10 },
      });
      const ms = Date.now() - inicio;
      const texto = (respuesta && (respuesta as any).text) || '(respuesta vacía)';
      console.log(`✅ ÉXITO (${ms}ms)`);
      console.log(`     Texto recibido: "${String(texto).trim()}"`);
      console.log('');
      console.log(linea());
      console.log(`  RESULTADO: la API key ES VÁLIDA y el modelo "${modelo}" respondió correctamente.`);
      if (modelo !== PRIMARY_MODEL) {
        console.log(`  ⚠️ Nota: el modelo primario configurado ("${PRIMARY_MODEL}") NO fue el que respondió —`);
        console.log(`     falló antes de llegar a "${modelo}". Revise el detalle de los modelos anteriores`);
        console.log('     arriba para decidir si vale la pena ajustar GEMINI_MODEL o la lista de candidatos.');
      }
      exitoso = true;
      break;
    } catch (err: any) {
      const { status, mensaje } = describirError(err);
      console.log(`❌ FALLÓ`);
      console.log(`     status=${status} · mensaje técnico="${mensaje}"`);
      console.log(`     Interpretación probable: ${interpretarCausaProbable(status, mensaje)}`);
      console.log('');
    }
  }

  if (!exitoso) {
    console.log(linea());
    console.log('  RESULTADO: NINGÚN modelo de la lista respondió correctamente.');
    console.log('  Esto explica exactamente el síntoma reportado: la aplicación agota TODOS');
    console.log('  los candidatos y termina mostrando el mensaje amigable genérico al usuario');
    console.log('  final (por diseño, desde las Rondas 48/50, nunca el detalle técnico) — el');
    console.log('  detalle técnico real de CADA intento está impreso arriba, modelo por modelo.');
    process.exitCode = 1;
  }

  console.log(linea('═'));
}

main().catch((err) => {
  console.error('');
  console.error('❌ Error inesperado ejecutando el diagnóstico (no relacionado con Gemini en sí):');
  console.error(err);
  process.exitCode = 1;
});
