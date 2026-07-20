// ============================================================
// GESTOR ACADÉMICO YC — API SERVER
// Express + Node.js | Puerto 8080
// ============================================================

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, kvStore, notifications, documents } from './db/index.js';
import { eq, desc } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';

// ============================================================
// A01 · CONFIGURACIÓN EXPRESS, CORS Y MIDDLEWARE
// ============================================================

const app = express();
const PORT = parseInt(process.env.PORT || '8080');
const IS_PROD = process.env.NODE_ENV === 'production';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Esta es la ruta corregida basada en tu estructura de carpetas:
const STATIC_DIR = path.resolve(__dirname, '../gestor-academico/dist');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// ============================================================
// A02 · HELPERS — IA (GEMINI), SSE Y UTILIDADES
// ============================================================

// ── Gemini ────────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL   = 'gemini-2.5-flash';

function getGenAI() {
  if (!GEMINI_API_KEY) return null;
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

/**
 * Construye el system prompt de Adán con el contexto de la institución activa.
 * Soporta modo gestor (multi-plataforma) y modo institución (single-tenant).
 */
function buildSystemPrompt(context: Record<string, unknown>): string {
  const inst            = context.institucion    as string   || 'Gestor Académico YC';
  const modulo          = context.modulo         as string   || 'general';
  const usuario         = context.usuario        as string   || 'Invitado';
  const rol             = context.rol            as string   || 'visitante';
  const anio            = context.anio           as string   || new Date().getFullYear().toString();
  const esGestor        = !!(context.gestorMode);
  const nombreInst      = context.nombreInst     as string   || inst;
  const numEstudiantes  = context.numEstudiantes as number   || 0;
  const numDocentes     = context.numDocentes    as number   || 0;
  const grados          = (context.grados        as string[]) || [];
  const perActual       = context.periodoActual  as string   || '1';
  const numPeriodos     = context.numPeriodos    as number   || 4;
  const escalaS         = context.escalaS        as number   || 4.7;
  const escalaA         = context.escalaA        as number   || 4.0;
  const escalaB         = context.escalaB        as number   || 3.0;
  const asignaturas     = (context.asignaturas   as string[]) || [];
  const misAsignaturas  = (context.misAsignaturas as string[]) || [];

  const rolLabel = rol === 'admin'       ? 'Administrador / Rector(a)'
                 : rol === 'docente'     ? 'Docente'
                 : rol === 'estudiante'  ? 'Estudiante'
                 : rol === 'padre'       ? 'Padre/Acudiente'
                 : rol === 'admin-gestor'? 'Administrador General'
                 : rol;

  const ctxSistema = esGestor
    ? `Estás en modo Gestor Multi-Plataforma. El usuario administra múltiples instituciones educativas desde el panel central.`
    : `Institución: ${nombreInst} | Año: ${anio} | Grados: ${grados.join(', ') || 'N/A'} | Estudiantes: ${numEstudiantes} | Docentes: ${numDocentes} | Periodos: ${numPeriodos} | Periodo actual: ${perActual} | Escala: S≥${escalaS} A≥${escalaA} B≥${escalaB} | Asignaturas: ${asignaturas.join(', ') || 'N/A'}${misAsignaturas.length ? ` | Mis asignaturas: ${misAsignaturas.join(', ')}` : ''}`;

  return `Eres Adán, un asistente de inteligencia artificial avanzado — igual que Gemini, ChatGPT o Claude. Puedes responder CUALQUIER pregunta sobre CUALQUIER tema sin excepción: ciencias, matemáticas, historia, programación, filosofía, arte, medicina, derecho, entretenimiento, cocina, deportes, viajes, tecnología, relaciones personales, o cualquier otro tema que el usuario necesite.

USUARIO ACTIVO:
- Nombre: ${usuario}
- Rol en el sistema: ${rolLabel}
- Módulo activo: ${modulo}
- Contexto del sistema: ${ctxSistema}

CONOCIMIENTO ESPECIALIZADO (Gestor Académico YC):
Además de ser un asistente general, tienes conocimiento profundo del sistema Gestor Académico YC para instituciones educativas colombianas:

MÓDULOS DISPONIBLES:
• Planilla de Calificaciones — notas por SER/SABER/HACER, pendientes con borde amarillo, se aplican con "GUARDAR CAMBIOS"
• Descriptores — desempenos por nivel (Superior/Alto/Básico/Bajo) por asignatura, grado, periodo
• Horarios — bloques de clase por grado, lunes a viernes
• Asistencia — P/A/J por fecha, grado y asignatura, planillas PDF
• Observador — anotaciones de convivencia, logros y compromisos con fecha automática
• Pre-matrícula — inscripciones en línea con aprobación del admin
• Boletines/Informes — PDFs por estudiante, consolidados, rankings
• Documentos/Actas — actas, paz y salvo, certificados, constancias
• Años Lectivos — gestión de años aislados, histórico, importación entre años
• Evaluación Docente, Democracia Escolar, Comunicados, Quizzes, y más

NORMATIVA COLOMBIANA:
• Decreto 1290 de 2009: evaluación y promoción, escala propia con mínimo 4 niveles
• Ley 115 de 1994 (Ley General de Educación)
• Decreto 1075 de 2015 (Decreto Único Reglamentario del Sector Educación)

CAPACIDADES ESPECIALES:
1. Generar evaluaciones completas: quices, exámenes, talleres, actividades adaptadas al grado
2. Análisis psicopedagógico de observadores estudiantiles
3. Planificación curricular: secuencias didácticas, planes de aula, descriptores de desempeño
4. Orientación paso a paso sobre cualquier función del sistema
5. Redacción de documentos: actas, comunicados, informes, circulares, cartas institucionales
6. Resolución de problemas matemáticos, científicos, históricos, literarios, etc.

INSTRUCCIONES:
1. Responde en español colombiano, claro y personalizado según el rol del usuario (${rolLabel})
2. Para CUALQUIER pregunta de cualquier tema, responde de forma completa y útil
3. Para material académico (quices, evaluaciones), usa formato bien estructurado con markdown
4. Para código o cálculos, usa bloques de código apropiados
5. Para preguntas del sistema, explica paso a paso específico para el módulo activo (${modulo})
6. Nunca digas que "no puedes responder" un tema — puedes responder TODO
7. Si el usuario pide generar material de estudio, créalo completo y de alta calidad
8. Adapta la extensión de la respuesta a la complejidad de la pregunta
9. Usa los datos del sistema cuando el usuario pregunte sobre su institución específica`;
}

// ── SSE (Server-Sent Events) ──────────────────────────────────────────────────
// Mapa: sk → Set de respuestas SSE activas para sincronización en tiempo real.

const sseClients = new Map<string, Set<express.Response>>();

function broadcastChange(sk: string, extra?: Record<string, unknown>) {
  const clients = sseClients.get(sk);
  if (!clients || clients.size === 0) return;
  const msg = `data: ${JSON.stringify({ type: 'change', sk, ts: Date.now(), ...extra })}\n\n`;
  clients.forEach(res => {
    try { res.write(msg); } catch {}
  });
}

// ── Servir portal frontend ────────────────────────────────────────────────────

const portalPath = path.join(STATIC_DIR, 'portal.html');
const indexPath  = path.join(STATIC_DIR, 'index.html');

function servePortal(_req: express.Request, res: express.Response) {
  if (fs.existsSync(portalPath)) return res.sendFile(portalPath);
  if (fs.existsSync(indexPath))  return res.sendFile(indexPath);
  return res.status(200).send('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3;url=/"></head><body>Cargando...</body></html>');
}

// ============================================================
// A03 · RUTAS — SALUD Y SINCRONIZACIÓN EN TIEMPO REAL (SSE)
// ============================================================

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ── SSE — suscripción por canal (sk) ─────────────────────────────────────────
// El frontend se suscribe aquí; recibe un evento 'change' cada vez que
// otro dispositivo guarda datos en el mismo sk, permitiendo sync instantánea.

app.get('/api/inetis/events', (req, res) => {
  const sk = String(req.query.sk || '');
  if (!sk) { res.status(400).json({ error: 'sk requerido' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  if (!sseClients.has(sk)) sseClients.set(sk, new Set());
  sseClients.get(sk)!.add(res);

  res.write(`data: ${JSON.stringify({ type: 'connected', sk, ts: Date.now() })}\n\n`);

  const keepAlive = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { clearInterval(keepAlive); }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    const set = sseClients.get(sk);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseClients.delete(sk);
    }
  });
});

// ============================================================
// A04 · RUTAS — BASE DE DATOS POR INSTITUCIÓN (KV STORE)
// ============================================================
// Cada institución (plataforma) guarda su estado completo bajo una clave `sk`
// única. El Gestor YC tiene su propia clave especial (GESTOR_SK).

const GESTOR_SK = '__gestor_academico_yc__';

// ── KV genérico — datos de institución ───────────────────────────────────────

app.get('/api/inetis/db', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
    if (!rows.length) return res.json({ data: null });
    return res.json({ data: rows[0].value });
  } catch (e) {
    console.error('GET /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/db', async (req, res) => {
  try {
    const { sk, data } = req.body as { sk: string; data: unknown };
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    await db
      .insert(kvStore)
      .values({ key: sk, value: data as any, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: data as any, updatedAt: new Date() },
      });
    broadcastChange(sk);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ── Gestor DB — estado global del administrador general ───────────────────────

app.get('/api/inetis/gestordb', async (_req, res) => {
  try {
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    if (!rows.length) return res.json({ data: null });
    return res.json({ data: rows[0].value });
  } catch (e) {
    console.error('GET /api/inetis/gestordb', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/gestordb', async (req, res) => {
  try {
    const { data } = req.body as { data: unknown };
    await db
      .insert(kvStore)
      .values({ key: GESTOR_SK, value: data as any, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: data as any, updatedAt: new Date() },
      });
    broadcastChange(GESTOR_SK);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/gestordb', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ── Documentos — paz y salvo, certificados, actas, etc. ──────────────────────

app.get('/api/inetis/docs', async (req, res) => {
  try {
    const estId = String(req.query.estId || '');
    if (estId) {
      const rows = await db.select().from(documents).where(eq(documents.estId, estId));
      return res.json(rows.map(r => r.data));
    }
    const rows = await db.select().from(documents).limit(500);
    return res.json(rows.map(r => r.data));
  } catch (e) {
    console.error('GET /api/inetis/docs', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/docs', async (req, res) => {
  try {
    const { clave, ...data } = req.body as { clave: string; [k: string]: unknown };
    if (!clave) return res.status(400).json({ error: 'clave requerida' });
    const estId = String((data as any).estId || (data as any).est_id || '');
    await db
      .insert(documents)
      .values({ clave, estId, data: { clave, ...data } as any })
      .onConflictDoUpdate({
        target: documents.clave,
        set: { data: { clave, ...data } as any, estId },
      });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/docs', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/inetis/docs/:clave', async (req, res) => {
  try {
    const clave = decodeURIComponent(req.params.clave);
    const rows = await db.select().from(documents).where(eq(documents.clave, clave));
    if (!rows.length) return res.status(404).json(null);
    return res.json(rows[0].data);
  } catch (e) {
    console.error('GET /api/inetis/docs/:clave', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/inetis/docs/:clave', async (req, res) => {
  try {
    const clave = decodeURIComponent(req.params.clave);
    await db.delete(documents).where(eq(documents.clave, clave));
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/inetis/docs/:clave', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// A05 · RUTAS — NOTIFICACIONES DEL SISTEMA
// ============================================================

app.get('/api/inetis/notifications', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
    const rows = await db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return res.json(rows);
  } catch (e) {
    console.error('GET /api/inetis/notifications', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/notify', async (req, res) => {
  try {
    const { kind, actor, message, meta } = req.body as {
      kind: string; actor: string; message: string; meta?: unknown;
    };
    await db.insert(notifications).values({
      kind: kind || 'info',
      actor: actor || '',
      message: message || '',
      meta: (meta || null) as any,
      seen: false,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/notify', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/notify/seen', async (_req, res) => {
  try {
    await db.update(notifications).set({ seen: true });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/notify/seen', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// A06 · RUTAS — ASISTENTE IA ADÁN (GEMINI)
// ============================================================

// ── Chat con streaming (SSE) — módulo principal de Adán ──────────────────────
// Soporta visión multimodal: si `imagePart` viene en el cuerpo, se envía
// la imagen como inlineData a Gemini para análisis visual.

app.post('/api/inetis/ai/chat', async (req, res) => {
  try {
    const { messages, context, mode, imagePart } = req.body as {
      messages: Array<{ role: string; content: string }>;
      context?: Record<string, unknown>;
      mode?: string;
      imagePart?: { mimeType: string; data: string };
    };

    if (!GEMINI_API_KEY) {
      return res.status(503).json({ error: 'GEMINI_API_KEY no configurada' });
    }

    const genAI = getGenAI()!;
    const systemPrompt = buildSystemPrompt(context || {});

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }));

    const lastMsg  = messages[messages.length - 1];
    const userText = lastMsg?.content || '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const isPlanear = mode === 'planear' || messages.some(m =>
      m.content && m.content.includes('planeación de clase COMPLETA')
    );

    const chat = genAI.chats.create({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.8,
        maxOutputTokens: isPlanear ? 8192 : 4096,
      },
      history,
    });

    let stream;
    if (imagePart && imagePart.data) {
      stream = await chat.sendMessageStream({
        message: [
          { text: userText || 'Analiza esta imagen y describe lo que ves, luego responde lo que necesite el usuario.' },
          { inlineData: { mimeType: imagePart.mimeType || 'image/jpeg', data: imagePart.data } },
        ],
      });
    } else {
      stream = await chat.sendMessageStream({ message: userText });
    }

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ content: chunk.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
    return;
  } catch (e: unknown) {
    console.error('POST /api/inetis/ai/chat', e);
    const msg = e instanceof Error ? e.message : 'Error interno';
    if (!res.headersSent) return res.status(500).json({ error: msg });
    try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); } catch {}
    return;
  }
});

// ── Consulta simple sin streaming — para análisis de observador, sugerencias ─

app.post('/api/inetis/ai/general', async (req, res) => {
  try {
    const { messages, context, prompt } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      context?: Record<string, unknown>;
      prompt?: string;
    };

    if (!GEMINI_API_KEY) {
      return res.status(503).json({ error: 'GEMINI_API_KEY no configurada' });
    }

    const genAI = getGenAI()!;
    const systemPrompt = buildSystemPrompt(context || {});
    const userText = prompt || (messages && messages[messages.length - 1]?.content) || '';

    if (!userText) return res.status(400).json({ error: 'Texto vacío' });

    const result = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
      contents: userText,
    });

    return res.json({ content: result.text || '' });
  } catch (e: unknown) {
    console.error('POST /api/inetis/ai/general', e);
    const msg = e instanceof Error ? e.message : 'Error interno';
    return res.status(500).json({ error: msg });
  }
});

// ============================================================
// A07 · RUTAS — FRONTEND ESTÁTICO (PRODUCCIÓN)
// ============================================================
// En producción el API server sirve también el build de Vite.
// El archivo principal es portal.html (SPA monolítica de un solo archivo).

if (IS_PROD) {
  if (fs.existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR, { index: false }));
  }

  app.get('/', servePortal);
 // Rutas ocultas del Admin General
  app.get('/admin-ycgestor',      servePortal);
  app.get('/admin-portal-secure', servePortal);

  // Fallback SPA: cualquier ruta no-API devuelve portal.html
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    return servePortal(req, res);
  });
}

// ============================================================
// A08 · INICIO DEL SERVIDOR
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server escuchando en puerto ${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY no configurada — IA no disponible');
  }
});