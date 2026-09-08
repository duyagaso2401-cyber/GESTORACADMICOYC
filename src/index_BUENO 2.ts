// ============================================================
// GESTOR ACADÉMICO YC — API SERVER
// Express + Node.js | Puerto 8080
// ============================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db, kvStore, notifications, documents, pushSubscriptions } from './db/index.js';
import repositorioRouter from './routes/repositorio.js';
import { eq, desc, and, isNull, or } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import webpush from 'web-push';
import { uploadMemoria, subirBufferACloudinary } from './lib/upload.js';
import { cloudinaryConfigurado } from './lib/cloudinary.js';

// ============================================================
// FIRMA DE DOCUMENTOS (boletines) — HMAC-SHA256 con una clave que
// solo existe en el servidor (DOC_SIGN_SECRET). El navegador nunca
// conoce esta clave, así que no puede generar códigos válidos por
// su cuenta: solo puede pedirle al servidor que firme un documento,
// y luego pedirle que verifique si un código corresponde exactamente
// a los datos actuales. Esto es lo que hace que el código no se
// pueda falsificar simplemente leyendo el código fuente de la app
// (algo que sí era posible con la versión anterior, calculada 100%
// en el navegador).
// ============================================================
const DOC_SIGN_SECRET = process.env.DOC_SIGN_SECRET || '';
function _jsonEstable(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(_jsonEstable).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _jsonEstable((obj as Record<string, unknown>)[k])).join(',') + '}';
}
function _firmarBlob(datos: unknown): string {
  return crypto.createHmac('sha256', DOC_SIGN_SECRET).update(_jsonEstable(datos)).digest('hex').slice(0, 16).toUpperCase();
}

// ============================================================
// NOTIFICACIONES PUSH (Web Push) — requiere VAPID_PUBLIC_KEY y
// VAPID_PRIVATE_KEY en el .env. Si no están configuradas, el envío
// de push simplemente se omite (no rompe el resto de la app).
// Generar un par nuevo con: npx web-push generate-vapid-keys
// ============================================================
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@gestoracademicoyc.com';
const PUSH_HABILITADO = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_HABILITADO) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('⚠️ VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas: las notificaciones push están desactivadas.');
}

// Envía una notificación push a los dispositivos suscritos que correspondan
// a la institución (y, si aplica, al grado) del evento que la origina.
// Nunca lanza: un fallo aquí no debe afectar la respuesta HTTP normal.
async function enviarPushParaNotificacion(sk: string, kind: string, message: string, meta: any) {
  if (!PUSH_HABILITADO || !sk) return;
  try {
    let subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.sk, sk));
    if (!subs.length) return;
    if (meta && meta.estId) {
      const estId = String(meta.estId);
      subs = subs.filter(s => s.estId === estId);
    } else if (meta && meta.grado) {
      const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
      const data: any = rows[0]?.value || {};
      const estIdsDelGrado = new Set((data.ests || []).filter((e: any) => e.g === meta.grado).map((e: any) => String(e.id)));
      subs = subs.filter(s => s.estId && estIdsDelGrado.has(s.estId));
    }
    if (!subs.length) return;
    const payload = JSON.stringify({
      title: 'Gestor Académico YC',
      body: String(message || '').slice(0, 180),
      kind,
    });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription as any, payload);
      } catch (err: any) {
        // Suscripción vencida o inválida (el navegador la revocó): se limpia.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        }
      }
    }));
  } catch (e) {
    console.error('enviarPushParaNotificacion', e);
  }
}

// ============================================================
// A01 · CONFIGURACIÓN EXPRESS, CORS Y MIDDLEWARE
// ============================================================

const app = express();
const PORT = parseInt(process.env.PORT || '8080');
const IS_PROD = process.env.NODE_ENV === 'production';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '../gestor-academico/dist');

// Configuración robusta de CORS para soportar Live Server, Replit y Render
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-gemini-api-key', 'x-gemini-key', 'x-api-key'],
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '50mb' }));

// ============================================================
// A02 · HELPERS — IA (GEMINI), SSE Y UTILIDADES
// ============================================================

// ── Gemini ────────────────────────────────────────────────────────────────────

function getGeminiApiKey(req?: express.Request): string {
  if (req) {
    const bodyKey = (req.body && (req.body.apiKey || req.body.geminiApiKey || req.body.geminiKey)) as string;
    if (bodyKey && typeof bodyKey === 'string' && bodyKey.trim()) return bodyKey.trim();
    const headerKey = (req.headers['x-gemini-api-key'] || req.headers['x-gemini-key'] || req.headers['x-api-key']) as string;
    if (headerKey && typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
    const authHeader = req.headers['authorization'] as string;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token.startsWith('AIza')) return token;
    }
  }
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

// Modelos activos y vigentes únicamente
const PRIMARY_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^models\//, '').trim();

const CANDIDATE_MODELS = [
    PRIMARY_MODEL,
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
].filter((model, index, self) => Boolean(model) && self.indexOf(model) === index);

function getGenAI(apiKeyParam?: string) {
  const apiKey = (apiKeyParam || getGeminiApiKey()).trim();
  if (!apiKey) return null;
  try {
    return new GoogleGenAI({ apiKey });
  } catch (err) {
    console.error('Error al inicializar GoogleGenAI:', err);
    return null;
  }
}

/**
 * Construye el system prompt de Adán con el contexto de la institución activa.
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

  return `Eres Adán, un asistente de inteligencia artificial avanzado — igual que Gemini, ChatGPT o Claude. Puedes responder CUALQUIER pregunta sobre CUALQUIER tema sin excepción. Además, funcionas como un Copilot Pedagógico y actúas como un Sico orientador pedagógico y psicólogo educativo para apoyar a la comunidad académica.

USUARIO ACTIVO:
- Nombre: ${usuario}
- Rol en el sistema: ${rolLabel}
- Módulo activo: ${modulo}
- Contexto del sistema: ${ctxSistema}

CONOCIMIENTO ESPECIALIZADO (Gestor Académico YC):
Además de ser un asistente general, tienes conocimiento profundo del sistema Gestor Académico YC para instituciones educativas colombianas y debes actuar como Sico orientador pedagógico en los módulos de historial, asistencia, descriptores y observador:

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
2. Análisis psicopedagógico profundo de observadores estudiantiles (comportamiento, dificultades, logros)
3. Planificación curricular: secuencias didácticas, planes de aula, descriptores de desempeño
4. Orientación paso a paso sobre cualquier función del sistema
5. Redacción de documentos: actas, comunicados, informes, circulares, cartas institucionales
6. Resolución de problemas matemáticos, científicos, históricos, literarios, etc.
7. Crear planes de nivelación académica y estrategias pedagógicas para estudiantes con inasistencias o bajo rendimiento.

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

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

const GESTOR_SK = '__gestor_academico_yc__';

app.get('/api/inetis/db', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
    if (!rows.length) return res.json({ data: null, version: null });
    return res.json({ data: rows[0].value, version: rows[0].updatedAt ? rows[0].updatedAt.toISOString() : null });
  } catch (e) {
    console.error('GET /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// Elimina definitivamente los datos de una institución (usado por el súper
// admin al borrar una plataforma). Antes solo se limpiaba el localStorage
// del navegador que hacía la operación; los datos reales quedaban huérfanos
// en la base de datos y podían reaparecer si alguien creaba otra plataforma
// con el mismo identificador ("sk"). Ahora se borra también en el servidor.
app.delete('/api/inetis/db', async (req, res) => {
  try {
    const sk = String(req.query.sk || (req.body && req.body.sk) || '');
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    await db.delete(kvStore).where(eq(kvStore.key, sk));
    await db.delete(notifications).where(eq(notifications.sk, sk));
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// Guardado con detección de ediciones concurrentes (optimistic
// concurrency control): el cliente envía la versión ("baseVersion")
// que tenía al momento de empezar a editar. Si nadie más guardó
// desde entonces, se acepta normalmente. Si alguien más ya guardó
// (por ejemplo otro docente editando la misma planilla), se
// responde 409 con los datos actuales del servidor para que el
// cliente combine los cambios en vez de sobrescribirlos a ciegas.
// Si el cliente no envía "baseVersion" (versiones antiguas del
// frontend, o el HTML de uso sin conexión), se guarda como antes,
// sin verificación, para no romper compatibilidad.
// ============================================================
app.post('/api/inetis/db', async (req, res) => {
  try {
    const { sk, data, baseVersion } = req.body as { sk: string; data: unknown; baseVersion?: string | null };
    if (!sk) return res.status(400).json({ error: 'sk requerido' });

    if (baseVersion !== undefined) {
      const existing = await db.select().from(kvStore).where(eq(kvStore.key, sk));
      const currentVersion = existing.length && existing[0].updatedAt ? existing[0].updatedAt.toISOString() : null;
      if (existing.length && currentVersion !== baseVersion) {
        // Alguien más guardó primero: se informa al cliente para que combine y reintente.
        return res.status(409).json({
          error: 'conflict',
          data: existing[0].value,
          version: currentVersion,
        });
      }
    }

    const nowTs = new Date();
    await db
      .insert(kvStore)
      .values({ key: sk, value: data as any, updatedAt: nowTs })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: data as any, updatedAt: nowTs },
      });
    broadcastChange(sk);
    return res.json({ ok: true, version: nowTs.toISOString() });
  } catch (e) {
    console.error('POST /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

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
    const sk = req.query.sk !== undefined ? String(req.query.sk || '') : null;
    const kind = req.query.kind !== undefined ? String(req.query.kind || '') : null;
    // sk presente → solo esa institución (portales de padre/estudiante/docente/admin).
    // sk ausente → sin filtrar, para el panel del súper admin (ve todas las instituciones a propósito).
    // kind opcional → por ejemplo 'salud-guardado' para el Panel de Salud del Sistema,
    // sin tener que traer y filtrar en el navegador todas las notificaciones existentes.
    const condiciones = [
      sk !== null ? eq(notifications.sk, sk) : undefined,
      kind !== null ? eq(notifications.kind, kind) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const rows = await db
      .select()
      .from(notifications)
      .where(condiciones.length ? and(...condiciones) : undefined)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return res.json({ notifications: rows });
  } catch (e) {
    console.error('GET /api/inetis/notifications', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/notify', async (req, res) => {
  try {
    const { kind, actor, message, meta, sk } = req.body as {
      kind: string; actor: string; message: string; meta?: unknown; sk?: string;
    };
    await db.insert(notifications).values({
      sk: sk || null,
      kind: kind || 'info',
      actor: actor || '',
      message: message || '',
      meta: (meta || null) as any,
      seen: false,
    });
    if (sk) enviarPushParaNotificacion(sk, kind || 'info', message || '', meta).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/notify', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// SUSCRIPCIONES A NOTIFICACIONES PUSH
// ============================================================
app.get('/api/inetis/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY, habilitado: PUSH_HABILITADO });
});

app.post('/api/inetis/push/subscribe', async (req, res) => {
  try {
    const { sk, userU, rol, estId, subscription } = req.body as {
      sk: string; userU: string; rol?: string; estId?: string | number; subscription?: { endpoint: string };
    };
    if (!sk || !userU || !subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    await db.insert(pushSubscriptions).values({
      sk, userU, rol: rol || '', estId: estId != null ? String(estId) : null,
      endpoint: subscription.endpoint, subscription: subscription as any,
    }).onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { sk, userU, rol: rol || '', estId: estId != null ? String(estId) : null, subscription: subscription as any },
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/push/subscribe', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/push/unsubscribe', async (req, res) => {
  try {
    const endpoint = String((req.body && req.body.endpoint) || '');
    if (endpoint) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/push/unsubscribe', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/notify/seen', async (req, res) => {
  try {
    const sk = String((req.body && req.body.sk) || '');
    // Si se indica institución, solo se marcan como leídas SUS notificaciones.
    // Sin sk (panel del súper admin), se conserva el comportamiento global.
    await db.update(notifications).set({ seen: true }).where(sk ? eq(notifications.sk, sk) : undefined);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/notify/seen', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// FIRMA Y VERIFICACIÓN DE BOLETINES (código de autenticidad + QR)
// El navegador nunca conoce DOC_SIGN_SECRET: solo puede pedir que se
// firme un documento (al generarlo) o que se verifique un código
// contra los datos actuales (al comprobarlo). Sin la clave secreta
// del servidor es imposible generar un código válido para datos
// alterados, así que un boletín no se puede "editar" y seguir
// pasando la verificación.
// ============================================================
app.post('/api/inetis/boletin/firmar', (req, res) => {
  if (!DOC_SIGN_SECRET) return res.status(503).json({ error: 'La firma de documentos no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
  try {
    const { documentos } = req.body as { documentos?: { ref: string; datos: unknown }[] };
    if (!Array.isArray(documentos) || !documentos.length) return res.status(400).json({ error: 'documentos requerido' });
    const codigos = documentos.map(d => ({ ref: d.ref, codigo: _firmarBlob(d.datos) }));
    return res.json({ codigos });
  } catch (e) {
    console.error('POST /api/inetis/boletin/firmar', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

interface ArchivoSubidoMulter {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

app.post('/api/inetis/boletin/verificar', (req, res) => {
  if (!DOC_SIGN_SECRET) return res.status(503).json({ error: 'La firma de documentos no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
  try {
    const { datos, codigo } = req.body as { datos?: unknown; codigo?: string };
    if (datos === undefined || !codigo) return res.status(400).json({ error: 'datos y codigo son requeridos' });
    const esperado = _firmarBlob(datos);
    return res.json({ valido: esperado === String(codigo).toUpperCase() });
  } catch (e) {
    console.error('POST /api/inetis/boletin/verificar', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// A05B · RUTAS — CARGA DE ARCHIVOS (Cloudinary)
// ============================================================
// Todos los archivos (fotos de perfil, logos, escudos, firmas,
// evidencias, documentos) se suben aquí en vez de guardarse como texto
// Base64 dentro de la base de datos. El navegador manda el archivo con
// multipart/form-data (campo "archivo"); esta ruta lo recibe con
// Multer (en memoria, nunca toca el disco), lo sube a Cloudinary con
// upload_stream, y devuelve SOLO la URL pública (secure_url) — eso es
// lo único que el navegador debe guardar en el registro
// correspondiente (ej. db.logo = url).
//
// "carpeta" (opcional, en el formulario) organiza los archivos dentro
// de Cloudinary por tipo, ej. "fotos-perfil", "logos-institucion",
// "documentos". Si no se envía, cae en una carpeta general.
// Ruta de diagnóstico: abra esto directamente en el navegador (GET, sin
// necesidad de subir nada) para confirmar sin ambigüedad si Cloudinary
// está configurado en ESTE proceso que está corriendo ahora mismo — más
// confiable que revisar el historial de la terminal, que puede mostrar
// texto de una ejecución anterior.
app.get('/api/inetis/upload/status', (req, res) => {
  res.json({
    cloudinaryConfigurado,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ? process.env.CLOUDINARY_CLOUD_NAME : null,
    mensaje: cloudinaryConfigurado
      ? '✅ Cloudinary está configurado y listo para recibir archivos.'
      : '⚠️ Cloudinary NO está configurado — faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET en las variables de entorno de ESTE proceso.',
  });
});

app.post('/api/inetis/upload', uploadMemoria.single('archivo'), async (req, res) => {
  if (!cloudinaryConfigurado) {
    return res.status(503).json({ error: 'La carga de archivos no está configurada en el servidor (faltan las variables CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET).' });
  }
  try {
    const archivo = (req as unknown as { file?: ArchivoSubidoMulter }).file;
    if (!archivo) return res.status(400).json({ error: 'No se recibió ningún archivo (campo "archivo" requerido).' });
    const carpeta = String(req.body?.carpeta || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
    const sk = String(req.body?.sk || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const tipoForzado = String(req.body?.resourceType || '');
    const esImagen = archivo.mimetype.startsWith('image/');
    const resourceType = (tipoForzado === 'raw' || tipoForzado === 'image' || tipoForzado === 'auto')
      ? tipoForzado
      : (esImagen ? 'image' : 'auto');
    const resultado = await subirBufferACloudinary(archivo.buffer, {
      folder: 'gestor-yc/' + (sk ? sk + '/' : '') + carpeta,
      resourceType,
    });
    return res.json({ url: resultado.url, bytes: resultado.bytes, format: resultado.format });
  } catch (e) {
    console.error('POST /api/inetis/upload', e);
    return res.status(500).json({ error: 'No se pudo subir el archivo. Intente de nuevo.' });
  }
});

// ============================================================
// A06 · RUTAS — ASISTENTE IA ADÁN (GEMINI)
// ============================================================

app.get('/api/inetis/ai/status', async (req, res) => {
  const apiKey = getGeminiApiKey(req);
  if (!apiKey) {
    return res.json({
      ok: false,
      keyConfigured: false,
      message: 'GEMINI_API_KEY o GOOGLE_API_KEY no encontrada en .env ni en variables de entorno.'
    });
  }

  try {
    const genAI = getGenAI(apiKey);
    if (!genAI) {
      return res.json({ ok: false, keyConfigured: false, message: 'No se pudo inicializar la librería GoogleGenAI' });
    }

    let activeModel = '';
    let lastError = '';

    for (const m of CANDIDATE_MODELS) {
      try {
        const testRes = await genAI.models.generateContent({
          model: m,
          contents: 'Hola',
          config: { maxOutputTokens: 10 }
        });
        if (testRes && (testRes.text || testRes.candidates)) {
          activeModel = m;
          break;
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    if (activeModel) {
      return res.json({
        ok: true,
        keyConfigured: true,
        model: activeModel,
        message: `Asistente Adán conectado correctamente con modelo ${activeModel}`
      });
    } else {
      return res.json({
        ok: false,
        keyConfigured: true,
        message: `Clave detectada pero hubo fallo al consultar modelos Gemini: ${lastError}`
      });
    }
  } catch (e: any) {
    return res.status(200).json({ ok: false, keyConfigured: true, error: e?.message || 'Error de diagnóstico' });
  }
});

app.post('/api/inetis/ai/chat', async (req, res) => {
  try {
    const { messages, context, mode, imagePart } = req.body as {
      messages: Array<{ role: string; content: string }>;
      context?: Record<string, unknown>;
      mode?: string;
      imagePart?: { mimeType: string; data: string };
    };

    const apiKey = getGeminiApiKey(req);
    if (!apiKey) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ content: '⚠️ **Asistente Adán**: Clave GEMINI_API_KEY o GOOGLE_API_KEY no detectada en el servidor (.env) ni en la petición.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const genAI = getGenAI(apiKey);
    if (!genAI) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ content: '⚠️ Error al inicializar el cliente de Google Gemini con la clave proporcionada.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const systemPrompt = buildSystemPrompt(context || {});

    const history = (messages || []).slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content || '' }],
    }));

    const lastMsg  = (messages && messages.length > 0) ? messages[messages.length - 1] : null;
    const userText = lastMsg?.content || '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const isPlanear = mode === 'planear' || (messages || []).some(m =>
      m.content && m.content.includes('planeación de clase COMPLETA')
    );

    let stream = null;
    let streamModel = '';
    let lastError: any = null;

   /* for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const chat = genAI.chats.create({
          model: candidateModel,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.8,
            maxOutputTokens: isPlanear ? 8192 : 4096,
          },
          history,
        });

        if (imagePart && imagePart.data) {
          stream = await chat.sendMessageStream({
            message: [
              { text: userText || 'Analiza esta imagen y describe lo que ves.' },
              { inlineData: { mimeType: imagePart.mimeType || 'image/jpeg', data: imagePart.data } },
            ],
          });
        } else {
          stream = await chat.sendMessageStream({ message: userText });
        }
        streamModel = candidateModel;
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ Intento fallido con modelo IA ${candidateModel}:`, err?.message || err);
      }
    }
*/
for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const chat = genAI.chats.create({
          model: candidateModel,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
            maxOutputTokens: isPlanear ? 4096 : 2048, // Permite respuestas largas sin cortar la idea
          },
          history: history.slice(-6), // Mantiene un contexto de conversación equilibrado
        });

        if (imagePart && imagePart.data) {
          stream = await chat.sendMessageStream({
            message: [
              { text: userText || 'Analiza esta imagen.' },
              { inlineData: { mimeType: imagePart.mimeType || 'image/jpeg', data: imagePart.data } },
            ],
          });
        } else {
          stream = await chat.sendMessageStream({ message: userText });
        }
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ Intento fallido con modelo ${candidateModel}:`, err?.message || err);
      }
    }
    if (!stream) {
      const errMsg = lastError?.message || 'No se pudo establecer conexión con los modelos Gemini de Google.';
      res.write(`data: ${JSON.stringify({ content: `⚠️ Error de conexión con Gemini: ${errMsg}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
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
    console.error('POST /api/inetis/ai/chat error:', e);
    const msg = e instanceof Error ? e.message : 'Error interno de comunicación con la IA';
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    try {
      res.write(`data: ${JSON.stringify({ content: `⚠️ Error: ${msg}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {}
    return;
  }
});

app.post('/api/inetis/ai/general', async (req, res) => {
  try {
    const { messages, context, prompt } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      context?: Record<string, unknown>;
      prompt?: string;
    };

    const apiKey = getGeminiApiKey(req);
    if (!apiKey) {
      return res.json({
        ok: false,
        error: 'GEMINI_API_KEY_NO_CONFIGURADA',
        content: '⚠️ La clave GEMINI_API_KEY o GOOGLE_API_KEY no está configurada.'
      });
    }

    const genAI = getGenAI(apiKey);
    if (!genAI) {
      return res.json({
        ok: false,
        error: 'ERROR_INICIALIZANDO_GENAI',
        content: '⚠️ No se pudo inicializar el cliente de Google Gemini con la clave provista.'
      });
    }

    const systemPrompt = buildSystemPrompt(context || {});
    const userText = prompt || (messages && messages[messages.length - 1]?.content) || '';

    if (!userText) return res.status(400).json({ ok: false, error: 'Texto vacío', content: '' });

    let resultText = '';
    let lastError: any = null;

    for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const result = await genAI.models.generateContent({
          model: candidateModel,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
          contents: userText,
        });
        if (result && result.text) {
          resultText = result.text;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ Error en ai/general con modelo ${candidateModel}:`, err?.message || err);
      }
    }

    if (!resultText && lastError) {
      return res.json({
        ok: false,
        error: lastError?.message || 'Error en consulta Gemini',
        content: `⚠️ No se pudo generar la respuesta con Gemini: ${lastError?.message || 'Error desconocido'}`
      });
    }

    return res.json({ ok: true, content: resultText || '' });
  } catch (e: unknown) {
    console.error('POST /api/inetis/ai/general', e);
    const msg = e instanceof Error ? e.message : 'Error interno';
    return res.json({ ok: false, error: msg, content: `⚠️ Error al procesar solicitud de IA: ${msg}` });
  }
});

// ── RUTA DEDICADA PARA INFORMES Y REPORTES PSICOPEDAGÓGICOS POR GRADO Y PERIODO ─────────

app.post('/api/inetis/ai/psicopedagogico', async (req, res) => {
  try {
    const { grado, periodo, datosAsistencia, datosObservador, context } = req.body as {
      grado: string;
      periodo: string;
      datosAsistencia?: any[];
      datosObservador?: any[];
      context?: Record<string, unknown>;
    };

    const apiKey = getGeminiApiKey(req);
    if (!apiKey) {
      return res.status(400).json({ ok: false, message: 'Clave API no configurada' });
    }

    const genAI = getGenAI(apiKey);
    if (!genAI) {
      return res.status(500).json({ ok: false, message: 'Error al inicializar Gemini' });
    }

    const promptText = `
Genera un informe psicopedagógico detallado con las siguientes especificaciones:
- Grado evaluado: ${grado || 'Todos los grados'}
- Periodo académico: ${periodo || 'Todos los periodos'}
- Datos de inasistencias acumuladas: ${JSON.stringify(datosAsistencia || [])}
- Anotaciones del observador/convivencia: ${JSON.stringify(datosObservador || [])}

Proporciona:
1. Resumen ejecutivo de novedades comportamentales y de asistencia.
2. Identificación de estudiantes en riesgo académico o deserción.
3. Recomendaciones y compromisos recomendados para docentes y acudientes.
`;

    let resultText = '';
    for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const result = await genAI.models.generateContent({
          model: candidateModel,
          config: {
            systemInstruction: buildSystemPrompt(context || {}),
            temperature: 0.7,
            maxOutputTokens: 4096,
          },
          contents: promptText,
        });
        if (result && result.text) {
          resultText = result.text;
          break;
        }
      } catch (err) {
        console.warn(`Error con modelo ${candidateModel}:`, err);
      }
    }

    return res.json({ ok: true, report: resultText });
  } catch (e: any) {
    console.error('Error en /api/inetis/ai/psicopedagogico:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Error interno' });
  }
});

// ============================================================
// A06b · RUTAS — MÓDULO REPOSITORIO
// ============================================================

app.use('/api/repositorio', repositorioRouter);

app.get('/repositorio', (req, res) => {
  function _safeDecodeQP(raw: unknown): string {
    const s = String(raw || '').trim();
    if (!s) return '';
    try { return decodeURIComponent(s); } catch { return s; }
  }
  const instNombre = _safeDecodeQP(req.query._instNombre);
  const instEscudo = _safeDecodeQP(req.query._instEscudo);

  try {
    let html = fs.readFileSync(path.resolve(__dirname, '../modulo-repositorio/index.html'), 'utf8');

    if (instNombre) {
      const title = `REPOSITORIO RECURSOS · ${instNombre}`;
      html = html
        .replace(/<title id="site-title-tag">.*?<\/title>/,
          `<title id="site-title-tag">${title}</title>`)
        .replace(/<div class="hdr-title" id="hdr-inst-name">.*?<\/div>/,
          `<div class="hdr-title" id="hdr-inst-name">${title}</div>`);
    }

    if (instEscudo) {
      html = html.replace(
        /<img id="hdr-logo"[^>]*>/,
        `<img id="hdr-logo" class="hdr-logo" src="${instEscudo}" alt="" style="">`
      );
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.removeHeader('ETag');
    res.send(html);
  } catch (_e) {
    res.sendFile(path.resolve(__dirname, '../modulo-repositorio/index.html'));
  }
});

app.use('/repositorio', express.static(path.resolve(__dirname, '../modulo-repositorio'), { index: false }));
app.use('/modulo-repositorio', express.static(path.resolve(__dirname, '../modulo-repositorio')));

// ============================================================
// A07 · RUTAS — FRONTEND ESTÁTICO (PRODUCCIÓN)
// ============================================================

if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR, { index: false }));
}

app.get('/', servePortal);
app.get('/admin-ycgestor',      servePortal);
app.get('/admin-portal-secure', servePortal);

// Comodín para servir el frontend en cualquier ruta no reconocida (SPA).
// Se usa una expresión regular literal (/.*/), NO el texto '*' — desde que
// Express (incluso en la rama 4.x, por una actualización de seguridad de su
// motor interno de rutas "path-to-regexp") dejó de aceptar '*' como cadena
// de texto para este tipo de ruta comodín. Una RegExp real evita ese
// problema por completo, sin importar la versión instalada.
app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return servePortal(req, res);
});

// ============================================================
// A08 · INICIO DEL SERVIDOR
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server escuchando en puerto ${PORT}`);
  const key = getGeminiApiKey();
  if (!key) {
    console.warn('⚠️  GEMINI_API_KEY no configurada — IA no disponible');
  } else {
    console.log(`✅  Asistente Adán IA configurado. Modelo preferido: ${PRIMARY_MODEL}`);
  }
});