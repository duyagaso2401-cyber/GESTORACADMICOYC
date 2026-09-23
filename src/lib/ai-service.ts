// ════════════════════════════════════════════════════════════════════════════
// RONDA 44 — DIMENSIÓN 7 (ADAPTADA, decisión de ingeniería explícita)
// ------------------------------------------------------------------------------
// El Prompt Maestro pide un "aiService.js" con Strategy Pattern Gemini/Ollama +
// Function Calling ya integrado en el Ecosistema Auditor y en "Adán". Se
// entrega aquí la CAPA de Strategy Pattern como infraestructura nueva y
// reutilizable (este archivo) — pero, de forma deliberadamente conservadora,
// NO se rewired el endpoint SSE existente de Adán (`/api/adan/*` en
// src/index.ts, ~línea 3919 en adelante) para consumirla en esta ronda: ese
// endpoint es uno de los flujos más usados y más delicados de toda la
// plataforma (streaming SSE, historial de conversación, function calling
// propio ya construido a mano sobre `GoogleGenAI` directamente), y
// reemplazar su proveedor por esta capa sin poder ejecutar pruebas reales
// contra un servidor Ollama de verdad (este entorno no tiene acceso a uno)
// habría sido un cambio de alto riesgo sin poder validarlo end-to-end.
//
// Lo que SÍ se entrega, real y funcional:
//   1) `AIStrategy` — interfaz común: `generar(prompt, opciones) => Promise<string>`.
//   2) `GeminiStrategy` — usa `@google/genai` (ya instalado), MISMA librería y
//      MISMA lógica de resolución de API key que ya usaba `getGeminiApiKey()`
//      en src/index.ts (se reimplementa aquí sin importar desde index.ts para
//      no crear un ciclo de módulos).
//   3) `OllamaStrategy` — usa `fetch` nativo (Node 18+, sin dependencia nueva)
//      contra `OLLAMA_BASE_URL` (nueva variable de entorno, ver .env.example),
//      hablando el protocolo REST estándar de Ollama (`POST /api/generate`).
//   4) `obtenerEstrategiaIA(opciones?)` — el propio Strategy Pattern: por
//      defecto siempre devuelve Gemini (proveedor actual, sin romper nada);
//      solo cambia a Ollama si `AI_PROVIDER=ollama` está explícitamente
//      configurado en el entorno (o se pasa `{ proveedor: 'ollama' }`) Y
//      `OLLAMA_BASE_URL` está configurada — si falta cualquiera de las dos
//      condiciones, se queda en Gemini silenciosamente (comportamiento por
//      defecto intacto).
//
// Cualquier ruta nueva que se construya en el futuro (o una futura ronda que
// SÍ quiera migrar el endpoint de Adán) puede importar `obtenerEstrategiaIA`
// de aquí sin más cambios. Documentado también en CHECKLIST_DESPLIEGUE.md.
// ════════════════════════════════════════════════════════════════════════════
import { GoogleGenAI } from '@google/genai';
import { ALL_CANDIDATE_MODELS, llamarGeminiConResiliencia } from './gemini-config.js';

export interface OpcionesGeneracionIA {
  proveedor?: 'gemini' | 'ollama';
  apiKey?: string;
  modelo?: string;
  temperatura?: number;
}

export interface AIStrategy {
  nombre: 'gemini' | 'ollama';
  generar(prompt: string, opciones?: OpcionesGeneracionIA): Promise<string>;
}

class GeminiStrategy implements AIStrategy {
  nombre: 'gemini' = 'gemini';
  async generar(prompt: string, opciones?: OpcionesGeneracionIA): Promise<string> {
    const apiKey = (opciones?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY o GOOGLE_API_KEY no configurada.');
    const genAI = new GoogleGenAI({ apiKey });
    // RONDA 48: si el llamador pide un modelo explícito (opciones.modelo),
    // se respeta como PRIMER intento, pero ya no se queda solo con ese —
    // se completa con la lista central de fallback para no perder
    // resiliencia por pedir un modelo puntual. Sin `opciones.modelo`, usa
    // la lista central completa (mismo criterio que el resto del sistema).
    const modelosAProbar = opciones?.modelo
      ? [opciones.modelo.replace(/^models\//, '').trim(), ...ALL_CANDIDATE_MODELS].filter((m, i, self) => Boolean(m) && self.indexOf(m) === i)
      : ALL_CANDIDATE_MODELS;
    const intento = await llamarGeminiConResiliencia(async (modelo) => {
      const res = await genAI.models.generateContent({ model: modelo, contents: prompt });
      return (res as any)?.text || '';
    }, { modelos: modelosAProbar, etiqueta: 'GeminiStrategy' });
    if (!intento.ok) throw intento.error || new Error('No se pudo generar contenido con ningún modelo Gemini disponible.');
    return intento.resultado || '';
  }
}

class OllamaStrategy implements AIStrategy {
  nombre: 'ollama' = 'ollama';
  async generar(prompt: string, opciones?: OpcionesGeneracionIA): Promise<string> {
    const base = (process.env.OLLAMA_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('OLLAMA_BASE_URL no configurada.');
    const modelo = opciones?.modelo || process.env.OLLAMA_MODEL || 'llama3';
    const resp = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, prompt, stream: false, options: { temperature: opciones?.temperatura ?? 0.7 } }),
    });
    if (!resp.ok) throw new Error(`Ollama respondió ${resp.status}`);
    const j: any = await resp.json();
    return j?.response || '';
  }
}

const _geminiStrategy = new GeminiStrategy();
const _ollamaStrategy = new OllamaStrategy();

// Strategy Pattern: elección del proveedor. Por defecto SIEMPRE Gemini
// (proveedor actual del sistema, sin romper nada de las 43 rondas
// anteriores) — solo cambia a Ollama si se pide explícitamente Y hay
// servidor Ollama configurado.
export function obtenerEstrategiaIA(opciones?: OpcionesGeneracionIA): AIStrategy {
  const quiereOllama = opciones?.proveedor === 'ollama' || (process.env.AI_PROVIDER || '').trim().toLowerCase() === 'ollama';
  const hayOllama = !!(process.env.OLLAMA_BASE_URL || '').trim();
  if (quiereOllama && hayOllama) return _ollamaStrategy;
  return _geminiStrategy;
}

export async function generarConEstrategiaIA(prompt: string, opciones?: OpcionesGeneracionIA): Promise<string> {
  const estrategia = obtenerEstrategiaIA(opciones);
  return estrategia.generar(prompt, opciones);
}
